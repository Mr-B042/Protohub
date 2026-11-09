import { randomBytes } from "node:crypto";
import { supabase } from "./supabase.js";
import { logger } from "./logger.js";
import { BRAND_COLORS as C, emailBrand, type EmailBrand } from "./email-brand.js";
import { buildReceipt, money, type ReceiptModel, type ReceiptOrderInput } from "./receipt-model.js";

/**
 * E-receipts (Bright, 9 Nov 2026): the "Order Confirmation" receipt goes by
 * email when an order is placed, the "Thank You" receipt when it is marked
 * Delivered. Same designs and figures as Order Details › Send Order Receipt
 * (receipt-model.ts is shared), drawn in email-safe HTML (tables, inline
 * styles) in the brand's logo colours.
 */

export type ReceiptKind = "confirmation" | "thank_you";
type ImageOf = (productId?: string) => string | null;

const esc = (value: unknown) => String(value ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const SCRIPT = "'Kaushan Script','Brush Script MT','Segoe Script',cursive";

function logo(brand: EmailBrand, size: number, light = false) {
  if (brand.logoUrl) return `<img src="${esc(brand.logoUrl)}" width="${size}" height="${size}" alt="${esc(brand.name)}" style="display:block;width:${size}px;height:${size}px;border-radius:10px;border:0;${light ? "background:#ffffff;" : ""}">`;
  return `<div style="width:${size}px;height:${size}px;border-radius:10px;background:${C.blue};color:#fff;font:900 ${Math.round(size / 2)}px/${size}px ${FONT};text-align:center">${esc(brand.name.slice(0, 1))}</div>`;
}
function brandRow(brand: EmailBrand, light = false) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td valign="middle">${logo(brand, 44, light)}</td><td valign="middle" style="padding-left:12px;font-family:${FONT}"><div style="font-size:24px;font-weight:900;letter-spacing:.5px;text-transform:uppercase;line-height:1.05;color:${light ? "#ffffff" : C.charcoal}">${esc(brand.name)}</div>${brand.tagline ? `<div style="font-size:12px;color:${light ? "rgba(255,255,255,.85)" : "#64748b"};margin-top:2px">${esc(brand.tagline)}</div>` : ""}</td></tr></table>`;
}
const podPill = (paid: boolean, light = false) =>
  `<span style="display:inline-block;padding:9px 16px;border-radius:999px;background:${C.ink};color:#fff;font:800 12px ${FONT};letter-spacing:.3px;white-space:nowrap;${light ? "box-shadow:0 0 0 3px rgba(255,255,255,.5);" : ""}">🚚 ${paid ? "PAID ON DELIVERY" : "PAY ON DELIVERY"}</span>`;
const chip = (text: string, tone: "blue" | "purple" | "green") => {
  const [bg, fg] = tone === "blue" ? ["#e3f2fd", C.blueDark] : tone === "purple" ? ["#f1e8ff", "#7e22ce"] : ["#dcfce7", "#15803d"];
  return `<span style="display:inline-block;padding:4px 10px;border-radius:7px;background:${bg};color:${fg};font:800 12px ${FONT};margin:0 6px 6px 0">${esc(text)}</span>`;
};
const picture = (src: string | null, size: number, radius = 12) => src
  ? `<img src="${esc(src)}" width="${size}" height="${size}" alt="" style="display:block;width:${size}px;height:${size}px;object-fit:cover;border-radius:${radius}px;border:0;background:#f1f5f9">`
  : `<div style="width:${size}px;height:${size}px;border-radius:${radius}px;background:#eef2f7;text-align:center;font-size:${Math.round(size / 2.6)}px;line-height:${size}px">📦</div>`;

