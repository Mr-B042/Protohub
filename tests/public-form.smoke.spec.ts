import { expect, test } from "@playwright/test";

const defaultLocalSmokeUrl =
  "http://127.0.0.1:5174/#/order-form/embed?product=d7f0b40f-38cc-49a8-94a2-bba3d1347921&currency=NGN&preview=1";

const smokeUrl = process.env.PUBLIC_FORM_SMOKE_URL?.trim() || defaultLocalSmokeUrl;
const expectAdditionalItems = process.env.PUBLIC_FORM_SMOKE_EXPECT_ADDITIONAL_ITEMS === "1";

test.describe("public order form smoke", () => {
  test("loads without crashing and blocks incomplete submit inline", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => {
      pageErrors.push(error.message);
    });

    await page.goto(smokeUrl, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle");

    await expect(page.getByRole("heading", { name: /loading order form/i })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: /order form unavailable/i })).toHaveCount(0);
    await expect(page.getByText(/something went wrong\./i)).toHaveCount(0);
    await expect(page.getByText(/show technical details/i)).toHaveCount(0);

    const orderNow = page.getByRole("button", { name: /order now/i });
    await expect(orderNow).toBeVisible();

    if (expectAdditionalItems) {
      await expect(page.getByText(/would you like to add additional items/i)).toBeVisible();
    }

    await orderNow.click();

    await expect(page.getByText(/please complete the highlighted fields/i)).toBeVisible();
    await expect(page.locator("#public-order-error-name")).toHaveText(/customer name is required\./i);
    await expect(page.locator("#public-order-error-phone")).toHaveText(/phone number is required\./i);

    expect(pageErrors, `Unexpected page errors: ${pageErrors.join(" | ")}`).toEqual([]);
  });
});
