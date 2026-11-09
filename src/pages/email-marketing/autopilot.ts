import type { EmDesigner, EmDesignerProduct, EmFlowNode, EmQuietReason } from "../../lib/api";
import { buildQuietDesign, buildStarterDesign, buildStoreDesign, fillProduct, type CampaignFields, type QuietEmailSpec, type StoreEmailSpec } from "../../lib/email-render";
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
  // Bright, 9 Nov 2026: "it should be sent immediately" — no sending hours;
  // each email goes the moment its step is due (it can be switched on per flow).
  sendWindow: { on: false, from: 8, to: 20, days: [0, 1, 2, 3, 4, 5, 6] }
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
    // The server takes at most 200 characters (Bright hit this on 9 Nov).
    id: null, status: "draft", active: true, name: name.slice(0, 160), description: description.slice(0, 200), template, goal, trigger, audience: { source: "all" },
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
  // Delivered customers shop on Our Store now (Bright, 9 Nov 2026): Win-Back invites them there.
  plan.push({
    key: "store_win_back", productName: null, ready: true, needs: [],
    draft: draft("Autopilot: Store — Win-Back", "Customers with no delivery for 60 days: back to Our Store (pay online, pay less), with live store picks.", "win_back", "winback", "winback", { kind: "inactive", inactiveDays: 60 }, [
      storeEmail(designer, best, STORE_MAIL.missYou), wait(7), storeEmail(designer, best, STORE_MAIL.greatBuys)
    ], true)
  });
  // Store Club: every delivered customer, whatever they bought. First make sure the product delivered value, then the store.
  {
    const nodes: EmFlowNode[] = [
      wait(2), storeEmail(designer, best, STORE_MAIL.valueCheck), wait(3),
      { id: newId("c"), type: "condition", name: "Did they tap \"Yes, I love it\"?", check: { kind: "clicked_last" }, yes: [], no: [storeEmail(designer, best, STORE_MAIL.valueCheckAgain), wait(3)] },
      storeEmail(designer, best, STORE_MAIL.welcomeStore), wait(4), storeEmail(designer, best, STORE_MAIL.forYourHome), wait(5),
      storeEmail(designer, best, STORE_MAIL.greatBuys), wait(7), storeEmail(designer, best, STORE_MAIL.justArrived), wait(7), storeEmail(designer, best, STORE_MAIL.safeOnline)
    ];
    const auto = draft("Autopilot: Store Club — Delivered Customers", "Every delivered customer: is it working well? Then Our Store (pay online, pay less), live store picks for them over the first month. The segment flows carry on after.",
      "post_purchase", "repeat", "post_purchase", { kind: "order_delivered", productId: null }, nodes, false);
    plan.push({ key: "store_club", productName: null, ready: true, needs: [], draft: auto });
  }

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
    const auto = draft("Autopilot: Went Quiet — Monthly, Until They Buy", "Everyone quiet for over a month, including those who said no thanks: one email a month, six in turn, then from the start. Stops when they order, get a delivery or unsubscribe.",
      "win_back", "winback", "winback", { kind: "went_quiet", quietDays: 31, quietReasons: [] }, nodes, true);
    auto.settings = { ...auto.settings, priority: "normal", reentry: true, reentryDays: 0, frequency: "unlimited" };
    plan.push({ key: "quiet:monthly", productName: null, ready: !storeNeeds.length, needs: storeNeeds, draft: auto });
  }

  for (const product of [...products, ...quiet]) {
    const needs = needsOf(product);
    const selling = (count.get(product.id) ?? 0) > 0;
    const why = selling ? needs : [...needs, "sales: it has no orders in 60 days, so it waits as a draft"];
    // After Delivery per product is replaced by Store Club (one flow for every delivered customer).
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
  plan.push(...segmentFlows(designer, products, best, storeNeeds));
  return plan;
}

// ── Stay in touch, by segment (Bright, 9 Nov 2026) ───────────────────
// "Get those who haven't bought to buy, and those who have bought engaged
// till they buy again and again… forever." One flow per key segment, each
// a few emails a month apart, then a 30-day pause and again from the start
// for as long as the customer stays in the segment. A customer walks one of
// these at a time (the lowest rank wins: VIP before Loyal before…), a new
// order takes them out (the after-delivery emails take over), and leaving
// the segment ends it. No made-up offers or claims.

