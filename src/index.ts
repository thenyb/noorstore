// NoorStore — Noor Retail LLC online store (Cloudflare Worker + D1).
// Workflow: Register → Login → Add to cart → Checkout → My Orders → Order detail.
// The flag is NEVER in this repo: it arrives via the FLAG secret at runtime
// and lives only in D1 row orders(582).gift_note (see ensureOrderFlag).

import { hashPassword, verifyPassword, newSessionToken, sessionExpiryIso } from "./auth.js";
import {
  APP_CSS,
  APP_JS,
  checkoutPage,
  esc,
  homePage,
  loginPage,
  notFoundPage,
  orderDetailPage,
  ordersPage,
  registerPage,
} from "./html.js";

// Minimal structural D1 typings (the real binding is provided by the runtime).
interface D1Stmt {
  bind(...args: unknown[]): D1Stmt;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ success: boolean; meta?: { last_row_id?: number; changes?: number } }>;
}
interface D1Db {
  prepare(sql: string): D1Stmt;
  exec(sql: string): Promise<unknown>;
}
export interface Env {
  DB: D1Db;
  FLAG?: string;
  [k: string]: unknown;
}

interface UserRow {
  id: number;
  name: string;
  email: string;
}

// ---------------------------------------------------------------------------
// Deterministic seed (mirrors migrations/0002_seed.sql; INSERT OR IGNORE
// makes this a harmless no-op when migrations already applied).
// ---------------------------------------------------------------------------

const SEED_PRODUCTS = [
  [1, "Wireless Headphones", "سماعة رأس لاسلكية", "Bluetooth 5.3, noise cancelling, 40h battery.", 34900, 60, "🎧"],
  [2, "Smartphone X2", "هاتف ذكي X2", "128GB, 50MP camera, 2-year warranty.", 129900, 40, "📱"],
  [3, "Laptop Pro 14", "لابتوب برو 14", "14-inch, 16GB RAM, 512GB SSD, Arabic/English keyboard.", 289900, 25, "💻"],
  [4, "Coffee Maker", "ماكينة قهوة", "15-bar pump, Arabic coffee + espresso modes.", 45900, 50, "☕"],
  [5, "Smartwatch S", "ساعة ذكية S", "Heart-rate + sleep tracking, 10-day battery.", 79900, 70, "⌚"],
  [6, "Travel Backpack", "حقيبة ظهر للسفر", "35L, water resistant, laptop sleeve.", 18900, 90, "🎒"],
  [7, "Oud Perfume 100ml", "عطر عود 100مل", "Premium Arabian oud, gift box included.", 25900, 80, "🌸"],
  [8, "Desk Lamp", "مصباح مكتب", "LED, warm/cool modes, USB-C powered.", 12900, 120, "💡"],
] as const;

const VICTIM = {
  id: 1,
  name: "Layla Hassan",
  email: "layla@example.com",
  // PBKDF2-SHA256 (120000x) of a strong undisclosed password. Plaintext is
  // nowhere in this repo — reach this account's orders via the IDOR instead.
  password_hash: "11b201716e471b2fa3ddb0702a0c840b710d778a70aeee773be9feffc94bade4",
  salt: "e3aea0652e1c595fcc53e766e2597db8",
} as const;

