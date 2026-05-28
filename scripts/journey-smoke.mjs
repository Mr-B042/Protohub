// Smoke test for the 5 new cart-journey events.
// Drives the local public form via Playwright headless Chromium, then queries
// the local Supabase DB to verify which event types landed.

import { chromium } from "playwright";
import { execSync } from "node:child_process";

const FRONTEND = "http://127.0.0.1:5174";
const PRODUCT_ID = "7e94da88-a9f0-48af-b88b-f0f87b9508cd"; // Mock Edge Brusher Max - State Combo Demo
const FORM_URL = `${FRONTEND}/#/order-form/embed?product=${PRODUCT_ID}&currency=NGN`;
const DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const log = (...args) => console.log("[smoke]", ...args);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const baseline = execSync(
  `psql "${DB_URL}" -At -c "SELECT COALESCE(MAX(created_at)::text, '1970-01-01') FROM cart_journey_events"`
).toString().trim();
log(`baseline timestamp = ${baseline}`);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 800 } });
const page = await context.newPage();

let failed500 = 0;
page.on("response", (res) => {
  if (res.status() >= 500 && res.url().includes("/api/")) {
    failed500++;
    console.log("[5xx]", res.status(), res.url());
  }
});
page.on("console", (msg) => {
  if (msg.type() === "error") console.log("[browser-error]", msg.text());
});

log("opening form...");
await page.goto(FORM_URL, { waitUntil: "domcontentloaded" });
await page.waitForSelector('input[placeholder*="Name" i]:not([aria-hidden="true"])', { timeout: 20_000 });
await sleep(1500);

// ── 1. Pick Lagos as state so state-gated combo packages with carousels surface ──
log("selecting state Lagos...");
const stateSelect = page.locator('select').first();
try {
  await stateSelect.selectOption({ label: "Lagos" });
} catch (e) {
  log("could not select Lagos:", e.message);
  try {
    await stateSelect.selectOption({ index: 1 });
  } catch (e2) {
    log("fallback also failed:", e2.message);
  }
}
await sleep(1200);

// ── 2. Click into name field, type 4 chars, backspace one-at-a-time → field_hesitated ──
log("typing then char-by-char clearing name field for field_hesitated...");
const nameInput = page.locator('input[placeholder*="Name" i]:not([aria-hidden="true"])').first();
await nameInput.click();
await sleep(300);
await nameInput.pressSequentially("abcd", { delay: 90 });
await sleep(500);
for (let i = 0; i < 4; i++) {
  await page.keyboard.press("Backspace");
  await sleep(120);
}
await sleep(700);

// ── 3. Switch packages for tier_switched + repeat package_selected ──
log("switching packages for tier_switched...");
const packageCards = page.locator('[role="radio"]');
const packageCount = await packageCards.count();
log(`found ${packageCount} package cards`);
if (packageCount >= 2) {
  await packageCards.nth(1).click();
  await sleep(1200);
  if (packageCount >= 3) {
    await packageCards.nth(2).click();
    await sleep(1200);
  }
}

// ── 4. Click any "Home Combo" package (has multi-image carousel) ──
log("selecting a Home Combo package to expose the carousel...");
const comboPackage = page.locator('[role="radio"]').filter({ hasText: /combo/i }).first();
if (await comboPackage.count() > 0) {
  await comboPackage.click();
  await sleep(1500);
}

// ── 4b. Click carousel next arrow + dwell 1.8s → image_viewed ──
log("clicking carousel next + dwelling 1.8s...");
const nextArrows = page.locator('button[aria-label*="next" i][aria-label*="photo" i]');
const arrowCount = await nextArrows.count();
log(`found ${arrowCount} next-photo buttons`);
if (arrowCount > 0) {
  await nextArrows.first().click({ force: true }).catch((e) => log("click err:", e.message));
  await sleep(1800);
}

// ── 5. Scroll submit area into view + idle 31s → submit_idle ──
log("scrolling submit into view + idling 31s for submit_idle...");
// Scroll to bottom to ensure submit area is in the viewport
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await sleep(500);
const submitBtn = page.locator('button[type="submit"]').first();
try {
  await submitBtn.scrollIntoViewIfNeeded();
} catch {}
const inView = await submitBtn.isVisible().catch(() => false);
log(`submit visible: ${inView}`);
await sleep(31_500);

// ── 6. Trigger popstate via in-page back navigation → back_button_pressed ──
log("triggering popstate (back navigation)...");
await page.evaluate(() => {
  window.history.pushState({ extraTestNav: true }, "");
  setTimeout(() => window.history.back(), 50);
});
await sleep(2000);

await browser.close();
log(`5xx API errors: ${failed500}`);
log("browser closed, querying DB...");

const after = execSync(
  `psql "${DB_URL}" -At -F"|" -c "SELECT event_type, COUNT(*) FROM cart_journey_events WHERE created_at > '${baseline}'::timestamptz GROUP BY event_type ORDER BY event_type"`
).toString().trim();

console.log("\n=== EVENTS RECORDED SINCE BASELINE ===");
console.log(after || "(none)");

const recorded = new Set(
  after.split("\n").filter(Boolean).map((line) => line.split("|")[0])
);
const expected = [
  "package_selected", // restored regression
  "tier_switched",
  "field_hesitated",
  "image_viewed",
  "submit_idle",
  "back_button_pressed"
];
console.log("\n=== EXPECTED EVENT COVERAGE ===");
let missing = 0;
for (const e of expected) {
  const present = recorded.has(e);
  console.log(`  ${present ? "✅" : "❌"} ${e}`);
  if (!present) missing++;
}

if (missing > 0) {
  console.log(`\n${missing} expected event(s) missing.`);
  process.exit(1);
}
console.log("\nAll expected event types landed in DB.");
