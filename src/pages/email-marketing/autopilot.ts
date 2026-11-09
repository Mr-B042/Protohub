import type { EmDesigner, EmDesignerProduct, EmFlowNode, EmQuietReason } from "../../lib/api";
import { buildQuietDesign, buildStarterDesign, fillProduct, type CampaignFields, type QuietEmailSpec } from "../../lib/email-render";
import { DEFAULT_SETTINGS, newId, type AutoDraft } from "./automation-model";
import { priceText } from "./wizard-model";

/**
 * Autopilot (Bright, 9 Nov 2026: "start working non stop… the right email
 * for each product… draft if not available"). Builds the automations that
 * keep email marketing running by itself, from the business's own products:
 *  - for everyone: Welcome (new subscriber) and Win-Back (60 days quiet);
 *  - for each product that sells: After Delivery (thanks + use, how is it
 *    going, a matching product) and Cart Reminder (1 hour, then next day).
 * A flow goes live only when its emails have a product photo and an order
 * page; otherwise it is saved as a draft that says what is missing.
 */

export type PlanItem = { key: string; draft: AutoDraft; ready: boolean; needs: string[]; productName: string | null };

const SETTINGS = {
  ...DEFAULT_SETTINGS,
  // Customers order every day: send every day, 8am to 8pm Lagos.
  sendWindow: { on: true, from: 8, to: 20, days: [0, 1, 2, 3, 4, 5, 6] }
};

function fields(designer: EmDesigner, product: EmDesignerProduct | undefined): CampaignFields {
  return {
    brand: designer.sender.fromName || "Our Store", goal: "retention", offerType: "custom", productId: product?.id ?? "", productName: product?.name ?? "",
    productImage: product?.image ?? "", productLink: product?.links[0]?.url ?? "", productPrice: priceText(product), offerOn: false, offerTitle: "", offerBenefit: ""
  };
}
const wait = (amount: number, unit: "hours" | "days" = "days"): EmFlowNode => ({ id: newId("w"), type: "wait", amount, unit });
function email(name: string, starter: string, designer: EmDesigner, product: EmDesignerProduct | undefined, subject: string, preheader: string): EmFlowNode {
  const f = fields(designer, product);
  return {
    id: newId("e"), type: "email", name, campaignId: null,
    email: { subject: fillProduct(subject, f.productName), preheader, design: buildStarterDesign(starter, f), productId: product?.id ?? null, thumbnailUrl: product?.image || null }
  };
}
const needsOf = (product: EmDesignerProduct | undefined) => [
  ...(!product?.image ? ["a product photo (Products & Stock › gallery)"] : []),
  ...(!product?.links.length ? ["an order page link (Tracking Hub › landing page)"] : [])
];

// ── Customers who went quiet (Bright, 9 Nov 2026) ────────────────────
// "Follow up customers who… haven't been picking calls for days… forever
// till they buy." Each email shows the product THAT customer ordered
// ({{Their Product}} and the marked picture/card are filled when sent).
// First month: day 1, 3, 7, 14, 21, 30, words matched to why they went quiet.
// After that: one email a month, six in turn, starting over, until they
// order, their order is delivered, or they unsubscribe. No made-up offers.

type QuietMail = { name: string; subject: string; preheader: string; spec: QuietEmailSpec };
const REPLY = "Questions? Just reply to this email. A real person reads every reply.";
const POD_LINE = "No payment upfront: you pay when it arrives at your door.";
const mail = (name: string, subject: string, preheader: string, spec: Omit<QuietEmailSpec, "lines"> & { lines: string[] }): QuietMail => ({ name, subject, preheader, spec });

