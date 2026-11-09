import type { QuietEmailSpec, StoreEmailSpec } from "../../lib/email-render";
import { TIPS, tipsForMonth, type Tip } from "./tips-library";

/**
 * Monthly email plan (Bright, 9 Nov 2026, from the "Campaign Content
 * Calendar" and "Content Pillars" guides):
 *  - two emails a week, Monday and Thursday, eight a month;
 *  - sell when customers have money: the selling emails land in week 1 and
 *    week 4 (payday), the middle of the month gives help and asks nothing;
 *  - about 6 helpful emails to 2 selling ones, rotating education, proof,
 *    community and product highlights, with topics that change month to month.
 * December runs the Christmas season instead: gift guide, festive picks,
 * guest-ready, gifting, great buys, order-by date, final call, and a thank-you
 * with no selling on Christmas Day.
 * Every send has two versions that never overlap: delivered customers get Our
 * Store (pay online, pay less, live picks); everyone else gets the best seller,
 * pay on delivery. Only true claims: no discounts, deadlines or quotes are made up.
 */

export type PlanVersion = { subject: string; preheader: string };
export type PlanSlot = {
  key: string; title: string; pillar: "Sales" | "Education" | "Proof" | "Community" | "Product";
  /** A thank-you with nothing to sell: both versions use the plain (pay-on-delivery style) layout without a button. */
  noSell?: boolean;
  /** A helpful letter (plain, nothing to sell): both versions are built from it. */
  tip?: Tip;
  store: PlanVersion & { spec?: StoreEmailSpec };
  pod: PlanVersion & { spec?: QuietEmailSpec };
};

/** A helpful letter as a plan send. */
export const tipSlot = (key: string, tip: Tip): PlanSlot => ({
  key, title: tip.title, pillar: "Education", tip,
  store: { subject: tip.subject, preheader: tip.preheader }, pod: { subject: tip.subject, preheader: tip.preheader }
});

const POD_LINE = "No payment upfront: you pay when it arrives at your door.";
const REPLY = "Just reply to this email. A real person reads every reply.";

const MONTH_END: Array<{ title: string; subject: string; mode: "value" | "related" | "new"; lines: string }> = [
  { title: "Month-End Great Buys 🔥", subject: "Month-end great buys, {{First Name}} 🔥", mode: "value", lines: "The month is ending: here are great buys from our store, at online prices." },
  { title: "Get Set For The New Month 📦", subject: "Get set for the new month, {{First Name}}", mode: "related", lines: "Start the new month organised. Get everything you need in one order." },
  { title: "New Month, New Arrivals ✨", subject: "New in our store, {{First Name}} ✨", mode: "new", lines: "Fresh in our store, just in time for the new month." }
];

/**
 * The eight sends of a normal month (Bright, 9 Nov 2026: "more than 80%
 * helpful"): seven plain helpful letters, and one selling email on the
 * week-4 Thursday (the 25th–31st, when most people have been paid).
 */
export function normalMonth(month: number, year = new Date().getFullYear()): PlanSlot[] {
  const end = MONTH_END[month % MONTH_END.length];
  const tips = tipsForMonth(year, month, 7);
  return [
    ...["w1mon", "w1thu", "w2mon", "w2thu", "w3mon", "w3thu", "w4mon"].map((key, index) => tipSlot(key, tips[index])),
    { key: "w4thu", title: end.title.replace(/ \S+$/, ""), pillar: "Sales",
      store: { subject: end.subject, preheader: "Pay online, pay less",
        spec: { slug: "weekend-deals", tone: "lavender", title: end.title, subtitle: "Pay online, pay less.", button: "Shop Now", buttonTone: "purple",
          lines: [end.lines], picks: [{ mode: end.mode, count: 4, title: end.mode === "value" ? "Under ₦15,000" : end.mode === "new" ? "New arrivals" : "For the new month" }] } },
      pod: { subject: "Order today, pay when it arrives, {{First Name}}", preheader: "Nothing to pay upfront",
        spec: { slug: "promotional-offer", tone: "lavender", title: "Order Today, Pay On Delivery 💵", subtitle: "Nothing to pay upfront.", button: "Order Now", buttonTone: "purple", theirs: false,
          lines: ["Order today and pay only when it's in your hands. Our team will call to confirm first.", REPLY] } } }
  ];
}

