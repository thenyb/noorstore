// Server-rendered HTML shell + embedded frontend assets (mirrored in /public).
// NOTE: this file never contains the flag. Order data is always fetched
// at runtime via the JSON API and HTML-escaped before rendering.

export function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export const APP_CSS = `
:root{--brand:#0f766e;--brand-d:#0b5954;--bg:#f6f7f9;--card:#fff;--ink:#1f2937;--mut:#6b7280;--line:#e5e7eb}
*{box-sizing:border-box}body{margin:0;font-family:"Segoe UI",Tahoma,Arial,sans-serif;background:var(--bg);color:var(--ink)}
a{color:var(--brand)}.wrap{max-width:1080px;margin:0 auto;padding:0 16px}
.topbar{background:var(--brand);color:#fff}.topbar .wrap{display:flex;align-items:center;gap:16px;padding:12px 16px}
.logo{font-weight:800;font-size:20px;color:#fff;text-decoration:none}.logo small{font-weight:400;opacity:.85;font-size:12px}
.nav{margin-inline-start:auto;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.nav a,.nav button{color:#fff;text-decoration:none;background:transparent;border:1px solid #ffffff55;border-radius:10px;padding:6px 12px;font-size:14px;cursor:pointer}
.nav a.active,.nav a:hover{background:#ffffff22}
.hero{background:linear-gradient(135deg,#0f766e,#14b8a6);color:#fff;padding:36px 0;margin-bottom:20px}
.hero h1{margin:0 0 6px;font-size:30px}.hero p{margin:0;opacity:.92}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:14px;margin:18px 0 40px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px;display:flex;flex-direction:column;gap:8px}
.card .em{font-size:40px;text-align:center}.card h3{margin:4px 0;font-size:16px}.card .pr{font-weight:800;color:var(--brand-d)}
.card p{font-size:13px;color:var(--mut);min-height:36px;margin:0}
.btn{background:var(--brand);color:#fff;border:0;border-radius:10px;padding:9px 14px;cursor:pointer;font-size:14px}
.btn:hover{background:var(--brand-d)}.btn.ghost{background:#fff;color:var(--brand);border:1px solid var(--brand)}
.panel{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px;margin:18px 0}
label{display:block;font-size:13px;margin:10px 0 4px}input,textarea{width:100%;border:1px solid var(--line);border-radius:10px;padding:9px 10px;font-size:14px;font-family:inherit}
table{width:100%;border-collapse:collapse;font-size:14px}th,td{border-bottom:1px solid var(--line);padding:9px 8px;text-align:start}
.alert{background:#fef2f2;border:1px solid #fecaca;color:#991b1b;border-radius:10px;padding:10px 12px;margin:12px 0;font-size:14px}
.ok{background:#ecfdf5;border:1px solid #a7f3d0;color:#065f46;border-radius:10px;padding:10px 12px;margin:12px 0;font-size:14px}
.mut{color:var(--mut);font-size:13px}.foot{border-top:1px solid var(--line);margin-top:30px;padding:16px 0;color:var(--mut);font-size:13px}
.note{background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:10px 12px;font-size:14px}
code{background:#f3f4f6;border-radius:6px;padding:1px 6px}
.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
`;

