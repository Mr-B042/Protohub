import assert from "node:assert/strict";
import { test } from "node:test";
import { orderInventoryLinesFromRow, scalePackageComponentLines, type OrderInventoryLine } from "./order-inventory.js";

test("package quantities are physical units, not one unit per order", () => {
  const packageQuantities = [3, 6, 10];
  const physicalUnits = packageQuantities.reduce((sum, quantity) => {
    const lines = orderInventoryLinesFromRow({
      product_id: "edge-brusher",
      product_name: "Edge Brusher Max",
      quantity
    });
    assert.equal(lines.length, 1);
    assert.equal(lines[0]?.quantity, quantity);
    return sum + (lines[0]?.quantity ?? 0);
  }, 0);

  assert.equal(physicalUnits, 19);
});

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

test("package components scale with a multi-unit order", () => {
  const oneUnitSnapshot: OrderInventoryLine[] = [
    {
      productId: "shelf",
      productName: "Corner Storage Shelf",
      quantity: 1,
      isFreeGift: false,
      sourceType: "package_component"
    },
    {
      productId: "hooks",
      productName: "Adhesive Hooks",
      quantity: 10,
      isFreeGift: true,
      sourceType: "package_component"
    },
    {
      productId: "glue",
      productName: "Super Glue",
      quantity: 1,
      isFreeGift: true,
      sourceType: "package_component"
    }
  ];

  const scaledSnapshot = scalePackageComponentLines(oneUnitSnapshot, 1, 3);
  const lines = orderInventoryLinesFromRow({
    product_id: "corner-rack",
    product_name: "5-in-1 Corner Racks",
    quantity: 3,
    package_components_snapshot: scaledSnapshot
  });

  assert.deepEqual(
    Object.fromEntries(lines.map((line) => [line.productId, line.quantity])),
    { shelf: 3, hooks: 30, glue: 3 }
  );
});

test("a package tier already configured for its full quantity is not scaled twice", () => {
  const fourPieceSnapshot: OrderInventoryLine[] = [
    {
      productId: "shelf",
      productName: "Corner Storage Shelf",
      quantity: 4,
      sourceType: "package_component"
    },
    {
      productId: "hooks",
      productName: "Adhesive Hooks",
      quantity: 4,
      sourceType: "package_component"
    }
  ];

  const snapshot = scalePackageComponentLines(fourPieceSnapshot, 4, 4);
  assert.deepEqual(snapshot.map((line) => line.quantity), [4, 4]);
});
