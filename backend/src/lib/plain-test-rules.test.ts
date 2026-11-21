import assert from "node:assert/strict";
import test from "node:test";
import { asOneLinkNote, normalizeDesign } from "./email-render.js";
import { plainTestVariant, plainVerdict } from "./plain-test-rules.js";

test("split: stable per person, about half and half", () => {
  assert.equal(plainTestVariant("Ada@Gmail.com"), plainTestVariant(" ada@gmail.com "));
  let b = 0;
  for (let i = 0; i < 2000; i += 1) if (plainTestVariant(`person${i}@gmail.com`) === "b") b += 1;
  assert.ok(b > 900 && b < 1100, `b = ${b}`);
});

test("verdict: too early, tie, winner; clicks decide once there are 10", () => {
  assert.equal(plainVerdict({ sent: 60, opened: 9, clicked: 0 }, { sent: 70, opened: 14, clicked: 0 }).kind, "too_early");
  const tie = plainVerdict({ sent: 135, opened: 18, clicked: 0 }, { sent: 137, opened: 19, clicked: 0 });
  assert.equal(tie.kind, "tie"); assert.equal(tie.measure, "opens");
  const plain = plainVerdict({ sent: 400, opened: 40, clicked: 2 }, { sent: 400, opened: 80, clicked: 3 });
  assert.equal(plain.kind, "plain"); assert.equal(plain.measure, "opens");
  const clicks = plainVerdict({ sent: 300, opened: 60, clicked: 20 }, { sent: 300, opened: 60, clicked: 4 });
  assert.equal(clicks.kind, "designed"); assert.equal(clicks.measure, "clicks");
});

test("one-link note: banner button is the only link, products become a list", () => {
  const design = normalizeDesign({ blocks: [
    { id: "h", type: "header", brand: "Protohub", tagline: "", align: "center" },
    { id: "c", type: "cover", title: "Want To Add Something?", subtitle: "", imageUrl: "x.jpg", emoji: "", buttonText: "Add To My Delivery", buttonLink: "https://wa.me/1", buttonTone: "yellow", tone: "lavender" },
    { id: "t1", type: "text", text: "Hi {{First Name}},", size: 19, align: "left", color: "", bold: true },
    { id: "p1", type: "product", productId: "1", name: "Corner Shelf", price: "₦42,500", imageUrl: "a.jpg", buttonText: "Add", link: "https://wa.me/2" },
    { id: "p2", type: "product", productId: "2", name: "Edge Brusher", price: "", imageUrl: "b.jpg", buttonText: "Add", link: "https://wa.me/3" },
    { id: "f", type: "features" },
    { id: "t2", type: "text", text: "Thanks for shopping with us,\nThe Protohub Team", size: 15, align: "left", color: "", bold: false },
    { id: "ft", type: "footer", text: "Pay on Delivery" }
  ] })!;
  const note = asOneLinkNote(design);
  const links = note.blocks.filter((b) => b.type === "button");
  assert.equal(links.length, 1);
  assert.equal((links[0] as any).link, "https://wa.me/1");
  assert.ok(note.blocks.every((b) => !["header", "cover", "product", "features", "footer", "image"].includes(b.type)));
  const list = note.blocks.find((b) => b.type === "text" && (b as any).text.startsWith("•")) as any;
  assert.equal(list.text, "• Corner Shelf (₦42,500)\n• Edge Brusher");
  assert.deepEqual(note.blocks.map((b) => b.id), ["t1", "one-list-1", "one-link", "t2"]);
});
