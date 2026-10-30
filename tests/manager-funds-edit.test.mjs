import test, { after, afterEach, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, rmdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempBase = path.join(repo, ".test-tmp");
await mkdir(tempBase, { recursive: true });
const tempDir = await mkdtemp(path.join(tempBase, "manager-funds-edit-"));
const bundle = path.join(tempDir, "ManagerFundsTab.mjs");
const apiCallsKey = Symbol.for("protohub.managerFundsEditTest.apiCalls");

// Only API boundaries are replaced. The real Funds component and shared Modal
// are bundled together; React and React DOM resolve to the repository's copies.
await build({
  entryPoints: [path.join(repo, "src/pages/ManagerFundsTab.tsx")],
  outfile: bundle,
  bundle: true,
  format: "esm",
  platform: "node",
  packages: "external",
  jsx: "automatic",
  define: { "import.meta.env": "{}" },
  plugins: [{
    name: "block-test-api-writes",
    setup(builder) {
      builder.onResolve({ filter: /(?:^|\/)lib\/api(?:\.ts)?$/ }, () => ({ path: "api", namespace: "test-api" }));
      builder.onLoad({ filter: /.*/, namespace: "test-api" }, () => ({
        loader: "js",
        contents: `const boundary = (name) => new Proxy({}, { get: (_target, method) => (...args) => {
          globalThis[Symbol.for("protohub.managerFundsEditTest.apiCalls")].push({ name, method, args });
          return Promise.reject(new Error("Unexpected API call in Funds edit regression: " + name + "." + String(method)));
        }});
        export const managerFundsApi = boundary("managerFundsApi");
        export const expensesApi = boundary("expensesApi");`
      }));
    }
  }]
});

// React DOM must see a DOM when it is first imported, otherwise its input event
// detection can silently miss the controlled-field edits this regression needs.
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost", pretendToBeVisual: true });
const originalGlobals = new Map();
const installGlobal = (key, value) => {
  originalGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
};
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLTextAreaElement", "Element", "Node", "Event", "MouseEvent", "KeyboardEvent", "File", "FileReader", "MutationObserver", "localStorage"]) {
  installGlobal(key, key === "window" ? dom.window : dom.window[key]);
}
installGlobal("getComputedStyle", dom.window.getComputedStyle.bind(dom.window));
installGlobal("requestAnimationFrame", dom.window.requestAnimationFrame.bind(dom.window));
installGlobal("cancelAnimationFrame", dom.window.cancelAnimationFrame.bind(dom.window));
installGlobal("IS_REACT_ACT_ENVIRONMENT", true);
class QuietResizeObserver { observe() {} unobserve() {} disconnect() {} }
installGlobal("ResizeObserver", QuietResizeObserver);
dom.window.ResizeObserver = QuietResizeObserver;
dom.window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
// jsdom has no layout engine. Give the unrelated charts a fixed viewport so
// Recharts can render without flooding these form tests with zero-size warnings.
const nativeRect = dom.window.HTMLElement.prototype.getBoundingClientRect;
dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
  return this.classList.contains("recharts-responsive-container")
    ? new dom.window.DOMRect(0, 0, 400, 220)
    : nativeRect.call(this);
};
const blockedFetch = mock.fn(async () => { throw new Error("Real network requests are forbidden in this regression"); });
installGlobal("fetch", blockedFetch);