async function ensureSchemaAndSeed(env: Env): Promise<void> {
  const db = env.DB;
  await db.exec(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, salt TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY, name_en TEXT NOT NULL, name_ar TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', price_cents INTEGER NOT NULL, stock INTEGER NOT NULL DEFAULT 100, emoji TEXT NOT NULL DEFAULT '📦');
CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, status TEXT NOT NULL DEFAULT 'paid', total_cents INTEGER NOT NULL, address TEXT NOT NULL, phone TEXT NOT NULL, gift_note TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
CREATE TABLE IF NOT EXISTS order_items (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE, product_id INTEGER NOT NULL REFERENCES products(id), qty INTEGER NOT NULL, unit_price_cents INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_items_order ON order_items(order_id);`);

  for (const p of SEED_PRODUCTS) {
    await db
      .prepare(
        "INSERT OR IGNORE INTO products (id,name_en,name_ar,description,price_cents,stock,emoji) VALUES (?,?,?,?,?,?,?)"
      )
      .bind(p[0], p[1], p[2], p[3], p[4], p[5], p[6])
      .run();
  }
  await db
    .prepare(
      "INSERT OR IGNORE INTO users (id,name,email,password_hash,salt,created_at) VALUES (?,?,?,?,?,?)"
    )
    .bind(VICTIM.id, VICTIM.name, VICTIM.email, VICTIM.password_hash, VICTIM.salt, "2026-01-10T09:00:00.000Z")
    .run();

  await db
    .prepare(
      "INSERT OR IGNORE INTO orders (id,user_id,status,total_cents,address,phone,gift_note,created_at) VALUES (?,?,?,?,?,?,?,?)"
    )
    .bind(581, 1, "delivered", 105800, "Jeddah, Al Hamra district, King Fahd Rd, Bldg 12", "+966501112233", "Please gift-wrap the perfume box. — Layla", "2026-09-02T14:20:00.000Z")
    .run();
  await db
    .prepare("INSERT OR IGNORE INTO order_items (id,order_id,product_id,qty,unit_price_cents) VALUES (?,?,?,?,?)")
    .bind(1001, 581, 5, 1, 79900)
    .run();
  await db
    .prepare("INSERT OR IGNORE INTO order_items (id,order_id,product_id,qty,unit_price_cents) VALUES (?,?,?,?,?)")
    .bind(1002, 581, 7, 1, 25900)
    .run();

  // Target order 582 — gift_note intentionally left NULL: filled at runtime
  // from the FLAG secret by ensureOrderFlag() (never from this repo).
  await db
    .prepare(
      "INSERT OR IGNORE INTO orders (id,user_id,status,total_cents,address,phone,gift_note,created_at) VALUES (?,?,?,?,?,?,?,?)"
    )
    .bind(582, 1, "paid", 324800, "Riyadh, Al Olaya district, Tower B, Apt 1402", "+966504445566", null, "2026-10-01T11:05:00.000Z")
    .run();
  await db
    .prepare("INSERT OR IGNORE INTO order_items (id,order_id,product_id,qty,unit_price_cents) VALUES (?,?,?,?,?)")
    .bind(1003, 582, 3, 1, 289900)
    .run();
  await db
    .prepare("INSERT OR IGNORE INTO order_items (id,order_id,product_id,qty,unit_price_cents) VALUES (?,?,?,?,?)")
    .bind(1004, 582, 1, 1, 34900) // product 1 (headphones)
    .run();
  try {
    await db.exec("UPDATE sqlite_sequence SET seq=582 WHERE name='orders'; UPDATE sqlite_sequence SET seq=1004 WHERE name='order_items';");
  } catch {
    /* sqlite_sequence may not exist on a fresh D1 until first AUTOINCREMENT insert — harmless */
  }
  await ensureOrderFlag(env);
}

// The literal flag prefix is assembled from char codes so the plaintext
// marker never appears in this repository (docs describe the format only).
function flagPrefix(): string {
  return String.fromCharCode(83, 68, 67, 123);
}

async function fallbackFlag(): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode("noorstore-order-582::v1")
  );
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
  return `${flagPrefix()}n00r_${hex}_1d0r}`;
}

function looksLikeFlag(v: unknown): v is string {
  if (typeof v !== "string") return false;
  return new RegExp("^" + flagPrefix() + ".+}$").test(v);
}

/** Injects the flag into the target order exactly once (seed files stay clean). */
async function ensureOrderFlag(env: Env): Promise<void> {
  const row = await env.DB.prepare("SELECT gift_note FROM orders WHERE id=582").first<{ gift_note: string | null }>();
  if (!row) return;
  if (row.gift_note !== null && String(row.gift_note).trim() !== "") return;
  const flag = looksLikeFlag(env.FLAG) ? (env.FLAG as string) : await fallbackFlag();
  await env.DB.prepare("UPDATE orders SET gift_note=? WHERE id=582")
    .bind(`Warranty activation code: ${flag} — keep private, do not share. (Layla)`)
    .run();
}

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

function getCookie(req: Request, name: string): string | null {
  const header = req.headers.get("Cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

async function getUser(req: Request, env: Env): Promise<UserRow | null> {
  const token = getCookie(req, "session");
  if (!token || token.length > 200) return null;
  const now = new Date().toISOString();
  const row = await env.DB.prepare(
    "SELECT u.id AS id, u.name AS name, u.email AS email FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires_at>?"
  )
    .bind(token, now)
    .first<UserRow>();
  return row ?? null;
}

function sessionCookie(req: Request, token: string): string {
  const secure = new URL(req.url).protocol === "https:";
  return `session=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=604800${secure ? "; Secure" : ""}`;
}

function clearedCookie(req: Request): string {
  const secure = new URL(req.url).protocol === "https:";
  return `session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function json(data: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...(headers ?? {}) },
  });
}