const QUIET_FIRST_MONTH: Record<"unreachable" | "not_ready" | "let_down", QuietMail[]> = {
  unreachable: [
    mail("Day 1: We Tried To Reach You", "{{First Name}}, we couldn't reach you about your order", "Your {{Their Product}} is still waiting",
      { slug: "checkout-help", tone: "sky", title: "We Tried To Reach You 📞", subtitle: "Your order is still waiting for you.", button: "Complete My Order", buttonTone: "purple",
        lines: ["We tried calling you about your order but couldn't get through.", "If now isn't a good time, no problem. Reply with a good time to call, or order again below.", POD_LINE] }),
    mail("Day 3: Still Want It?", "Still want your {{Their Product}}, {{First Name}}?", "It's still here for you",
      { slug: "re-engagement", tone: "peach", title: "Still Want Your {{Their Product}}?", subtitle: "It's still here for you.", button: "Order Now",
        lines: ["Your {{Their Product}} is still available.", "Reply with a good time and we'll call you, or order below and we'll deliver it to your door.", REPLY] }),
    mail("Day 7: Pay When It Arrives", "No payment until it arrives, {{First Name}}", "Your {{Their Product}}, delivered to your door",
      { slug: "shipping-confirmation", tone: "sky", title: "Pay Only When It Arrives 💵", subtitle: "Delivered to your door.", button: "Order Now", buttonTone: "purple",
        lines: ["No payment upfront. Our rider brings your {{Their Product}} to your door and you pay when it's in your hands.", "Reply with the best day and time, and we'll arrange it."] }),
    mail("Day 14: Take Your Time", "Take your time, {{First Name}}", "Your {{Their Product}} is one tap away",
      { slug: "cart-expiring", tone: "peach", title: "Still Thinking About It? 🤔", subtitle: "Take your time. We're here when you're ready.", button: "Order Now",
        lines: ["When you're ready, your {{Their Product}} is one tap away.", REPLY] }),
    mail("Day 21: Popular Items Sell Out", "Your {{Their Product}} is still available today", "Popular items sell out fast",
      { slug: "almost-sold-out", tone: "peach", title: "Still Available Today ⏳", subtitle: "Popular items sell out fast.", button: "Get Mine Now",
        lines: ["Your {{Their Product}} is still available today, but stock moves fast.", POD_LINE] }),
    mail("Day 30: Should We Keep It For You?", "Should we keep your order, {{First Name}}?", "Just checking in",
      { slug: "stay-subscribed", tone: "sky", title: "Should We Keep Your Order? 💜", subtitle: "Just checking in.", button: "Yes, Order Now", buttonTone: "purple",
        lines: ["It's been a month since you ordered your {{Their Product}}. If you still want it, order below and we'll deliver it.", "If not, no problem at all. We'll check in now and then with news you might like."] })
  ],
  not_ready: [
    mail("Day 1: Whenever You're Ready", "No rush, {{First Name}}: your {{Their Product}} can wait", "Order when it suits you",
      { slug: "holiday-schedule", tone: "mint", title: "Whenever You're Ready 🙂", subtitle: "No rush at all.", button: "Order When Ready",
        lines: ["When you're back or ready, your {{Their Product}} is one tap away.", "Reply with the day that suits you and we'll deliver then.", POD_LINE] }),
    mail("Day 3: Pick a Day", "Which day suits you, {{First Name}}?", "We'll deliver on your day",
      { slug: "last-chance-winback", tone: "peach", title: "Pick a Day That Suits You 📅", subtitle: "We'll deliver on your day.", button: "Order Now",
        lines: ["Tell us the day and we'll deliver your {{Their Product}} then. Just reply to this email with the date."] }),
    mail("Day 7: Back Home?", "Back home yet, {{First Name}}?", "We'll bring it to your door",
      { slug: "delivered", tone: "peach", title: "Back Home? 🏠", subtitle: "We'll bring it to your door.", button: "Deliver Mine",
        lines: ["If you travelled, we hope it went well. When you're back, we'll bring your {{Their Product}} to your door.", POD_LINE] }),
    mail("Day 14: Pay When It Arrives", "Order now, pay when it arrives, {{First Name}}", "No payment upfront",
      { slug: "shipping-confirmation", tone: "sky", title: "Pay When It Arrives 💵", subtitle: "No payment upfront.", button: "Order Now", buttonTone: "purple",
        lines: ["You pay only when your {{Their Product}} is in your hands, so you can order now and we'll deliver when you're ready.", REPLY] }),
    mail("Day 21: Still Want It?", "Still want your {{Their Product}}, {{First Name}}?", "It's still available",
      { slug: "re-engagement", tone: "peach", title: "Still Want Your {{Their Product}}?", subtitle: "It's still available.", button: "Order Now",
        lines: ["Your {{Their Product}} is still available. Order now, or reply with a better day."] }),
    mail("Day 30: Ready Now?", "Ready now, {{First Name}}?", "Your {{Their Product}} is ready to go",
      { slug: "welcome-gift-reminder", tone: "pink", title: "Ready Now? 🙌", subtitle: "Your order is ready to go.", button: "Order Now", buttonTone: "purple",
        lines: ["A month has gone by since you ordered. If now's a good time, your {{Their Product}} is ready to go.", POD_LINE] })
  ],
  let_down: [
    mail("Day 1: We're Sorry", "We're sorry, {{First Name}}", "We couldn't deliver as planned",
      { slug: "thank-you-loyal-customer", tone: "lavender", title: "We're Sorry 💜", subtitle: "We couldn't deliver as planned.", button: "See My Order", buttonTone: "purple",
        lines: ["We couldn't get your {{Their Product}} to you as planned, and that's on us.", "Reply to this email and we'll tell you as soon as we can deliver to you."] }),
    mail("Day 3: We Haven't Forgotten You", "We haven't forgotten you, {{First Name}}", "We're still working on your order",
      { slug: "stay-subscribed", tone: "sky", title: "We Haven't Forgotten You", subtitle: "We're still working on it.", button: "Order Again", buttonTone: "purple",
        lines: ["We're still working to get your {{Their Product}} to you.", "Reply with your current address or area and we'll check what we can do."] }),
    mail("Day 7: Want Us To Check Again?", "Shall we check again, {{First Name}}?", "Stock and delivery areas change every week",
      { slug: "back-in-stock", tone: "butter", title: "Want Us To Check Again? 🔔", subtitle: "Stock and delivery areas change every week.", button: "Order Again", buttonTone: "purple",
        lines: ["Order again below or reply, and we'll check if we can deliver your {{Their Product}} now.", "We'll call to confirm before anything is sent."] }),
    mail("Day 14: Still Want It?", "Still want your {{Their Product}}, {{First Name}}?", "We'd love to get it to you",
      { slug: "re-engagement", tone: "peach", title: "Still Want Your {{Their Product}}?", subtitle: "We'd love to get it to you.", button: "Order Now",
        lines: ["If you still want it, order below. We'll call to confirm we can deliver before anything is sent.", POD_LINE] }),
    mail("Day 21: Delivered To Your Door", "Delivered to your door, {{First Name}}", "Pay on delivery",
      { slug: "faster-delivery", tone: "sky", title: "Delivered To Your Door 🚚", subtitle: "And you pay when it arrives.", button: "Order Now", buttonTone: "purple",
        lines: ["If we can reach your area now, we'd love to get your {{Their Product}} to you.", REPLY] }),
    mail("Day 30: Thank You For Your Patience", "Thank you for your patience, {{First Name}}", "Whenever you'd like to try again",
      { slug: "refer-a-friend", tone: "pink", title: "Thank You For Your Patience 💜", subtitle: "Whenever you'd like to try again.", button: "Order Again", buttonTone: "purple",
        lines: ["Thank you for giving us a chance. Whenever you'd like to try again, your {{Their Product}} is one tap away."] })
  ]
};

