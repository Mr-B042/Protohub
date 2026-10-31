import test, { after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { JSDOM, VirtualConsole } from "jsdom";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];
const virtualConsole = new VirtualConsole();
virtualConsole.on("jsdomError", (error) => errors.push(error));
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://protohub.test/", virtualConsole });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator });
const React = await import("react");
const { createRoot } = await import("react-dom/client");
const temporary = await mkdtemp(path.join(root, ".workspace-test-"));
await build({
  entryPoints: ["RouteFallback", "DeferredCharts"].map((name) => path.join(root, `src/components/${name}.tsx`)),
  outdir: temporary, bundle: true, format: "esm", platform: "node", packages: "external",
  jsx: "automatic", outExtension: { ".js": ".mjs" }, splitting: true, logLevel: "silent"
});
const { RouteFallback } = await import(pathToFileURL(path.join(temporary, "RouteFallback.mjs")).href);
const { DeferredCharts } = await import(pathToFileURL(path.join(temporary, "DeferredCharts.mjs")).href);
let renderer;
let container;
let delayed;
const originalSetTimeout = window.setTimeout;
const originalClearTimeout = window.clearTimeout;
window.setTimeout = (callback, delay, ...args) => {
  if (delay === 12_000) { delayed = callback; return 12345; }
  return originalSetTimeout.call(window, callback, delay, ...args);
};
window.clearTimeout = (id) => { if (id !== 12345) originalClearTimeout.call(window, id); };
async function render(element) {
  container = document.createElement("div");
  document.body.append(container);
  renderer = createRoot(container);
  await React.act(async () => renderer.render(element));
}
afterEach(async () => {
  if (renderer) await React.act(async () => renderer.unmount());
  container?.remove();
  renderer = undefined;
  delayed = undefined;
  errors.length = 0;
});
after(async () => { await rm(temporary, { recursive: true, force: true }); dom.window.close(); });

test("slow workspace download continues after 12 seconds without automatic navigation", async () => {
  await render(React.createElement(RouteFallback, { message: "Loading workspace…" }));
  assert.equal(typeof delayed, "function");
  assert.equal(container.querySelector("button"), null);
  await React.act(async () => delayed());
  assert.match(container.textContent, /Loading workspace/);
  assert.match(container.textContent, /Loading will continue while you wait/);
  assert.equal(container.querySelector("button").textContent, "Retry workspace");
  assert.deepEqual(errors, [], "waiting must not trigger jsdom's unsupported location.reload");
});

test("other route fallbacks do not start a workspace retry timer", async () => {
  await render(React.createElement(RouteFallback, { message: "Loading…" }));
  assert.equal(delayed, undefined);
});

test("deferred charts preserve real Recharts components and render data after loading", async () => {
  await render(React.createElement(DeferredCharts, null, ({ ComposedChart, Bar, XAxis }) =>
    React.createElement(ComposedChart, { width: 320, height: 160, data: [{ label: "Oct", orders: 4 }] },
      React.createElement(XAxis, { dataKey: "label" }),
      React.createElement(Bar, { dataKey: "orders", isAnimationActive: false })
    )
  ));
  // The renderer arrives through a real dynamic import in the compiled test.
  for (let attempt = 0; attempt < 20 && !container.querySelector("svg"); attempt++) {
    await React.act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
  }
  assert.ok(container.querySelector("svg"));
  assert.match(container.textContent, /Oct/);
  assert.ok(container.querySelector(".recharts-bar-rectangle"));
});