const { createElement, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { default: ManagerFundsTab } = await import(pathToFileURL(bundle).href);
let mounted;

const makeWeek = () => ({
  weekStart: "2026-10-25",
  weekEnd: "2026-10-31",
  manager: { id: "manager-1", name: "Test Manager" },
  managers: [{ id: "manager-1", name: "Test Manager" }],
  wallet: { id: "wallet-1", name: "Test Manager's wallet" },
  editable: true,
  companyStatus: "draft",
  week: { opening: 10000, openingSource: "previous_week", actualClosing: null, varianceExplanation: null, notes: null, locked: false, closingSnapshot: null },
  settings: { expenseProofMin: 0, remittanceProofRequired: false, ownerFundingReferenceRequired: false, otherInProofRequired: false },
  totals: { opening: 10000, received: 0, receivedBySource: {}, spent: 6500, spentByCategory: { office: 6500 }, remitted: 0, expected: 3500, actual: null, variance: null, otherIn: 0, counts: { in: 0, expense: 1, out: 0 }, pending: 0 },
  readiness: [],
  transactions: [{
    id: "expense-1", managerId: "manager-1", weekStart: "2026-10-25", kind: "expense", kindLabel: "Expense",
    category: "office", categoryLabel: "Office supplies", amount: 6500, occurredAt: "2026-10-28T10:00:00.000Z",
    description: "Printer paper", paidTo: "Stationer", paymentMethod: "transfer", reference: "TEST-EXPENSE-1",
    orderIds: [], counterpartyAccountId: null, evidence: [], status: "recorded", returnReason: null, voidReason: null,
    adjustsTransactionId: null, version: 1, createdByName: "Test Manager", createdAt: "2026-10-28T10:00:00.000Z", updatedAt: "2026-10-28T10:00:00.000Z", missingProof: null
  }],
  companyAccounts: [], adjustments: [], daily: [], categories: [{ key: "office", label: "Office supplies" }], products: []
});

const makeCallbacks = () => Object.fromEntries([
  "onSelectManager", "onLog", "onUpload", "onEdit", "onVoid", "onOpenEvidence", "onSaveWeek", "onRequestAdjustment",
  "onDecideAdjustment", "onReturnTransaction", "onSaveSettings", "onShiftWeek", "onGoToWeek"
].map((key) => [key, mock.fn(async () => key === "onLog" ? { id: "new-expense" } : undefined)]));

async function mountFunds(data = makeWeek()) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const callbacks = makeCallbacks();
  let props = { data, loading: false, error: "", mode: "manager", canWrite: true, ...callbacks };
  mounted = { root, container };
  const render = async (updates = {}) => {
    props = { ...props, ...updates };
    await act(async () => { root.render(createElement(ManagerFundsTab, props)); });
  };
  await render();
  return { callbacks, render };
}

