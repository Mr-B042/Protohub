import PDFDocument from "pdfkit";

type ReceiptOrder = {
  id: string;
  customer?: string | null;
  phone?: string | null;
  productName?: string | null;
  packageName?: string | null;
  quantity?: number | null;
  amount?: number | null;
  currency?: string | null;
  city?: string | null;
  state?: string | null;
  source?: string | null;
  scheduledDate?: string | null;
  crossSellLines?: Array<{ productName?: string; quantity?: number; amount?: number }> | null;
};

export function generateOrderReceiptPdf(order: ReceiptOrder, orgName = "Protohub"): Promise<Buffer> {
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
    doc.fillColor("#fff").fontSize(13).font("Helvetica-Bold")
      .text(orgName, 28, 14, { width: W / 2 });
    doc.fillColor("#ffffff99").fontSize(8).font("Helvetica")
      .text("Order Receipt", 28, 30, { width: W / 2 });
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
    if (order.city || order.state) {
      doc.fillColor(MUTED).fontSize(8)
        .text(`Location: ${[order.city, order.state].filter(Boolean).join(", ")}`, 28, customerLineY);
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
    if (order.scheduledDate) addRow("Delivery date", order.scheduledDate);

    // Cross-sell / add-ons
    if (order.crossSellLines?.length) {
      rowY += 4;
      doc.fillColor(MUTED).fontSize(7).font("Helvetica-Bold")
        .text("ADD-ONS", 28, rowY); rowY += 10;
      for (const line of order.crossSellLines) {
        addRow(
          `  ${line.productName ?? "Add-on"} x${line.quantity ?? 1}`,
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