// Every store email (Bright, 9 Nov 2026): pay online, pay less; the promise; live store picks for this customer.
const SM = (name: string, subject: string, preheader: string, spec: StoreEmailSpec) => ({ name, subject, preheader, spec });
const STORE_MAIL = {
  valueCheck: SM("Check: Is It Working Well?", "How's your {{Their Product}}, {{First Name}}? 😊", "We want to be sure you're happy",
    { slug: "review-request", tone: "lavender", title: "Is Your {{Their Product}} Working Well? 😊", subtitle: "We want to be sure you got value for your money.", button: "Yes, I love it! 👍", theirPhoto: true, promise: false,
      lines: ["It's been a couple of days since your {{Their Product}} arrived. We hope it's already making life easier.", "If anything isn't right, just reply to this email or WhatsApp us on 07083515972 and we'll sort it out quickly. Your happiness comes first."] }),
  valueCheckAgain: SM("Check Again: All Good?", "Quick check, {{First Name}}: all good with your {{Their Product}}? 🙏", "We're here if you need anything",
    { slug: "thank-you-loyal-customer", tone: "lavender", title: "All Good With Your Order? 🙏", subtitle: "Just making sure.", button: "Yes, all good! 👍", buttonTone: "purple", promise: false,
      lines: ["We just want to be sure your {{Their Product}} is working well for you.", "Need help? Reply to this email or WhatsApp 07083515972. We'll make it right."] }),
  welcomeStore: SM("Welcome To Our Store", "You're invited, {{First Name}}: shop online, pay less 🎉", "Lower prices when you pay online",
    { slug: "welcome-email", tone: "lavender", title: "Shop Online, Pay Less 🎉", subtitle: "Our whole store, at lower prices when you pay before delivery.", button: "Visit Our Store", buttonTone: "purple",
      lines: ["You already know us: your {{Their Product}} came from us. Now you can shop our whole store online, and pay less than on delivery.",
        "🔎 Looking for something? Type it in the store's search bar. Kitchen, home, beauty, gadgets, kids and more: if it's in our store, you'll find it."],
      picks: [{ mode: "related", count: 4, title: "Picked for you" }] }),
  forYourHome: SM("Picked For Your Home", "Picked for your home, {{First Name}} 🏠", "Things that go with your {{Their Product}}",
    { slug: "our-story", tone: "lavender", title: "Picked For Your Home 🏠", subtitle: "Things that go well with your {{Their Product}}.", button: "See More In Our Store", buttonTone: "purple",
      lines: ["Customers who love their {{Their Product}} often make their home even easier with these."], picks: [{ mode: "related", count: 4, title: "Goes well with yours" }] }),
  greatBuys: SM("Great Buys This Week", "Great buys this week, {{First Name}} 🔥", "Lower prices when you pay online",
    { slug: "discount-code", tone: "lavender", title: "Great Buys This Week 🔥", subtitle: "Everyday things, at prices you'll love.", button: "Shop Great Buys", buttonTone: "purple",
      lines: ["Pay online and pay less. Here are this week's great buys from our store."], picks: [{ mode: "value", count: 4, title: "Under ₦15,000" }] }),
  justArrived: SM("Just Arrived", "Just arrived in our store, {{First Name}} ✨", "Be the first to get them",
    { slug: "welcome-gift-reminder", tone: "pink", title: "Just Arrived ✨", subtitle: "New in our store this week.", button: "See What's New", buttonTone: "purple",
      lines: ["Fresh in our store. Have a look before they're gone."], picks: [{ mode: "new", count: 4, title: "New arrivals" }] }),
  safeOnline: SM("Paying Online Is Safe", "Paying online for the first time, {{First Name}}? 🛡️", "Here's how we protect you",
    { slug: "shipping-confirmation", tone: "sky", title: "Paying Online? You're Protected 🛡️", subtitle: "Here's exactly how it works.", button: "Shop Safely Now", buttonTone: "purple",
      lines: ["We know paying before delivery can feel scary. But you already received from us, and we're the same team.",
        "1️⃣ Find what you want (use the search bar).\n2️⃣ Pay by bank transfer: our team confirms your payment.\n3️⃣ We deliver to your door, anywhere in Nigeria.\nIf your order doesn't arrive, you get your money back in full."],
      picks: [{ mode: "related", count: 2, title: "Start with these" }] }),
  missYou: SM("We Miss You", "We miss you, {{First Name}} 👋", "Come back and pay less",
    { slug: "win-back-campaign", tone: "lavender", title: "We Miss You! 👋", subtitle: "Come back to our store: pay online, pay less.", button: "Visit Our Store", buttonTone: "purple",
      lines: ["It's been a while since your last order. Our store has lots of new things for your home, at lower prices when you pay online."], picks: [{ mode: "related", count: 4, title: "Picked for you" }] }),
  vipThanks: SM("Our Best Customers", "You're one of our best customers, {{First Name}} 👑", "A first look, just for you",
    { slug: "vip-upgrade", tone: "lavender", title: "You're One Of Our Best Customers 👑", subtitle: "Here's a first look at what's new.", button: "See What's New", buttonTone: "purple",
      lines: ["Thank you for trusting us again and again. As one of our best customers, you get a first look at what's new in our store."], picks: [{ mode: "new", count: 4, title: "First look" }] }),
  loyalThanks: SM("Thank You For Coming Back", "Thank you for coming back, {{First Name}} 💜", "Picked for you",
    { slug: "thank-you-loyal-customer", tone: "lavender", title: "Thank You For Coming Back 💜", subtitle: "It means a lot to us.", button: "Visit Our Store", buttonTone: "purple",
      lines: ["You've ordered from us more than once, and that means a lot. Here's what we picked for you in our store, at online prices."], picks: [{ mode: "related", count: 4, title: "Picked for you" }] }),
  again: SM("Buy It Again", "Running low on {{Their Product}}, {{First Name}}?", "Get it again in our store",
    { slug: "replenishment-reminder", tone: "mint", title: "Time To Restock? 🔄", subtitle: "Get it again in our store, pay online, pay less.", button: "Visit Our Store", theirPhoto: true,
      lines: ["If you're running low, get it again in our store. And have a look at what goes well with it."], picks: [{ mode: "again", count: 1, title: "Buy it again" }, { mode: "related", count: 2, title: "Goes well with it" }] })
};
function storeEmail(designer: EmDesigner, sample: EmDesignerProduct | undefined, mail: { name: string; subject: string; preheader: string; spec: StoreEmailSpec }): EmFlowNode {
  return { id: newId("e"), type: "email", name: mail.name, campaignId: null,
    email: { subject: mail.subject, preheader: mail.preheader, design: buildStoreDesign(fields(designer, sample), mail.spec), productId: null, thumbnailUrl: null } };
}

