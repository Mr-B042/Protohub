import fs from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";

const SIZE = 192;
const OUT_DIR = path.resolve("public/icons/notifications");

const COLORS = {
  white: [255, 255, 255, 255],
  whiteSoft: [255, 255, 255, 36],
  blue: [31, 143, 224, 255],
  green: [17, 147, 90, 255],
  red: [209, 67, 67, 255],
  rose: [196, 60, 78, 255],
  purple: [122, 79, 224, 255],
  teal: [12, 123, 147, 255],
  amber: [217, 119, 6, 255],
  orange: [194, 101, 20, 255],
  deepOrange: [194, 65, 12, 255],
  indigo: [63, 92, 232, 255]
};

const ICONS = [
  { file: "order-new.png", color: COLORS.blue, draw: drawOrderNew },
  { file: "order-confirmed.png", color: COLORS.green, draw: drawOrderConfirmed },
  { file: "order-delivered.png", color: COLORS.green, draw: drawOrderDelivered },
  { file: "order-cancelled.png", color: COLORS.red, draw: drawOrderCancelled },
  { file: "order-failed.png", color: COLORS.rose, draw: drawOrderFailed },
  { file: "order-rescheduled.png", color: COLORS.purple, draw: drawOrderRescheduled },
  { file: "order-assigned.png", color: COLORS.teal, draw: drawOrderAssigned },
  { file: "low-stock.png", color: COLORS.amber, draw: drawLowStock },
  { file: "remittance-overdue.png", color: COLORS.deepOrange, draw: drawRemittanceOverdue },
  { file: "stale-carts.png", color: COLORS.orange, draw: drawStaleCarts },
  { file: "waybill.png", color: COLORS.indigo, draw: drawWaybill },
  { file: "test-push.png", color: COLORS.blue, draw: drawTestPush },
  { file: "info.png", color: COLORS.blue, draw: drawInfo }
];

fs.mkdirSync(OUT_DIR, { recursive: true });

for (const icon of ICONS) {
  const pixels = createCanvas(SIZE, SIZE);
  fillRoundedRect(pixels, 0, 0, SIZE, SIZE, 36, icon.color);
  icon.draw(pixels);
  fs.writeFileSync(path.join(OUT_DIR, icon.file), encodePng(SIZE, SIZE, pixels));
}

console.log(`Generated ${ICONS.length} notification PNG icons in ${OUT_DIR}`);

function createCanvas(width, height) {
  return new Uint8Array(width * height * 4);
}

function encodePng(width, height, pixels) {
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * stride;
    raw[rowOffset] = 0;
    const srcOffset = y * width * 4;
    pixels.slice(srcOffset, srcOffset + width * 4).forEach((value, index) => {
      raw[rowOffset + 1 + index] = value;
    });
  }

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const value of buffer) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit += 1) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function blendPixel(pixels, x, y, color) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  const index = (y * SIZE + x) * 4;
  const alpha = color[3] / 255;
  const inverse = 1 - alpha;
  pixels[index] = Math.round(color[0] * alpha + pixels[index] * inverse);
  pixels[index + 1] = Math.round(color[1] * alpha + pixels[index + 1] * inverse);
  pixels[index + 2] = Math.round(color[2] * alpha + pixels[index + 2] * inverse);
  pixels[index + 3] = Math.round((alpha + (pixels[index + 3] / 255) * inverse) * 255);
}

function fillRoundedRect(pixels, x, y, w, h, r, color) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  for (let py = Math.floor(y); py < Math.ceil(y + h); py += 1) {
    for (let px = Math.floor(x); px < Math.ceil(x + w); px += 1) {
      const qx = Math.abs(px + 0.5 - cx) - w / 2 + r;
      const qy = Math.abs(py + 0.5 - cy) - h / 2 + r;
      const outsideX = Math.max(qx, 0);
      const outsideY = Math.max(qy, 0);
      if ((Math.min(Math.max(qx, qy), 0) + Math.hypot(outsideX, outsideY)) <= 0.75) {
        blendPixel(pixels, px, py, color);
      }
    }
  }
}

function fillRect(pixels, x, y, w, h, color) {
  for (let py = Math.floor(y); py < Math.ceil(y + h); py += 1) {
    for (let px = Math.floor(x); px < Math.ceil(x + w); px += 1) {
      blendPixel(pixels, px, py, color);
    }
  }
}

function fillCircle(pixels, cx, cy, r, color) {
  const minX = Math.floor(cx - r);
  const maxX = Math.ceil(cx + r);
  const minY = Math.floor(cy - r);
  const maxY = Math.ceil(cy + r);
  for (let py = minY; py <= maxY; py += 1) {
    for (let px = minX; px <= maxX; px += 1) {
      if (Math.hypot(px + 0.5 - cx, py + 0.5 - cy) <= r) {
        blendPixel(pixels, px, py, color);
      }
    }
  }
}

