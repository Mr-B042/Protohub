import { forwardRef, type CSSProperties, type ReactNode } from "react";
import { CalendarDays, ClipboardList, Home, MapPin, MessageCircle, Package, Phone, ShieldCheck, Truck, User } from "lucide-react";
import { money, type ReceiptModel } from "./receipt-model";

// The two receipts from Bright's design (20 Oct 2026): "Order Confirmation"
// (middle) and "Thank You" (right). Inline styles only: they are drawn into a
// PNG by modern-screenshot, which copies computed styles, and they must look
// identical in the app's light and dark modes. Fixed 720px wide; the PNG is
// rendered at 1.5x (1080px), a good size for WhatsApp.

export type ReceiptBrand = { name: string; tagline: string; logoUrl: string | null; helpPhone: string };
export type ReceiptProps = { model: ReceiptModel; brand: ReceiptBrand; imageOf: (productId?: string) => string | null };

export const RECEIPT_WIDTH = 720;

/** Who and where, from the order record: name, phone, WhatsApp (when
 *  different), the full address, city/state and the delivery day. */
function customerRows(model: ReceiptModel, color: string) {
  const c = model.customer;
  const rows: Array<{ icon: ReactNode; label: string; value: string }> = [
    { icon: <User size={18} color={color} />, label: "Name", value: c.name },
    { icon: <Phone size={18} color={color} />, label: "Phone", value: c.phone },
  ];
  if (c.whatsapp) rows.push({ icon: <MessageCircle size={18} color={color} />, label: "WhatsApp", value: c.whatsapp });
  if (c.address) rows.push({ icon: <Home size={18} color={color} />, label: "Delivery address", value: c.address });
  rows.push({ icon: <MapPin size={18} color={color} />, label: "City / State", value: c.location });
  if (c.delivery) rows.push({ icon: <CalendarDays size={18} color={color} />, label: c.delivery.label, value: c.delivery.value });
  return rows;
}
const NAVY = "#0b1b3f";
const BLUE = "#1d6fe8";
const GREEN = "#16a34a";
const FONT = "Inter, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const base: CSSProperties = { width: RECEIPT_WIDTH, fontFamily: FONT, color: "#0f172a", background: "#ffffff", boxSizing: "border-box", overflow: "hidden", lineHeight: 1.35 };

export function WhatsAppGlyph({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <circle cx="16" cy="16" r="16" fill="#25D366" />
      <path fill="#fff" d="M23.3 8.7A10 10 0 0 0 7.6 20.8L6.3 25.7l5-1.3a10 10 0 0 0 4.7 1.2 10 10 0 0 0 7.3-16.9Zm-7.3 15.3a8.3 8.3 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3a8.3 8.3 0 1 1 6.9 3.8Zm4.6-6.2c-.3-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.6.8-.8 1-.3.2-.5 0a6.8 6.8 0 0 1-3.4-3c-.3-.4.3-.4.8-1.4a.5.5 0 0 0 0-.5l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 2.9 2.9 0 0 0-.9 2.2 5 5 0 0 0 1.1 2.7 11.5 11.5 0 0 0 4.4 3.9c1.6.7 2.3.8 3.1.6a2.7 2.7 0 0 0 1.8-1.2 2.2 2.2 0 0 0 .2-1.2c-.1-.2-.3-.2-.6-.3Z" />
    </svg>
  );
}

function BagLogo({ size = 40, color = BLUE, light = false }: { size?: number; color?: string; light?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden>
      <rect x="5" y="12" width="30" height="25" rx="5" fill={light ? "#ffffff" : color} />
      <path d="M13 15v-4a7 7 0 0 1 14 0v4" fill="none" stroke={light ? "#ffffff" : color} strokeWidth="3" strokeLinecap="round" />
      <circle cx="14" cy="19" r="1.8" fill={light ? color : "#ffffff"} /><circle cx="26" cy="19" r="1.8" fill={light ? color : "#ffffff"} />
    </svg>
  );
}

function Logo({ brand, size = 44, light = false }: { brand: ReceiptBrand; size?: number; light?: boolean }) {
  return brand.logoUrl
    ? <img src={brand.logoUrl} alt="" crossOrigin="anonymous" style={{ width: size, height: size, objectFit: "contain", borderRadius: 10, background: light ? "#ffffff" : "transparent" }} />
    : <BagLogo size={size} light={light} />;
}