function customerRows(model: ReceiptModel, labels: boolean) {
  const c = model.customer;
  const rows: Array<[string, string, string]> = [["👤", "Name", c.name], ["📞", "Phone", c.phone]];
  if (c.whatsapp) rows.push(["💬", "WhatsApp", c.whatsapp]);
  if (c.address) rows.push(["🏠", "Delivery address", c.address]);
  rows.push(["📍", "City / State", c.location]);
  if (c.delivery) rows.push(["📅", c.delivery.label, c.delivery.value]);
  return rows.map(([icon, label, value]) => labels
    ? `<tr><td width="26" valign="top" style="padding:5px 0;font-size:15px">${icon}</td><td width="150" valign="top" style="padding:6px 0;font:14px ${FONT};color:#475569">${esc(label)}:</td><td valign="top" style="padding:5px 0;font:500 15px ${FONT};color:#0f172a;word-break:break-word">${esc(value)}</td></tr>`
    : `<tr><td width="26" valign="top" style="padding:4px 0;font-size:15px">${icon}</td><td valign="top" style="padding:4px 0;font:15px ${FONT};color:#0f172a;word-break:break-word">${label === "Delivered on" || label === "Delivery date" || label === "Preferred delivery" ? `<span style="color:#475569">${esc(label)}: </span><b>${esc(value)}</b>` : esc(value)}</td></tr>`).join("");
}

function totals(model: ReceiptModel) {
  const s = model.currencySymbol;
  const row = (label: string, value: string, extra = "") => `<tr><td style="padding:12px 20px;font:16px ${FONT};color:#334155">${label}</td><td align="right" style="padding:12px 20px;font:700 17px ${FONT};color:#0f172a;white-space:nowrap">${value}${extra}</td></tr>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e2e8f0;border-radius:16px;border-collapse:separate;overflow:hidden">
    ${row("Subtotal", money(model.subtotal, s))}
    ${row("Delivery Fee", money(model.deliveryFee, s), model.deliveryFee === 0 ? ` &nbsp;${chip("FREE DELIVERY", "green").replace("margin:0 6px 6px 0", "margin:0")}` : "")}
    <tr><td style="padding:16px 20px;background:#ecfdf3;font:800 18px ${FONT};color:#0f172a;border-radius:0 0 0 15px">Total Amount</td><td align="right" style="padding:16px 20px;background:#ecfdf3;font:900 28px ${FONT};color:#0f172a;white-space:nowrap;border-radius:0 0 15px 0">${money(model.total, s)}</td></tr>
  </table>`;
}

function promises() {
  const item = (icon: string, bg: string, title: string, sub: string) =>
    `<td width="33%" align="center" valign="top" style="padding:6px 4px"><div style="width:40px;height:40px;border-radius:20px;background:${bg};margin:0 auto;font-size:19px;line-height:40px;text-align:center">${icon}</div><div style="font:800 12px ${FONT};color:${C.charcoal};margin-top:8px">${title}</div><div style="font:12px ${FONT};color:#475569;margin-top:2px">${sub}</div></td>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${item("🚚", "#16a34a", "FREE DELIVERY", "Nationwide")}${item("📦", C.blue, "PAY ON DELIVERY", "Pay when you receive")}${item("🛡️", "#f59e0b", "QUALITY GUARANTEED", "Check before payment")}</tr></table>`;
}

function waLink(phone: string) {
  const digits = phone.replace(/\D/g, "").replace(/^0/, "234");
  return digits.length >= 10 ? `https://wa.me/${digits}` : "";
}
function footer(brand: EmailBrand, above = "#ffffff") {
  const wa = brand.helpPhone ? waLink(brand.helpPhone) : "";
  const help = brand.helpPhone
    ? `<td align="right" valign="middle" style="font:13px ${FONT};color:#fff;line-height:1.35">${wa ? `<a href="${esc(wa)}" style="color:#fff;text-decoration:none">` : ""}<b>Need help? 💬</b><br><span style="opacity:.9">Chat with us on WhatsApp</span><br><b style="font-size:16px">${esc(brand.helpPhone)}</b>${wa ? "</a>" : ""}</td>`
    : "";
  return `<tr><td style="background:${C.charcoal};padding:0">
      <div style="height:22px;background:${above};border-radius:0 0 50% 50% / 0 0 100% 100%"></div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding:18px 28px 24px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td valign="middle">${brandRow(brand, true)}</td>${help}</tr></table>
      </td></tr></table>
    </td></tr>`;
}

