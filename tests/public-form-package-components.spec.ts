import { expect, test } from "@playwright/test";

const localFormUrl =
  "http://127.0.0.1:5174/#/order-form/embed?product=prod-main-components&currency=NGN&preview=1";

test.describe("public order form package component display", () => {
  test("keeps internal stock components out of the main package picker copy", async ({ page }) => {
    await page.route("**/api/public/products/prod-main-components", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          product: {
            id: "prod-main-components",
            orgId: "org-local-test",
            name: "Multiple Hanger",
            description: "Local regression product",
            packageDescription: "",
            active: true,
            availableStates: [],
            freeGiftProductIds: [],
            freeGiftStateRestrictions: {},
            crossSellPriceOverrides: {},
            formCustomText: "",
            pricings: [{ currency: "NGN", sellingPrice: 19500, isPrimary: true }],
            packages: [
              {
                id: "pkg-starter",
                name: "Starter Pack",
                description: "1 Sets (4 pcs) Multiple Hanger - Starter Pack + FREE DELIVERY",
                quantity: 4,
                price: 19500,
                currency: "NGN",
                displayOrder: 1,
                active: true,
                packageSet: "Default",
                stateFilterMode: "all",
                stateRestrictions: [],
                requiresStateStock: false,
                featuredComboCard: false,
                imageUrl: "",
                imageUrls: [],
                unitSingular: "pc",
                unitPlural: "pcs",
                attributionProductId: null,
                packageComponents: [
                  { componentId: "edge", productId: "prod-edge", quantity: 4, isFreeGift: false },
                  { componentId: "knee", productId: "prod-knee", quantity: 2, isFreeGift: false },
                  { componentId: "towel", productId: "prod-towel", quantity: 1, isFreeGift: true }
                ],
                companionProducts: []
              }
            ]
          },
          related: [
            {
              id: "prod-edge",
              orgId: "org-local-test",
              name: "Edge Brusher Max",
              description: "",
              active: true,
              availableStates: [],
              pricings: [{ currency: "NGN", sellingPrice: 8500, isPrimary: true }],
              packages: []
            },
            {
              id: "prod-knee",
              orgId: "org-local-test",
              name: "Knee pad",
              description: "",
              active: true,
              availableStates: [],
              pricings: [{ currency: "NGN", sellingPrice: 5000, isPrimary: true }],
              packages: []
            },
            {
              id: "prod-towel",
              orgId: "org-local-test",
              name: "Absorbent Hand Towel",
              description: "",
              active: true,
              availableStates: [],
              pricings: [{ currency: "NGN", sellingPrice: 2000, isPrimary: true }],
              packages: []
            }
          ]
        })
      });
    });

    await page.route("**/api/public/embed-settings/org-local-test", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          showPackageName: true,
          publicFormMode: "classic",
          freeDeliverySlotsEnabled: false
        })
      });
    });

    await page.route("**/api/public/carts/**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true })
      });
    });

    await page.goto(localFormUrl, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle");

    await expect(page.getByText("SELECT YOUR PACKAGE *")).toBeVisible();
    await expect(page.locator(".public-package-option__title").filter({ hasText: "Starter Pack" })).toHaveCount(1);
    await expect(page.locator(".public-package-option__description").filter({
      hasText: "1 Sets (4 pcs) Multiple Hanger - Starter Pack + FREE DELIVERY"
    })).toHaveCount(1);

    const packagePicker = page.locator(".package-picker");
    await expect(packagePicker.getByText("Selected combo")).toHaveCount(0);
    await expect(packagePicker.getByText("4 pcs of Edge Brusher Max + 2 pcs of Knee pad + FREE 1 pc of Absorbent Hand Towel")).toHaveCount(0);
    await expect(packagePicker.getByText("1 FREE GIFT")).toHaveCount(0);
    await expect(packagePicker.getByText("FREE GIFT INCLUDED:")).toHaveCount(0);
  });
});
