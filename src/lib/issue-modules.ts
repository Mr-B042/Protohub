// "Where did this happen?" for Issue Management (Bright, 9 Oct 2026): the
// person's own pages, then that page's real tabs when it has them. Anything
// without tabs offers the common parts of a page.

export const PAGE_TABS: Record<string, string[]> = {
  "Tracking Hub": ["Overview", "Data Sources", "Websites", "Tracking Links", "Event Ledger", "Reconciliation", "Ad Spend", "Diagnostics", "Settings"],
  "Manager Dashboard": ["Overview", "Targets & Incentives", "Bonus & Performance", "Upsell & Cross-Sell Bonus", "Upsell Performance", "Team Challenges", "Weekly Reports", "Inventory", "Needs Attention"],
  "Finance & Accounting": ["Cash Flow", "Financial Overview", "Reports", "Weekly Accounting", "Sales Rep Finance", "Agent Costs", "Delivery Fee Audit", "Remittance", "Profit & Loss", "Product Profitability", "Package Performance", "State Performance", "Profitability"],
  "Sales Rep Workspace": ["Dashboard", "My Targets & Incentives", "Team Challenges", "Bonuses", "Upsell & Cross-sell Log", "Products & Stock", "Orders", "Scheduled Deliveries", "Abandoned Carts", "Customers", "Leaderboard", "Notifications", "Settings"],
  "Recovery Rep Dashboard": ["Overview", "Work Queue", "Activity Sheet", "Customer Retention"],
  "Head of Sales Rep": ["Overview", "Weekly Scorecard", "Team Performance", "Rep Coaching", "Upsell & Cross-sell", "Sales Scripting", "Script Usage Report", "Weekly Report", "Bonus & Payouts"],
  "Inventory & Logistics Operations": ["Demand Detected", "Check Stock", "Plan Movement", "Assign Carrier", "Create Waybill", "Pickup", "In Transit", "Receive & Confirm", "Reconcile"],
  "Expenses": ["Expenses list", "Add Expense form", "Funds & Expenses (manager wallet)"],
  "Orders": ["Orders list", "Order Details pop-up", "Filters or search", "Change status", "Delivery fee", "Assign rep or agent"],
  "Abandoned Carts": ["Cart list", "Cart details", "Follow-up log", "Auto hand-out"],
  "Weekly Reports": ["My weekly report", "Manager review", "Owner approval", "Report history"],
  "Personal Delivery Agents": ["Overview", "Applications & KYC", "Active Agents", "Agent Access", "Orders & Dispatch", "Inventory", "COD & Reconciliation", "Incidents", "Reports", "Settings"]
};
export const PAGE_PARTS = ["The whole page", "A pop-up or form", "A table or list", "A button", "A number or chart", "Filters or search", "Something else"];
export const partsFor = (module: string) => PAGE_TABS[module] ?? PAGE_PARTS;
/** Pages people report on that are not a sidebar entry. */
export const EXTRA_MODULES = ["Login / sign in", "Phone app / notifications", "Public order form", "Other"];