function shell(title: string, preheader: string, inner: string, extraHead = "") {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${esc(title)}</title>${extraHead}</head>
<body style="margin:0;padding:0;background:${C.page}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.page}"><tr><td align="center" style="padding:24px 10px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;background:#ffffff;border-radius:24px;overflow:hidden;font-family:${FONT}">
${inner}
</table></td></tr></table></body></html>`;
}

function lineCards(model: ReceiptModel, imageOf: ImageOf) {
  const s = model.currencySymbol;
  return model.lines.map((line) => {
    const main = line.kind === "main";
    const chips = main ? `${line.detail ? chip(line.detail, "blue") : ""}${model.gifts.length ? chip(`Includes ${model.gifts.length} FREE GIFT${model.gifts.length === 1 ? "" : "S"}`, "purple") : ""}` : "";
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e2e8f0;border-radius:16px;border-collapse:separate;margin-bottom:10px"><tr>
      <td width="${main ? 108 : 70}" valign="top" style="padding:12px">${picture(imageOf(line.productId), main ? 96 : 58)}</td>
      <td valign="top" style="padding:12px 4px;font-family:${FONT}"><div style="font-size:${main ? 19 : 16}px;font-weight:800;color:#0f172a">${esc(line.name)}</div>${line.subtitle || (!main && line.detail) ? `<div style="font-size:14px;color:#475569;margin-top:2px">${esc(line.subtitle || line.detail)}</div>` : ""}${chips ? `<div style="margin-top:10px">${chips}</div>` : ""}</td>
      <td valign="top" align="right" style="padding:12px;font-family:${FONT};white-space:nowrap"><div style="font-size:19px;font-weight:800;color:#0f172a">${money(line.amount, s)}</div><div style="font-size:14px;color:#334155;margin-top:12px">x${line.quantity}</div></td>
    </tr></table>`;
  }).join("");
}

