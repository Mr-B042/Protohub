import type { CoverTone, HolidayTier } from "../../lib/email-render";

/**
 * Nigerian holidays & festivals (Bright, 9 Nov 2026; designs from his
 * "10 Nigerian Holidays & Festivals" folder, plus Black Friday and Christmas).
 * Each holiday goes out in four versions (lib/email-render buildHolidayDesign)
 * so every customer gets exactly one: VIP, Loyal, First-time, Everyone else.
 *
 * Dates: fixed days, or worked out (Easter, Mothering Sunday, Father's Day,
 * Black Friday). Islamic holidays follow the moon: the dates below are the
 * expected ones and can move by a day; Bright can change the send date.
 */

export type Holiday = {
  slug: string; name: string; photo: string; tone: CoverTone; title: string; subtitle: string; greeting: string;
  /** Days before the day to send (gifts need delivery time). */
  sendBefore: number;
  /** "moon" = may move a day with the moon sighting; "varies" = the day differs by community/state. */
  note?: "moon" | "varies";
  dates: (year: number) => string | null;
};

const fixed = (mmdd: string) => (year: number) => `${year}-${mmdd}`;
const ymd = (d: Date) => d.toISOString().slice(0, 10);
/** Easter Sunday (Gregorian). */
function easter(year: number) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}
const shift = (d: Date, days: number) => new Date(d.getTime() + days * 86_400_000);
/** The nth weekday (0 = Sunday) of a month. */
function nthWeekday(year: number, month: number, weekday: number, n: number) {
  const first = new Date(Date.UTC(year, month - 1, 1));
  return new Date(Date.UTC(year, month - 1, 1 + ((weekday - first.getUTCDay() + 7) % 7) + (n - 1) * 7));
}
/** Expected dates (moon sighting can move them a day). */
const MOON: Record<string, Record<number, string>> = {
  ramadan: { 2027: "2027-02-08", 2028: "2028-01-28" },
  "eid-al-fitr": { 2027: "2027-03-10", 2028: "2028-02-27" },
  "eid-al-adha": { 2027: "2027-05-17", 2028: "2028-05-05" },
  "eid-el-maulud": { 2027: "2027-08-14", 2028: "2028-08-03" }
};
const moon = (slug: string) => (year: number) => MOON[slug]?.[year] ?? null;