const QUIET_MONTHLY: QuietMail[] = [
  mail("Month 1: Still Available", "Your {{Their Product}} is still available, {{First Name}}", "In case you still want it",
    { slug: "whats-new", tone: "lavender", title: "Still Available ✨", subtitle: "In case you still want it.", button: "Order Now", buttonTone: "purple",
      lines: ["It's been a while. Here's your {{Their Product}} again, in case you still want it.", POD_LINE] }),
  mail("Month 2: Pay On Delivery", "Pay when it arrives, {{First Name}}", "No payment upfront",
    { slug: "shipping-confirmation", tone: "sky", title: "Pay On Delivery, Always 💵", subtitle: "No payment upfront.", button: "Order Now", buttonTone: "purple",
      lines: ["Order today and pay only when it's in your hands.", REPLY] }),
  mail("Month 3: Still Here For You", "Still here for you, {{First Name}}", "Whenever you're ready",
    { slug: "refer-a-friend", tone: "pink", title: "Still Here For You 🤝", subtitle: "Whenever you're ready.", button: "Order Now", buttonTone: "purple",
      lines: ["No pressure, just a friendly hello. Your {{Their Product}} is one tap away whenever you want it."] }),
  mail("Month 4: Ready When You Are", "Ready when you are, {{First Name}}", "Your {{Their Product}} is waiting",
    { slug: "back-in-stock", tone: "butter", title: "Ready When You Are 🔔", subtitle: "Your order is waiting.", button: "Order Now", buttonTone: "purple",
      lines: ["Your {{Their Product}} is ready to deliver to your door.", POD_LINE] }),
  mail("Month 5: Make Life Easier", "Make life easier, {{First Name}}", "Delivered to your door",
    { slug: "our-story", tone: "lavender", title: "Make Life Easier 🏠", subtitle: "Delivered to your door.", button: "Order Now", buttonTone: "purple",
      lines: ["Customers order from us for their homes every day. Whenever you're ready, so is your {{Their Product}}.", REPLY] }),
  mail("Month 6: We'd Love To Have You", "We'd love to have you, {{First Name}}", "Order whenever you're ready",
    { slug: "win-back-campaign", tone: "lavender", title: "We'd Love To Have You 💜", subtitle: "Order whenever you're ready.", button: "Order Now", buttonTone: "purple",
      lines: ["Order below whenever you're ready.", POD_LINE] })
];

