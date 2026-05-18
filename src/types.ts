import { LucideIcon } from "lucide-react";

export type Period = "Today" | "This Week" | "This Month" | "This Year" | "Custom";
export type CurrencyCode = "NGN" | "USD" | "GBP";
export type ProductCurrencyCode = "NGN" | "GHS" | "USD" | "GBP" | "EUR";
export type ModalType = "createTeam" | "notifications" | "help" | "signout" | "carts" | "addProduct" | "updateStock" | "addSalesRep" | "addAgent" | "setRate" | "addExpense" | "addUser" | "editUser" | "resetUserPassword" | "deleteUser" | "productDetails" | "deleteProduct" | "addPricing" | "editPricing" | "addPackage" | "editPackage" | "deletePackage" | "createOrder" | "orderDetails" | "orderWorkflow" | "changeOrderStatus" | "editOrderCustomer" | "editOrderItems" | "deleteOrder" | "reassignOrder" | "sendToAgent" | "scheduleOrder" | "cartDetails" | "convertCart" | "assignCart" | "agentDetails" | "assignAgentStock" | "reconcileAgentStock" | "editAgent" | "deleteAgent" | "salesRepDetails" | "editSalesRep" | "recordRemittance" | "bonusSettings" | "stateAvailability" | "addCrossSell" | "addFreeGift" | "manualBonus" | "addPenalty" | "editProduct" | "createWaybill" | "editWaybill" | "flagCustomer" | "newStockCount" | "stockCountEntry" | "adjustStockCount" | null;

export type ActivePage =
  | "Dashboard" | "Orders" | "Abandoned Carts" | "Scheduled Deliveries" | "Deliveries"
  | "Inventory" | "Sales Reps" | "Sales Teams" | "Sales Rep Workspace" | "Call Rep Console" | "Weekend Stock Summary" | "Agents"
  | "Waybill" | "Payroll" | "Customers" | "Expenses" | "Finance & Accounting"
  | "Ad Tracking" | "User Management" | "Round-Robin" | "Embed Form"
  | "Notifications" | "Settings";

export type OrderStatus = "All Orders" | "New" | "Confirmed" | "In Process" | "Dispatched" | "Delivered" | "Cancelled" | "Postponed" | "Failed";
export type OrderSource = "All Sources" | "TikTok" | "Facebook" | "Instagram" | "WhatsApp" | "Website";
export type OrderLocation = "All Locations" | "Lagos" | "Abuja" | "Port Harcourt" | "Ibadan";
export type CartStatus = "All statuses" | "Open abandoned" | "In progress" | "Abandoned" | "Assigned" | "Contacted" | "Converted" | "No response" | "Not interested";
export type DeliveryAgent = string;
export type ScheduleRange = "Today" | "Tomorrow" | "Next tomorrow";
export type RepStatus = "All statuses" | "Active" | "Inactive";
export type AgentZone = string;
export type AgentStatus = "All Status" | "Active" | "Order in Progress" | "Inactive";
export type PayrollTab = "Pay Rates" | "Run Payroll" | "History";
export type CustomerSource = "Source: All" | "TikTok" | "Facebook" | "WhatsApp" | "Website";
export type FinanceTab = "Financial Overview" | "Sales Rep Finance" | "Agent Costs" | "Remittance" | "Profit & Loss" | "Product Profitability" | "State Performance";
export type ExpenseType = "Ad Spend" | "Delivery" | "Clearing & Shipping" | "Waybill" | "Airtime & Data" | "Other";
export type ExpenseFilter = "All Types" | ExpenseType;
export type UserRole = "All Roles" | "Admin" | "Manager" | "Sales Rep" | "Inventory Manager" | "Viewer";
export type UserStatus = "All Status" | "Active" | "Inactive";
export type RoundRobinTab = "Active Sequence" | "Temporarily Excluded";
export type EmbedTab = "Create Order Form" | "Generate";
export type NotificationFilter = "All" | "Unread";
export type InventoryView = "dashboard" | "history" | "pricing" | "packages" | "stockcount" | "state-stock";
export type EmbedCodeTab = "Direct Link" | "HTML/Iframe" | "Elementor";
export type StockMovementType = "Stock Added" | "Distributed to Agent" | "Order Fulfilled" | "Return" | "Correction" | "Waybill Out" | "Waybill In";
export type WaybillStatus = "In Transit" | "Received" | "Returned" | "Cancelled" | "Defective" | "Missing";
export type StockCountStatus = "Pending" | "Agent Submitted" | "Admin Confirmed" | "Verified" | "Discrepancy";
export type WriteOffReason = "Damaged" | "Theft" | "Unreported Sale" | "Return to Warehouse" | "Other";

