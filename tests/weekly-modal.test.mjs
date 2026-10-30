import test, { after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { JSDOM } from "jsdom";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://protohub.test/" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator });
const React = await import("react");
const { createRoot } = await import("react-dom/client");
const temporary = await mkdtemp(path.join(root, ".modal-test-"));
const compiled = path.join(temporary, "weekly-modal.mjs");
await build({
  entryPoints: [path.join(root, "src/components/WeeklyReportParts.tsx")],
  outfile: compiled, bundle: true, format: "esm", platform: "node", packages: "external",
  jsx: "automatic", define: { "import.meta.env": "{}" }, logLevel: "silent"
});
const { Modal } = await import(pathToFileURL(compiled).href);
let mounted;

async function render(props = {}) {
  const container = document.createElement("div");
  document.body.append(container);
  const renderer = createRoot(container);
  const element = (next) => React.createElement(Modal, {
    title: "Edit expense", onClose() {}, ...next,
    children: React.createElement("input", { "aria-label": "Description" })
  });
  await React.act(async () => { renderer.render(element(props)); });
  mounted = { renderer, container };
  const dialog = document.querySelector('[role="dialog"]');
  return {
    dialog, backdrop: dialog.parentElement, input: dialog.querySelector("input"),
    async rerender(next) { await React.act(async () => renderer.render(element(next))); }
  };
}

async function pointer(target, type) {
  await React.act(async () => target.dispatchEvent(new window.MouseEvent(type, { bubbles: true, cancelable: true })));
}

afterEach(async () => {
  if (mounted) {
    await React.act(async () => mounted.renderer.unmount());
    mounted.container.remove();
    mounted = null;
  }
});
after(async () => { await rm(temporary, { recursive: true, force: true }); dom.window.close(); });

test("clicking a field and selecting text out of the dialog does not dismiss it", async () => {
  let closed = 0;
  const { input, backdrop } = await render({ onClose() { closed++; } });
  await pointer(input, "pointerdown");
  await pointer(input, "click");
  assert.equal(closed, 0);
  await pointer(input, "pointerdown");
  await pointer(backdrop, "click");
  assert.equal(closed, 0);
});

test("a deliberate backdrop click still closes ordinary weekly dialogs", async () => {
  let closed = 0;
  const { backdrop } = await render({ onClose() { closed++; } });
  await pointer(backdrop, "pointerdown");
  await pointer(backdrop, "click");
  assert.equal(closed, 1);
});

test("financial entry editors require their explicit close control", async () => {
  let closed = 0;
  const { dialog, backdrop } = await render({ closeOnBackdrop: false, onClose() { closed++; } });
  await pointer(backdrop, "pointerdown");
  await pointer(backdrop, "click");
  assert.equal(closed, 0);
  await pointer(dialog.querySelector('button[aria-label="Close"]'), "click");
  assert.equal(closed, 1);
});

test("a cancelled pointer gesture cannot dismiss the dialog", async () => {
  let closed = 0;
  const { backdrop } = await render({ onClose() { closed++; } });
  await pointer(backdrop, "pointerdown");
  await pointer(backdrop, "pointercancel");
  await pointer(backdrop, "click");
  assert.equal(closed, 0);
});

test("Escape consumed by an input control leaves the parent dialog open", async () => {
  let closed = 0;
  const { input } = await render({ onClose() { closed++; } });
  input.addEventListener("keydown", (event) => event.preventDefault(), { once: true });
  await React.act(async () => input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
  assert.equal(closed, 0);
  await React.act(async () => window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", cancelable: true })));
  assert.equal(closed, 1);
});

test("rerenders use the latest close callback and unmount removes its listener", async () => {
  let previous = 0;
  let current = 0;
  const view = await render({ onClose() { previous++; } });
  await view.rerender({ onClose() { current++; } });
  await React.act(async () => window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape" })));
  assert.equal(previous, 0);
  assert.equal(current, 1);
  await React.act(async () => mounted.renderer.unmount());
  mounted.container.remove();
  mounted = null;
  window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape" }));
  assert.equal(current, 1);
});