function Brand({ brand, light = false }: { brand: ReceiptBrand; light?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <Logo brand={brand} light={light} />
      <div>
        <div style={{ fontSize: 26, fontWeight: 900, letterSpacing: 0.5, color: light ? "#ffffff" : NAVY, textTransform: "uppercase", lineHeight: 1.05 }}>{brand.name}</div>
        {brand.tagline && <div style={{ fontSize: 13, color: light ? "rgba(255,255,255,0.85)" : "#64748b", marginTop: 2 }}>{brand.tagline}</div>}
      </div>
    </div>
  );
}

function PodPill({ paid, light = false }: { paid: boolean; light?: boolean }) {
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 18px", borderRadius: 999, background: NAVY, color: "#ffffff", fontSize: 13, fontWeight: 800, letterSpacing: 0.3, boxShadow: light ? "0 0 0 3px rgba(255,255,255,0.55)" : "none", whiteSpace: "nowrap" }}>
      <Truck size={18} strokeWidth={2.4} /> {paid ? "PAID ON DELIVERY" : "PAY ON DELIVERY"}
    </div>
  );
}

function Chip({ children, tone }: { children: ReactNode; tone: "blue" | "purple" | "green" }) {
  const tones = { blue: ["#e8f0ff", "#1d4ed8"], purple: ["#f1e8ff", "#7e22ce"], green: ["#dcfce7", "#15803d"] } as const;
  return <span style={{ display: "inline-block", padding: "4px 12px", borderRadius: 8, background: tones[tone][0], color: tones[tone][1], fontSize: 13, fontWeight: 700, whiteSpace: "nowrap" }}>{children}</span>;
}

function ProductImage({ src, size, radius = 14 }: { src: string | null; size: number; radius?: number }) {
  return src
    ? <img src={src} alt="" crossOrigin="anonymous" style={{ width: size, height: size, objectFit: "cover", borderRadius: radius, display: "block", background: "#f1f5f9" }} />
    : <div style={{ width: size, height: size, borderRadius: radius, background: "#eef2f7", display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8" }}><Package size={size * 0.4} /></div>;
}

function Totals({ model, compact = false }: { model: ReceiptModel; compact?: boolean }) {
  const row: CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", padding: compact ? "10px 18px" : "12px 20px", fontSize: 17, color: "#334155" };
  const s = model.currencySymbol;
  return (
    <div style={{ border: "1px solid #e2e8f0", borderRadius: 16, overflow: "hidden" }}>
      <div style={row}><span>Subtotal</span><span style={{ fontWeight: 600 }}>{money(model.subtotal, s)}</span></div>
      <div style={row}><span>Delivery Fee</span><span style={{ display: "flex", alignItems: "center", gap: 10 }}><b style={{ fontSize: 18, color: "#0f172a" }}>{money(model.deliveryFee, s)}</b><Chip tone="green">FREE DELIVERY</Chip></span></div>
      <div style={{ ...row, background: "#ecfdf3", padding: compact ? "14px 18px" : "16px 20px" }}>
        <span style={{ fontSize: 19, fontWeight: 800, color: "#0f172a" }}>Total Amount</span>
        <span style={{ fontSize: 30, fontWeight: 900, color: "#0f172a" }}>{money(model.total, s)}</span>
      </div>
    </div>
  );
}

function Promises({ small = false }: { small?: boolean }) {
  const items = [
    { icon: <Truck size={small ? 22 : 24} color="#fff" />, bg: GREEN, title: "FREE DELIVERY", sub: "Nationwide" },
    { icon: <Package size={small ? 22 : 24} color="#fff" />, bg: BLUE, title: "PAY ON DELIVERY", sub: "Pay when you receive" },
    { icon: <ShieldCheck size={small ? 22 : 24} color="#fff" />, bg: "#f59e0b", title: "QUALITY GUARANTEED", sub: "Check before payment" }
  ];
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: small ? "4px 6px" : "4px 8px" }}>
      {items.map((item) => (
        <div key={item.title} style={{ display: "flex", flexDirection: small ? "column" : "row", alignItems: "center", gap: small ? 6 : 10, flex: 1, textAlign: small ? "center" : "left" }}>
          <span style={{ width: small ? 40 : 44, height: small ? 40 : 44, borderRadius: 999, background: item.bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{item.icon}</span>
          <div><div style={{ fontSize: small ? 12.5 : 13, fontWeight: 800, color: NAVY, lineHeight: "17px", whiteSpace: "nowrap" }}>{item.title}</div><div style={{ fontSize: 12, color: "#475569", lineHeight: "16px", whiteSpace: "nowrap" }}>{item.sub}</div></div>
        </div>
      ))}
    </div>
  );
}

function Footer({ brand }: { brand: ReceiptBrand }) {
  return (
    <div style={{ position: "relative", background: NAVY, color: "#ffffff", padding: "40px 28px 24px", marginTop: 6 }}>
      <svg viewBox="0 0 720 40" preserveAspectRatio="none" style={{ position: "absolute", top: -1, left: 0, width: "100%", height: 34 }} aria-hidden>
        <path d="M0 0h720v14c-120 26-240 26-360 6S120-6 0 22Z" fill="#ffffff" />
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Logo brand={brand} size={42} light />
          <div><div style={{ fontSize: 22, fontWeight: 900, textTransform: "uppercase" }}>{brand.name}</div>{brand.tagline && <div style={{ fontSize: 13, opacity: 0.85 }}>{brand.tagline}</div>}</div>
        </div>
        {brand.helpPhone && (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <WhatsAppGlyph size={34} />
            <div style={{ fontSize: 13, lineHeight: 1.3 }}><div style={{ fontWeight: 700 }}>Need Help?</div><div style={{ opacity: 0.9 }}>Chat with us on WhatsApp</div><div style={{ fontSize: 16, fontWeight: 800 }}>{brand.helpPhone}</div></div>
          </div>
        )}
      </div>
    </div>
  );
}

const sectionTitle = (icon: ReactNode, text: string) => (
  <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 19, fontWeight: 800, color: NAVY, margin: "0 0 12px" }}>{icon}{text}</div>
);