function segmentFlows(designer: EmDesigner, products: EmDesignerProduct[], best: EmDesignerProduct | undefined, _storeNeeds: string[]): PlanItem[] {
  const groups = designer.segments ?? [];
  const byKey = (key: string) => groups.find((row) => row.builtIn === key && row.status === "active");
  const out: PlanItem[] = [];
  const add = (key: string, groupId: string, rank: number, title: string, about: string, mails: Array<keyof typeof STORE_MAIL>, gaps: number[]) => {
    const nodes: EmFlowNode[] = [];
    mails.forEach((mail, index) => { if (gaps[index]) nodes.push(wait(gaps[index])); nodes.push(storeEmail(designer, best, STORE_MAIL[mail])); });
    const auto = draft(`Autopilot: Store — ${title}`, about, "repeat_buyer", "repeat", "retention", { kind: "in_segment", segmentId: groupId, rank }, nodes, true);
    auto.settings = { ...auto.settings, priority: "low", reentry: true, reentryDays: 30, frequency: "unlimited" };
    out.push({ key: `segment:${key}`, productName: null, ready: true, needs: [], draft: auto });
  };
  const vip = byKey("top_spenders");
  if (vip) add("vip", vip.id, 10, "VIP (Top 20% Spenders)", "Biggest spenders: first look at new arrivals, great buys, restock. Monthly, again after 30 days.", ["vipThanks", "greatBuys", "again"], [0, 30, 30]);
  const repeat = byKey("repeat");
  if (repeat) add("loyal", repeat.id, 20, "Loyal (Repeat Buyers)", "2+ deliveries: thanks, picks, new arrivals, great buys, paying online is safe. Monthly.", ["loyalThanks", "justArrived", "greatBuys", "safeOnline"], [0, 30, 30, 30]);
  const upsell = byKey("upsell");
  if (upsell) add("upgrade", upsell.id, 30, "Buy Again (Bought One Unit)", "Last order was one unit: get it again in the store, and what goes with it.", ["again", "greatBuys"], [0, 21]);
  const once = byKey("one_time");
  if (once) add("second", once.id, 40, "Second Order (One-Time Buyers)", "One delivery, 30+ days ago: the store, picks, great buys, new, paying online is safe.", ["welcomeStore", "greatBuys", "justArrived", "safeOnline"], [0, 10, 14, 14]);
  for (const product of products.slice(0, 3)) {
    const group = groups.find((row) => row.builtIn === `bought_${product.id.slice(0, 8)}` && row.status === "active");
    if (group) add(`bought:${product.id}`, group.id, 50, `Bought ${product.name}`, `Customers who got ${product.name}: what goes with it in the store, then buy again.`, ["forYourHome", "again"], [0, 21]);
  }
  const inactive = byKey("inactive");
  if (inactive) add("inactive", inactive.id, 60, "Inactive (No Purchase in 60+ Days)", "No delivery in 60+ days: miss you, new arrivals, paying online is safe, great buys. Monthly until they buy.", ["missYou", "justArrived", "safeOnline", "greatBuys"], [0, 30, 30, 30]);
  return out;
}