const dialog = () => {
  const node = document.querySelector('[role="dialog"]');
  assert.ok(node, "Funds dialog should stay open");
  return node;
};
const button = (scope, text) => {
  const node = [...scope.querySelectorAll("button")].find((entry) => entry.textContent.trim() === text);
  assert.ok(node, `Expected button '${text}'`);
  return node;
};
const field = (scope, labelText) => {
  const label = [...scope.querySelectorAll("label")].find((entry) => {
    const text = entry.querySelector("span")?.textContent?.trim() ?? "";
    return labelText instanceof RegExp ? labelText.test(text) : text === labelText;
  });
  const input = label?.querySelector("input, textarea, select");
  assert.ok(input, `Expected field '${labelText}'`);
  return input;
};
const click = async (node) => act(async () => { node.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
const changeInput = async (input, value) => {
  const prototype = input.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, "value").set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
async function openAction(label) {
  const actions = document.querySelector('button[aria-label="Actions"]');
  assert.ok(actions, "Existing expense has an actions menu");
  await click(actions);
  await click(button(document, label));
  return dialog();
}
const assertNoWrites = (callbacks) => {
  for (const name of ["onLog", "onEdit", "onUpload", "onVoid", "onSaveWeek", "onRequestAdjustment", "onDecideAdjustment", "onReturnTransaction", "onSaveSettings"]) {
    assert.equal(callbacks[name].mock.callCount(), 0, `${name} must not write during field editing or invalid saves`);
  }
};

beforeEach(() => {
  globalThis[apiCallsKey] = [];
  blockedFetch.mock.resetCalls();
});
afterEach(async () => {
  if (mounted) {
    await act(async () => { mounted.root.unmount(); });
    mounted.container.remove();
    mounted = undefined;
  }
  assert.deepEqual(globalThis[apiCallsKey], [], "Edit/proof tests must never reach the live API boundary");
  assert.equal(blockedFetch.mock.callCount(), 0, "No test should reach a real network request");
  document.body.replaceChildren();
});
after(async () => {
  dom.window.close();
  delete globalThis[apiCallsKey];
  for (const [key, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
  await rm(tempDir, { recursive: true, force: true });
  await rmdir(tempBase).catch((error) => { if (error.code !== "ENOTEMPTY" && error.code !== "ENOENT") throw error; });
});

test("clearing an edited expense amount keeps the normal form and validates without uploading", async () => {
  const { callbacks } = await mountFunds();
  const originalDialog = await openAction("Edit");
  const amount = field(originalDialog, /^Amount \(/);
  assert.equal(originalDialog.getAttribute("aria-label"), "Edit Expense");
  assert.equal(amount.value, "6500");
  await changeInput(amount, "");
  assert.equal(dialog(), originalDialog, "Clearing Amount must not remount the dialog");
  assert.equal(field(dialog(), /^Amount \(/), amount, "Amount input must remain the same mounted node");
  assert.equal(dialog().getAttribute("aria-label"), "Edit Expense", "Blank amount must not switch Edit into Add proof");
  assert.equal(field(dialog(), "Description").value, "Printer paper");
  await click(button(dialog(), "Save"));
  assert.match(dialog().textContent, /Enter the amount\./);
  assert.equal(field(dialog(), /^Amount \(/).value, "");
  assertNoWrites(callbacks);
});

test("replacement amount and text stay mounted and use the normal expense edit save", async () => {
  const { callbacks } = await mountFunds();
  const originalDialog = await openAction("Edit");
  const amount = field(originalDialog, /^Amount \(/);
  const description = field(originalDialog, "Description");
  await act(async () => { amount.focus(); });
  await changeInput(amount, "");
  for (const value of ["8", "82", "820", "8200"]) {
    await changeInput(amount, value);
    assert.equal(field(dialog(), /^Amount \(/), amount);
    assert.equal(document.activeElement, amount, "Typing the replacement amount must retain focus");
  }
  await changeInput(description, "Printer paper and ink");
  assert.equal(dialog(), originalDialog);
  assert.equal(field(dialog(), "Description"), description);
  assert.equal(description.value, "Printer paper and ink");
  assertNoWrites(callbacks);
  await click(button(dialog(), "Save"));
  assert.equal(callbacks.onEdit.mock.callCount(), 1);
  const [id, body] = callbacks.onEdit.mock.calls[0].arguments;
  assert.equal(id, "expense-1");
  assert.equal(body.amount, 8200);
  assert.equal(body.description, "Printer paper and ink");
  assert.equal(body.category, "office");
  assert.equal(callbacks.onUpload.mock.callCount(), 0);
  assert.equal(callbacks.onLog.mock.callCount(), 0);
  assert.equal(document.querySelector('[role="dialog"]'), null);
});

test("Add proof stays an explicit upload-only mode and still uploads a selected file", async () => {
  const { callbacks } = await mountFunds();
  const proof = await openAction("Add proof");
  assert.equal(proof.getAttribute("aria-label"), "Add proof");
  assert.equal(proof.querySelector('input[inputmode="decimal"]'), null, "Proof mode must not display the amount form");
  await click(button(proof, "Save"));
  assert.match(dialog().textContent, /Choose a file\./);
  assertNoWrites(callbacks);
  const file = new File(["test receipt"], "receipt.pdf", { type: "application/pdf" });
  const fileInput = dialog().querySelector('input[type="file"]');
  Object.defineProperty(fileInput, "files", { configurable: true, value: [file] });
  await act(async () => { fileInput.dispatchEvent(new Event("change", { bubbles: true })); });
  await click(button(dialog(), "Save"));
  assert.equal(callbacks.onUpload.mock.callCount(), 1);
  assert.deepEqual(callbacks.onUpload.mock.calls[0].arguments, ["expense-1", file]);
  assert.equal(callbacks.onEdit.mock.callCount(), 0);
  assert.equal(callbacks.onLog.mock.callCount(), 0);
  assert.equal(document.querySelector('[role="dialog"]'), null);
});

test("a same-wallet incoming refresh preserves the active unsaved expense draft", async () => {
  const { callbacks, render } = await mountFunds();
  const originalDialog = await openAction("Edit");
  const amount = field(originalDialog, /^Amount \(/);
  const description = field(originalDialog, "Description");
  await changeInput(amount, "9400");
  await changeInput(description, "Unsaved expense note");
  await act(async () => { description.focus(); });
  const incoming = makeWeek();
  incoming.transactions[0] = { ...incoming.transactions[0], amount: 7000, description: "New server copy", version: 2 };
  incoming.totals = { ...incoming.totals, spent: 7000, expected: 3000 };
  await render({ data: incoming, loading: true });
  await render({ data: structuredClone(incoming), loading: false });
  assert.equal(dialog(), originalDialog, "Background refresh must not replace the edit dialog");
  assert.equal(field(dialog(), /^Amount \(/), amount);
  assert.equal(field(dialog(), "Description"), description);
  assert.equal(amount.value, "9400");
  assert.equal(description.value, "Unsaved expense note");
  assert.equal(document.activeElement, description, "The in-progress edit must retain focus through refresh");
  assert.equal(dialog().getAttribute("aria-label"), "Edit Expense");
  assertNoWrites(callbacks);
});