function strokeCircle(pixels, cx, cy, r, width, color) {
  const minX = Math.floor(cx - r - width / 2);
  const maxX = Math.ceil(cx + r + width / 2);
  const minY = Math.floor(cy - r - width / 2);
  const maxY = Math.ceil(cy + r + width / 2);
  for (let py = minY; py <= maxY; py += 1) {
    for (let px = minX; px <= maxX; px += 1) {
      const distance = Math.abs(Math.hypot(px + 0.5 - cx, py + 0.5 - cy) - r);
      if (distance <= width / 2) {
        blendPixel(pixels, px, py, color);
      }
    }
  }
}

function strokeLine(pixels, x1, y1, x2, y2, width, color) {
  const radius = width / 2;
  const minX = Math.floor(Math.min(x1, x2) - radius - 1);
  const maxX = Math.ceil(Math.max(x1, x2) + radius + 1);
  const minY = Math.floor(Math.min(y1, y2) - radius - 1);
  const maxY = Math.ceil(Math.max(y1, y2) + radius + 1);
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSq = dx * dx + dy * dy || 1;
  for (let py = minY; py <= maxY; py += 1) {
    for (let px = minX; px <= maxX; px += 1) {
      const t = Math.max(0, Math.min(1, ((px + 0.5 - x1) * dx + (py + 0.5 - y1) * dy) / lengthSq));
      const projX = x1 + t * dx;
      const projY = y1 + t * dy;
      if (Math.hypot(px + 0.5 - projX, py + 0.5 - projY) <= radius) {
        blendPixel(pixels, px, py, color);
      }
    }
  }
}

function strokePath(pixels, points, width, color) {
  for (let i = 0; i < points.length - 1; i += 1) {
    strokeLine(pixels, points[i][0], points[i][1], points[i + 1][0], points[i + 1][1], width, color);
  }
}

function fillTriangle(pixels, a, b, c, color) {
  const minX = Math.floor(Math.min(a[0], b[0], c[0]));
  const maxX = Math.ceil(Math.max(a[0], b[0], c[0]));
  const minY = Math.floor(Math.min(a[1], b[1], c[1]));
  const maxY = Math.ceil(Math.max(a[1], b[1], c[1]));
  const area = triangleArea(a, b, c) || 1;
  for (let py = minY; py <= maxY; py += 1) {
    for (let px = minX; px <= maxX; px += 1) {
      const p = [px + 0.5, py + 0.5];
      const w1 = triangleArea(p, b, c) / area;
      const w2 = triangleArea(a, p, c) / area;
      const w3 = triangleArea(a, b, p) / area;
      if (w1 >= 0 && w2 >= 0 && w3 >= 0) {
        blendPixel(pixels, px, py, color);
      }
    }
  }
}

function triangleArea(a, b, c) {
  return ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
}

function drawPackage(pixels, offsetX = 0, offsetY = 0) {
  fillRoundedRect(pixels, 42 + offsetX, 64 + offsetY, 108, 74, 18, COLORS.whiteSoft);
  strokePath(pixels, [[58 + offsetX, 82 + offsetY], [96 + offsetX, 100 + offsetY], [134 + offsetX, 82 + offsetY]], 10, COLORS.white);
  strokePath(pixels, [[96 + offsetX, 100 + offsetY], [96 + offsetX, 134 + offsetY]], 10, COLORS.white);
  strokePath(pixels, [[58 + offsetX, 82 + offsetY], [50 + offsetX, 100 + offsetY], [96 + offsetX, 124 + offsetY], [142 + offsetX, 100 + offsetY], [134 + offsetX, 82 + offsetY]], 10, COLORS.white);
}

function drawCheckMark(pixels, points = [[74, 96], [92, 114], [124, 78]], width = 12) {
  strokePath(pixels, points, width, COLORS.white);
}

function drawOrderNew(pixels) {
  drawPackage(pixels);
  fillCircle(pixels, 146, 46, 19, [255, 255, 255, 40]);
  strokeLine(pixels, 146, 34, 146, 58, 10, COLORS.white);
  strokeLine(pixels, 134, 46, 158, 46, 10, COLORS.white);
}

function drawOrderConfirmed(pixels) {
  drawPackage(pixels);
  drawCheckMark(pixels, [[74, 92], [92, 110], [126, 74]], 12);
}

function drawOrderDelivered(pixels) {
  drawCheckMark(pixels, [[76, 66], [92, 82], [122, 48]], 12);
  strokePath(pixels, [[52, 88], [108, 88], [108, 126], [52, 126], [52, 88]], 10, COLORS.white);
  strokePath(pixels, [[108, 98], [128, 98], [144, 114], [144, 126], [108, 126]], 10, COLORS.white);
  strokeCircle(pixels, 74, 132, 11, 10, COLORS.white);
  strokeCircle(pixels, 124, 132, 11, 10, COLORS.white);
}

