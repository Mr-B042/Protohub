import test from "node:test";
import assert from "node:assert/strict";
import { canApproveMedia, canSendMedia, cleanFileName, sniffMediaType } from "./media-safety.js";

const bytes = (...parts: Array<number[] | string>) => {
  const out: number[] = [];
  for (const part of parts) out.push(...(typeof part === "string" ? Array.from(part, (ch) => ch.charCodeAt(0)) : part));
  while (out.length < 32) out.push(0);
  return Uint8Array.from(out);
};
const ftyp = (brand: string) => bytes([0, 0, 0, 0x20], "ftyp", brand);

test("real photos are recognised from their first bytes", () => {
  assert.equal(sniffMediaType(bytes([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
  assert.equal(sniffMediaType(bytes([0x89], "PNG", [0x0d, 0x0a, 0x1a, 0x0a])), "image/png");
  assert.equal(sniffMediaType(bytes("RIFF", [1, 2, 3, 4], "WEBPVP8 ")), "image/webp");
});

test("real videos are recognised, phone and web formats", () => {
  assert.equal(sniffMediaType(ftyp("isom")), "video/mp4");
  assert.equal(sniffMediaType(ftyp("mp42")), "video/mp4");
  assert.equal(sniffMediaType(ftyp("qt  ")), "video/quicktime");
  assert.equal(sniffMediaType(bytes([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81], "B\x82\x84webm")), "video/webm");
});

test("anything disguised as a photo or video is refused", () => {
  assert.equal(sniffMediaType(bytes("MZ\x90\x00")), null, "Windows app");
  assert.equal(sniffMediaType(bytes([0x7f], "ELF")), null, "Linux app");
  assert.equal(sniffMediaType(bytes("<!DOCTYPE html><script>")), null, "web page");
  assert.equal(sniffMediaType(bytes("<svg xmlns=\"http://www.w3.org/2000/svg\">")), null, "SVG");
  assert.equal(sniffMediaType(bytes("PK\x03\x04")), null, "zip / APK");
  assert.equal(sniffMediaType(bytes("%PDF-1.7")), null, "PDF");
  assert.equal(sniffMediaType(bytes("GIF89a")), null, "GIF is not on the list");
  assert.equal(sniffMediaType(new Uint8Array([0xff, 0xd8])), null, "too short to judge");
});

test("still-picture containers that share the video header are not videos", () => {
  assert.equal(sniffMediaType(ftyp("heic")), null);
  assert.equal(sniffMediaType(ftyp("avif")), null);
  assert.equal(sniffMediaType(ftyp("zzzz")), null, "unknown brand");
  assert.equal(sniffMediaType(bytes([0x1a, 0x45, 0xdf, 0xa3], "matroska")), null, "Matroska is not WebM");
});

test("who sends and who approves", () => {
  for (const role of ["Owner", "Admin", "Manager"]) assert.ok(canApproveMedia(role), role);
  for (const role of ["Sales Rep", "Recovery Rep", "Sales Closer", "Marketer"]) {
    assert.ok(!canApproveMedia(role), role);
    assert.ok(canSendMedia(role), role);
  }
  assert.ok(!canSendMedia("Viewer"));
  assert.ok(!canSendMedia("Delivery Agent"));
  assert.ok(!canSendMedia(undefined));
});

test("file names are shortened and stripped of markup", () => {
  assert.equal(cleanFileName("<img src=x onerror=alert(1)>.jpg"), "img src=x onerror=alert(1).jpg");
  assert.equal(cleanFileName("../../etc/passwd"), "....etcpasswd");
  assert.equal(cleanFileName(""), "file");
  assert.equal(cleanFileName("a".repeat(300)).length, 120);
});

import { cleanImportUrl, isPrivateAddress, nameFromUrl } from "./media-safety.js";

test("links to private or internal networks are refused", () => {
  for (const ip of ["127.0.0.1", "10.2.3.4", "172.16.0.9", "172.31.255.1", "192.168.1.10", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) {
    assert.ok(isPrivateAddress(ip), ip);
  }
  for (const ip of ["8.8.8.8", "104.16.1.1", "172.32.0.1", "2606:4700::6810:84e5"]) assert.ok(!isPrivateAddress(ip), ip);
});

test("only plain public web links are accepted", () => {
  assert.ok(cleanImportUrl("https://img.kwcdn.com/product/fancy/a32a18c6.jpg"));
  assert.ok(cleanImportUrl("http://example.com/a.png"));
  for (const bad of ["file:///etc/passwd", "ftp://example.com/a.jpg", "javascript:alert(1)", "http://localhost/a.jpg", "http://127.0.0.1/a.jpg",
    "http://169.254.169.254/latest/meta-data", "http://192.168.0.1/a.jpg", "http://intranet/a.jpg", "https://user:pass@example.com/a.jpg",
    "http://example.com:5432/a.jpg", "http://db.internal/a.jpg", "http://[::1]/a.jpg", "not a link", ""]) {
    assert.equal(cleanImportUrl(bad), null, bad);
  }
});

test("file name comes from the link", () => {
  assert.equal(nameFromUrl(new URL("https://img.kwcdn.com/product/open/3c86de-goods.jpeg?x=1")), "3c86de-goods.jpeg");
  assert.equal(nameFromUrl(new URL("https://example.com/")), "example.com");
});