export function confirmationHtml(model: ReceiptModel, brand: EmailBrand, imageOf: ImageOf) {
  const s = model.currencySymbol;
  const gifts = model.gifts.length ? `<div style="font:14px ${FONT};color:#6b21a8;margin:-2px 4px 12px">🎁 Free gifts: ${esc(model.gifts.map((g) => `${g.name}${g.quantity > 1 ? ` x${g.quantity}` : ""}`).join(", "))}</div>` : "";
  const inner = `
<tr><td style="padding:26px 28px 6px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td valign="middle">${brandRow(brand)}</td><td align="right" valign="middle">${podPill(model.paid)}</td></tr></table>
  <div style="text-align:center;margin-top:22px">
    <div style="font:900 30px ${FONT};color:${C.charcoal};letter-spacing:.5px">ORDER CONFIRMATION</div>
    <div style="font:600 18px ${FONT};color:#0f172a;margin-top:6px">Thank you for your order! 🎉</div>
    <div style="font:14px ${FONT};color:#475569;margin-top:4px">Here are your order details. Please check and keep this for reference.</div>
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:20px;background:${C.mist};border-radius:16px;border-collapse:separate"><tr>
    <td width="50%" style="padding:14px 18px;border-right:1px solid #d6e6f5;font-family:${FONT}"><div style="font-size:14px;color:#334155">Order ID</div><div style="font-size:19px;font-weight:800;color:#0f172a;margin-top:2px">${esc(model.reference)}</div></td>
    <td width="50%" style="padding:14px 18px;font-family:${FONT}"><div style="font-size:14px;color:#334155">Order Date</div><div style="font-size:16px;color:#0f172a;margin-top:4px">${esc(model.orderDate)}</div></td>
  </tr></table>
  <div style="font:800 18px ${FONT};color:${C.charcoal};margin:24px 0 10px">👤 Customer &amp; Delivery Details</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${customerRows(model, true)}</table>
  <div style="font:800 18px ${FONT};color:${C.charcoal};margin:22px 0 10px">📋 Order Summary</div>
  ${lineCards(model, imageOf)}${gifts}${totals(model)}
  <div style="margin-top:20px">${promises()}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0 22px;background:${C.mist};border:1px solid #d6e6f5;border-radius:16px;border-collapse:separate"><tr>
    <td width="44" valign="top" style="padding:16px 0 16px 16px"><div style="width:32px;height:32px;border-radius:16px;background:${C.blue};text-align:center;line-height:32px;font-size:16px">📋</div></td>
    <td style="padding:16px 18px 16px 12px;font:15px ${FONT};color:#173a5e;line-height:1.5"><b style="color:${C.blueDark}">Important:</b><br>${model.paid ? `This order was paid on delivery: <b>${money(model.total, s)}</b>.` : `You will pay <b>${money(model.total, s)}</b> when you receive your order.`}<br>Please keep this receipt for reference. Questions? Just reply to this email.<div style="margin-top:10px;font-size:13px;color:#475569">📌 Tip: if this landed in Promotions or Updates, move it to your <b>Primary</b> tab (or add us to your contacts) so you don't miss your delivery updates.</div></td>
  </tr></table>
</td></tr>
${footer(brand)}`;
  return shell(`Order Confirmation ${model.reference}`, `Thank you for your order! ${model.reference} · pay ${money(model.total, s)} on delivery`, inner);
}