export const APP_JS = `
"use strict";
const $=(s)=>document.querySelector(s);
function escH(s){return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");}
async function api(path,opts){const r=await fetch(path,Object.assign({headers:{"Content-Type":"application/json"}},opts||{}));let d=null;try{d=await r.json();}catch(e){}return{ok:r.ok,status:r.status,data:d};}
function cart(){try{return JSON.parse(localStorage.getItem("noor_cart")||"{}");}catch(e){return{};}}
function setCart(c){localStorage.setItem("noor_cart",JSON.stringify(c));updateCartCount();}
function updateCartCount(){const c=cart();let n=0;for(const k in c)n+=c[k];const el=$("#cartCount");if(el)el.textContent=n;}
async function refreshNav(){const m=$("#navUser");if(!m)return;const r=await api("/api/me");if(r.ok&&r.data&&r.data.user){m.innerHTML="";const s=document.createElement("span");s.textContent=r.data.user.name+" 👋";m.appendChild(s);const lo=document.createElement("button");lo.textContent="Logout / خروج";lo.onclick=async()=>{await api("/api/logout",{method:"POST"});location.href="/";};m.appendChild(lo);}else{m.innerHTML='<a href="/login">Login / دخول</a><a href="/register">Register / تسجيل</a>';}}
function money(c){return (c/100).toFixed(2)+" SAR / ر.س";}
async function loadProducts(){const g=$("#product-grid");if(!g)return;const r=await api("/api/products");if(!r.ok){g.innerHTML='<div class="alert">Failed to load products.</div>';return;}g.innerHTML="";r.data.products.forEach((p)=>{const d=document.createElement("div");d.className="card";const h=document.createElement("div");h.className="em";h.textContent=p.emoji||"📦";const t=document.createElement("h3");t.textContent=p.name_ar+" — "+p.name_en;const ds=document.createElement("p");ds.textContent=p.description;const pr=document.createElement("div");pr.className="pr";pr.textContent=money(p.price_cents);const b=document.createElement("button");b.className="btn";b.textContent="Add to cart / أضف للسلة";b.onclick=()=>{const c=cart();c[p.id]=(c[p.id]||0)+1;setCart(c);b.textContent="Added ✓ تمت الإضافة";setTimeout(()=>{b.textContent="Add to cart / أضف للسلة";},900);};d.append(h,t,ds,pr,b);g.appendChild(d);});}
function bindAuthForm(id,path,okTo){const f=$(id);if(!f)return;f.addEventListener("submit",async(e)=>{e.preventDefault();const fd=new FormData(f);const body={};fd.forEach((v,k)=>{body[k]=v;});const msg=$("#formMsg");const r=await api(path,{method:"POST",body:JSON.stringify(body)});if(r.ok){location.href=okTo;}else{if(msg){msg.className="alert";msg.textContent=(r.data&&r.data.error)||"Something went wrong.";}}});}
async function loadCheckout(){const box=$("#checkoutBox");if(!box)return;const r=await api("/api/products");const prods={};if(r.ok)r.data.products.forEach((p)=>{prods[p.id]=p;});const c=cart();const ids=Object.keys(c);if(!ids.length){box.innerHTML='<div class="alert">Your cart is empty / السلة فارغة. <a href="/">Back to store</a></div>';return;}let total=0;let rows="";ids.forEach((id)=>{const p=prods[id];if(!p)return;const q=c[id];const line=p.price_cents*q;total+=line;rows+="<tr><td>"+p.name_ar+" — "+p.name_en+"</td><td>"+q+"</td><td>"+money(line)+"</td></tr>";});box.querySelector("#sumRows").innerHTML=rows;box.querySelector("#sumTotal").textContent=money(total);const f=$("#checkoutForm");f.addEventListener("submit",async(e)=>{e.preventDefault();const fd=new FormData(f);const items=ids.map((id)=>({product_id:Number(id),qty:c[id]}));const r2=await api("/api/orders",{method:"POST",body:JSON.stringify({items,address:String(fd.get("address")||""),phone:String(fd.get("phone")||"")})});const msg=$("#formMsg");if(r2.ok){setCart({});location.href="/orders/"+r2.data.id;}else if(msg){msg.className="alert";msg.textContent=(r2.data&&r2.data.error)||"Checkout failed.";}});}
async function loadOrders(){const t=$("#ordersTable");if(!t)return;const r=await api("/api/orders");if(r.status===401){location.href="/login";return;}if(!r.ok){t.innerHTML='<div class="alert">Failed to load orders.</div>';return;}const tb=t.querySelector("tbody");tb.innerHTML="";r.data.orders.forEach((o)=>{const tr=document.createElement("tr");const a=document.createElement("a");a.href="/orders/"+o.id;a.textContent="#"+o.id;const td0=document.createElement("td");td0.appendChild(a);const td1=document.createElement("td");td1.textContent=o.status;const td2=document.createElement("td");td2.textContent=money(o.total_cents);const td3=document.createElement("td");td3.textContent=new Date(o.created_at).toLocaleString();tr.append(td0,td1,td2,td3);tb.appendChild(tr);});}
async function loadOrderDetail(id){const box=$("#orderBox");if(!box)return;const r=await api("/api/orders/"+id);if(r.status===401){location.href="/login";return;}if(r.status===404){box.innerHTML='<div class="alert">Order not found / الطلب غير موجود.</div>';return;}if(!r.ok){box.innerHTML='<div class="alert">Failed to load order.</div>';return;}const o=r.data.order;let rows="";o.items.forEach((it)=>{rows+="<tr><td>"+escH(it.name_ar)+" — "+escH(it.name_en)+"</td><td>"+escH(it.qty)+"</td><td>"+money(it.unit_price_cents)+"</td><td>"+money(it.unit_price_cents*it.qty)+"</td></tr>";});box.innerHTML='<div class="panel"><h2 style="margin-top:0">Order #'+escH(o.id)+' / طلب رقم '+escH(o.id)+'</h2><p class="mut">Status: '+escH(o.status)+' • Placed: '+escH(new Date(o.created_at).toLocaleString())+' • Owner: '+escH(o.owner_name)+' ('+escH(o.owner_email_masked)+')</p><table><thead><tr><th>Product / المنتج</th><th>Qty</th><th>Unit</th><th>Line</th></tr></thead><tbody>'+rows+'</tbody></table><p><b>Total / الإجمالي: '+money(o.total_cents)+'</b></p><p class="mut">Deliver to / التوصيل: '+escH(o.address)+' • '+escH(o.phone)+'</p>'+(o.gift_note?'<div class="note"><b>Order note / ملاحظة الطلب:</b> '+escH(o.gift_note)+'</div>':'')+'<p style="margin-top:14px"><a class="btn" href="/api/orders/'+escH(o.id)+'/invoice">Download invoice (PDF) / تحميل الفاتورة</a> <a class="btn ghost" href="/orders">Back to my orders</a></p></div>';}
document.addEventListener("DOMContentLoaded",()=>{refreshNav();updateCartCount();loadProducts();bindAuthForm("#registerForm","/api/register","/");bindAuthForm("#loginForm","/api/login","/");loadCheckout();loadOrders();const od=document.querySelector("[data-order-id]");if(od)loadOrderDetail(od.getAttribute("data-order-id"));});
`;