export type StockCountEntry = {
  id: string;
  productId: string;
  productName: string;
  agentId: string;
  agentName: string;
  systemQty: number;
  agentCount?: number;
  adminCount?: number;
  agentSubmittedAt?: string;
  adminConfirmedAt?: string;
  status: StockCountStatus;
  verifiedAt?: string;
  variance?: number;
  notes?: string;
};

export type StockCountSession = {
  id: string;
  title: string;
  createdAt: string;
  closedAt?: string;
  createdBy: string;
  status: "Open" | "Closed";
  entries: StockCountEntry[];
};

export type WaybillRecord = {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  waybillFee: number;
  logisticsPartner: string;
  sendingState: string;
  receivingState: string;
  fromAgentId?: string;
  toAgentId?: string;
  dateSent: string;
  dateReceived?: string;
  status: WaybillStatus;
  note?: string;
  createdBy: string;
  createdAt: string;
};

export type RepConsoleTab = "Dashboard" | "Products" | "Orders" | "Scheduled Deliveries" | "Abandoned Carts" | "Customers" | "Leaderboard" | "Notifications" | "Settings";
export type CustomerFlag = { flagged: boolean; reason: string; flaggedAt: string };
export type CallOutcome = string;
export type SystemNotification = { id: string; type: "low_stock" | "remittance_overdue" | "info"; message: string; read: boolean; createdAt: string; productId?: string };
export type RepOrderStatusTab = "All Orders" | "Pending" | "Confirmed" | "Follow-up";
export type CreateOrderContext = "admin" | "rep";
export type DateRange = { start: string; end: string };
export type EditableUserRole = "Owner" | "Admin" | "Manager" | "Sales Rep" | "Inventory Manager" | "Viewer";
export type UserPermission =
  | "create_orders" | "edit_orders" | "delete_orders" | "change_order_status" | "reassign_orders"
  | "manage_inventory" | "manage_products"
  | "view_weekend_stock_summary"
  | "manage_agents"
  | "view_finance" | "view_reports"
  | "manage_users" | "manage_settings";

export type SalesTeam = {
  id: string;
  name: string;
  leadId?: string;
};

export type ManagedUser = {
  id: string;
  name: string;
  email: string;
  role: EditableUserRole;
  active: boolean;
  created: string;
  lastSeenAt?: string;
  permissions?: UserPermission[];
  agentBalanceScopeMode?: "all" | "states" | "agents" | "assigned_agents";
  agentBalanceStateScope?: string[];
  agentBalanceAgentIds?: string[];
  assignedAgentIds?: string[];
};

export type PayStructureType = "Per Delivered Order" | "Fixed Salary" | "Hybrid" | "Performance Bonus";
export type ProductPricing = {
  currency: ProductCurrencyCode;
  sellingPrice: number;
  unitCost: number;
  isPrimary?: boolean;
};

export type PackageCompanion = {
  companionId?: string;
  productId: string;
  packageId?: string | null;
  quantity: number;
  pricingMode?: "free" | "fixed" | "use_product_price" | "standard";
  fixedPrice?: number | null;
  stateFilterMode?: "all" | "allow" | "block";
  stateRestrictions?: string[];
  autoInclude?: boolean;
  placement?: "inline" | "upsell";
  pitch?: string;
  badgeText?: string;
  headline?: string;
  ctaText?: string;
  declineText?: string;
  imageUrl?: string;
  videoUrl?: string;
  embedHtml?: string;
  priority?: number;
  displayMode?: "compact" | "card";
};

export type PackageComponent = {
  componentId?: string;
  productId: string;
  quantity: number;
  isFreeGift?: boolean;
  note?: string;
};

export type ProductPackage = {
  id: string;
  name: string;
  description: string;
  quantity: number;
  price: number;
  currency: ProductCurrencyCode;
  displayOrder: number;
  active: boolean;
  companions?: PackageCompanion[];
  packageComponents?: PackageComponent[];
  offerSyncEnabled?: boolean;
  offerSyncSourceProductId?: string | null;
  offerSyncSourcePackageId?: string | null;
};

export type PackBonusRule = {
  id: string;
  quantity: number;
  amount: number;
};

export type UpgradeBonusRule = {
  id: string;
  fromQty: number;
  toQty: number;
  amount: number;
};