export function thankYouHtml(model: ReceiptModel, brand: EmailBrand, imageOf: ImageOf, reviewUrl: string | null) {
  const s = model.currencySymbol;
  const main = model.lines[0];
  const extras = model.lines.slice(1);
  const giftCards = model.gifts.slice(0, 3).map((gift) => `<td valign="top" style="padding:0 8px 0 0"><table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:112px;border:1px solid #e2e8f0;border-radius:14px;border-collapse:separate;background:#fff"><tr><td style="padding:6px 8px 8px;text-align:center;font-family:${FONT}">
      <div style="text-align:left"><span style="display:inline-block;background:#ef4444;color:#fff;font-size:10px;font-weight:800;padding:2px 7px;border-radius:5px">FREE</span></div>
      <div style="margin:6px auto 0;width:64px">${picture(imageOf(gift.productId), 64, 10)}</div>
      <div style="font-size:12px;color:#0f172a;margin-top:6px">${esc(gift.name)}${gift.quantity > 1 ? ` x${gift.quantity}` : ""}</div></td></tr></table></td>`).join("");
  const extraRows = extras.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:12px;background:#fff;border-radius:16px;border-collapse:separate">${extras.map((line) => `<tr><td width="52" style="padding:8px 0 8px 14px">${picture(imageOf(line.productId), 40, 8)}</td><td style="padding:8px;font:15px ${FONT};color:#0f172a"><b>${esc(line.name)}</b>${line.detail ? `<span style="color:#64748b"> · ${esc(line.detail)}</span>` : ""} x${line.quantity}</td><td align="right" style="padding:8px 14px;font:800 15px ${FONT};color:#0f172a;white-space:nowrap">${money(line.amount, s)}</td></tr>`).join("")}</table>` : "";
  const review = reviewUrl ? `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:16px;background:#fff;border-radius:18px;border-collapse:separate"><tr><td align="center" style="padding:20px 22px;font-family:${FONT}">
    <div style="font-size:18px;font-weight:800;color:${C.charcoal}">How is your ${esc(main.name)}? ⭐</div>
    <div style="font-size:14px;color:#475569;margin-top:6px;line-height:1.5">We'd love to see it in your home. Share a photo or a few words: it helps other customers and it helps us do better.</div>
    <div style="margin-top:14px"><a href="${esc(reviewUrl)}" style="display:inline-block;padding:13px 26px;border-radius:12px;background:${C.blue};color:#fff;font-size:15px;font-weight:800;text-decoration:none">Share My Experience →</a></div>
  </td></tr></table>` : "";
  const inner = `
<tr><td style="padding:0;background:${C.blue};background-image:linear-gradient(135deg,${C.blueLight} 0%,${C.blue} 55%,${C.blueDark} 100%)">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding:24px 26px 0">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td valign="middle">${brandRow(brand, true)}</td><td align="right" valign="middle">${podPill(model.paid, true)}</td></tr></table>
  </td></tr>
  <tr><td align="center" style="padding:16px 20px 44px;font-family:${SCRIPT};font-size:50px;line-height:1.08;color:#ffffff;text-shadow:0 3px 0 rgba(15,23,42,.18)">Thank You<br>for Your Order! <span style="font-family:${FONT};font-size:30px;color:#fbbf24">✨</span></td></tr>
  <tr><td style="padding:0"><div style="height:24px;background:#f4f8fd;border-radius:50% 50% 0 0 / 100% 100% 0 0"></div></td></tr></table>
</td></tr>
<tr><td style="padding:0 22px 6px;background:#f4f8fd">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#fff;border-radius:20px;border-collapse:separate;box-shadow:0 8px 24px rgba(15,23,42,.08)">
    <tr><td width="50%" style="padding:14px 20px;border-bottom:1px solid #e2e8f0;border-right:1px solid #e2e8f0;font-family:${FONT}"><div style="font-size:13px;color:#475569">Order ID</div><div style="font-size:18px;font-weight:800;color:#0f172a">${esc(model.reference)}</div></td>
        <td width="50%" style="padding:14px 20px;border-bottom:1px solid #e2e8f0;font-family:${FONT}"><div style="font-size:13px;color:#475569">Order Date</div><div style="font-size:15px;color:#0f172a">${esc(model.orderDate)}</div></td></tr>
    <tr><td colspan="2" style="padding:14px 20px 18px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td valign="top"><div style="font:800 17px ${FONT};color:${C.charcoal};margin-bottom:6px">Customer Details</div><table role="presentation" cellpadding="0" cellspacing="0" border="0">${customerRows(model, false)}</table></td>
      <td width="170" valign="top" style="padding-left:10px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.mist};border-radius:16px;border-collapse:separate"><tr><td style="padding:14px;font-family:${FONT}">
        <div style="width:44px;height:44px;border-radius:12px;background:${C.blue};text-align:center;line-height:44px;font-size:22px">📦</div>
        <div style="font-size:17px;font-weight:900;color:${C.charcoal};line-height:1.1;margin-top:8px">${model.paid ? "PAID ON" : "PAY ON"}<br>DELIVERY</div>
        <div style="font-size:12px;color:${C.blueDark};margin-top:4px">${model.paid ? "Paid when received" : "Pay when you receive"}</div></td></tr></table></td>
    </tr></table></td></tr>
  </table>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:16px;background:#fff;border-radius:20px;border-collapse:separate;box-shadow:0 8px 24px rgba(15,23,42,.06)"><tr>
    <td width="200" valign="top" style="padding:14px">${picture(imageOf(main.productId), 190, 16)}</td>
    <td valign="top" style="padding:14px 14px 14px 4px;font-family:${FONT}">
      <div style="font-size:26px;font-weight:900;color:${C.charcoal};line-height:1.1">${esc(main.name)}</div>
      ${main.subtitle ? `<div style="font-size:15px;color:#475569;margin-top:4px">${esc(main.subtitle)}</div>` : ""}
      <div style="margin-top:10px">${main.detail ? chip(main.detail, "blue") + "<br>" : ""}${model.gifts.length ? chip(`+ ${model.gifts.length} FREE GIFT${model.gifts.length === 1 ? "" : "S"}`, "purple") : ""}</div>
      ${giftCards ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:8px"><tr>${giftCards}</tr></table>` : ""}
    </td></tr></table>
  ${extraRows}
  <div style="margin-top:14px;background:#fff;border-radius:18px">${totals(model)}</div>
  ${review}
  <div style="margin:18px 0 20px">${promises()}</div>