/** December: the Christmas season. `cutoff` = the last day to order for Christmas delivery (e.g. "Sunday, 20 December"). */
export function christmasSeason(cutoff: string): PlanSlot[] {
  const gifts = "🍳 For the one who loves to cook: something for the kitchen.\n🏠 For the one setting up a home: storage and organisers.\n🎁 For the one who has everything: something practical they'll use every day.";
  const thanks = ["No offer today, just a thank you.", "Thank you for choosing us this year, and for every order you trusted us with. It means a lot to a team like ours.", "From our family to yours, Merry Christmas. See you in the new year! 🎄"];
  return [
    { key: "d1", title: "Christmas Gift Guide", pillar: "Education",
      store: { subject: "Your Christmas gift guide, {{First Name}} 🎁", preheader: "Gift ideas for everyone on your list",
        spec: { slug: "christmas", tone: "pink", title: "Your Christmas Gift Guide 🎁", subtitle: "Ideas for everyone on your list.", button: "Shop Gift Ideas", buttonTone: "purple",
          lines: ["Christmas shopping doesn't have to be stressful. Here's who to get what:", gifts, "Start early and thank yourself later."], picks: [{ mode: "value", count: 4, title: "Gift ideas" }] } },
      pod: { subject: "Your Christmas gift guide, {{First Name}} 🎁", preheader: "Practical gifts, delivered",
        spec: { slug: "christmas", tone: "pink", title: "Your Christmas Gift Guide 🎁", subtitle: "Practical gifts they'll use every day.", button: "Order A Gift", buttonTone: "purple", theirs: false,
          lines: ["Christmas shopping doesn't have to be stressful. Here's who to get what:", gifts, POD_LINE] } } },
    tipSlot("d2", TIPS.find((tip) => tip.key === "festive-cook")!),
    { key: "d3", title: "Guests Coming?", pillar: "Education",
      store: { subject: "Guests coming this Christmas, {{First Name}}? 🏡", preheader: "Get guest-ready, the easy way",
        spec: { slug: "holiday-schedule", tone: "mint", title: "Guests Coming? Get Guest-Ready 🏡", subtitle: "Easy wins before the visitors arrive.", button: "Shop Guest-Ready Picks", buttonTone: "purple",
          lines: ["1️⃣ Clear the entrance: it's the first thing guests see.\n2️⃣ Give the kitchen counter a reset.\n3️⃣ Find a home for shoes and bags.\n4️⃣ Freshen up the bathroom shelf.", "These can help:"], picks: [{ mode: "related", count: 4, title: "Guest-ready picks" }], promise: false } },
      pod: { subject: "Guests coming this Christmas, {{First Name}}? 🏡", preheader: "Get guest-ready, the easy way",
        spec: { slug: "holiday-schedule", tone: "mint", title: "Guests Coming? Get Guest-Ready 🏡", subtitle: "Easy wins before the visitors arrive.", button: "Order Now", buttonTone: "purple", theirs: false,
          lines: ["1️⃣ Clear the entrance: it's the first thing guests see.\n2️⃣ Give the kitchen counter a reset.\n3️⃣ Find a home for shoes and bags.\n4️⃣ Freshen up the bathroom shelf.", POD_LINE] } } },
    tipSlot("d4", TIPS.find((tip) => tip.key === "gift-ideas")!),
    { key: "d5", title: "Christmas Great Buys", pillar: "Sales",
      store: { subject: "Christmas great buys, {{First Name}} 🔥", preheader: "Pay online, pay less",
        spec: { slug: "weekend-deals", tone: "pink", title: "Christmas Great Buys 🔥", subtitle: "Pay online, pay less.", button: "Shop Great Buys", buttonTone: "purple",
          lines: ["The season is here, and so are our great buys. For you, for them, or for the house."], picks: [{ mode: "value", count: 4, title: "Great buys" }] } },
      pod: { subject: "For Christmas, {{First Name}}: order today 🎄", preheader: "Pay when it arrives",
        spec: { slug: "promotional-offer", tone: "pink", title: "Order For Christmas Today 🎄", subtitle: "Pay when it arrives.", button: "Order Now", buttonTone: "purple", theirs: false,
          lines: ["Whether it's for you or for someone special, order today and pay when it's in your hands.", POD_LINE] } } },
    { key: "d6", title: "Order By The Cut-Off", pillar: "Product",
      store: { subject: `Order by ${cutoff} for Christmas delivery 📅`, preheader: "Don't cut it too close",
        spec: { slug: "holiday-schedule", tone: "mint", title: `Order By ${cutoff} 📅`, subtitle: "To get it before Christmas.", button: "Shop Before The Cut-Off", buttonTone: "purple",
          lines: [`Quick but important: to have your order arrive before Christmas, please order by ${cutoff}. After that, we can't promise it will arrive in time.`], picks: [{ mode: "related", count: 4, title: "Still on your list?" }] } },
      pod: { subject: `Order by ${cutoff} for Christmas delivery 📅`, preheader: "Don't cut it too close",
        spec: { slug: "holiday-schedule", tone: "mint", title: `Order By ${cutoff} 📅`, subtitle: "To get it before Christmas.", button: "Order Now", buttonTone: "purple", theirs: false,
          lines: [`Quick but important: to have your order arrive before Christmas, please order by ${cutoff}. After that, we can't promise it will arrive in time.`, POD_LINE] } } },
    { key: "d7", title: "Final Call", pillar: "Sales",
      store: { subject: "Last day to order for Christmas, {{First Name}} ⏰", preheader: "Today is the cut-off",
        spec: { slug: "last-chance-winback", tone: "peach", title: "Last Day For Christmas Delivery ⏰", subtitle: "Today is the cut-off.", button: "Order Today", buttonTone: "purple",
          lines: ["Today is the last day to order for delivery before Christmas. If anything is still on your list, now's the moment."], picks: [{ mode: "value", count: 4, title: "Last-minute picks" }] } },
      pod: { subject: "Last day to order for Christmas, {{First Name}} ⏰", preheader: "Today is the cut-off",
        spec: { slug: "last-chance-winback", tone: "peach", title: "Last Day For Christmas Delivery ⏰", subtitle: "Today is the cut-off.", button: "Order Today", buttonTone: "purple", theirs: false,
          lines: ["Today is the last day to order for delivery before Christmas.", POD_LINE] } } },
    { key: "d8", title: "Merry Christmas", pillar: "Community", noSell: true,
      store: { subject: "Merry Christmas from all of us, {{First Name}} 🎄", preheader: "A heartfelt thank you",
        spec: { slug: "christmas", tone: "pink", title: "Merry Christmas 🎄", subtitle: "A heartfelt thank you.", button: "", lines: thanks, promise: false } },
      pod: { subject: "Merry Christmas from all of us, {{First Name}} 🎄", preheader: "A heartfelt thank you",
        spec: { slug: "christmas", tone: "pink", title: "Merry Christmas 🎄", subtitle: "A heartfelt thank you.", button: "", theirs: false, product: false, lines: thanks } } }
  ];
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);
/** Send days for a month: first Monday, then Mon/Thu each week (weeks 1–4). December uses fixed days. */
export function planDays(year: number, month: number, cutoffDay: number): string[] {
  if (month === 11) return [2, 5, 9, 12, 15, 17, cutoffDay, 25].map((day) => ymd(new Date(Date.UTC(year, 11, day))));
  const first = new Date(Date.UTC(year, month, 1));
  const monday = 1 + ((8 - first.getUTCDay()) % 7);
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  // A late first Monday can push the last Thursday past the month's end: it then goes on the last day.
  return [0, 1, 2, 3].flatMap((week) => [monday + week * 7, monday + week * 7 + 3]).map((day) => ymd(new Date(Date.UTC(year, month, Math.min(day, last)))));
}
