import { test } from "node:test";
import assert from "node:assert/strict";
import { intelAlerts } from "./stock-intel-alerts.js";

test("hub risk alert reads like Bright's Abuja example; a hub with enough stock says nothing", () => {
  const base = { sourceState: "FCT Abuja", productId: "p", hubLabel: "Abuja Hub", available: 40, ownDemand: 15, networkDemand: 35, required: 50, shortage: 10,
    dependents: [{ state: "Kano", agentName: "Kano Agent", locationId: "k", units: 20 }, { state: "Kaduna", agentName: "Kaduna Agent", locationId: "d", units: 15 }], dependentStates: ["Kaduna", "Kano"] };
  const [alert] = intelAlerts({ hubRisks: [base], fallbacks: [], productName: () => "Corner Shelf" });
  assert.equal(alert.type, "stock_hub_risk");
  assert.match(alert.message, /has 40 Corner Shelf\. It needs 15 for its own week and 35 for 2 agents it restocks — 10 short\. Restock Abuja/);
  assert.equal(intelAlerts({ hubRisks: [{ ...base, shortage: 0 }], fallbacks: [], productName: () => "x" }).length, 0);
});

test("transfer alert names who sends, how many, and keeps a stable link for the daily dedupe", () => {
  const chance = { locationId: "ibadan", agentName: "Ibadan Agent", state: "Oyo", productId: "p", need: 20,
    from: { kind: "hub" as const, label: "Ogun Agent", state: "Ogun", locationId: "ogun", spare: 12, units: 12, priority: 2 } };
  const a = intelAlerts({ hubRisks: [], fallbacks: [chance], productName: () => "Shelf" });
  const b = intelAlerts({ hubRisks: [], fallbacks: [chance], productName: () => "Shelf" });
  assert.equal(a[0].title, "Ibadan Agent (Oyo) can get Shelf from Ogun Agent");
  assert.match(a[0].message, /can spare 12 and still cover its own week — send 12/);
  assert.equal(a[0].link, b[0].link);
});
