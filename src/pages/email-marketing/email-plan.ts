import type { QuietEmailSpec, StoreEmailSpec } from "../../lib/email-render";

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
  store: PlanVersion & { spec: StoreEmailSpec };
  pod: PlanVersion & { spec: QuietEmailSpec };
};

const POD_LINE = "No payment upfront: you pay when it arrives at your door.";
const REPLY = "Just reply to this email. A real person reads every reply.";

const TIPS: Array<{ title: string; subtitle: string; tips: string }> = [
  { title: "5 Ways To Keep Your Home Tidy 🧹", subtitle: "Small habits, big difference.",
    tips: "1️⃣ Give everything a home, so it always goes back to the same place.\n2️⃣ Use the space on walls and behind doors.\n3️⃣ Clear surfaces once a day: five minutes is enough.\n4️⃣ Keep what you use most within easy reach.\n5️⃣ One in, one out: when something new comes in, let something old go." },
  { title: "Make Your Kitchen Work For You 🍳", subtitle: "Cook faster, clean less.",
    tips: "1️⃣ Keep the things you use every day closest to the cooker.\n2️⃣ Build upwards: shelves and racks free up the counter.\n3️⃣ Group things by use: cooking, baking, cleaning.\n4️⃣ Wipe as you go, so cleaning never piles up." },
  { title: "Small Space, Big Difference 🏠", subtitle: "Make every corner count.",
    tips: "1️⃣ Use the corners: they're the most wasted space in most rooms.\n2️⃣ Go up: shelves and hooks use the wall, not the floor.\n3️⃣ Choose things that fold or stack.\n4️⃣ Keep the floor clear: the room feels bigger straight away." },
  { title: "A Calmer Bathroom In 10 Minutes 🛁", subtitle: "Easy wins for the busiest room.",
    tips: "1️⃣ Keep only today's things on the sink.\n2️⃣ Give towels and toiletries their own shelf.\n3️⃣ A quick wipe after use stops stains building up.\n4️⃣ Use the space above the toilet for storage." }
];

function education(key: string, n: number): PlanSlot {
  const t = TIPS[n % TIPS.length];
  return {
    key, title: t.title.replace(/ \S+$/, ""), pillar: "Education",
    store: { subject: `${t.title.replace(/ \S+$/, "")}, {{First Name}}`, preheader: t.subtitle,
      spec: { slug: "setup-and-care-tips", tone: "mint", title: t.title, subtitle: t.subtitle, button: "See Helpful Picks", buttonTone: "purple",
        lines: ["A few simple tips we love:", t.tips, "If you'd like a hand with any of these, our store has helpful things for every room."], picks: [{ mode: "related", count: 2, title: "Helpful for this" }], promise: false } },
    pod: { subject: `${t.title.replace(/ \S+$/, "")}, {{First Name}}`, preheader: t.subtitle,
      spec: { slug: "setup-and-care-tips", tone: "mint", title: t.title, subtitle: t.subtitle, button: "See How It Helps", buttonTone: "purple", theirs: false,
        lines: ["A few simple tips we love:", t.tips, POD_LINE] } }
  };
}

const MONTH_END: Array<{ title: string; subject: string; mode: "value" | "related" | "new"; lines: string }> = [
  { title: "Month-End Great Buys 🔥", subject: "Month-end great buys, {{First Name}} 🔥", mode: "value", lines: "The month is ending: here are great buys from our store, at online prices." },
  { title: "Get Set For The New Month 📦", subject: "Get set for the new month, {{First Name}}", mode: "related", lines: "Start the new month organised. Get everything you need in one order." },
  { title: "New Month, New Arrivals ✨", subject: "New in our store, {{First Name}} ✨", mode: "new", lines: "Fresh in our store, just in time for the new month." }
];

