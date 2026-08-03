import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compactCartJourneyEventsForAnalytics } from "./cart-journey.js";

type EventRow = {
  id: string;
  cart_id: string;
  event_type: string;
  created_at: string;
  metadata?: Record<string, unknown>;
};

const row = (id: string, cartId: string, eventType: string, second: number): EventRow => ({
  id,
  cart_id: cartId,
  event_type: eventType,
  created_at: `2026-08-03T10:00:${String(second).padStart(2, "0")}.000Z`
});

describe("compactCartJourneyEventsForAnalytics", () => {
  it("keeps exact counted events while reducing repeated presence-only signals", () => {
    const events = [
      row("open-1", "CART-1", "form_opened", 1),
      row("open-2", "CART-1", "form_opened", 2),
      row("preview-1", "CART-1", "additional_item_preview_opened", 3),
      row("preview-2", "CART-1", "additional_item_preview_opened", 4),
      row("blocked-1", "CART-1", "submit_blocked_missing_city", 5),
      row("blocked-2", "CART-1", "submit_blocked_missing_city", 6),
      row("exit-1", "CART-1", "form_exited", 7)
    ];

    const compacted = compactCartJourneyEventsForAnalytics(events);
    assert.deepEqual(compacted.map((event) => event.id), [
      "open-2",
      "preview-1",
      "preview-2",
      "blocked-1",
      "blocked-2",
      "exit-1"
    ]);
  });

  it("preserves each cart's latest event even when its type has an older duplicate", () => {
    const events = [
      row("state-1", "CART-1", "state_selected", 1),
      row("state-2", "CART-1", "state_selected", 2),
      row("open-1", "CART-2", "form_opened", 3)
    ];

    const compacted = compactCartJourneyEventsForAnalytics(events);
    assert.deepEqual(compacted.map((event) => event.id), ["state-2", "open-1"]);
  });

  it("keeps overview metadata and removes repeated ad-attribution payload", () => {
    const event = {
      ...row("submitted", "CART-1", "order_submitted", 1),
      metadata: {
        orderId: "1234",
        customerName: "Customer",
        productName: "Product",
        fbclid: "large-ad-click-id",
        fbp: "browser-cookie",
        utmCampaign: "campaign"
      }
    };

    const [compacted] = compactCartJourneyEventsForAnalytics([event]);
    assert.deepEqual(compacted.metadata, {
      orderId: "1234",
      customerName: "Customer",
      productName: "Product"
    });
  });
});
