// Shop (Ecwid) orders for BirdBox Learn's Receipts tab (Nathan, 20 Nov 2026).
//
// The shop has its own checkout, separate from BirdBox Learn, and its sign-in
// is switched off, so learners find their shop orders here instead: matched on
// the email they log in with, each with Ecwid's VAT invoice.
//
// Needs ECWID_SECRET_TOKEN in Netlify: the secret token of the private
// "BirdBox Learn" app in Ecwid (Apps → Custom Apps), read-only scopes
// (read orders, read catalog, read invoices, read store profile).
// Without it the Receipts tab simply shows no shop orders.

const STORE = "140532633";
const API = `https://app.ecwid.com/api/v3/${STORE}`;
const token = () => process.env.ECWID_SECRET_TOKEN || "";

async function ecwid(path, raw) {
  const r = await fetch(API + path, { headers: { Authorization: "Bearer " + token() } });
  if (!r.ok) throw new Error("Ecwid " + r.status);
  return raw ? r : r.json();
}

const PAID = new Set(["PAID", "PARTIALLY_REFUNDED", "REFUNDED"]);

async function ordersOf(email) {
  if (!token() || !email) return [];
  const out = [];
  for (let offset = 0; offset < 500; offset += 100) {
    const d = await ecwid(`/orders?email=${encodeURIComponent(email)}&limit=100&offset=${offset}`);
    for (const o of d.items || []) {
      // Ecwid's email search is loose; keep exact matches only
      if (String(o.email || "").trim().toLowerCase() !== email) continue;
      if (!PAID.has(o.paymentStatus)) continue;
      out.push(o);
    }
    if (!d.items || d.items.length < 100) break;
  }
  return out;
}

// One line per order, in the same shape as the Stripe receipts.
export async function shopOrders(email) {
  let orders = [];
  try { orders = await ordersOf(email); } catch (e) { console.error("shop orders", e.message); return []; }
  return orders.map((o) => {
    const items = (o.items || []).map((it) => {
      const opts = (it.selectedOptions || []).map((s) => s.value).filter(Boolean).join(", ");
      return { name: it.name + (opts ? " (" + opts + ")" : "") + (it.quantity > 1 ? " × " + it.quantity : ""),
        picture: it.smallThumbnailUrl || it.imageUrl || null };
    });
    const ts = o.createTimestamp ? o.createTimestamp * 1000 : Date.parse(String(o.createDate || "").replace(" ", "T").replace(" +0000", "Z"));
    return {
      id: "shop_" + o.id,
      shop: true,
      order: String(o.id),
      date: new Date(ts || Date.now()).toISOString(),
      what: "Shop order: " + items.map((i) => i.name).join(", "),
      items,
      amount: Math.round((o.total || 0) * 100),
      refunded: Math.round((o.refundedAmount || 0) * 100),
      currency: String(o.currency || o.pricesCurrency || "EUR").toLowerCase(),
      number: String(o.id),
    };
  });
}

// The order's VAT invoice as a PDF, only for an order placed with this email.
export async function shopInvoice(email, orderId) {
  const id = String(orderId || "").replace(/^shop_/, "");
  if (!/^[A-Za-z0-9-]{1,30}$/.test(id) || !token()) return { error: "That order could not be found." };
  const o = await ecwid(`/orders/${encodeURIComponent(id)}`).catch(() => null);
  if (!o || String(o.email || "").trim().toLowerCase() !== email) return { error: "That order could not be found." };
  // the tax invoice (BirdBox's VAT number) if Ecwid made one, else the order receipt
  let bytes = null;
  const inv = await ecwid(`/orders/${encodeURIComponent(id)}/invoices`).catch(() => null);
  const list = (inv && (inv.invoices || inv.items)) || [];
  const latest = list.filter((x) => x && x.link).sort((a, b) => String(b.createDate || "").localeCompare(String(a.createDate || "")))[0];
  if (latest) {
    const r = await fetch(latest.link).catch(() => null);
    if (r && r.ok) bytes = Buffer.from(await r.arrayBuffer());
  }
  if (!bytes) {
    const r = await ecwid(`/orders/${encodeURIComponent(id)}/invoice-pdf`, true).catch(() => null);
    if (r) bytes = Buffer.from(await r.arrayBuffer());
  }
  if (!bytes) return { error: "The invoice for this order is not ready yet. Please try again later or write to info@birdboxcoaching.com." };
  return { pdf: bytes.toString("base64"), filename: `BirdBox shop order ${id}.pdf` };
}