function quietEmail(designer: EmDesigner, sample: EmDesignerProduct | undefined, row: QuietMail): EmFlowNode {
  return {
    id: newId("e"), type: "email", name: row.name, campaignId: null,
    email: { subject: row.subject, preheader: row.preheader, design: buildQuietDesign(fields(designer, sample), row.spec), productId: null, thumbnailUrl: null }
  };
}
/** Day 1, 3, 7, 14, 21, 30 (the trigger fires on day 1). */
const FIRST_MONTH_GAPS = [0, 2, 4, 7, 7, 9];

function draft(name: string, description: string, template: string, goal: string, stage: AutoDraft["stage"], trigger: AutoDraft["trigger"], nodes: EmFlowNode[], exitOnPurchase: boolean): AutoDraft {
  return {
    id: null, status: "draft", active: true, name, description, template, goal, trigger, audience: { source: "all" },
    enrollment: { on: false, match: "all", conditions: [] },
    settings: { ...SETTINGS, exit: { ...SETTINGS.exit, onPurchase: exitOnPurchase } },
    workflow: { nodes }, stage
  };
}

/** The whole plan. `sales` = delivered-or-placed orders per product in the last 60 days. */
export function autopilotPlan(designer: EmDesigner, sales: Array<{ productId: string; orders: number }>): PlanItem[] {
  const count = new Map(sales.map((row) => [row.productId, row.orders]));
  const products = designer.products.filter((row) => (count.get(row.id) ?? 0) > 0).sort((a, b) => (count.get(b.id) ?? 0) - (count.get(a.id) ?? 0));
  const best = products.find((row) => row.image && row.links.length) ?? products[0];
  // Products with an order page but no sales yet: drafts, ready to switch on later.
  const quiet = designer.products.filter((row) => !(count.get(row.id) ?? 0) && row.links.length);
  const plan: PlanItem[] = [];

  const storeNeeds = needsOf(best);
  plan.push({
    key: "welcome", productName: null, ready: !storeNeeds.length, needs: storeNeeds,
    draft: draft("Autopilot: Welcome", "New subscribers get a welcome, then the best seller.", "welcome", "welcome", "acquisition", { kind: "new_subscriber" }, [
      email("Email 1: Welcome", "welcome_email", designer, best, "Welcome, {{First Name}}! 🎉", "Thanks for joining us"),
      wait(3),
      email("Email 2: Our Best Seller", "product_collection", designer, best, "Our customers' favourite: {{Product}}", "Order today, pay on delivery")
    ], true)
  });
  plan.push({
    key: "win_back", productName: null, ready: !storeNeeds.length, needs: storeNeeds,
    draft: draft("Autopilot: Win-Back", "Customers with no delivery for 60 days.", "win_back", "winback", "winback", { kind: "inactive", inactiveDays: 60 }, [
      email("Email 1: We Miss You", "win_back_offer", designer, best, "We miss you, {{First Name}}", "Here is a reason to come back"),
      wait(7),
      { id: newId("c"), type: "condition", name: "Did the customer order again?", check: { kind: "placed_order" }, yes: [], no: [
        email("Email 2: Still Here For You", "still_interested", designer, best, "Still thinking about {{Product}}?", "It's still available")
      ] }
    ], true)
  });

  // Customers who went quiet: one first-month flow per reason, then the monthly one, forever.
  const quietFlows: Array<{ key: "unreachable" | "not_ready" | "let_down"; title: string; reasons: EmQuietReason[]; about: string }> = [
    { key: "unreachable", title: "Stopped Picking Calls", reasons: ["unreachable", "other"], about: "Orders that failed or stalled because the customer stopped picking calls or replying (or no reason was written)." },
    { key: "not_ready", title: "Not Ready Yet", reasons: ["not_ready"], about: "Customers who said they travelled, had no money yet or asked to wait." },
    { key: "let_down", title: "We Let Them Down", reasons: ["let_down"], about: "Orders we couldn't deliver: out of stock, or we couldn't reach their area." }
  ];
  for (const flow of quietFlows) {
    const nodes: EmFlowNode[] = [];
    QUIET_FIRST_MONTH[flow.key].forEach((row, index) => { if (FIRST_MONTH_GAPS[index]) nodes.push(wait(FIRST_MONTH_GAPS[index])); nodes.push(quietEmail(designer, best, row)); });
    const auto = draft(`Autopilot: Went Quiet — ${flow.title}`, `${flow.about} Six emails over the first month, each showing the product they ordered.`, "win_back", "winback", "winback",
      { kind: "went_quiet", quietDays: 1, quietReasons: flow.reasons }, nodes, true);
    auto.settings = { ...auto.settings, priority: "high", reentry: false };
    plan.push({ key: `quiet:${flow.key}`, productName: null, ready: !storeNeeds.length, needs: storeNeeds, draft: auto });
  }
  {
    const nodes: EmFlowNode[] = [];
    for (const row of QUIET_MONTHLY) nodes.push(wait(30), quietEmail(designer, best, row));
    const auto = draft("Autopilot: Went Quiet — Monthly, Until They Buy", "Everyone who went quiet over a month ago (including those who said no thanks): one email a month, six in turn, then again from the start. Stops when they order, their order is delivered, or they unsubscribe.",
      "win_back", "winback", "winback", { kind: "went_quiet", quietDays: 31, quietReasons: [] }, nodes, true);
    auto.settings = { ...auto.settings, priority: "normal", reentry: true, reentryDays: 0, frequency: "unlimited" };
    plan.push({ key: "quiet:monthly", productName: null, ready: !storeNeeds.length, needs: storeNeeds, draft: auto });
  }

  for (const product of [...products, ...quiet]) {
    const needs = needsOf(product);
    const selling = (count.get(product.id) ?? 0) > 0;
    const partner = products.find((row) => row.id !== product.id && row.image && row.links.length);
    const why = selling ? needs : [...needs, "sales: it has no orders in 60 days, so it waits as a draft"];
    plan.push({
      key: `delivered:${product.id}`, productName: product.name, ready: selling && !needs.length, needs: why,
      draft: draft(`Autopilot: ${product.name} — After Delivery`, `Customers who received ${product.name}.`, "post_purchase", "repeat", "post_purchase", { kind: "order_delivered", productId: product.id }, [
        wait(1),
        email("Email 1: Thanks + How To Use It", "usage_tips", designer, product, "Get the most from your {{Product}}, {{First Name}}", "A few quick tips"),
        wait(5),
        email("Email 2: How Is It Going?", "review_request", designer, product, "How's your {{Product}}, {{First Name}}?", "We'd love to hear how it's going"),
        ...(partner ? [wait(14), email("Email 3: Goes Well With It", "product_collection", designer, partner, "Goes well with your order: {{Product}}", "Order today, pay on delivery")] : [])
      ], false)
    });
    plan.push({
      key: `cart:${product.id}`, productName: product.name, ready: selling && !needs.length, needs: why,
      draft: draft(`Autopilot: ${product.name} — Cart Reminder`, `People who left the ${product.name} order form without ordering.`, "cart_abandonment", "cart", "conversion", { kind: "cart_abandoned", cartMinutes: 60, productId: product.id }, [
        email("Email 1: You Left Something", "cart_reminder", designer, product, "You left something behind, {{First Name}}", "Your order is one step away"),
        wait(1),
        { id: newId("c"), type: "condition", name: "Did they order?", check: { kind: "placed_order" }, yes: [], no: [
          email("Email 2: Still Interested?", "still_interested", designer, product, "Still interested in {{Product}}?", "It's still available, pay on delivery")
        ] }
      ], true)
    });
  }
  return plan;
}
