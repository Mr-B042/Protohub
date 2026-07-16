import PDFDocument from "pdfkit";
import { supabase } from "./supabase.js";

type ReceiptOrder = {
  id: string;
  customer?: string | null;
  phone?: string | null;
  productName?: string | null;
  packageName?: string | null;
  quantity?: number | null;
  amount?: number | null;
  currency?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  source?: string | null;
  createdAt?: string | null;
  scheduledDate?: string | null;
  crossSellLines?: Array<{ productName?: string; quantity?: number; amount?: number }> | null;
  packageComponentsSnapshot?: Array<{ productName?: string | null; quantity?: number | null; isFreeGift?: boolean | null; hiddenFromCustomer?: boolean | null }> | null;
};

async function fetchImageBufferSafe(url: string, timeoutMs = 4000): Promise<Buffer | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

// Real org name + logo for the receipt header, with safe fallbacks - a
// branding lookup failure (missing logo, network hiccup) should never stop
// the receipt itself from generating.
export async function fetchReceiptBranding(orgId: string): Promise<{ orgName: string; logoBuffer: Buffer | null }> {
  let orgName = "Protohub";
  let logoBuffer: Buffer | null = null;
  try {
    const { data } = await supabase.from("organizations").select("name, logo_url").eq("id", orgId).maybeSingle();
    if (data?.name) orgName = data.name;
    if (data?.logo_url) logoBuffer = await fetchImageBufferSafe(data.logo_url);
  } catch {
    // keep defaults - a receipt without live branding is still useful
  }
  return { orgName, logoBuffer };
}

