import assert from "node:assert/strict";
import { test } from "node:test";
import { formatOrderForWhatsAppDispatch } from "./order-whatsapp-dispatch.js";

test("combo add-on WhatsApp dispatch uses component names instead of wrapper quantity", () => {
  const body = formatOrderForWhatsAppDispatch({
    id: "ORD-1",
    customer: "Mercy Tsekar",
    phone: "08033073602",
    whatsapp: "08033073602",
    address: "1 A234",
    city: "Makurdi",
    state: "Benue",
    product_name: "Edge Brusher Max",
    package_name: "Home Pack",
    quantity: 6,
    amount: 60400,
    currency: "NGN",
    cross_sell_lines: [
      {
        productName: "Edge Brusher Max",
        quantity: 1,
        amount: 30000,
        packageComponentsSnapshot: [
          { productName: "2-in-1 Window Groove", quantity: 4 },
          { productName: "Mini Mop", quantity: 2 },
          { productName: "Absorbent Hand Towel", quantity: 1, isFreeGift: true }
        ]
      }
    ]
  });

  assert.match(body, /Preferred Package 2:/);
  assert.match(body, /4pcs Of 2-in-1 Window Groove \+ 2pcs Of Mini Mop \+ One Free Gift Of Absorbent Hand Towel Combo/);
  assert.match(body, /Items: 4 pcs of 2-in-1 Window Groove \+ 2 pcs of Mini Mop \+ FREE 1 pc of Absorbent Hand Towel/);
  assert.doesNotMatch(body, /Preferred Package 2: Edge Brusher Max\s*\nItems: 1 pc/);
});

test("saved combo display text overrides generated component summary", () => {
  const body = formatOrderForWhatsAppDispatch({
    id: "ORD-2",
    customer: "Customer",
    phone: "08030000000",
    city: "Lagos",
    state: "Lagos",
    product_name: "Main Product",
    package_name: "Starter Pack",
    quantity: 1,
    amount: 18500,
    currency: "NGN",
    cross_sell_lines: [
      {
        displayName: "Window Groove Cleaning Tool Combo",
        displayDescription: "4 pcs of 2-in-1 Window Groove + 2 pcs of Mini Mop + FREE 1 pc of Absorbent Hand Towel",
        amount: 18500,
        packageComponentsSnapshot: [
          { productName: "Wrong Fallback", quantity: 1 }
        ]
      }
    ]
  });

  assert.match(body, /Preferred Package 2: Window Groove Cleaning Tool Combo/);
  assert.match(body, /Items: 4 pcs of 2-in-1 Window Groove \+ 2 pcs of Mini Mop \+ FREE 1 pc of Absorbent Hand Towel/);
  assert.doesNotMatch(body, /Wrong Fallback/);
});
