# NoorStore — متجر نور الإلكتروني (Noor Retail LLC)

A realistic small SaaS **e-commerce store** (Cloudflare Workers + D1 + TypeScript)
built as a **Broken Access Control / IDOR training challenge**. It looks and behaves
like a real shop — registration, login, cart, checkout, order history, printable/PDF
invoices — with exactly **one** intentional vulnerability hidden in normal business logic.

> **Randomly selected theme:** **#3 of 7 — E-commerce (متجر إلكتروني)**
> (picked with `Get-Random -Minimum 1 -Maximum 8` → `3`).
> Target: **another user's order** · Attack: **change `/orders/581/` to `/orders/582/`**.
> App name: **NoorStore** · Company: **Noor Retail LLC / شركة نور للتجزئة** ·
> Language: **Arabic + English** · Workflow: **Register → Login → Create Order → Access Target Order**.

## Quick start (local workshop)

```bash
cd noorstore
npm.cmd install          # on Windows (npm.ps1 may be blocked); elsewhere: npm install
npm run db:migrate:local # apply migrations/ to the local D1 database
npm run test             # build + run the full end-to-end verification
npm run dev              # wrangler dev (serves the app locally)
```

Deploy for real:

```bash
npm run db:create              # note the database id it prints
# put that id into wrangler.toml -> database_id, then:
npm run db:migrate             # apply migrations to remote D1
wrangler secret put FLAG       # e.g. SDC{your_own_flag_here}  (never commit it)
npm run deploy
```

## The challenge

1. **Register** a new account, **log in**.
2. Add products to the cart and **check out** → you get your own order, e.g. `/orders/583/`.
3. Open it — it works. Now change the URL to **`/orders/582/`**.
4. You are looking at **another customer's (Layla's) order**, including a private
   order note and a downloadable invoice. That note is where the flag lives.
5. Same flaw via the API: `GET /api/orders/582` and `GET /api/orders/582/invoice` (PDF).

The victim account's password is a strong undisclosed value (only its PBKDF2 hash is
seeded) — you are **not** supposed to log in as Layla. The intended path is the IDOR.

## The vulnerability (exactly one, intentional)

**Where:** `getOrderByIdVulnerable()` in `src/index.ts`, serving

- `GET /api/orders/:id` (order detail JSON), and
- `GET /api/orders/:id/invoice` (PDF invoice download) — same shared lookup, one flaw.

The HTML page `GET /orders/:id` renders through that same API.

**Why it is vulnerable:** the handler **requires authentication** (401 when logged out)
and correctly reads the caller's session — but the SQL lookup is

```sql
... FROM orders o JOIN users u ON u.id = o.user_id WHERE o.id = ?
```

with **no `AND o.user_id = ?` ownership check**. Authentication answers *"who are you?"*;
the missing object-level authorization check never asks *"is this yours?"*. So any
logged-in user who guesses/changes the numeric id reads anyone's order. Your own order
works normally, which makes the flaw invisible until you tamper with the id
(`581 → 582`).

**The fix** (one line of business logic + tests):

```sql
... WHERE o.id = ? AND o.user_id = ?
-- bind: (orderId, sessionUser.id)
-- return 404 when nothing matches (don't reveal existence)
```

i.e. scope every object read to the session user — exactly as the already-secure
`GET /api/orders` list does (`WHERE o.user_id = ?`). Then add a regression test:
user A must get **404** (not 401/403-leaking) on user B's order id.

## Flag handling

- Format: `SDC{...}`. It exists **only** in D1 row `orders(582).gift_note` at runtime.
- `migrations/0002_seed.sql` deliberately inserts that row with `gift_note = NULL`;
  the Worker fills it once from the **`FLAG` secret** (`ensureOrderFlag()` in
  `src/index.ts`). Local dev without the secret uses a deterministic fallback derived
  from a SHA-256 hash (no literal in the repo).
- Verified by `npm test`: the marker never appears in `migrations/`, `src/`, `dist/`,
  `public/`, normal pages, the products API, or the my-orders list — only via the
  vulnerable order-582 detail/invoice responses.

## What's real / what's deliberately NOT vulnerable

- Real registration/login/logout, PBKDF2-SHA256 password hashing (120k iterations),
  random HttpOnly session cookies (`SameSite=Lax`, `Secure` on HTTPS, 7-day expiry).
- Real D1 relational schema + migrations (`users`, `sessions`, `products`, `orders`,
  `order_items`), server-side price calculation at checkout (client prices ignored).
- All queries parameterized (no SQLi), all user data HTML-escaped server- and
  client-side (no XSS), masked e-mails in responses, no secrets in frontend code.

## Project layout

```
wrangler.toml            Worker + D1 binding config
migrations/0001_schema.sql   relational schema
migrations/0002_seed.sql     deterministic seed: 8 products, victim user (id=1),
                             victim orders 581 (ordinary) + 582 (target, note=NULL)
src/index.ts             router, APIs, vulnerable lookup, PDF invoices, flag injection
src/auth.ts              PBKDF2 hashing, session tokens
src/html.ts              bilingual (AR/EN, RTL) pages + embedded CSS/JS
public/app.css|app.js    static-asset mirrors of the embedded frontend
scripts/test-workflow.mjs  end-to-end verification (register→checkout→IDOR→flag)
.dev.vars.example        local FLAG secret template (gitignored real file)
```

Seed map: products 1–8 · victim `layla@example.com` (id 1) · order **581** (ordinary,
delivered) · order **582** (target, `paid`, contains flag note) · new checkouts → 583+.
