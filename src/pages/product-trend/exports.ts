// Product Trend exports: a real .xlsx workbook and a printable PDF report,
// with no extra libraries. The workbook is an uncompressed zip of the
// SpreadsheetML parts (Excel, Google Sheets and Numbers all open it); the PDF
// is a print-ready page the browser saves as PDF ("Save as PDF").

export type Cell = string | number | null | undefined;
export type Sheet = { name: string; rows: Cell[][] };

// ── Zip (stored, no compression) ────────────────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function zipStore(files: Array<{ name: string; data: string }>): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = enc.encode(file.name);
    const data = enc.encode(file.data);
    const crc = crc32(data);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true); lv.setUint16(8, 0, true);
    lv.setUint16(10, 0, true); lv.setUint16(12, 0x21, true); lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true); lv.setUint32(22, data.length, true); lv.setUint16(26, name.length, true); lv.setUint16(28, 0, true);
    local.set(name, 30);
    parts.push(local, data);
    const head = new Uint8Array(46 + name.length);
    const cv = new DataView(head.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true); cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true); cv.setUint16(14, 0x21, true); cv.setUint32(16, crc, true); cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true); cv.setUint16(30, 0, true); cv.setUint16(32, 0, true); cv.setUint16(34, 0, true); cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true); cv.setUint32(42, offset, true);
    head.set(name, 46);
    central.push(head);
    offset += local.length + data.length;
  }
  const centralSize = central.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true); ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + centralSize + end.length);
  let at = 0;
  for (const part of [...parts, ...central, end]) { out.set(part, at); at += part.length; }
  return out;
}

// ── Workbook ────────────────────────────────────────────────────────────────

const xml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
const colName = (index: number) => { let s = ""; let n = index + 1; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
const sheetName = (name: string, used: Set<string>) => {
  let base = name.replace(/[\\/?*[\]:]/g, " ").slice(0, 31).trim() || "Sheet";
  let candidate = base; let i = 2;
  while (used.has(candidate)) { candidate = `${base.slice(0, 28)} ${i}`; i += 1; }
  used.add(candidate);
  return candidate;
};

/** Build an .xlsx (first row of each sheet is bold, as a header). */
export function buildXlsx(sheets: Sheet[]): Uint8Array {
  const used = new Set<string>();
  const names = sheets.map((s) => sheetName(s.name, used));
  const sheetXml = (sheet: Sheet) => {
    const widths = new Map<number, number>();
    const rows = sheet.rows.map((row, r) => `<row r="${r + 1}">${row.map((value, c) => {
      const ref = `${colName(c)}${r + 1}`;
      const style = r === 0 ? ' s="1"' : "";
      widths.set(c, Math.min(60, Math.max(widths.get(c) ?? 8, String(value ?? "").length + 2)));
      if (value === null || value === undefined || value === "") return `<c r="${ref}"${style}/>`;
      if (typeof value === "number" && Number.isFinite(value)) return `<c r="${ref}"${style}><v>${value}</v></c>`;
      return `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${xml(String(value))}</t></is></c>`;
    }).join("")}</row>`).join("");
    const cols = widths.size ? `<cols>${[...widths].sort((a, b) => a[0] - b[0]).map(([c, w]) => `<col min="${c + 1}" max="${c + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>` : "";
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>${cols}<sheetData>${rows}</sheetData></worksheet>`;
  };
  const files = [
    { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${names.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>` },
    { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: "xl/workbook.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${xml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${names.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: "xl/styles.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>` },
    ...sheets.map((sheet, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(sheet) }))
  ];
  return zipStore(files);
}

export function downloadBytes(name: string, bytes: Uint8Array, type: string) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([bytes.slice().buffer as ArrayBuffer], { type }));
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1500);
}

export const downloadXlsx = (name: string, sheets: Sheet[]) =>
  downloadBytes(name, buildXlsx(sheets), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");

// ── Printable PDF report ────────────────────────────────────────────────────

export type ReportSection = { title: string; note?: string; rows: Cell[][] };

/**
 * Opens the browser's print dialog on a clean report page (choose "Save as
 * PDF"). Printed from a hidden frame so no pop-up blocker gets in the way.
 */
export function printReport(report: { title: string; subtitle: string; meta: Array<[string, string]>; kpis: Array<[string, string]>; sections: ReportSection[]; definitions: string[] }) {
  const cell = (v: Cell) => (v === null || v === undefined ? "" : xml(String(typeof v === "number" ? (Number.isInteger(v) ? v.toLocaleString("en-NG") : v.toLocaleString("en-NG", { maximumFractionDigits: 1 })) : v)));
  const table = (rows: Cell[][]) => rows.length === 0 ? "<p class=\"muted\">No data.</p>" : `<table><thead><tr>${rows[0].map((h) => `<th>${cell(h)}</th>`).join("")}</tr></thead><tbody>${rows.slice(1).map((r) => `<tr>${r.map((v) => `<td>${cell(v)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${xml(report.title)}</title><style>
    @page { size: A4 landscape; margin: 12mm; }
    body { font-family: Inter, system-ui, -apple-system, Segoe UI, sans-serif; color: #0f172a; font-size: 10.5px; }
    h1 { font-size: 20px; margin: 0; } h2 { font-size: 13px; margin: 18px 0 6px; page-break-after: avoid; }
    .sub { color: #475569; margin: 2px 0 10px; } .muted { color: #64748b; }
    .meta { display: flex; flex-wrap: wrap; gap: 4px 18px; color: #334155; margin-bottom: 10px; }
    .kpis { display: grid; grid-template-columns: repeat(6, 1fr); gap: 6px; margin: 8px 0 4px; }
    .kpi { border: 1px solid #e2e8f0; border-radius: 6px; padding: 6px 8px; } .kpi b { display: block; font-size: 14px; margin-top: 2px; }
    table { width: 100%; border-collapse: collapse; page-break-inside: auto; } tr { page-break-inside: avoid; }
    th { text-align: left; background: #f1f5f9; border-bottom: 1px solid #cbd5e1; padding: 4px 5px; font-size: 9.5px; }
    td { border-bottom: 1px solid #e2e8f0; padding: 3px 5px; }
    ul { margin: 4px 0 0 16px; padding: 0; color: #334155; }
  </style></head><body>
    <h1>${xml(report.title)}</h1><p class="sub">${xml(report.subtitle)}</p>
    <div class="meta">${report.meta.map(([k, v]) => `<span><b>${xml(k)}:</b> ${xml(v)}</span>`).join("")}</div>
    <div class="kpis">${report.kpis.map(([k, v]) => `<div class="kpi">${xml(k)}<b>${xml(v)}</b></div>`).join("")}</div>
    ${report.sections.map((s) => `<h2>${xml(s.title)}</h2>${s.note ? `<p class="muted">${xml(s.note)}</p>` : ""}${table(s.rows)}`).join("")}
    <h2>How the figures are worked out</h2><ul>${report.definitions.map((d) => `<li>${xml(d)}</li>`).join("")}</ul>
  </body></html>`;
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  Object.assign(frame.style, { position: "fixed", right: "0", bottom: "0", width: "0", height: "0", border: "0" });
  document.body.appendChild(frame);
  const doc = frame.contentWindow?.document;
  if (!doc) { frame.remove(); return; }
  doc.open(); doc.write(html); doc.close();
  window.setTimeout(() => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    window.setTimeout(() => frame.remove(), 60_000);
  }, 300);
}