export const HOLIDAYS: Holiday[] = [
  { slug: "new-year", name: "New Year's Day", photo: "holidays/new-year", tone: "lavender", title: "Happy New Year! 🎆", subtitle: "Here's to a great year together.", sendBefore: 0, dates: fixed("01-01"),
    greeting: "Happy New Year! Thank you for shopping with us. We wish you and your family a year full of good things." },
  { slug: "valentines-day", name: "Valentine's Day", photo: "holidays/valentines-day", tone: "pink", title: "Love Is in the Air ❤️", subtitle: "Gifts they'll use every day.", sendBefore: 5, dates: fixed("02-14"),
    greeting: "Valentine's Day is coming. Show love with a gift that makes everyday life easier. Order early so it arrives in time." },
  { slug: "womens-day", name: "International Women's Day", photo: "holidays/womens-day", tone: "lilac", title: "Happy Women's Day 💜", subtitle: "Celebrating the women who inspire us.", sendBefore: 0, dates: fixed("03-08"),
    greeting: "Happy International Women's Day! Today we celebrate the mothers, sisters, friends and colleagues who make a difference." },
  { slug: "mothers-day", name: "Mother's Day (Mothering Sunday)", photo: "holidays/mothers-day", tone: "pink", title: "Happy Mother's Day 💐", subtitle: "For the woman who keeps everything together.", sendBefore: 5,
    dates: (year) => ymd(shift(easter(year), -21)), greeting: "Mothering Sunday is coming. Show mum some love with a gift for her home. Order early so it arrives in time." },
  { slug: "ramadan", name: "Ramadan", photo: "holidays/ramadan", tone: "lavender", title: "Ramadan Kareem 🌙", subtitle: "Wishing you a peaceful and blessed Ramadan.", sendBefore: 0, note: "moon", dates: moon("ramadan"),
    greeting: "Ramadan Kareem! May this holy month bring you peace, blessings and time with loved ones." },
  { slug: "eid-al-fitr", name: "Eid al-Fitr (Sallah)", photo: "holidays/eid-al-fitr", tone: "mint", title: "Eid Mubarak! Happy Sallah 🌙", subtitle: "Celebrate with family, and a fresh home.", sendBefore: 3, note: "moon", dates: moon("eid-al-fitr"),
    greeting: "Eid Mubarak! As you get ready to celebrate with family and friends, we wish you joy and blessings." },
  { slug: "good-friday", name: "Good Friday", photo: "holidays/good-friday", tone: "lavender", title: "A Peaceful Good Friday 🕊️", subtitle: "Wishing you a blessed Easter.", sendBefore: 0,
    dates: (year) => ymd(shift(easter(year), -2)), greeting: "Wishing you and your family a peaceful Good Friday and a joyful Easter." },
  { slug: "easter-monday", name: "Easter", photo: "holidays/easter-monday", tone: "butter", title: "Happy Easter 🐣", subtitle: "Joy, peace and a refreshed home.", sendBefore: 0,
    dates: (year) => ymd(shift(easter(year), 1)), greeting: "Happy Easter! Wishing you and your family a joyful celebration." },
  { slug: "workers-day", name: "Workers' Day", photo: "holidays/workers-day", tone: "sky", title: "Happy Workers' Day 💪", subtitle: "You work hard. Let your home work for you.", sendBefore: 0, dates: fixed("05-01"),
    greeting: "Happy Workers' Day! Today we celebrate you and all the hard work you put in." },
  { slug: "childrens-day", name: "Children's Day", photo: "holidays/childrens-day", tone: "butter", title: "Happy Children's Day 🎈", subtitle: "Happy kids, happy homes.", sendBefore: 0, dates: fixed("05-27"),
    greeting: "Happy Children's Day to every little one! Celebrate the children in your life." },
  { slug: "democracy-day", name: "Democracy Day", photo: "holidays/democracy-day", tone: "mint", title: "Happy Democracy Day 🇳🇬", subtitle: "Celebrating Nigeria, today and every day.", sendBefore: 0, dates: fixed("06-12"),
    greeting: "Happy Democracy Day! Today we celebrate our nation and the freedom we share." },
  { slug: "fathers-day", name: "Father's Day", photo: "holidays/fathers-day", tone: "sky", title: "Happy Father's Day 👔", subtitle: "For the dad who does it all.", sendBefore: 5,
    dates: (year) => ymd(nthWeekday(year, 6, 0, 3)), greeting: "Father's Day is coming. Celebrate dad with a gift he'll use every day. Order early so it arrives in time." },
  { slug: "eid-al-adha", name: "Eid al-Adha (Ileya)", photo: "holidays/eid-al-adha", tone: "mint", title: "Eid al-Adha Mubarak 🌙", subtitle: "Happy Ileya! A blessed celebration.", sendBefore: 3, note: "moon", dates: moon("eid-al-adha"),
    greeting: "Eid al-Adha Mubarak! May this Ileya bring you joy, blessings and happy moments with family." },
  { slug: "new-yam-festival", name: "New Yam Festival", photo: "holidays/new-yam-festival", tone: "peach", title: "Happy New Yam Festival 🍠", subtitle: "Celebrating the harvest and new beginnings.", sendBefore: 0, note: "varies", dates: fixed("08-15"),
    greeting: "Happy New Yam Festival! As families come together to celebrate the harvest, we wish you plenty and joy." },
  { slug: "eid-el-maulud", name: "Eid-el-Maulud", photo: "holidays/eid-el-maulud", tone: "lavender", title: "Happy Eid-el-Maulud 🌙", subtitle: "Wishing you peace and blessings.", sendBefore: 0, note: "moon", dates: moon("eid-el-maulud"),
    greeting: "Happy Eid-el-Maulud! Wishing you and your family peace, love and blessings." },
  { slug: "back-to-school", name: "Back to School", photo: "holidays/back-to-school", tone: "sky", title: "Back to School 🎒", subtitle: "Get ready for the new term.", sendBefore: 7, note: "varies", dates: fixed("09-14"),
    greeting: "A new school term is starting. Get the children ready, and the home too." },
  { slug: "independence-day", name: "Independence Day", photo: "holidays/independence-day", tone: "mint", title: "Happy Independence Day, Nigeria! 🇳🇬", subtitle: "Proudly Nigerian.", sendBefore: 0, dates: fixed("10-01"),
    greeting: "Happy Independence Day! Today we celebrate the spirit, strength and creativity of Nigerians everywhere." },
  { slug: "black-friday", name: "Black Friday", photo: "black-friday", tone: "lavender", title: "Black Friday Is Here 🖤", subtitle: "Great buys all weekend.", sendBefore: 0,
    dates: (year) => ymd(shift(nthWeekday(year, 11, 4, 4), 1)), greeting: "It's Black Friday! Great buys from our store all weekend long." },
  { slug: "detty-december", name: "Detty December", photo: "holidays/detty-december", tone: "butter", title: "Detty December Is Here 🎉", subtitle: "Owambe season. Get your home guest-ready.", sendBefore: 0, dates: fixed("12-01"),
    greeting: "Detty December is officially here! Between the owambes, concerts and visitors, get your home guest-ready." },
  { slug: "calabar-carnival", name: "Carnival Season", photo: "holidays/calabar-carnival", tone: "pink", title: "Carnival Season Is Here 🎭", subtitle: "Colour, music and festive vibes.", sendBefore: 0, dates: fixed("12-10"),
    greeting: "December means carnival season! Whether you're heading to Calabar or celebrating at home, get your home festive-ready." },
  { slug: "christmas", name: "Christmas", photo: "christmas", tone: "pink", title: "Merry Christmas 🎄", subtitle: "Festive cheer for your home.", sendBefore: 7, dates: fixed("12-25"),
    greeting: "Christmas is almost here! Wishing you and your family a joyful season. Order early so it arrives in time for the celebrations." },
  { slug: "boxing-day", name: "Boxing Day", photo: "holidays/boxing-day", tone: "pink", title: "Happy Boxing Day 🎁", subtitle: "The celebration continues.", sendBefore: 0, dates: fixed("12-26"),
    greeting: "Christmas may be over, but the celebration isn't! Treat yourself to something new for the home." },
  { slug: "new-years-eve", name: "New Year's Eve", photo: "holidays/new-years-eve", tone: "lavender", title: "Cheers to a New Year 🥂", subtitle: "Thank you for an amazing year.", sendBefore: 0, dates: fixed("12-31"),
    greeting: "As the year ends, thank you for being part of our family. Here's to an even better year ahead." }
];