</td></tr>
${footer(brand, "#f4f8fd")}`;
  const head = `<link href="https://fonts.googleapis.com/css2?family=Kaushan+Script&display=swap" rel="stylesheet">`;
  return shell(`Thank you for your order ${model.reference}`, `Your order ${model.reference} was delivered. Thank you for choosing ${brand.name}!`, inner, head);
}

export function receiptText(kind: ReceiptKind, model: ReceiptModel, brand: EmailBrand, reviewUrl: string | null) {
  const s = model.currencySymbol;
  return [
    kind === "confirmation" ? "ORDER CONFIRMATION - Thank you for your order!" : "Thank you for your order! It has been delivered.",
    `Order ID: ${model.reference}`, `Order date: ${model.orderDate}`, "",
    ...model.lines.map((line) => `${line.name}${line.detail ? ` (${line.detail})` : ""} x${line.quantity}: ${money(line.amount, s)}`),
    ...(model.gifts.length ? [`Free gifts: ${model.gifts.map((g) => `${g.name}${g.quantity > 1 ? ` x${g.quantity}` : ""}`).join(", ")}`] : []),
    `Delivery fee: ${money(model.deliveryFee, s)}`, `Total: ${money(model.total, s)}`, "",
    model.paid ? "Paid on delivery." : `You will pay ${money(model.total, s)} when you receive your order.`,
    ...(reviewUrl ? ["", `Share your experience: ${reviewUrl}`] : []),
    "", `${brand.name}${brand.helpPhone ? ` · WhatsApp ${brand.helpPhone}` : ""}`
  ].join("\n");
}

// ── Reading an order ─────────────────────────────────────────────────

const ORDER_COLUMNS = "id, org_id, branch_id, customer, phone, whatsapp, email, address, city, state, location, product_id, product_name, package_name, quantity, amount, original_amount, currency, status, scheduled_date, delivered_date, preferred_delivery, created_at, original_created_at, cross_sell_lines, additional_lines, package_components_snapshot";

const lines = (raw: unknown) => (Array.isArray(raw) ? raw : []).map((line: any) => ({
  productId: line?.productId ?? undefined, productName: String(line?.productName ?? line?.displayName ?? ""), quantity: Number(line?.quantity) || 1,
  amount: Number(line?.amount) || 0, packageName: line?.packageName ?? undefined
})).filter((line) => line.productName);

export function receiptInput(row: any): ReceiptOrderInput {
  return {
    id: String(row.id), customer: row.customer ?? "", phone: row.phone ?? "", whatsapp: row.whatsapp ?? undefined,
    address: row.address ?? undefined, city: row.city ?? undefined, state: row.state ?? undefined, location: row.location ?? undefined,
    productId: row.product_id ?? undefined, productName: row.product_name ?? "", packageName: row.package_name ?? undefined,
    quantity: row.quantity ?? undefined, amount: Number(row.amount) || 0, originalAmount: row.original_amount ?? undefined,
    currency: row.currency ?? "NGN", status: row.status ?? undefined, scheduledDate: row.scheduled_date ?? undefined,
    deliveredDate: row.delivered_date ?? undefined, preferredDelivery: row.preferred_delivery ?? undefined,
    createdAt: row.created_at ?? undefined, originalCreatedAt: row.original_created_at ?? undefined,
    crossSellLines: lines(row.cross_sell_lines), additionalLines: lines(row.additional_lines),
    packageComponentsSnapshot: (Array.isArray(row.package_components_snapshot) ? row.package_components_snapshot : []).map((c: any) => ({
      productId: c?.productId ?? undefined, productName: String(c?.productName ?? ""), quantity: Number(c?.quantity) || 1, isFreeGift: !!c?.isFreeGift, hiddenFromCustomer: !!c?.hiddenFromCustomer
    }))
  };
}

/** Product photos for the receipt: each product's approved gallery cover, else its own picture. */
async function imagesFor(productIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(productIds.filter(Boolean))];
  const out = new Map<string, string>();
  if (!ids.length) return out;
  const https = (url: unknown) => (typeof url === "string" && /^https:\/\//i.test(url) ? url : "");
  const [media, products] = await Promise.all([
    supabase.from("product_media").select("product_id, url, thumb_url, is_cover, display_order").in("product_id", ids).eq("status", "approved").eq("kind", "image"),
    supabase.from("products").select("id, image_url").in("id", ids)
  ]);
  const rows = ((media.data ?? []) as any[]).sort((a, b) => Number(b.is_cover) - Number(a.is_cover) || (a.display_order ?? 0) - (b.display_order ?? 0));
  for (const row of rows) { const url = https(row.url) || https(row.thumb_url); if (url && !out.has(row.product_id)) out.set(row.product_id, url); }
  for (const row of (products.data ?? []) as any[]) { const url = https(row.image_url); if (url && !out.has(row.id)) out.set(row.id, url); }
  return out;
}

const appBase = () => (process.env.FRONTEND_URL ?? "").split(",")[0]?.trim().replace(/\/+$/, "") || "http://localhost:5173";

/** The order's personal review link (Reviews & UGC), made the first time. Null when it can't be made. */
async function reviewLinkFor(order: any): Promise<string | null> {
  try {
    const { data: found } = await supabase.from("review_links").select("token").eq("order_id", order.id).maybeSingle();
    let token = found?.token as string | undefined;
    if (!token) {
      const { data, error } = await supabase.from("review_links").insert({ org_id: order.org_id ?? null, branch_id: order.branch_id, order_id: order.id, token: randomBytes(18).toString("base64url") }).select("token").single();
      if (error && String(error.code) === "23505") token = (await supabase.from("review_links").select("token").eq("order_id", order.id).single()).data?.token;
      else if (error) throw error;
      else token = data?.token;
    }
    return token ? `${appBase()}/#/review/${token}` : null;
  } catch (error) {
    logger.warn("receipt review link failed", { orderId: order.id, error: (error as Error).message });
    return null;
  }
}