/** The eight sends of a normal month (index = month number, so topics change each month). */
export function normalMonth(month: number): PlanSlot[] {
  const end = MONTH_END[month % MONTH_END.length];
  return [
    { key: "w1mon", title: "Payday Picks", pillar: "Sales",
      store: { subject: "Payday picks for your home, {{First Name}} 💸", preheader: "Pay online, pay less",
        spec: { slug: "payday-sale", tone: "butter", title: "Payday Picks 💸", subtitle: "Treat your home this payday. Pay online, pay less.", button: "Shop Payday Picks", buttonTone: "purple",
          lines: ["Payday is here! If there's something you've been meaning to get for your home, this is a good week for it.", "Here are great buys from our store, at online prices."], picks: [{ mode: "value", count: 4, title: "Great buys this payday" }] } },
      pod: { subject: "A little payday treat, {{First Name}} 💸", preheader: "Order today, pay when it arrives",
        spec: { slug: "payday-sale", tone: "butter", title: "A Little Payday Treat 💸", subtitle: "Something useful for your home.", button: "Order Now", theirs: false,
          lines: ["Payday is here. If you've been meaning to get it, this is a good week.", POD_LINE] } } },
    { key: "w1thu", title: "Show Us Your Home", pillar: "Proof",
      store: { subject: "Show us how you use it, {{First Name}} 📸", preheader: "Your photos help other customers",
        spec: { slug: "review-request", tone: "pink", title: "Show Us How You Use It 📸", subtitle: "Real homes help other customers decide.", button: "Visit Our Store", buttonTone: "purple",
          lines: ["Got something from us that you love? Reply to this email with a photo or a short video of it in your home.", "With your permission, we may share it, so other customers can see real homes and not just product photos. Thank you!"], promise: false } },
      pod: { subject: "Why customers order from us, {{First Name}}", preheader: "Nothing to pay until it arrives",
        spec: { slug: "shipping-confirmation", tone: "sky", title: "Why Customers Order From Us 🤝", subtitle: "Simple, safe, delivered to your door.", button: "Order Now", buttonTone: "purple", theirs: false,
          lines: ["✅ Nothing to pay until it's in your hands.\n📞 Our team calls to confirm every order.\n🚚 Delivered to your door.\n💬 Questions? WhatsApp 07083515972.", POD_LINE] } } },
    education("w2mon", month),
    { key: "w2thu", title: "Just Arrived", pillar: "Product",
      store: { subject: "Just arrived in our store, {{First Name}} ✨", preheader: "Be the first to see them",
        spec: { slug: "whats-new", tone: "lavender", title: "Just Arrived ✨", subtitle: "New in our store.", button: "See What's New", buttonTone: "purple",
          lines: ["Fresh in our store. Have a look before they're gone."], picks: [{ mode: "new", count: 4, title: "New arrivals" }], promise: false } },
      pod: { subject: "Our best seller, {{First Name}} 🏆", preheader: "What customers order most",
        spec: { slug: "bestsellers", tone: "butter", title: "Our Best Seller 🏆", subtitle: "What customers order from us most right now.", button: "Order Now", theirs: false,
          lines: ["If you're not sure where to start, start here: it's what customers order from us most right now.", POD_LINE] } } },
    { key: "w3mon", title: "Quick Question", pillar: "Community",
      store: { subject: "Quick question for you, {{First Name}}", preheader: "Hit reply, we read everything",
        spec: { slug: "our-story", tone: "lavender", title: "Quick Question For You 💬", subtitle: "We'd love your answer.", button: "Visit Our Store", buttonTone: "purple",
          lines: ["What would make life at home easier for you? Is there something you wish we had in our store?", "Hit reply and tell us. We read every reply, and we stock what our customers ask for."], promise: false } },
      pod: { subject: "Quick question for you, {{First Name}}", preheader: "Hit reply, we read everything",
        spec: { slug: "our-story", tone: "lavender", title: "Quick Question For You 💬", subtitle: "We'd love your answer.", button: "", theirs: false, product: false,
          lines: ["What would make life at home easier for you? Is there something you wish we sold?", "Hit reply and tell us. " + REPLY.replace("Just reply to this email. ", "")] } } },
    education("w3thu", month + 1),
    { key: "w4mon", title: "Picked For Your Home", pillar: "Product",
      store: { subject: "Picked for your home, {{First Name}} 🏠", preheader: "Things that go with what you have",
        spec: { slug: "recommended-for-you", tone: "lavender", title: "Picked For Your Home 🏠", subtitle: "Things that go well with what you already have.", button: "See More In Our Store", buttonTone: "purple",
          lines: ["We picked these for you, based on what you got from us."], picks: [{ mode: "related", count: 4, title: "Picked for you" }], promise: false } },
      pod: { subject: "Make life at home easier, {{First Name}}", preheader: "Delivered to your door",
        spec: { slug: "recommended-for-you", tone: "lavender", title: "Make Life At Home Easier 🏠", subtitle: "Delivered to your door.", button: "Order Now", buttonTone: "purple", theirs: false,
          lines: ["Customers order this from us for their homes every day. Whenever you're ready, so is yours.", POD_LINE] } } },
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
    { key: "d2", title: "Get Christmas-Ready", pillar: "Product",
      store: { subject: "Get your home Christmas-ready, {{First Name}} 🎄", preheader: "New in our store",
        spec: { slug: "christmas", tone: "pink", title: "Get Your Home Christmas-Ready 🎄", subtitle: "New in our store for the season.", button: "See What's New", buttonTone: "purple",
          lines: ["December is full of visitors, parties and family time. Here's what's new in our store to get your home ready."], picks: [{ mode: "new", count: 4, title: "New for the season" }], promise: false } },
      pod: { subject: "Get your home Christmas-ready, {{First Name}} 🎄", preheader: "Delivered to your door",
        spec: { slug: "christmas", tone: "pink", title: "Get Your Home Christmas-Ready 🎄", subtitle: "Delivered to your door.", button: "Order Now", buttonTone: "purple", theirs: false,
          lines: ["December is full of visitors, parties and family time. Get your home ready early.", POD_LINE] } } },
    { key: "d3", title: "Guests Coming?", pillar: "Education",
      store: { subject: "Guests coming this Christmas, {{First Name}}? 🏡", preheader: "Get guest-ready, the easy way",
        spec: { slug: "holiday-schedule", tone: "mint", title: "Guests Coming? Get Guest-Ready 🏡", subtitle: "Easy wins before the visitors arrive.", button: "Shop Guest-Ready Picks", buttonTone: "purple",
          lines: ["1️⃣ Clear the entrance: it's the first thing guests see.\n2️⃣ Give the kitchen counter a reset.\n3️⃣ Find a home for shoes and bags.\n4️⃣ Freshen up the bathroom shelf.", "These can help:"], picks: [{ mode: "related", count: 4, title: "Guest-ready picks" }], promise: false } },
      pod: { subject: "Guests coming this Christmas, {{First Name}}? 🏡", preheader: "Get guest-ready, the easy way",
        spec: { slug: "holiday-schedule", tone: "mint", title: "Guests Coming? Get Guest-Ready 🏡", subtitle: "Easy wins before the visitors arrive.", button: "Order Now", buttonTone: "purple", theirs: false,
          lines: ["1️⃣ Clear the entrance: it's the first thing guests see.\n2️⃣ Give the kitchen counter a reset.\n3️⃣ Find a home for shoes and bags.\n4️⃣ Freshen up the bathroom shelf.", POD_LINE] } } },
    { key: "d4", title: "Stuck On A Gift?", pillar: "Community",
      store: { subject: "Stuck on what to get them, {{First Name}}? 🤔", preheader: "Practical gifts people actually use",
        spec: { slug: "christmas", tone: "pink", title: "Stuck On What To Get Them? 🤔", subtitle: "Practical gifts are the ones people use every day.", button: "Shop Gifts", buttonTone: "purple",
          lines: ["The best gifts are the ones people use every day, long after Christmas. Here are some under ₦15,000."], picks: [{ mode: "value", count: 4, title: "Gifts under ₦15,000" }] } },
      pod: { subject: "Stuck on what to get them, {{First Name}}? 🤔", preheader: "A gift they'll use every day",
        spec: { slug: "christmas", tone: "pink", title: "Stuck On What To Get Them? 🤔", subtitle: "A gift they'll use every day.", button: "Order A Gift", buttonTone: "purple", theirs: false,
          lines: ["The best gifts are the ones people use every day, long after Christmas.", POD_LINE] } } },
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