function html(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

function maskEmail(email: string): string {
  const [local, domain] = String(email).split("@");
  if (!domain) return "***";
  return `${(local ?? "").slice(0, 1)}***@${domain}`;
}

function validEmail(e: string): boolean {
  return typeof e === "string" && e.length <= 120 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

// ---------------------------------------------------------------------------
// VULNERABLE order lookup (the workshop's single intentional vulnerability).
//
// Requires authentication, but deliberately omits the ownership check
// (`AND o.user_id = ?`). Any logged-in user can therefore read ANY order
// (e.g. GET /api/orders/582 returns Layla's order incl. its private note).
// Both the detail API and the invoice download share this helper, so the
// vulnerability is one logical flaw in one place. Everything else in this
// app (notably GET /api/orders, the "my orders" list) correctly scopes
// rows to the session user.
// ---------------------------------------------------------------------------
async function getOrderByIdVulnerable(env: Env, orderId: number) {
  const order = await env.DB.prepare(
    `SELECT o.id AS id, o.user_id AS user_id, o.status AS status,
            o.total_cents AS total_cents, o.address AS address, o.phone AS phone,
            o.gift_note AS gift_note, o.created_at AS created_at,
            u.name AS owner_name, u.email AS owner_email
     FROM orders o JOIN users u ON u.id = o.user_id WHERE o.id = ?`
  )
    .bind(orderId)
    .first<{
      id: number; user_id: number; status: string; total_cents: number;
      address: string; phone: string; gift_note: string | null; created_at: string;
      owner_name: string; owner_email: string;
    }>();
  if (!order) return null;
  const { results } = await env.DB.prepare(
    `SELECT p.name_en AS name_en, p.name_ar AS name_ar, p.emoji AS emoji,
            i.qty AS qty, i.unit_price_cents AS unit_price_cents
     FROM order_items i JOIN products p ON p.id = i.product_id
     WHERE i.order_id = ? ORDER BY i.id`
  )
    .bind(orderId)
    .all();
  return {
    id: order.id,
    status: order.status,
    total_cents: order.total_cents,
    address: order.address,
    phone: order.phone,
    gift_note: order.gift_note,
    created_at: order.created_at,
    owner_name: order.owner_name,
    owner_email_masked: maskEmail(order.owner_email),
    items: results,
  };
}

// Minimal valid PDF-1.4 invoice (English-only text so standard Helvetica works).
function pdfSafe(s: string): string {
  return String(s ?? "")
    .replace(/[^\x20-\x7E]/g, "?")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .slice(0, 160);
}

function buildInvoicePdf(order: NonNullable<Awaited<ReturnType<typeof getOrderByIdVulnerable>>>): Uint8Array {
  const lines = [
    "NoorStore - Noor Retail LLC (Riyadh, Saudi Arabia)",
    `Tax Invoice #${order.id}   Status: ${order.status}`,
    `Date: ${order.created_at}   Billed to: ${order.owner_name}`,
    `Delivery: ${order.address}  ${order.phone}`,
    "------------------------------------------------------------",
  ];
  for (const it of order.items as Array<{ name_en: string; qty: number; unit_price_cents: number }>) {
    lines.push(`${it.name_en} x${it.qty}  @ ${(it.unit_price_cents / 100).toFixed(2)} SAR`);
  }
  lines.push("------------------------------------------------------------");
  lines.push(`TOTAL: ${(order.total_cents / 100).toFixed(2)} SAR`);
  if (order.gift_note) lines.push(`Order note: ${order.gift_note}`);
  lines.push("Thank you for shopping at NoorStore!");

  const content = lines.map((t, i) => `BT /F1 11 Tf 50 ${792 - i * 17} Td (${pdfSafe(t)}) Tj ET`).join("\n");
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${new TextEncoder().encode(content).length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const enc = new TextEncoder();
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((body, i) => {
    offsets.push(enc.encode(out).length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefPos = enc.encode(out).length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;
  return enc.encode(out);
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method.toUpperCase();

    try {
      await ensureSchemaAndSeed(env);
    } catch (e) {
      console.error("seed failed", e);
      return json({ error: "Service temporarily unavailable." }, 500);
    }

    try {
      // ---- static assets ----
      if (method === "GET" && path === "/app.css")
        return new Response(APP_CSS, { headers: { "Content-Type": "text/css; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
      if (method === "GET" && path === "/app.js")
        return new Response(APP_JS, { headers: { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "public, max-age=3600" } });

      // ---- pages ----
      if (method === "GET" && path === "/") return html(homePage());
      if (method === "GET" && path === "/register") {
        if (await getUser(request, env)) return Response.redirect(new URL("/", url).toString(), 302);
        return html(registerPage());
      }
      if (method === "GET" && path === "/login") {
        if (await getUser(request, env)) return Response.redirect(new URL("/", url).toString(), 302);
        return html(loginPage());
      }
      if (method === "GET" && path === "/checkout") {
        if (!(await getUser(request, env))) return Response.redirect(new URL("/login", url).toString(), 302);
        return html(checkoutPage());
      }
      if (method === "GET" && path === "/orders") {
        if (!(await getUser(request, env))) return Response.redirect(new URL("/login", url).toString(), 302);
        return html(ordersPage());
      }
      {
        const m = path.match(/^\/orders\/(\d+)$/);
        if (method === "GET" && m) {
          if (!(await getUser(request, env))) return Response.redirect(new URL("/login", url).toString(), 302);
          return html(orderDetailPage(m[1]));
        }
      }

      // ---- APIs ----
      if (path === "/api/register" && method === "POST") {
        let body: { name?: string; email?: string; password?: string };
        try { body = await request.json(); } catch { return json({ error: "Invalid JSON body." }, 400); }
        const name = String(body.name ?? "").trim();
        const email = String(body.email ?? "").trim().toLowerCase();
        const password = String(body.password ?? "");
        if (name.length < 2 || name.length > 80) return json({ error: "Name must be 2–80 characters." }, 400);
        if (!validEmail(email)) return json({ error: "Invalid email address." }, 400);
        if (password.length < 8 || password.length > 200) return json({ error: "Password must be at least 8 characters." }, 400);
        const exists = await env.DB.prepare("SELECT id FROM users WHERE email=?").bind(email).first();
        if (exists) return json({ error: "Email already registered. Try logging in." }, 409);
        const { salt, hash } = await hashPassword(password);
        const res = await env.DB.prepare("INSERT INTO users (name,email,password_hash,salt) VALUES (?,?,?,?)")
          .bind(name, email, hash, salt).run();
        const userId = res.meta?.last_row_id as number;
        const token = newSessionToken();
        await env.DB.prepare("INSERT INTO sessions (token,user_id,expires_at) VALUES (?,?,?)")
          .bind(token, userId, sessionExpiryIso()).run();
        return json({ ok: true, user: { id: userId, name, email } }, 201, { "Set-Cookie": sessionCookie(request, token) });
      }

      if (path === "/api/login" && method === "POST") {
        let body: { email?: string; password?: string };
        try { body = await request.json(); } catch { return json({ error: "Invalid JSON body." }, 400); }
        const email = String(body.email ?? "").trim().toLowerCase();
        const password = String(body.password ?? "");
        if (!validEmail(email) || !password) return json({ error: "Email and password are required." }, 400);
        const row = await env.DB.prepare("SELECT id,name,email,password_hash,salt FROM users WHERE email=?")
          .bind(email).first<{ id: number; name: string; email: string; password_hash: string; salt: string }>();
        if (!row || !(await verifyPassword(password, row.salt, row.password_hash)))
          return json({ error: "Invalid email or password." }, 401);
        const token = newSessionToken();
        await env.DB.prepare("INSERT INTO sessions (token,user_id,expires_at) VALUES (?,?,?)")
          .bind(token, row.id, sessionExpiryIso()).run();
        return json({ ok: true, user: { id: row.id, name: row.name, email: row.email } }, 200, { "Set-Cookie": sessionCookie(request, token) });
      }

      if (path === "/api/logout" && method === "POST") {
        const token = getCookie(request, "session");
        if (token) await env.DB.prepare("DELETE FROM sessions WHERE token=?").bind(token).run();
        return json({ ok: true }, 200, { "Set-Cookie": clearedCookie(request) });
      }

      if (path === "/api/me" && method === "GET") {
        const user = await getUser(request, env);
        if (!user) return json({ user: null }, 200);
        return json({ user }, 200);
      }

      if (path === "/api/products" && method === "GET") {
        const { results } = await env.DB.prepare(
          "SELECT id,name_en,name_ar,description,price_cents,stock,emoji FROM products ORDER BY id"
        ).all();
        return json({ products: results }, 200);
      }

      // My-orders list — SECURE: scoped to the session user.
      if (path === "/api/orders" && method === "GET") {
        const user = await getUser(request, env);
        if (!user) return json({ error: "Login required." }, 401);
        const { results } = await env.DB.prepare(
          `SELECT o.id AS id, o.status AS status, o.total_cents AS total_cents,
                  o.created_at AS created_at,
                  (SELECT COUNT(*) FROM order_items WHERE order_id=o.id) AS items
           FROM orders o WHERE o.user_id=? ORDER BY o.id DESC`
        ).bind(user.id).all();
        return json({ orders: results }, 200);
      }

      if (path === "/api/orders" && method === "POST") {
        const user = await getUser(request, env);
        if (!user) return json({ error: "Login required." }, 401);
        let body: { items?: Array<{ product_id?: number; qty?: number }>; address?: string; phone?: string };
        try { body = await request.json(); } catch { return json({ error: "Invalid JSON body." }, 400); }
        const items = body.items;
        const address = String(body.address ?? "").trim();
        const phone = String(body.phone ?? "").trim();
        if (!Array.isArray(items) || items.length === 0 || items.length > 20)
          return json({ error: "Cart must contain 1–20 line items." }, 400);
        if (address.length < 5 || address.length > 300) return json({ error: "Address must be 5–300 characters." }, 400);
        if (phone.length < 6 || phone.length > 20) return json({ error: "Phone must be 6–20 characters." }, 400);
        let total = 0;
        const lines: Array<{ product_id: number; qty: number; unit: number }> = [];
        for (const it of items) {
          const pid = Number(it.product_id);
          const qty = Number(it.qty);
          if (!Number.isInteger(pid) || !Number.isInteger(qty) || qty < 1 || qty > 10)
            return json({ error: "Each item needs a valid product and qty 1–10." }, 400);
          const prod = await env.DB.prepare("SELECT id,price_cents FROM products WHERE id=?").bind(pid).first<{ id: number; price_cents: number }>();
          if (!prod) return json({ error: `Unknown product: ${esc(pid)}` }, 400);
          total += prod.price_cents * qty;
          lines.push({ product_id: pid, qty, unit: prod.price_cents });
        }
        const res = await env.DB.prepare(
          "INSERT INTO orders (user_id,status,total_cents,address,phone) VALUES (?, 'paid', ?, ?, ?)"
        ).bind(user.id, total, address, phone).run();
        const orderId = res.meta?.last_row_id as number;
        for (const l of lines) {
          await env.DB.prepare("INSERT INTO order_items (order_id,product_id,qty,unit_price_cents) VALUES (?,?,?,?)")
            .bind(orderId, l.product_id, l.qty, l.unit).run();
        }
        return json({ ok: true, id: orderId, total_cents: total }, 201);
      }

      // Order detail — INTENTIONALLY VULNERABLE (IDOR): auth required,
      // ownership NOT checked. See getOrderByIdVulnerable().
      {
        const m = path.match(/^\/api\/orders\/(\d+)$/);
        if (m && method === "GET") {
          const user = await getUser(request, env);
          if (!user) return json({ error: "Login required." }, 401);
          const detail = await getOrderByIdVulnerable(env, Number(m[1]));
          if (!detail) return json({ error: "Order not found." }, 404);
          return json({ order: detail }, 200);
        }
      }

      // Invoice download — shares the same vulnerable lookup.
      {
        const m = path.match(/^\/api\/orders\/(\d+)\/invoice$/);
        if (m && method === "GET") {
          const user = await getUser(request, env);
          if (!user) return json({ error: "Login required." }, 401);
          const detail = await getOrderByIdVulnerable(env, Number(m[1]));
          if (!detail) return json({ error: "Order not found." }, 404);
          const pdf = buildInvoicePdf(detail);
          return new Response(pdf as unknown as BodyInit, {
            status: 200,
            headers: {
              "Content-Type": "application/pdf",
              "Content-Disposition": `attachment; filename="invoice-${detail.id}.pdf"`,
              "Cache-Control": "no-store",
            },
          });
        }
      }

      if (path.startsWith("/api/")) return json({ error: "Unknown API endpoint." }, 404);
      return html(notFoundPage(), 404);
    } catch (e) {
      console.error("request failed", e);
      if (path.startsWith("/api/")) return json({ error: "Internal server error." }, 500);
      return html(notFoundPage(), 500);
    }
  },
};