export type AovBonusRule = {
  id: string;
  threshold: number;
  amount: number;
};

export type DeliveryRateBonusRule = {
  id: string;
  ratePercent: number;
  amount: number;
};

export type ProductBonusConfig = {
  baseDelivered: PackBonusRule[];
  upgradeBonuses: UpgradeBonusRule[];
  manualOrderBonuses: PackBonusRule[];
  crossSellPercent: number;
  crossSellFixed: number;
  freeGiftBonus: number;
  aovBonuses: AovBonusRule[];
  deliveryRateBonuses: DeliveryRateBonusRule[];
  upgradeRequiresMinDeliveryRate: number;
  aovRequiresMinDeliveryRate: number;
  deliveryRateMinOrders: number;
  poorDeliveryRatePercent: number;
};

export type ProductRole = "Main" | "Cross-sell" | "Free Gift";
export type ProductCatalogType = "standard" | "combo_only";

export type Product = {
  id: string;
  name: string;
  description: string;
  sku: string;
  active: boolean;
  reorderPoint: number;
  warehouseStock: number;
  agentStock: number;
  unitsSold: number;
  pricings: ProductPricing[];
  packages: ProductPackage[];
  packageDescription: string;
  createdAt: string;
  availableStates?: string[];
  bonusConfig?: ProductBonusConfig;
  role?: ProductRole;
  catalogType?: ProductCatalogType;
  canBeCrossSell?: boolean;
  canBeFreeGift?: boolean;
  crossSellProductIds?: string[];
  crossSellPriceOverrides?: { [productId: string]: number };
  crossSellStateRestrictions?: { [productId: string]: string[] };
  freeGiftProductIds?: string[];
  freeGiftStateRestrictions?: { [productId: string]: string[] };
  formCustomText?: string;
};

export type CrossSellLine = {
  id: string;
  productId?: string;
  packageId?: string;
  packageName?: string;
  packageQuantity?: number;
  packageComponentsSnapshot?: PackageComponentSnapshotLine[];
  productName: string;
  quantity: number;
  amount: number;
  selectionSource?: "public_form" | "public_upsell" | "manual_rep" | "auto_include";
};

export type PackageComponentSnapshotLine = {
  componentId?: string;
  productId: string;
  productName: string;
  quantity: number;
  isFreeGift?: boolean;
  note?: string;
  sourceType?: "base_product" | "package_component" | "cross_sell" | "free_gift";
};

export type FreeGiftLine = {
  id: string;
  productId?: string;
  productName: string;
  quantity: number;
};

export type OrderInventoryComponentSnapshot = {
  componentId?: string;
  productId?: string;
  productName: string;
  quantity: number;
  isFreeGift?: boolean;
  note?: string;
  sourceType?: "base_product" | "package_component" | "cross_sell" | "free_gift";
};

export type RepPenaltyType =
  | "Fake Upgrade"
  | "Wrong Data Entry"
  | "Missed Recovery"
  | "Poor Delivery Rate"
  | "Order Source Manipulation"
  | "Unprofessional Conduct"
  | "Negligence"
  | "Other";

export type RepPenaltyRecord = {
  id: string;
  repId: string;
  repName: string;
  type: RepPenaltyType;
  amount: number;
  removeAllBonuses: boolean;
  weekKey?: string;
  orderId?: string;
  reason: string;
  date: string;
  by: string;
};

export type Penalty = RepPenaltyRecord;

export type StockMovement = {
  id: string;
  date: string;
  productId: string;
  productName: string;
  type: StockMovementType;
  qty: number;
  balanceAfter: number;
  agent?: string;
  order?: string;
  by: string;
  note?: string;
};

export type CustomerRecord = {
  id: string;
  name: string;
  email: string;
  phone: string;
  orders: number;
  successful: number;
  cancelled: number;
  totalSpend: number;
  source: string;
};