export function generateOrderReceiptPdf(order: ReceiptOrder, orgName = "Protohub", logoBuffer?: Buffer | null): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A6", margin: 28, info: { Title: `Order Receipt ${order.id}`, Author: orgName } });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const WA_GREEN = "#25D366";
    const DARK     = "#111827";
    const MUTED    = "#6B7280";
    const LINE     = "#E5E7EB";
    const W        = doc.page.width - 56;

    // ── Header bar ──────────────────────────────────────────────
    doc.rect(0, 0, doc.page.width, 44).fill(WA_GREEN);
    const hasLogo = Boolean(logoBuffer);
    const textStartX = hasLogo ? 62 : 28;
    if (logoBuffer) {
      try {
        doc.image(logoBuffer, 28, 7, { width: 30, height: 30, fit: [30, 30] });
      } catch {
        // corrupt/unsupported image bytes - skip the logo, keep the receipt going
      }
    }
    // Reserve just enough room on the right for the short "#order-id" text -
    // NOT half the page width, which left too little room for the org name
    // once the logo pushed textStartX inward (it was wrapping to 3-4 lines).
    const headerRightReserve = 60;
    const headerTextWidth = doc.page.width - textStartX - headerRightReserve;
    doc.fillColor("#fff").fontSize(hasLogo ? 11 : 13).font("Helvetica-Bold")
      .text(orgName, textStartX, hasLogo ? 12 : 14, { width: headerTextWidth, ellipsis: true });
    doc.fillColor("#ffffff99").fontSize(8).font("Helvetica")
      .text("Order Receipt", textStartX, hasLogo ? 27 : 30, { width: headerTextWidth });
    doc.fillColor("#fff").fontSize(9).font("Helvetica-Bold")
      .text(`#${order.id}`, doc.page.width / 2, 18, { width: W / 2, align: "right" });

    // ── Customer block ─────────────────────────────────────────
    // NOTE: No emoji chars — Helvetica doesn't support them (renders as garbage)
    const y0 = 56;
    doc.fillColor(DARK).fontSize(11).font("Helvetica-Bold")
      .text(order.customer ?? "Customer", 28, y0);

    let customerLineY = y0 + 14;
    if (order.phone) {
      doc.fillColor(MUTED).fontSize(8).font("Helvetica")
        .text(`Tel: ${order.phone}`, 28, customerLineY);
      customerLineY += 12;
    }
    const locationLine = [order.address, order.city, order.state].filter((part) => (part ?? "").trim()).join(", ");
    if (locationLine) {
      doc.fillColor(MUTED).fontSize(8)
        .text(`Address: ${locationLine}`, 28, customerLineY, { width: W });
      customerLineY += 12;
    }

    // ── Divider ──────────────────────────────────────────────────
    const divY = customerLineY + 6;
    doc.strokeColor(LINE).lineWidth(0.5).moveTo(28, divY).lineTo(28 + W, divY).stroke();

    // ── Product rows ─────────────────────────────────────────────
    let rowY = divY + 10;
    const currency = order.currency ?? "NGN";

    const addRow = (label: string, value: string, bold = false) => {
      doc.fillColor(MUTED).fontSize(7.5).font("Helvetica").text(label, 28, rowY, { width: W * 0.52 });
      doc.fillColor(DARK).fontSize(7.5).font(bold ? "Helvetica-Bold" : "Helvetica")
        .text(value, 28 + W * 0.52, rowY, { width: W * 0.48, align: "right" });
      rowY += 14;
    };

    addRow("Product", order.productName ?? "—");
    if (order.packageName) addRow("Package", order.packageName);
    // Quantity — e.g. "3 pcs"
    if (order.quantity != null && order.quantity > 0) {
      addRow("Quantity", `${order.quantity} pcs`);
    }
    if (order.source)       addRow("Channel", order.source);
    if (order.createdAt)    addRow("Order date", order.createdAt);
    if (order.scheduledDate) addRow("Delivery date", order.scheduledDate);

    // What's inside the package (components + free gifts), customer-visible only.
    const includes = (order.packageComponentsSnapshot ?? []).filter(c => c && !c.hiddenFromCustomer && (c.productName ?? "").trim());
    if (includes.length) {
      rowY += 4;
      doc.fillColor(MUTED).fontSize(7).font("Helvetica-Bold")
        .text("PACKAGE INCLUDES", 28, rowY); rowY += 10;
      for (const c of includes) {
        const qty = Math.max(1, Math.round(Number(c.quantity ?? 1) || 1));
        addRow(`  ${c.productName} ${qty} pcs`, c.isFreeGift ? "FREE" : "Included");
      }
    }

    // Cross-sell / add-ons
    if (order.crossSellLines?.length) {
      rowY += 4;
      doc.fillColor(MUTED).fontSize(7).font("Helvetica-Bold")
        .text("ADD-ONS", 28, rowY); rowY += 10;
      for (const line of order.crossSellLines) {
        addRow(
          `  ${line.productName ?? "Add-on"} ${line.quantity ?? 1} pcs`,
          line.amount != null ? `${currency} ${line.amount.toLocaleString("en-NG")}` : "—"
        );
      }
    }

    // ── Total amount block ────────────────────────────────────────
    rowY += 4;
    doc.rect(28, rowY, W, 28).fill("#F9FAFB");
    doc.fillColor(MUTED).fontSize(7.5).font("Helvetica")
      .text("Total amount", 34, rowY + 9);
    doc.fillColor(DARK).fontSize(12).font("Helvetica-Bold")
      .text(
        order.amount != null ? `${currency} ${order.amount.toLocaleString("en-NG")}` : "—",
        34, rowY + 6, { width: W - 12, align: "right" }
      );
    rowY += 36;

    // ── Footer ────────────────────────────────────────────────────
    doc.strokeColor(LINE).lineWidth(0.5).moveTo(28, rowY).lineTo(28 + W, rowY).stroke();
    rowY += 6;
    doc.fillColor(MUTED).fontSize(7).font("Helvetica")
      .text("Thank you for your order! Reply to this WhatsApp message for enquiries.", 28, rowY, { width: W, align: "center" });

    doc.end();
  });
}
