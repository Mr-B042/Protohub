import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import { cleanCommentReply, commentReplyBlock, contactIdFor, keywordHit, parseMetaWebhook, pickPublic, privateReplyOpen, signState, signatureOk, stateOk, toGraphMessage, type MetaCommentEvent } from "./meta-direct-rules.js";

test("Facebook Page: comment + Messenger message; own posts, echoes and edits left out", () => {
  const events = parseMetaWebhook({ object: "page", entry: [{ id: "PAGE1", time: 1763000000000,
    changes: [
      { field: "feed", value: { item: "comment", verb: "add", comment_id: "111_222", post_id: "PAGE1_9", from: { id: "U1", name: "Kemi Ade" }, message: "Price please", created_time: 1763000000 } },
      { field: "feed", value: { item: "comment", verb: "edited", comment_id: "111_223", post_id: "PAGE1_9", from: { id: "U1", name: "Kemi" }, message: "x" } },
      { field: "feed", value: { item: "comment", verb: "add", comment_id: "111_224", post_id: "PAGE1_9", from: { id: "PAGE1", name: "Shop" }, message: "Thanks" } }
    ],
    messaging: [
      { sender: { id: "PSID9" }, recipient: { id: "PAGE1" }, timestamp: 1763000001000, message: { mid: "m_1", text: "How much?", referral: { ad_id: "AD7", source: "ADS", ads_context_data: { ad_title: "Shelf promo" } } } },
      { sender: { id: "PAGE1" }, recipient: { id: "PSID9" }, message: { mid: "m_2", text: "echo", is_echo: true } }
    ] }] });
  assert.equal(events.length, 2);
  const comment = events.find((e) => e.kind === "comment") as MetaCommentEvent;
  assert.equal(comment.commentId, "111_222");
  assert.equal(comment.userName, "Kemi Ade");
  assert.equal(comment.isReply, false);
  const msg = events.find((e) => e.kind === "message")!;
  assert.equal(msg.userId, "PSID9");
  assert.equal((msg as any).adId, "AD7");
  assert.equal((msg as any).adTitle, "Shelf promo");
});

test("Instagram: comment on a boosted post keeps the ad id; story reply arrives as a message", () => {
  const events = parseMetaWebhook({ object: "instagram", entry: [{ id: "IG1", time: 1763000000000,
    changes: [{ field: "comments", value: { id: "C9", text: "LINK", from: { id: "IGU", username: "tayo" }, media: { id: "ADMEDIA", original_media_id: "POST1", ad_id: "AD3", media_product_type: "AD" } } }],
    messaging: [{ sender: { id: "IGU" }, recipient: { id: "IG1" }, timestamp: 1, message: { mid: "ig_m", text: "price" } }] }] });
  const c = events.find((e) => e.kind === "comment") as MetaCommentEvent;
  assert.equal(c.postId, "POST1");
  assert.equal(c.adId, "AD3");
  assert.equal(c.userName, "tayo");
  assert.equal(events.filter((e) => e.kind === "message").length, 1);
  assert.deepEqual(parseMetaWebhook({ object: "whatsapp_business_account", entry: [] }), []);
});

test("signature: Meta's HMAC of the exact bytes", () => {
  const raw = Buffer.from('{"object":"page","entry":[]}');
  const sig = `sha256=${createHmac("sha256", "s3cret").update(raw).digest("hex")}`;
  assert.equal(signatureOk(raw, sig, "s3cret"), true);
  assert.equal(signatureOk(raw, sig, "other"), false);
  assert.equal(signatureOk(Buffer.from('{"object":"page","entry":[1]}'), sig, "s3cret"), false);
  assert.equal(signatureOk(raw, undefined, "s3cret"), false);
});

test("connect state: signed, 10 minutes", () => {
  const now = 1_763_000_000_000;
  const st = signState({ o: "org", b: "br", u: "me", t: now }, "k");
  assert.equal(stateOk(st, "k", now + 60_000)?.u, "me");
  assert.equal(stateOk(st, "k", now + 11 * 60_000), null);
  assert.equal(stateOk(st, "wrong", now), null);
  assert.equal(stateOk(st.replace(/^./, "x"), "k", now), null);
});

test("comment auto-reply: whole-word keywords, thread replies skipped, off by default", () => {
  assert.equal(keywordHit("What's the PRICE?", ["price"]), true);
  assert.equal(keywordHit("priceless", ["price"]), false);
  assert.equal(keywordHit("how much is it", ["how much"]), true);
  assert.equal(keywordHit("anything", []), true);
  const ev = { kind: "comment", object: "page", accountId: "P", userId: "U", userName: null, commentId: "C", text: "price", postId: null, adId: null, isReply: false, at: 0 } as MetaCommentEvent;
  assert.match(commentReplyBlock(cleanCommentReply({}), ev)!, /off/);
  const on = cleanCommentReply({ enabled: true, keywords: ["Price", "price", " "] });
  assert.deepEqual(on.keywords, ["price"]);
  assert.equal(commentReplyBlock(on, ev), null);
  assert.match(commentReplyBlock(on, { ...ev, isReply: true })!, /thread/);
  assert.match(commentReplyBlock(on, { ...ev, text: "nice" })!, /keyword/);
  assert.equal(pickPublic(on, "C"), null);
  const pub = cleanCommentReply({ publicReply: true, publicMessages: ["A", "B"] });
  assert.ok(["A", "B"].includes(pickPublic(pub, "C1")!));
});

test("private reply window, contact ids, message shapes", () => {
  const now = Date.parse("2026-11-13T12:00:00Z");
  assert.equal(privateReplyOpen("2026-11-07T12:00:00Z", now), true);
  assert.equal(privateReplyOpen("2026-11-06T11:00:00Z", now), false);
  assert.equal(privateReplyOpen(null, now), false);
  assert.equal(contactIdFor("page", "123", true), "fbc_123");
  assert.equal(contactIdFor("instagram", "9", false), "ig_9");
  assert.deepEqual(toGraphMessage({ type: "text", text: "Hi" }), { text: "Hi" });
  const card: any = toGraphMessage({ type: "cards", elements: [{ title: "Shelf – ₦39,500", image_url: "https://x/y.jpg", buttons: [{ type: "url", caption: "View Details", url: "https://z" }] }] });
  assert.equal(card.attachment.payload.template_type, "generic");
  assert.equal(card.attachment.payload.elements[0].buttons[0].type, "web_url");
});