export interface NavState {
  active?: "home" | "orders" | "checkout" | "login" | "register";
}

export function layout(title: string, nav: NavState, body: string): string {
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${esc(title)} — NoorStore | متجر نور</title>
<link rel="stylesheet" href="/app.css"/>
</head>
<body>
<header class="topbar"><div class="wrap">
<a class="logo" href="/">🛍️ NoorStore <small>متجر نور الإلكتروني</small></a>
<nav class="nav">
<a href="/" class="${nav.active === "home" ? "active" : ""}">Store / المتجر</a>
<a href="/orders" class="${nav.active === "orders" ? "active" : ""}">My Orders / طلباتي</a>
<a href="/checkout" class="${nav.active === "checkout" ? "active" : ""}">Cart / السلة (<span id="cartCount">0</span>)</a>
<span id="navUser" class="row"></span>
</nav>
</div></header>
<main class="wrap">${body}</main>
<footer class="foot"><div class="wrap">NoorStore — Noor Retail LLC / شركة نور للتجزئة • Riyadh, Saudi Arabia • Support: support@noorstore.example</div></footer>
<script src="/app.js"></script>
</body>
</html>`;
}

export function homePage(): string {
  return layout("Online Store", { active: "home" }, `
<section class="hero"><div class="wrap" style="padding:0">
<h1>Welcome to NoorStore / أهلاً بكم في متجر نور</h1>
<p>Electronics, home goods &amp; gifts with fast delivery across Saudi Arabia. / إلكترونيات ومنتجات منزلية وهدايا مع توصيل سريع.</p>
</div></section>
<div class="row mut"><span>How it works / كيف تطلب:</span><code>Register → Login → Add to cart → Checkout → Track in My Orders</code></div>
<div id="product-grid" class="grid"><div class="mut">Loading products… / جارٍ التحميل…</div></div>`);
}

export function registerPage(): string {
  return layout("Register", { active: "register" }, `
<div class="panel" style="max-width:520px"><h2 style="margin-top:0">Create account / إنشاء حساب</h2>
<div id="formMsg"></div>
<form id="registerForm">
<label>Full name / الاسم الكامل</label><input name="name" required minlength="2" maxlength="80" placeholder="e.g. Sara Ahmed"/>
<label>Email / البريد الإلكتروني</label><input name="email" type="email" required maxlength="120" placeholder="you@example.com"/>
<label>Password / كلمة المرور (8+ chars)</label><input name="password" type="password" required minlength="8" maxlength="200"/>
<p style="margin-top:14px"><button class="btn" type="submit">Register / تسجيل</button> <a href="/login">Have an account? Login / دخول</a></p>
</form></div>`);
}

export function loginPage(): string {
  return layout("Login", { active: "login" }, `
<div class="panel" style="max-width:520px"><h2 style="margin-top:0">Login / تسجيل الدخول</h2>
<div id="formMsg"></div>
<form id="loginForm">
<label>Email / البريد الإلكتروني</label><input name="email" type="email" required maxlength="120"/>
<label>Password / كلمة المرور</label><input name="password" type="password" required maxlength="200"/>
<p style="margin-top:14px"><button class="btn" type="submit">Login / دخول</button> <a href="/register">New here? Register / تسجيل جديد</a></p>
</form></div>`);
}

export function checkoutPage(): string {
  return layout("Checkout", { active: "checkout" }, `
<div id="checkoutBox" class="panel"><h2 style="margin-top:0">Checkout / إتمام الطلب</h2>
<table><thead><tr><th>Product / المنتج</th><th>Qty</th><th>Line / المبلغ</th></tr></thead>
<tbody id="sumRows"></tbody></table>
<p><b>Total / الإجمالي: <span id="sumTotal"></span></b></p>
<div id="formMsg"></div>
<form id="checkoutForm">
<label>Delivery address / عنوان التوصيل</label><textarea name="address" required minlength="5" maxlength="300" rows="3" placeholder="City, district, street, building…"></textarea>
<label>Phone / الجوال</label><input name="phone" required minlength="6" maxlength="20" placeholder="+9665XXXXXXXX"/>
<p style="margin-top:14px"><button class="btn" type="submit">Place order / تأكيد الطلب</button></p>
</form></div>`);
}

export function ordersPage(): string {
  return layout("My Orders", { active: "orders" }, `
<div id="ordersTable" class="panel"><h2 style="margin-top:0">My orders / طلباتي</h2>
<table><thead><tr><th>Order / الطلب</th><th>Status / الحالة</th><th>Total / الإجمالي</th><th>Date / التاريخ</th></tr></thead><tbody></tbody></table></div>`);
}

export function orderDetailPage(id: string): string {
  return layout("Order " + id, { active: "orders" }, `
<div id="orderBox" data-order-id="${esc(id)}"><div class="mut">Loading order… / جارٍ تحميل الطلب…</div></div>`);
}

export function notFoundPage(): string {
  return layout("Not found", {}, `<div class="panel"><h2>404 — Not found / غير موجود</h2><p><a href="/">Back to store / عودة للمتجر</a></p></div>`);
}
