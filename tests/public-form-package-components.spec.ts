import { expect, test } from "@playwright/test";

const localFormUrl =
  "http://127.0.0.1:5174/#/order-form/embed?product=prod-main-components&currency=NGN&preview=1";
const addonLayoutFormUrl =
  "http://127.0.0.1:5174/#/order-form/embed?product=prod-addon-layout&currency=NGN&preview=1";
const addonPreviewImage =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 600 600'%3E%3Crect width='600' height='600' fill='%23f8fafc'/%3E%3Ccircle cx='210' cy='180' r='120' fill='%23dbeafe' stroke='%2394a3b8' stroke-width='8'/%3E%3Ccircle cx='400' cy='185' r='120' fill='%23e0f2fe' stroke='%2394a3b8' stroke-width='8'/%3E%3Ccircle cx='220' cy='410' r='120' fill='%23f1f5f9' stroke='%2394a3b8' stroke-width='8'/%3E%3Ccircle cx='410' cy='410' r='120' fill='%23ecfeff' stroke='%2394a3b8' stroke-width='8'/%3E%3Ctext x='300' y='310' text-anchor='middle' font-size='34' font-family='Arial' font-weight='700' fill='%230f172a'%3EEdge Brusher%3C/text%3E%3C/svg%3E";

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

  test("keeps selected showcase add-on layout readable on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.route("**/api/public/products/prod-addon-layout", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          product: {
            id: "prod-addon-layout",
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
                id: "pkg-starter-layout",
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
                packageComponents: [],
                companionProducts: [
                  {
                    companionId: "addon-edge-showcase",
                    productId: "prod-edge-layout",
                    packageId: null,
                    active: true,
                    quantity: 1,
                    pricingMode: "fixed",
                    fixedPrice: 8500,
                    stateFilterMode: "all",
                    stateRestrictions: [],
                    autoInclude: false,
                    placement: "inline",
                    displayMode: "showcase",
                    pitch: "Clean Edge And Corners areas where Normal Brush Cant reach",
                    badgeText: "Flash Sale",
                    headline: "Edge Brusher Max",
                    imageUrl: addonPreviewImage,
                    bundleComponents: [
                      { componentId: "edge", productId: "prod-edge-layout", quantity: 3, isFreeGift: false },
                      { componentId: "hanger", productId: "prod-addon-layout", quantity: 1, isFreeGift: false },
                      { componentId: "towel", productId: "prod-towel-layout", quantity: 1, isFreeGift: true }
                    ]
                  }
                ]
              }
            ]
          },
          related: [
            {
              id: "prod-edge-layout",
              orgId: "org-local-test",
              name: "Edge Brusher Max",
              description: "",
              active: true,
              availableStates: [],
              pricings: [{ currency: "NGN", sellingPrice: 8500, isPrimary: true }],
              packages: []
            },
            {
              id: "prod-towel-layout",
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

    await page.goto(addonLayoutFormUrl, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle");

    const addonCard = page.locator(".public-package-option--featured").filter({ hasText: "Edge Brusher Max" });
    await expect(addonCard).toHaveCount(1);
    await addonCard.click();

    await expect(addonCard.getByText("Added to order")).toHaveCount(0);
    await expect(addonCard.getByText("FREE GIFT INCLUDED:")).toBeVisible();
    await expect(addonCard.locator(".public-package-option__price")).toBeVisible();
    await expect(addonCard.locator(".public-package-option__price-stack")).toBeVisible();

    const radioBox = await addonCard.locator('input[type="radio"]').boundingBox();
    expect(radioBox?.width).toBeLessThanOrEqual(30);
    expect(radioBox?.height).toBeLessThanOrEqual(30);
  });
});
