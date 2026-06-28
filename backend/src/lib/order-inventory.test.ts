import assert from "node:assert/strict";
import { test } from "node:test";
import { orderInventoryLinesFromRow } from "./order-inventory.js";

test("combo add-on inventory deduction uses component snapshot, not wrapper product", () => {
  const lines = orderInventoryLinesFromRow({
    product_id: "main-product",
    product_name: "Main offer",
    quantity: 6,
    package_components_snapshot: [
      {
        productId: "main-product",
        productName: "Main offer",
        quantity: 6,
        isFreeGift: false,
        sourceType: "package_component"
      }
    ],
    cross_sell_lines: [
      {
        productId: "edge-brusher-wrapper",
        productName: "Edge Brusher Max",
        quantity: 1,
        amount: 30000,
        packageComponentsSnapshot: [
          {
            productId: "window-groove",
            productName: "2-in-1 Window Groove",
            quantity: 4,
            isFreeGift: false,
            sourceType: "cross_sell"
          },
          {
            productId: "mini-mop",
            productName: "Mini Mop",
            quantity: 2,
            isFreeGift: false,
            sourceType: "cross_sell"
          },
          {
            productId: "absorbent-towel",
            productName: "Absorbent Hand Towel",
            quantity: 1,
            isFreeGift: true,
            sourceType: "cross_sell"
          }
        ]
      }
    ]
  });

  assert.deepEqual(
    lines.map((line) => ({
      productId: line.productId,
      productName: line.productName,
      quantity: line.quantity,
      isFreeGift: Boolean(line.isFreeGift),
      sourceType: line.sourceType
    })),
    [
      {
        productId: "main-product",
        productName: "Main offer",
        quantity: 6,
        isFreeGift: false,
        sourceType: "package_component"
      },
      {
        productId: "window-groove",
        productName: "2-in-1 Window Groove",
        quantity: 4,
        isFreeGift: false,
        sourceType: "cross_sell"
      },
      {
        productId: "mini-mop",
        productName: "Mini Mop",
        quantity: 2,
        isFreeGift: false,
        sourceType: "cross_sell"
      },
      {
        productId: "absorbent-towel",
        productName: "Absorbent Hand Towel",
        quantity: 1,
        isFreeGift: true,
        sourceType: "cross_sell"
      }
    ]
  );
});

test("main product still deducts when package snapshot only contains free gifts", () => {
  const lines = orderInventoryLinesFromRow({
    product_id: "corner-rack",
    product_name: "5-in-1 Corner Racks",
    quantity: 2,
    package_components_snapshot: [
      {
        productId: "adhesive-hook",
        productName: "Adhesive Hook",
        quantity: 20,
        isFreeGift: true,
        sourceType: "package_component"
      },
      {
        productId: "super-glue",
        productName: "Super Adhesive Oily Glue",
        quantity: 2,
        isFreeGift: true,
        sourceType: "package_component"
      }
    ]
  });

  assert.deepEqual(
    lines.map((line) => ({
      productId: line.productId,
      productName: line.productName,
      quantity: line.quantity,
      isFreeGift: Boolean(line.isFreeGift),
      sourceType: line.sourceType
    })),
    [
      {
        productId: "corner-rack",
        productName: "5-in-1 Corner Racks",
        quantity: 2,
        isFreeGift: false,
        sourceType: "base_product"
      },
      {
        productId: "adhesive-hook",
        productName: "Adhesive Hook",
        quantity: 20,
        isFreeGift: true,
        sourceType: "package_component"
      },
      {
        productId: "super-glue",
        productName: "Super Adhesive Oily Glue",
        quantity: 2,
        isFreeGift: true,
        sourceType: "package_component"
      }
    ]
  );
});