export type TrackedOrder = {
  id: string;
  productId?: string;
  packageId?: string;
  customer: string;
  phone: string;
  whatsapp?: string;
  email?: string;
  address?: string;
  city?: string;
  state?: string;
  productName: string;
  packageName: string;
  quantity?: number;
  amount: number;
  currency: ProductCurrencyCode;
  utmSource: string;
  utmCampaign: string;
  utmContent?: string;
  utmMedium?: string;
  source?: Exclude<OrderSource, "All Sources">;
  status?: Exclude<OrderStatus, "All Orders">;
  response?: string;
  location?: string;
  deliveryWindow?: string;
  createdAt?: string;
  scheduledDate?: string;
  deliveredDate?: string;
  assignedRepId?: string;
  assignedByUserId?: string;
  assignedByNameSnapshot?: string;
  agentId?: string;
  stockDeducted?: boolean;
  logisticsCost?: number;
  amountRemitted?: number;
  remittanceStatus?: "Pending" | "Partial" | "Paid";
  callOutcome?: CallOutcome;
  buyerHealth?: "healthy" | "watch" | "at_risk" | "not_serious_candidate";
  followUpAttemptCount?: number;
  lastContactAttemptAt?: string;
  lastContactAttemptOutcome?: string;
  nextFollowUpAt?: string;
  overdueFollowUpCount?: number;
  upsellFromQty?: number;
  upsellToQty?: number;
  upsellNote?: string;
  crossSellLines?: CrossSellLine[];
  freeGiftLines?: FreeGiftLine[];
  manualBonusOverride?: number;
  manualBonusReason?: string;
  bonusManuallyAdjusted?: boolean;
  notes?: OrderNote[];
  date: string;
};

export type OrderNote = {
  id: string;
  text: string;
  by: string;
  date: string;
  followUpDate?: string;
  followUpAt?: string;
};

export type FollowUpTask = {
  id: string;
  orderId: string;
  assignedRepId?: string;
  taskType: "callback" | "payment_check" | "delivery_confirmation" | "waybill_follow_up";
  priority: "same_day" | "normal" | "low_intent";
  status: "open" | "due" | "overdue" | "completed" | "cancelled";
  effectiveStatus?: "open" | "due" | "overdue" | "completed" | "cancelled";
  dueAt: string;
  slaMinutes?: number;
  note?: string;
  sourceKind?: string;
  sourceRef?: string;
  completedAt?: string;
  createdAt?: string;
};

export type OrderContactAttempt = {
  id: string;
  orderId: string;
  taskId?: string;
  repId?: string;
  attemptedAt: string;
  channel: "call" | "whatsapp" | "sms" | "manual";
  attemptType: "scheduled_callback" | "fresh_follow_up" | "delivery_confirmation" | "payment_follow_up" | "waybill_follow_up";
  outcomeCode: string;
  outcomeGroup?: "progress" | "recoverable" | "unreachable" | "closed_loss" | "other";
  recoveryBucket?: "ready_now" | "call_tomorrow" | "call_in_2_3_days" | "salary_wait" | "spouse_approval" | "wants_discount" | "asked_for_whatsapp" | "no_answer" | "switched_off" | "line_busy" | "not_interested" | "wrong_number" | "out_of_coverage";
  outcomeNote?: string;
  customerReached?: boolean;
  nextActionType?: "callback" | "payment_check" | "delivery_confirmation" | "waybill_follow_up";
  nextActionAt?: string;
  promiseWindow?: "same_day" | "tomorrow" | "later";
};

export type AbandonedCartRecord = {
  id: string;
  customer: string;
  phone: string;
  whatsapp?: string;
  email?: string;
  city?: string;
  state?: string;
  productId?: string;
  packageId?: string;
  productName: string;
  packageName: string;
  amount: number;
  currency: ProductCurrencyCode;
  source: Exclude<OrderSource, "All Sources">;
  status: Exclude<CartStatus, "All statuses">;
  assignedRepId?: string;
  lastActivity: string;
  createdAt: string;
};

export type DeliveryAgentRecord = {
  id: string;
  name: string;
  phone: string;
  zone: string;
  address: string;
  active: boolean;
  created: string;
};

export type AgentStockRecord = {
  agentId: string;
  productId: string;
  quantity: number;
  defective: number;
  missing: number;
};

export type ExpenseRecord = {
  id: string;
  type: ExpenseType;
  amount: number;
  currency: CurrencyCode;
  date: string;
  productId?: string;
  productName: string;
  description: string;
};

export type BonusTier = { threshold: number; amount: number };
export type PayStructure = {
  userId: string;
  type: PayStructureType;
  fixedSalary: number;
  commissionRate: number;
  bonusTiers: BonusTier[];
  updatedAt: string;
};

export type PayrollRow = {
  userId: string;
  name: string;
  delivered: number;
  fixedSalary: number;
  commission: number;
  autoBonus?: number;
  deductions?: number;
  total: number;
};

export type PayrollRun = {
  id: string;
  month: string;
  label: string;
  notes: string;
  total: number;
  createdAt: string;
  rows: PayrollRow[];
  topPerformer?: { names: string[]; amountEach: number; delivered: number };
};
