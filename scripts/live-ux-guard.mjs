#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const appPath = path.join(root, "src", "App.tsx");

if (!existsSync(appPath)) {
  console.error("[live-ux-guard] Missing src/App.tsx. Run this from the project root.");
  process.exit(1);
}

const app = readFileSync(appPath, "utf8");

const checks = [
  {
    name: "Global WhatsApp app picker",
    why: "Every WhatsApp action must keep the Normal WhatsApp / WhatsApp Business choice modal.",
    required: [
      "const [whatsAppPicker, setWhatsAppPicker]",
      "setWhatsAppPicker({ customerName: name, normalUrl, businessUrl });",
      "Normal WhatsApp",
      "WhatsApp Business"
    ]
  },
  {
    name: "Assigned-rep WhatsApp greeting",
    why: "Order WhatsApp messages must use the assigned non-owner user, and owner/unassigned orders should use brand-only copy.",
    required: [
      "assignedUser && assignedUser.role !== \"Owner\"",
      "${brandName} here."
    ]
  },
  {
    name: "Orders financial KPI split",
    why: "Sales reps see Bonus est.; owner/admin dashboards see Revenue in the same KPI slot.",
    required: [
      "const orderWorkspaceFinancialMetric = canViewOrderBonusEstimate",
      "label: \"Bonus est.\"",
      "label: \"Revenue\"",
      "orderWorkspaceFinancialMetric,"
    ]
  },
  {
    name: "Orders workspace pages",
    why: "Orders, Follow-up Queue, and Closed Orders must stay as first-class restored workspace pages.",
    required: [
      "type OrderWorkspacePage = \"Orders\" | \"Follow-up Queue\" | \"Closed Orders\";",
      "Queue Total",
      "Closed Total",
      "orderWorkspacePage === \"Follow-up Queue\"",
      "orderWorkspacePage === \"Closed Orders\""
    ]
  },
  {
    name: "Cart details customer journey",
    why: "Cart Details must keep the restored Customer Journey analytics and timeline UX.",
    required: [
      "selectedCartJourneyEvents",
      "Customer Journey",
      "Journey events",
      "cartJourneyTitle(event)",
      "cartJourneyDetail(event)"
    ]
  },
  {
    name: "Ad Tracking tracked orders layout",
    why: "Tracked Orders in Ad Tracking must keep the restored attributed Orders section, mobile cards, and pagination.",
    required: [
      "const CAMP_PAGE = 25;",
      "const pagedTrackedOrders =",
      "All orders placed via tracked links.",
      "pagedTrackedOrders.map((order) =>",
      "campTotalPages > 1"
    ]
  },
  {
    name: "Global mobile topbar and content offset",
    why: "Admin mobile pages need the restored fixed topbar and matching content offset from Dashboard through Settings.",
    required: [
      "app-topbar fixed inset-x-0 top-0 z-30",
      "lg:static lg:z-auto",
      "overflow-y-auto px-4 pt-16 pb-2"
    ]
  },
  {
    name: "Mobile-safe date range calendar",
    why: "The shared date range picker must stay viewport-sized and scrollable on mobile.",
    required: [
      "w-[min(640px,calc(100vw-1rem))]",
      "max-w-[calc(100vw-1rem)]",
      "max-h-[min(80vh,42rem)]",
      "overflow-y-auto"
    ]
  },
  {
    name: "Sales rep motivator bonus coach",
    why: "The first Sales Rep Motivator Bonus UX must stay as the simple four-card coach with the owner/admin bonus challenge, named opportunities, and the best-order jump.",
    required: [
      "repBonusOpportunityByOrderId",
      "Bonus Coach",
      "Weekly top-performer challenge",
      "Set an extra winner bonus outside product/order bonus rules.",
      "setTopPerformerBonusEnabled(!topPerformerBonusEnabled)",
      "topPerformerBonusAmount",
      "Bonus earned",
      "Open pipeline",
      "Delivery rate",
      "Next unlock",
      "Open best order",
      "Named opportunity",
      "No specific bonus push is blocking you right now. Keep converting and delivering assigned orders."
    ],
    forbidden: [
      "const repBonusZeroState",
      "const repBonusEarnedProgressPercent",
      "const repBonusPipelineProgressPercent",
      "Tier progress",
      "Delivery-rate gate",
      "No live bonus opportunity is open yet.",
      "First successful delivery starts your rate progress.",
      "Start with your first confirmed-to-delivered order this week to unlock bonus progress."
    ]
  }
];

const failures = [];

for (const check of checks) {
  const missing = check.required.filter((needle) => !app.includes(needle));
  const presentForbidden = (check.forbidden ?? []).filter((needle) => app.includes(needle));
  if (missing.length > 0 || presentForbidden.length > 0) {
    failures.push({ ...check, missing, presentForbidden });
  }
}

if (failures.length > 0) {
  console.error("\n[live-ux-guard] Restored live UX guard failed.\n");
  for (const failure of failures) {
    console.error(`- ${failure.name}`);
    console.error(`  Why: ${failure.why}`);
    for (const missing of failure.missing) {
      console.error(`  Missing marker: ${missing}`);
    }
    for (const forbidden of failure.presentForbidden ?? []) {
      console.error(`  Forbidden marker still present: ${forbidden}`);
    }
  }
  console.error("\nThis usually means a localhost feature branch was based on an older App.tsx and dropped restored live UX.");
  console.error("Rebase/merge latest origin/main, re-apply the feature, then run: npm run guard:live-ui\n");
  process.exit(1);
}

console.log(`[live-ux-guard] ${checks.length} restored UX checks passed.`);