/** Subject, HTML and text of an order's receipt email, from the order as it is now. */
export async function buildReceiptEmail(orgId: string, orderId: string, kind: ReceiptKind) {
  // launch-safe: one named order's own receipt (the same order the customer placed), not a list or a total.
  const { data: row, error } = await supabase.from("orders").select(ORDER_COLUMNS).eq("org_id", orgId).eq("id", orderId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) return null;
  const model = buildReceipt(receiptInput(row));
  const ids = [model.lines.map((line) => line.productId), model.gifts.map((gift) => gift.productId)].flat().filter((id): id is string => !!id);
  const [brand, images, reviewUrl] = await Promise.all([emailBrand(orgId), imagesFor(ids), kind === "thank_you" ? reviewLinkFor(row) : Promise.resolve(null)]);
  const imageOf: ImageOf = (productId) => (productId && images.get(productId)) || null;
  const subject = kind === "confirmation"
    ? `Order confirmed: ${model.reference} 🎉`
    : `Thank you for your order, ${String(row.customer ?? "").trim().split(/\s+/)[0] || "friend"}! 💙`;
  return {
    row, model, subject,
    html: kind === "confirmation" ? confirmationHtml(model, brand, imageOf) : thankYouHtml(model, brand, imageOf, reviewUrl),
    text: receiptText(kind, model, brand, reviewUrl)
  };
}