export const TIERS: Array<{ key: HolidayTier; label: string; who: string }> = [
  { key: "vip", label: "VIP", who: "Top 20% spenders" },
  { key: "loyal", label: "Loyal", who: "2+ deliveries (not VIP)" },
  { key: "first", label: "First-time", who: "1 delivery (not VIP)" },
  { key: "everyone", label: "Everyone else", who: "On the list, no delivery yet" }
];

/** The next time each holiday comes round (on or after `today`), with its send day, sorted by send day. */
export function upcomingHolidays(today: string, months = 12) {
  const end = new Date(`${today}T00:00:00Z`); end.setUTCMonth(end.getUTCMonth() + months);
  const out: Array<Holiday & { day: string; sendDay: string; year: number }> = [];
  const y0 = Number(today.slice(0, 4));
  for (const h of HOLIDAYS) {
    for (const year of [y0, y0 + 1, y0 + 2]) {
      const day = h.dates(year);
      if (!day) continue;
      const send = ymd(shift(new Date(`${day}T00:00:00Z`), -h.sendBefore));
      if (send < today || new Date(`${day}T00:00:00Z`) > end) continue;
      out.push({ ...h, day, sendDay: send, year });
      break;
    }
  }
  return out.sort((a, b) => a.sendDay.localeCompare(b.sendDay));
}

/** "Holiday: Christmas 2026 · VIP": the name that marks a holiday's campaign (and stops it being made twice). */
export const holidayCampaignName = (h: { name: string; year: number }, tier: (typeof TIERS)[number]) => `Holiday: ${h.name} ${h.year} · ${tier.label}`;