// ── Middle design: Order Confirmation ───────────────────────────────────────

export const OrderConfirmationReceipt = forwardRef<HTMLDivElement, ReceiptProps>(function OrderConfirmationReceipt({ model, brand, imageOf }, ref) {
  const s = model.currencySymbol;
  const main = model.lines[0];
  return (
    <div ref={ref} style={{ ...base, borderRadius: 24 }}>
      <div style={{ padding: "28px 32px 8px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}><Brand brand={brand} /><PodPill paid={model.paid} /></div>
        <div style={{ textAlign: "center", marginTop: 22 }}>
          <div style={{ fontSize: 34, fontWeight: 900, color: NAVY, letterSpacing: 0.5 }}>ORDER CONFIRMATION</div>
          <div style={{ fontSize: 19, fontWeight: 600, marginTop: 6 }}>Thank you for your order! 🎉</div>
          <div style={{ fontSize: 15, color: "#475569", marginTop: 4 }}>Here are your order details. Please check and keep this for reference.</div>
        </div>
        <div style={{ display: "flex", marginTop: 20, borderRadius: 16, overflow: "hidden", background: "#eaf1fd" }}>
          <div style={{ flex: 1, padding: "14px 18px", borderRight: "1px solid #d5e2f7" }}><div style={{ fontSize: 15, color: "#334155" }}>Order ID</div><div style={{ fontSize: 20, fontWeight: 800, marginTop: 2 }}>{model.reference}</div></div>
          <div style={{ flex: 1, padding: "14px 18px" }}><div style={{ fontSize: 15, color: "#334155" }}>Order Date</div><div style={{ fontSize: 18, fontWeight: 500, marginTop: 4 }}>{model.orderDate}</div></div>
        </div>

        <div style={{ marginTop: 24 }}>
          {sectionTitle(<User size={22} color={BLUE} fill={BLUE} />, "Customer & Delivery Details")}
          {customerRows(model, "#64748b").map(({ icon, label, value }) => (
            <div key={label} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "5px 0", fontSize: 16 }}>
              <span style={{ display: "flex", paddingTop: 1, flexShrink: 0 }}>{icon}</span><span style={{ width: 150, flexShrink: 0, color: "#475569", fontSize: 14, paddingTop: 1 }}>{label}:</span><span style={{ fontWeight: 500, minWidth: 0, overflowWrap: "anywhere" }}>{value}</span>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 22 }}>
          {sectionTitle(<ClipboardList size={22} color={BLUE} />, "Order Summary")}
          {model.lines.map((line, i) => (
            <div key={i} style={{ display: "flex", gap: 16, alignItems: "flex-start", border: "1px solid #e2e8f0", borderRadius: 16, padding: 12, marginBottom: 10 }}>
              <ProductImage src={imageOf(line.productId)} size={line.kind === "main" ? 108 : 64} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: line.kind === "main" ? 20 : 17, fontWeight: 800 }}>{line.name}</div>
                {(line.subtitle || (line.kind === "addon" && line.detail)) && <div style={{ fontSize: 15, color: "#475569", marginTop: 2 }}>{line.subtitle || line.detail}</div>}
                {line.kind === "main" && (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                    {main.detail && <Chip tone="blue">{main.detail}</Chip>}
                    {model.gifts.length > 0 && <Chip tone="purple">Includes {model.gifts.length} FREE GIFT{model.gifts.length === 1 ? "" : "S"}</Chip>}
                  </div>
                )}
              </div>
              <div style={{ textAlign: "right" }}><div style={{ fontSize: 20, fontWeight: 800 }}>{money(line.amount, s)}</div><div style={{ fontSize: 15, color: "#334155", marginTop: 14 }}>x{line.quantity}</div></div>
            </div>
          ))}
          {model.gifts.length > 0 && (
            <div style={{ fontSize: 14, color: "#6b21a8", margin: "-2px 4px 10px" }}>Free gifts: {model.gifts.map((g) => `${g.name}${g.quantity > 1 ? ` x${g.quantity}` : ""}`).join(", ")}</div>
          )}
          <Totals model={model} />
        </div>

        <div style={{ marginTop: 20 }}><Promises /></div>

        <div style={{ display: "flex", gap: 14, marginTop: 18, marginBottom: 18, padding: "16px 18px", borderRadius: 16, background: "#eef4fe", border: "1px solid #dbe6fb" }}>
          <span style={{ width: 34, height: 34, borderRadius: 999, background: BLUE, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><ClipboardList size={18} color="#fff" /></span>
          <div style={{ fontSize: 16, color: "#1e3a8a" }}>
            <div style={{ fontWeight: 800, color: BLUE }}>Important:</div>
            {model.paid ? <>This order was paid on delivery: {money(model.total, s)}.</> : <>You will pay <b>{money(model.total, s)}</b> when you receive your order.</>}<br />Please keep this receipt for reference.
          </div>
        </div>
      </div>
      <Footer brand={brand} />
    </div>
  );
});

// ── Right design: Thank You ─────────────────────────────────────────────────

export const ThankYouReceipt = forwardRef<HTMLDivElement, ReceiptProps>(function ThankYouReceipt({ model, brand, imageOf }, ref) {
  const s = model.currencySymbol;
  const main = model.lines[0];
  const extras = model.lines.slice(1);
  return (
    <div ref={ref} style={{ ...base, borderRadius: 24, background: "#f4f8ff" }}>
      <div style={{ position: "relative", padding: "26px 28px 70px", background: "linear-gradient(135deg, #3b82f6 0%, #1d6fe8 55%, #1557c9 100%)", color: "#ffffff" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}><Brand brand={brand} light /><PodPill paid={model.paid} light /></div>
        <div style={{ position: "relative", textAlign: "center", marginTop: 18, fontFamily: "'Kaushan Script', 'Brush Script MT', cursive", fontSize: 56, lineHeight: 1.05, textShadow: "0 3px 0 rgba(15,23,42,0.18)" }}>
          Thank You<br />for Your Order!
          <svg width="44" height="44" viewBox="0 0 44 44" style={{ position: "absolute", right: 70, top: 40 }} aria-hidden>
            <path d="M6 30l8-6M10 12l6 8M24 4l0 10" stroke="#fbbf24" strokeWidth="4" strokeLinecap="round" />
          </svg>
        </div>
        <svg viewBox="0 0 720 60" preserveAspectRatio="none" style={{ position: "absolute", left: 0, bottom: -1, width: "100%", height: 60 }} aria-hidden>
          <path d="M0 40c160-40 300 10 440-6S640-6 720 18v42H0Z" fill="#f4f8ff" />
        </svg>
      </div>

      <div style={{ padding: "0 24px", marginTop: -48, position: "relative" }}>
        <div style={{ background: "#ffffff", borderRadius: 20, boxShadow: "0 8px 24px rgba(15,23,42,0.08)", overflow: "hidden" }}>
          <div style={{ display: "flex", borderBottom: "1px solid #e2e8f0" }}>
            <div style={{ flex: 1, padding: "14px 20px", borderRight: "1px solid #e2e8f0" }}><div style={{ fontSize: 14, color: "#475569" }}>Order ID</div><div style={{ fontSize: 19, fontWeight: 800 }}>{model.reference}</div></div>
            <div style={{ flex: 1, padding: "14px 20px" }}><div style={{ fontSize: 14, color: "#475569" }}>Order Date</div><div style={{ fontSize: 17 }}>{model.orderDate}</div></div>
          </div>
          <div style={{ display: "flex", gap: 14, padding: "14px 20px 18px" }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: NAVY, marginBottom: 8 }}>Customer Details</div>
              {customerRows(model, BLUE).map(({ icon, label, value }) => (
                <div key={label} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "4px 0", fontSize: 16 }}>
                  <span style={{ display: "flex", paddingTop: 1, flexShrink: 0 }}>{icon}</span>
                  <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{label === "Delivery date" || label === "Delivered on" || label === "Preferred delivery" ? <><span style={{ color: "#475569" }}>{label}: </span><b>{value}</b></> : value}</span>
                </div>
              ))}
            </div>
            <div style={{ width: 210, borderRadius: 16, background: "#eef4fe", padding: "16px", display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ width: 52, height: 52, borderRadius: 12, background: BLUE, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Package size={28} color="#fde68a" /></span>
              <div><div style={{ fontSize: 19, fontWeight: 900, color: NAVY, lineHeight: 1.1 }}>{model.paid ? "PAID ON" : "PAY ON"}<br />DELIVERY</div><div style={{ fontSize: 12.5, color: BLUE, marginTop: 4 }}>{model.paid ? "Paid when received" : "Pay when you receive"}</div></div>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 14, marginTop: 16, background: "#ffffff", borderRadius: 20, padding: 14, boxShadow: "0 8px 24px rgba(15,23,42,0.06)" }}>
          <ProductImage src={imageOf(main.productId)} size={250} radius={16} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 30, fontWeight: 900, color: NAVY, lineHeight: 1.1 }}>{main.name}</div>
            {main.subtitle && <div style={{ fontSize: 17, color: "#475569", marginTop: 4 }}>{main.subtitle}</div>}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 8, marginTop: 12 }}>
              {main.detail && <Chip tone="blue">{main.detail}</Chip>}
              {model.gifts.length > 0 && <Chip tone="purple">+ {model.gifts.length} FREE GIFT{model.gifts.length === 1 ? "" : "S"}</Chip>}
            </div>
            {model.gifts.length > 0 && (
              <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
                {model.gifts.slice(0, 3).map((gift, i) => (
                  <div key={i} style={{ position: "relative", width: 128, border: "1px solid #e2e8f0", borderRadius: 14, padding: "10px 8px 8px", textAlign: "center", background: "#ffffff" }}>
                    <span style={{ position: "absolute", top: -9, left: 8, background: "#ef4444", color: "#fff", fontSize: 11, fontWeight: 800, padding: "2px 8px", borderRadius: 6 }}>FREE</span>
                    <div style={{ display: "flex", justifyContent: "center" }}><ProductImage src={imageOf(gift.productId)} size={70} radius={10} /></div>
                    <div style={{ fontSize: 12.5, marginTop: 6, color: "#0f172a" }}>{gift.name}{gift.quantity > 1 ? ` x${gift.quantity}` : ""}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {extras.length > 0 && (
          <div style={{ marginTop: 12, background: "#ffffff", borderRadius: 16, padding: "6px 16px" }}>
            {extras.map((line, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderTop: i ? "1px solid #eef2f7" : "none", fontSize: 16 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 10 }}><ProductImage src={imageOf(line.productId)} size={40} radius={8} /><span><b>{line.name}</b>{line.detail ? <span style={{ color: "#64748b" }}> · {line.detail}</span> : null} x{line.quantity}</span></span>
                <b>{money(line.amount, s)}</b>
              </div>
            ))}
          </div>
        )}

        <div style={{ marginTop: 14, background: "#ffffff", borderRadius: 18 }}><Totals model={model} compact /></div>
        <div style={{ marginTop: 16, marginBottom: 18 }}><Promises small /></div>
      </div>
      <Footer brand={brand} />
    </div>
  );
});