function drawOrderCancelled(pixels) {
  strokeCircle(pixels, 96, 96, 50, 12, COLORS.white);
  strokeLine(pixels, 68, 68, 124, 124, 12, COLORS.white);
  strokeLine(pixels, 124, 68, 68, 124, 12, COLORS.white);
}

function drawOrderFailed(pixels) {
  fillTriangle(pixels, [96, 40], [146, 138], [46, 138], [255, 255, 255, 34]);
  strokePath(pixels, [[96, 52], [136, 130], [56, 130], [96, 52]], 10, COLORS.white);
  strokeLine(pixels, 96, 78, 96, 106, 12, COLORS.white);
  fillCircle(pixels, 96, 122, 7, COLORS.white);
}

function drawOrderRescheduled(pixels) {
  strokeCircle(pixels, 96, 100, 42, 10, COLORS.white);
  strokeLine(pixels, 96, 100, 96, 76, 10, COLORS.white);
  strokeLine(pixels, 96, 100, 118, 112, 10, COLORS.white);
  strokePath(pixels, [[58, 84], [58, 58], [86, 58]], 10, COLORS.white);
}

function drawOrderAssigned(pixels) {
  drawPackage(pixels, -6, 8);
  fillCircle(pixels, 122, 58, 22, [255, 255, 255, 40]);
  fillCircle(pixels, 122, 50, 10, COLORS.white);
  strokeCircle(pixels, 122, 68, 18, 8, COLORS.white);
}

function drawLowStock(pixels) {
  drawPackage(pixels, -4, 6);
  strokeLine(pixels, 130, 50, 130, 92, 12, COLORS.white);
  fillCircle(pixels, 130, 112, 7, COLORS.white);
}

function drawRemittanceOverdue(pixels) {
  fillRoundedRect(pixels, 44, 68, 104, 58, 18, [255, 255, 255, 40]);
  strokePath(pixels, [[56, 86], [136, 86], [136, 118], [56, 118], [56, 86]], 10, COLORS.white);
  strokeLine(pixels, 76, 96, 116, 96, 10, COLORS.white);
  strokeCircle(pixels, 132, 62, 20, 8, COLORS.white);
  strokeLine(pixels, 132, 62, 132, 50, 8, COLORS.white);
  strokeLine(pixels, 132, 62, 142, 68, 8, COLORS.white);
}

function drawStaleCarts(pixels) {
  strokePath(pixels, [[54, 74], [66, 74], [78, 120], [132, 120]], 10, COLORS.white);
  strokePath(pixels, [[74, 86], [138, 86], [130, 110], [80, 110]], 10, COLORS.white);
  strokeCircle(pixels, 90, 134, 10, 8, COLORS.white);
  strokeCircle(pixels, 124, 134, 10, 8, COLORS.white);
  strokeCircle(pixels, 142, 54, 16, 8, COLORS.white);
  strokeLine(pixels, 142, 54, 142, 45, 7, COLORS.white);
  strokeLine(pixels, 142, 54, 149, 60, 7, COLORS.white);
}

function drawWaybill(pixels) {
  fillRoundedRect(pixels, 54, 44, 84, 104, 18, [255, 255, 255, 34]);
  strokePath(pixels, [[66, 52], [120, 52], [138, 70], [138, 140], [66, 140], [66, 52]], 10, COLORS.white);
  strokePath(pixels, [[120, 52], [120, 70], [138, 70]], 10, COLORS.white);
  strokeLine(pixels, 80, 90, 122, 90, 10, COLORS.white);
  strokePath(pixels, [[102, 76], [122, 90], [102, 104]], 10, COLORS.white);
}

function drawTestPush(pixels) {
  strokeCircle(pixels, 96, 142, 10, 8, COLORS.white);
  strokePath(pixels, [[70, 84], [70, 96], [74, 120], [96, 132], [118, 120], [122, 96], [122, 84]], 10, COLORS.white);
  strokeLine(pixels, 82, 142, 110, 142, 8, COLORS.white);
  strokeLine(pixels, 96, 56, 96, 38, 10, COLORS.white);
  strokeLine(pixels, 74, 64, 62, 52, 8, COLORS.white);
  strokeLine(pixels, 118, 64, 130, 52, 8, COLORS.white);
}

function drawInfo(pixels) {
  strokeCircle(pixels, 96, 96, 50, 12, COLORS.white);
  fillCircle(pixels, 96, 66, 7, COLORS.white);
  strokeLine(pixels, 96, 84, 96, 126, 12, COLORS.white);
}
