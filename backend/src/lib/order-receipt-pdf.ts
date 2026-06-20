import PDFDocument from "pdfkit";

type ReceiptOrder = {
  id: string;
  customer?: string | null;
  phone?: string | null;
  productName?: string | null;
  packageName?: string | null;
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
    const doc = new PDFDocument({ size: "A6", margin: 28, info: { Title: `Order Receipt ${order.id}` } });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const WA_GREEN = "#25D366";
    const DARK     = "#111827";
    const MUTED    = "#6B7280";
    const LINE     = "#E5E7EB";
    const W        = doc.page.width - 56; // usable width

    // ── Header bar ──────────────────────────────────────────────
    doc.rect(0, 0, doc.page.width, 44).fill(WA_GREEN);
    doc.fillColor("#fff").fontSize(13).font("Helvetica-Bold")
      .text(orgName, 28, 14, { width: W / 2 });
    doc.fillColor("#ffffff99").fontSize(8).font("Helvetica")
      .text("Order Receipt", 28, 30, { width: W / 2 });

    // Order ID badge top-right
    doc.fillColor("#fff").fontSize(9).font("Helvetica-Bold")
      .text(`#${order.id}`, doc.page.width / 2, 18, { width: W / 2, align: "right" });

    doc.moveDown(0.2);

    // ── Customer block ───────────────────────────────────────────
    const y0 = 56;
    doc.fillColor(DARK).fontSize(11).font("Helvetica-Bold")
      .text(order.customer ?? "Customer", 28, y0);
    if (order.phone) {
      doc.fillColor(MUTED).fontSize(8).font("Helvetica")
        .text(`📱 ${order.phone}`, 28, y0 + 14);
    }
    if (order.city || order.state) {
      doc.fillColor(MUTED).fontSize(8)
        .text(`📍 ${[order.city, order.state].filter(Boolean).join(", ")}`, 28, y0 + (order.phone ? 24 : 14));
    }

    // ── Divider ──────────────────────────────────────────────────
    const divY = (order.phone || order.city) ? y0 + 40 : y0 + 18;
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
    if (order.source)      addRow("Channel", order.source);
    if (order.scheduledDate) addRow("Delivery date", order.scheduledDate);

    // Cross-sell lines
    if (order.crossSellLines?.length) {
      rowY += 4;
      doc.fillColor(MUTED).fontSize(7).font("Helvetica-Bold")
        .text("ADD-ONS", 28, rowY); rowY += 10;
      for (const line of order.crossSellLines) {
        addRow(
          `  ${line.productName ?? "Add-on"} ×${line.quantity ?? 1}`,
          line.amount != null ? `${currency} ${(line.amount).toLocaleString("en-NG")}` : "—"
        );
      }
    }

    // ── Amount block ─────────────────────────────────────────────
    rowY += 4;
    doc.rect(28, rowY, W, 26).fill("#F9FAFB");
    doc.fillColor(MUTED).fontSize(7.5).font("Helvetica")
      .text("Total amount", 34, rowY + 8);
    doc.fillColor(DARK).fontSize(12).font("Helvetica-Bold")
      .text(
        order.amount != null ? `${currency} ${order.amount.toLocaleString("en-NG")}` : "—",
        34, rowY + 5, { width: W - 12, align: "right" }
      );
    rowY += 34;

    // ── Footer ───────────────────────────────────────────────────
    doc.strokeColor(LINE).lineWidth(0.5).moveTo(28, rowY).lineTo(28 + W, rowY).stroke();
    rowY += 6;
    doc.fillColor(MUTED).fontSize(7).font("Helvetica")
      .text("Thank you for your order! For enquiries reply to the WhatsApp message or contact our team.", 28, rowY, { width: W, align: "center" });

    doc.end();
  });
}
