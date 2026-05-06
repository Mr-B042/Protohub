import { type Dispatch, type SetStateAction, useEffect, useState } from "react";
import {
  ArrowRight,
  Archive,
  Bell,
  ChevronRight,
  CalendarDays,
  CalendarClock,
  BadgeCheck,
  Banknote,
  BookOpen,
  BellOff,
  Bot,
  Clock,
  ChevronLeft,
  CheckCircle2,
  CircleDollarSign,
  Copy,
  Download,
  Eye,
  ExternalLink,
  Filter,
  HelpCircle,
  Headphones,
  History,
  HandCoins,
  Info,
  KeyRound,
  LogOut,
  Menu,
  MessageCircle,
  Moon,
  Boxes,
  PackageCheck,
  PackagePlus,
  Flame,
  Pencil,
  Plus,
  RefreshCw,
  Repeat2,
  Search,
  Sparkles,
  BadgeDollarSign,
  Trash2,
  Truck,
  Upload,
  UserPlus,
  UserRound,
  Users,
  ShoppingBag,
  ShoppingCart,
  Sun,
  Tag,
  ToggleLeft,
  ToggleRight,
  TrendingUp,
  Music2,
  Globe,
  AlertTriangle,
  CircleX,
  ClipboardCheck,
  X,
  Zap
} from "lucide-react";
import { auth } from "./lib/auth";
import { realtimeClient } from "./lib/realtime";
import {
  productsApi, ordersApi, agentsApi, stockApi,
  expensesApi, waybillsApi, notificationsApi, customersApi, teamApi, authApi, stockApi as _stockApi
} from "./lib/api";
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import {
  cartStats,
  emptyProductsIcon,
  navItems,
  revenueData,
  summaryCards
} from "./data";

type Period = "Today" | "This Week" | "This Month" | "This Year" | "Custom";
type CurrencyCode = "NGN" | "USD" | "GBP";
type ProductCurrencyCode = "NGN" | "GHS" | "USD" | "GBP" | "EUR";
type ModalType = "createTeam" | "tokens" | "notifications" | "help" | "signout" | "carts" | "addProduct" | "updateStock" | "addSalesRep" | "addAgent" | "setRate" | "addExpense" | "addUser" | "editUser" | "resetUserPassword" | "deleteUser" | "productDetails" | "deleteProduct" | "addPricing" | "editPricing" | "addPackage" | "editPackage" | "deletePackage" | "createOrder" | "orderDetails" | "orderWorkflow" | "changeOrderStatus" | "editOrderCustomer" | "editOrderItems" | "deleteOrder" | "reassignOrder" | "sendToAgent" | "scheduleOrder" | "cartDetails" | "convertCart" | "assignCart" | "agentDetails" | "assignAgentStock" | "reconcileAgentStock" | "editAgent" | "deleteAgent" | "salesRepDetails" | "editSalesRep" | "recordRemittance" | "bonusSettings" | "stateAvailability" | "addCrossSell" | "addFreeGift" | "manualBonus" | "addPenalty" | "editProduct" | "createWaybill" | "editWaybill" | "flagCustomer" | "newStockCount" | "stockCountEntry" | "adjustStockCount" | null;
type ActivePage = "Dashboard" | "Orders" | "Abandoned Carts" | "Scheduled Deliveries" | "Deliveries" | "Inventory" | "Sales Reps" | "Sales Teams" | "Call Rep Console" | "Agents" | "Waybill" | "Payroll" | "Customers" | "Expenses" | "Finance & Accounting" | "Ad Tracking" | "User Management" | "Round-Robin" | "Embed Form" | "AI Agent" | "AI Sandbox" | "AI/SMS Tokens" | "Notifications" | "Settings";
type OrderStatus = "All Orders" | "New" | "Confirmed" | "In Process" | "Dispatched" | "Delivered" | "Cancelled" | "Postponed" | "Failed";
type OrderSource = "All Sources" | "TikTok" | "Facebook" | "WhatsApp" | "Website";
type OrderLocation = "All Locations" | "Lagos" | "Abuja" | "Port Harcourt" | "Ibadan";
type CartStatus = "All statuses" | "Open abandoned" | "In progress" | "Abandoned" | "Assigned" | "Contacted" | "Converted" | "No response" | "Not interested";
type DeliveryAgent = string;
type ScheduleRange = "Today" | "Tomorrow" | "Next tomorrow";
type RepStatus = "All statuses" | "Active" | "Inactive";
type AgentZone = string;
type AgentStatus = "All Status" | "Active" | "Order in Progress" | "Inactive";
type PayrollTab = "Pay Rates" | "Run Payroll" | "History";
type CustomerSource = "Source: All" | "TikTok" | "Facebook" | "WhatsApp" | "Website";
type FinanceTab = "Financial Overview" | "Sales Rep Finance" | "Agent Costs" | "Remittance" | "Profit & Loss" | "Product Profitability" | "State Performance";
type ExpenseType = "Ad Spend" | "Delivery" | "Clearing & Shipping" | "Waybill" | "Airtime & Data" | "Other";
type ExpenseFilter = "All Types" | ExpenseType;
type UserRole = "All Roles" | "Admin" | "Sales Rep" | "Inventory Manager";
type UserStatus = "All Status" | "Active" | "Inactive";
type RoundRobinTab = "Active Sequence" | "Temporarily Excluded";
type EmbedTab = "Create Order Form" | "Generate";
type NotificationFilter = "All" | "Unread";
type InventoryView = "dashboard" | "history" | "pricing" | "packages" | "stockcount";
type EmbedCodeTab = "Direct Link" | "HTML/Iframe" | "Elementor";
type StockMovementType = "Stock Added" | "Distributed to Agent" | "Order Fulfilled" | "Return" | "Correction" | "Waybill Out" | "Waybill In";
type WaybillStatus = "In Transit" | "Received" | "Returned" | "Cancelled";
type StockCountStatus = "Pending" | "Agent Submitted" | "Admin Confirmed" | "Verified" | "Discrepancy";
type WriteOffReason = "Damaged" | "Theft" | "Unreported Sale" | "Return to Warehouse" | "Other";
type StockCountEntry = {
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
type StockCountSession = {
  id: string;
  title: string;
  createdAt: string;
  closedAt?: string;
  createdBy: string;
  status: "Open" | "Closed";
  entries: StockCountEntry[];
};
type WaybillRecord = {
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
type RepConsoleTab = "Dashboard" | "Products" | "Orders" | "Scheduled Deliveries" | "Abandoned Carts" | "Customers" | "Leaderboard" | "Notifications" | "Settings";
type CustomerFlag = { flagged: boolean; reason: string; flaggedAt: string };
type CallOutcome = "Confirmed" | "No Answer" | "Wrong Number" | "Refused" | "Scheduled Callback" | "Not Reached";
type SystemNotification = { id: string; type: "low_stock" | "remittance_overdue" | "info"; message: string; read: boolean; createdAt: string; productId?: string };
type RepOrderStatusTab = "All Orders" | "Pending" | "Confirmed" | "Follow-up";
type CreateOrderContext = "admin" | "rep";
type DateRange = { start: string; end: string };
type EditableUserRole = "Owner" | "Admin" | "Sales Rep" | "Inventory Manager";
type UserPermission =
  | "create_orders" | "edit_orders" | "delete_orders" | "change_order_status" | "reassign_orders"
  | "manage_inventory" | "manage_products"
  | "manage_agents"
  | "view_finance" | "view_reports"
  | "manage_users" | "manage_settings";
type ManagedUser = {
  id: string;
  name: string;
  email: string;
  role: EditableUserRole;
  active: boolean;
  created: string;
  permissions?: UserPermission[];
};
type PayStructureType = "Commission" | "Fixed Salary" | "Fixed + Commission";
type ProductPricing = {
  currency: ProductCurrencyCode;
  sellingPrice: number;
  unitCost: number;
  primary?: boolean;
};
type ProductPackage = {
  id: string;
  name: string;
  description: string;
  quantity: number;
  price: number;
  currency: ProductCurrencyCode;
  displayOrder: number;
  active: boolean;
};
type PackBonusRule = {
  id: string;
  quantity: number;
  amount: number;
};
type UpgradeBonusRule = {
  id: string;
  fromQty: number;
  toQty: number;
  amount: number;
};
type AovBonusRule = {
  id: string;
  threshold: number;
  amount: number;
};
type DeliveryRateBonusRule = {
  id: string;
  ratePercent: number;
  amount: number;
};
type ProductBonusConfig = {
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
type ProductRole = "Main" | "Cross-sell" | "Free Gift";
type Product = {
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
  canBeCrossSell?: boolean;
  canBeFreeGift?: boolean;
  crossSellProductIds?: string[];
  crossSellPriceOverrides?: { [productId: string]: number };
  crossSellStateRestrictions?: { [productId: string]: string[] };
  freeGiftProductIds?: string[];
  freeGiftStateRestrictions?: { [productId: string]: string[] };
  formCustomText?: string;
};
type CrossSellLine = {
  id: string;
  productId?: string;
  productName: string;
  quantity: number;
  amount: number;
};
type FreeGiftLine = {
  id: string;
  productId?: string;
  productName: string;
  quantity: number;
};
type RepPenaltyType =
  | "Fake Upgrade"
  | "Wrong Data Entry"
  | "Missed Recovery"
  | "Poor Delivery Rate"
  | "Order Source Manipulation"
  | "Unprofessional Conduct"
  | "Negligence"
  | "Other";
type RepPenaltyRecord = {
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
type StockMovement = {
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
type TrackedOrder = {
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
  source?: Exclude<OrderSource, "All Sources">;
  status?: Exclude<OrderStatus, "All Orders">;
  response?: string;
  location?: string;
  deliveryWindow?: string;
  createdAt?: string;
  scheduledDate?: string;
  deliveredDate?: string;
  assignedRepId?: string;
  agentId?: string;
  stockDeducted?: boolean;
  logisticsCost?: number;
  amountRemitted?: number;
  remittanceStatus?: "Pending" | "Partial" | "Paid";
  callOutcome?: CallOutcome;
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
type OrderNote = {
  id: string;
  text: string;
  by: string;
  date: string;
  followUpDate?: string;
};
type AbandonedCartRecord = {
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
type DeliveryAgentRecord = {
  id: string;
  name: string;
  phone: string;
  zone: string;
  address: string;
  active: boolean;
  created: string;
};
type AgentStockRecord = {
  agentId: string;
  productId: string;
  quantity: number;
  defective: number;
  missing: number;
};
type ExpenseRecord = {
  id: string;
  type: ExpenseType;
  amount: number;
  currency: CurrencyCode;
  date: string;
  productId?: string;
  productName: string;
  description: string;
};
type PayStructure = {
  userId: string;
  type: PayStructureType;
  fixedSalary: number;
  commissionRate: number;
  updatedAt: string;
};
type PayrollRun = {
  id: string;
  month: string;
  label: string;
  notes: string;
  total: number;
  createdAt: string;
  rows: { userId: string; name: string; delivered: number; fixedSalary: number; commission: number; autoBonus?: number; deductions?: number; total: number }[];
};

const periods: Period[] = ["Today", "This Week", "This Month", "This Year"];

const currencies: Record<CurrencyCode, { label: string; locale: string; currency: string }> = {
  NGN: { label: "Nigerian Naira", locale: "en-NG", currency: "NGN" },
  USD: { label: "US Dollar", locale: "en-US", currency: "USD" },
  GBP: { label: "British Pound", locale: "en-GB", currency: "GBP" }
};

const productCurrencies: Record<ProductCurrencyCode, { label: string; symbol: string; locale: string; currency: string }> = {
  NGN: { label: "Nigerian Naira", symbol: "₦", locale: "en-NG", currency: "NGN" },
  GHS: { label: "Ghanaian Cedi", symbol: "₵", locale: "en-GH", currency: "GHS" },
  USD: { label: "US Dollar", symbol: "$", locale: "en-US", currency: "USD" },
  GBP: { label: "British Pound", symbol: "£", locale: "en-GB", currency: "GBP" },
  EUR: { label: "Euro", symbol: "€", locale: "de-DE", currency: "EUR" }
};

const nigeriaStates = [
  "Abia",
  "Adamawa",
  "Akwa Ibom",
  "Anambra",
  "Bauchi",
  "Bayelsa",
  "Benue",
  "Borno",
  "Cross River",
  "Delta",
  "Ebonyi",
  "Edo",
  "Ekiti",
  "Enugu",
  "Gombe",
  "Imo",
  "Jigawa",
  "Kaduna",
  "Kano",
  "Katsina",
  "Kebbi",
  "Kogi",
  "Kwara",
  "Lagos",
  "Nasarawa",
  "Niger",
  "Ogun",
  "Ondo",
  "Osun",
  "Oyo",
  "Plateau",
  "Rivers",
  "Sokoto",
  "Taraba",
  "Yobe",
  "Zamfara"
];

const moneyValues = {
  totalRevenue: 0,
  netProfit: 0,
  currentRevenue: 0,
  ordersRevenue: 0
};

const orderStatuses: OrderStatus[] = ["All Orders", "New", "Confirmed", "In Process", "Dispatched", "Delivered", "Cancelled", "Postponed", "Failed"];
const orderSources: OrderSource[] = ["All Sources", "TikTok", "Facebook", "WhatsApp", "Website"];
const orderLocations: OrderLocation[] = ["All Locations", "Lagos", "Abuja", "Port Harcourt", "Ibadan"];
const cartStatuses: CartStatus[] = ["All statuses", "Open abandoned", "In progress", "Abandoned", "Assigned", "Contacted", "Converted", "No response", "Not interested"];
const scheduleRanges: ScheduleRange[] = ["Today", "Tomorrow", "Next tomorrow"];
const repStatuses: RepStatus[] = ["All statuses", "Active", "Inactive"];
const agentZones: AgentZone[] = ["All Zones", "Lagos Island", "Mainland", "Abuja"];
const agentStatuses: AgentStatus[] = ["All Status", "Active", "Order in Progress", "Inactive"];
const payrollTabs: PayrollTab[] = ["Pay Rates", "Run Payroll", "History"];
const customerSources: CustomerSource[] = ["Source: All", "TikTok", "Facebook", "WhatsApp", "Website"];
const financeTabs: FinanceTab[] = ["Financial Overview", "Sales Rep Finance", "Agent Costs", "Remittance", "Profit & Loss", "Product Profitability", "State Performance"];
const expenseTypes: ExpenseType[] = ["Ad Spend", "Delivery", "Clearing & Shipping", "Waybill", "Airtime & Data", "Other"];
const expenseFilters: ExpenseFilter[] = ["All Types", ...expenseTypes];
const userRoles: UserRole[] = ["All Roles", "Admin", "Sales Rep", "Inventory Manager"];
const editableUserRoles: EditableUserRole[] = ["Owner", "Admin", "Sales Rep", "Inventory Manager"];
const userStatuses: UserStatus[] = ["All Status", "Active", "Inactive"];
const roundRobinTabs: RoundRobinTab[] = ["Active Sequence", "Temporarily Excluded"];
const embedTabs: EmbedTab[] = ["Create Order Form", "Generate"];
const embedCodeTabs: EmbedCodeTab[] = ["Direct Link", "HTML/Iframe", "Elementor"];
const stockMovementTypes: ("All Types" | StockMovementType)[] = ["All Types", "Stock Added", "Distributed to Agent", "Order Fulfilled", "Return", "Correction", "Waybill Out", "Waybill In"];
const repConsoleTabs: RepConsoleTab[] = ["Dashboard", "Products", "Orders", "Scheduled Deliveries", "Abandoned Carts", "Customers", "Leaderboard", "Notifications", "Settings"];
const repOrderStatusTabs: RepOrderStatusTab[] = ["All Orders", "Pending", "Confirmed", "Follow-up"];
const repChangeStatuses: Exclude<OrderStatus, "All Orders" | "New">[] = ["Confirmed", "In Process", "Dispatched", "Delivered", "Cancelled", "Postponed", "Failed"];
const allOrderStatuses: Exclude<OrderStatus, "All Orders">[] = ["New", "Confirmed", "In Process", "Dispatched", "Delivered", "Cancelled", "Postponed", "Failed"];
const permissionDefs: { key: UserPermission; label: string; group: string }[] = [
  { key: "create_orders",       label: "Create Orders",       group: "Orders" },
  { key: "edit_orders",         label: "Edit Orders",         group: "Orders" },
  { key: "delete_orders",       label: "Delete Orders",       group: "Orders" },
  { key: "change_order_status", label: "Change Order Status", group: "Orders" },
  { key: "reassign_orders",     label: "Reassign Orders",     group: "Orders" },
  { key: "manage_inventory",    label: "Manage Inventory",    group: "Inventory" },
  { key: "manage_products",     label: "Manage Products",     group: "Inventory" },
  { key: "manage_agents",       label: "Manage Agents",       group: "Operations" },
  { key: "view_finance",        label: "View Finance",        group: "Finance" },
  { key: "view_reports",        label: "View Reports",        group: "Finance" },
  { key: "manage_users",        label: "Manage Users",        group: "Admin" },
  { key: "manage_settings",     label: "Manage Settings",     group: "Admin" },
];
const defaultPermsByRole: Record<EditableUserRole, UserPermission[]> = {
  "Owner":             permissionDefs.map((p) => p.key),
  "Admin":             ["create_orders", "edit_orders", "delete_orders", "change_order_status", "reassign_orders", "manage_inventory", "manage_products", "manage_agents", "view_finance", "view_reports"],
  "Sales Rep":         ["create_orders", "change_order_status", "reassign_orders"],
  "Inventory Manager": ["manage_inventory", "manage_products", "view_reports"],
};
const payStructureTypes: { value: PayStructureType; helper: string }[] = [
  { value: "Commission", helper: "Paid per delivered order" },
  { value: "Fixed Salary", helper: "Fixed monthly amount" },
  { value: "Fixed + Commission", helper: "Monthly salary plus per-order bonus" }
];
const userGrowthData = [
  { month: "Dec", users: 0 },
  { month: "Jan", users: 0 },
  { month: "Feb", users: 0 },
  { month: "Mar", users: 0 },
  { month: "Apr", users: 0 },
  { month: "May", users: 1 }
];

const isDateValue = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00`).getTime());

const slugify = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

const makeProductId = () => `prod-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const makePackageId = () => `pkg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const makeMovementId = () => `mov-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const makeOrderId = () => `ORD-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
const makeBonusRuleId = () => `bonus-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const makeCrossSellLineId = () => `xsell-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
const makeFreeGiftLineId = () => `gift-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
const makePenaltyId = () => `pen-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;

const defaultBonusConfig = (): ProductBonusConfig => ({
  baseDelivered: [
    { id: "base-3", quantity: 3, amount: 200 },
    { id: "base-5", quantity: 5, amount: 200 },
    { id: "base-7", quantity: 7, amount: 200 },
    { id: "base-10", quantity: 10, amount: 200 },
    { id: "base-15", quantity: 15, amount: 200 },
    { id: "base-20", quantity: 20, amount: 200 }
  ],
  upgradeBonuses: [
    { id: "up-3-5", fromQty: 3, toQty: 5, amount: 1000 },
    { id: "up-3-7", fromQty: 3, toQty: 7, amount: 1500 },
    { id: "up-3-10", fromQty: 3, toQty: 10, amount: 2000 },
    { id: "up-3-12", fromQty: 3, toQty: 12, amount: 2500 },
    { id: "up-3-15", fromQty: 3, toQty: 15, amount: 3000 },
    { id: "up-5-7", fromQty: 5, toQty: 7, amount: 1500 },
    { id: "up-5-10", fromQty: 5, toQty: 10, amount: 2000 },
    { id: "up-5-12", fromQty: 5, toQty: 12, amount: 2500 },
    { id: "up-5-15", fromQty: 5, toQty: 15, amount: 3000 },
    { id: "up-7-10", fromQty: 7, toQty: 10, amount: 2000 },
    { id: "up-7-12", fromQty: 7, toQty: 12, amount: 2500 },
    { id: "up-7-15", fromQty: 7, toQty: 15, amount: 3000 },
    { id: "up-10-12", fromQty: 10, toQty: 12, amount: 2500 },
    { id: "up-10-15", fromQty: 10, toQty: 15, amount: 3000 },
    { id: "up-12-15", fromQty: 12, toQty: 15, amount: 3000 }
  ],
  manualOrderBonuses: [
    { id: "manual-3", quantity: 3, amount: 500 },
    { id: "manual-5", quantity: 5, amount: 800 },
    { id: "manual-7", quantity: 7, amount: 1000 },
    { id: "manual-12", quantity: 12, amount: 1200 },
    { id: "manual-15", quantity: 15, amount: 1500 }
  ],
  crossSellPercent: 5,
  crossSellFixed: 0,
  freeGiftBonus: 0,
  aovBonuses: [
    { id: "aov-33", threshold: 33000, amount: 10000 },
    { id: "aov-35", threshold: 35000, amount: 20000 }
  ],
  deliveryRateBonuses: [
    { id: "dr-60", ratePercent: 60, amount: 5000 },
    { id: "dr-70", ratePercent: 70, amount: 10000 },
    { id: "dr-80", ratePercent: 80, amount: 20000 }
  ],
  upgradeRequiresMinDeliveryRate: 60,
  aovRequiresMinDeliveryRate: 60,
  deliveryRateMinOrders: 50,
  poorDeliveryRatePercent: 55
});

const productBonusConfig = (product?: Product | null): ProductBonusConfig => product?.bonusConfig ?? defaultBonusConfig();
const makeSku = (name: string) => {
  const cleanParts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((part) => part.slice(0, 3).toUpperCase());
  return `${cleanParts.join("-") || "PRD"}-${Math.floor(100 + Math.random() * 900)}`;
};

const formatProductMoney = (amount: number, code: ProductCurrencyCode) =>
  new Intl.NumberFormat(productCurrencies[code].locale, {
    style: "currency",
    currency: productCurrencies[code].currency,
    maximumFractionDigits: 0
  }).format(amount || 0);

const primaryPricing = (product: Product) => product.pricings.find((pricing) => pricing.primary) ?? product.pricings[0];
const totalProductStock = (product: Product) => product.warehouseStock + product.agentStock;
const productInventoryValue = (product: Product) => totalProductStock(product) * (primaryPricing(product)?.sellingPrice ?? 0);
const activeProductPackages = (product: Product) => product.packages.filter((item) => item.active).sort((a, b) => a.displayOrder - b.displayOrder);
const orderSourceFromUtm = (source: string): Exclude<OrderSource, "All Sources"> => {
  const normalized = source.toLowerCase();

  if (normalized.includes("tiktok")) {
    return "TikTok";
  }

  if (normalized.includes("facebook") || normalized.includes("meta")) {
    return "Facebook";
  }

  if (normalized.includes("whatsapp")) {
    return "WhatsApp";
  }

  return "Website";
};
const orderLocationFromFields = (city: string, state: string) => {
  const rawLocation = `${city} ${state}`.trim();
  const matchedLocation = orderLocations.find(
    (location) => location !== "All Locations" && rawLocation.toLowerCase().includes(location.toLowerCase())
  );

  return matchedLocation || city.trim() || state.trim() || "Lagos";
};

const statusBadgeClasses = (status: string): string => {
  const map: Record<string, string> = {
    "New":        "bg-blue-50 text-blue-700 border-blue-200",
    "Confirmed":  "bg-amber-50 text-amber-800 border-amber-400",
    "In Process": "bg-amber-50 text-amber-800 border-amber-400",
    "Dispatched": "bg-purple-50 text-purple-800 border-purple-300",
    "Delivered":  "bg-green-50 text-green-800 border-green-400",
    "Cancelled":  "bg-red-50 text-red-800 border-red-300",
    "Postponed":  "bg-stone-50 text-stone-700 border-stone-300",
    "Failed":     "bg-orange-50 text-orange-900 border-orange-300",
  };
  return map[status] ?? "bg-stone-50 text-stone-700 border-stone-300";
};

const formatDateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const monthLabel = (date: Date) =>
  new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(date);

const addMonths = (date: Date, months: number) => new Date(date.getFullYear(), date.getMonth() + months, 1);

const getCalendarDays = (monthDate: Date) => {
  const firstDay = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const startDate = new Date(firstDay);
  startDate.setDate(1 - firstDay.getDay());

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(startDate);
    date.setDate(startDate.getDate() + index);
    return {
      key: formatDateKey(date),
      day: date.getDate(),
      inMonth: date.getMonth() === monthDate.getMonth()
    };
  });
};

const chooseRangeDate = (range: DateRange, nextDate: string): DateRange => {
  if (!range.start || range.end || nextDate < range.start) {
    return { start: nextDate, end: "" };
  }

  return { start: range.start, end: nextDate };
};

const todayKey = () => formatDateKey(new Date());

const normalizeDateKey = (value?: string) => {
  if (!value) {
    return todayKey();
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? todayKey() : formatDateKey(parsed);
};

const displayDateFromKey = (value?: string) =>
  new Date(`${normalizeDateKey(value)}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

const scheduleDateForRange = (range: ScheduleRange) => {
  const date = new Date();
  date.setDate(date.getDate() + (range === "Today" ? 0 : range === "Tomorrow" ? 1 : 2));
  return formatDateKey(date);
};

const isInPeriod = (dateKey: string | undefined, activePeriod: Period, range: DateRange) => {
  const value = normalizeDateKey(dateKey);
  const now = new Date();
  const today = formatDateKey(now);
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay());

  if (activePeriod === "Custom") {
    return Boolean(range.start && range.end && value >= range.start && value <= range.end);
  }

  if (activePeriod === "Today") {
    return value === today;
  }

  if (activePeriod === "This Week") {
    return value >= formatDateKey(weekStart) && value <= today;
  }

  if (activePeriod === "This Month") {
    return value.slice(0, 7) === today.slice(0, 7);
  }

  return value.slice(0, 4) === today.slice(0, 4);
};

const daysInPeriodSoFar = (activePeriod: Period, range: DateRange) => {
  const now = new Date();
  if (activePeriod === "Custom" && range.start && range.end) {
    const start = new Date(`${range.start}T00:00:00`);
    const end = new Date(`${range.end}T00:00:00`);
    return Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1);
  }

  if (activePeriod === "Today") {
    return 1;
  }

  if (activePeriod === "This Week") {
    return now.getDay() + 1;
  }

  if (activePeriod === "This Month") {
    return now.getDate();
  }

  const yearStart = new Date(now.getFullYear(), 0, 1);
  return Math.max(1, Math.round((now.getTime() - yearStart.getTime()) / 86_400_000) + 1);
};

const fulfillmentDaysForOrder = (order: TrackedOrder) => {
  const created = new Date(`${orderCreatedKey(order)}T00:00:00`);
  const delivered = new Date(`${orderDeliveredKey(order) || orderCreatedKey(order)}T00:00:00`);
  if (Number.isNaN(created.getTime()) || Number.isNaN(delivered.getTime())) {
    return 0;
  }
  return Math.max(0, Math.round((delivered.getTime() - created.getTime()) / 86_400_000));
};

const explicitPeriodRange = (activePeriod: Period, range: DateRange, previous = false): DateRange => {
  const now = new Date();
  const today = formatDateKey(now);

  if (activePeriod === "Custom" && range.start && range.end) {
    if (!previous) {
      return range;
    }

    const start = new Date(`${range.start}T00:00:00`);
    const end = new Date(`${range.end}T00:00:00`);
    const length = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1);
    const previousEnd = new Date(start);
    previousEnd.setDate(start.getDate() - 1);
    const previousStart = new Date(previousEnd);
    previousStart.setDate(previousEnd.getDate() - length + 1);
    return { start: formatDateKey(previousStart), end: formatDateKey(previousEnd) };
  }

  if (activePeriod === "Today") {
    if (!previous) {
      return { start: today, end: today };
    }
    const date = new Date(now);
    date.setDate(now.getDate() - 1);
    const key = formatDateKey(date);
    return { start: key, end: key };
  }

  if (activePeriod === "This Week") {
    const start = new Date(now);
    start.setDate(now.getDate() - now.getDay());
    const end = new Date(now);
    if (previous) {
      start.setDate(start.getDate() - 7);
      end.setDate(end.getDate() - 7);
    }
    return { start: formatDateKey(start), end: formatDateKey(end) };
  }

  if (activePeriod === "This Month") {
    if (!previous) {
      return { start: formatDateKey(new Date(now.getFullYear(), now.getMonth(), 1)), end: today };
    }
    const previousMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastDay = new Date(now.getFullYear(), now.getMonth(), 0).getDate();
    return {
      start: formatDateKey(previousMonth),
      end: formatDateKey(new Date(previousMonth.getFullYear(), previousMonth.getMonth(), Math.min(now.getDate(), lastDay)))
    };
  }

  if (!previous) {
    return { start: formatDateKey(new Date(now.getFullYear(), 0, 1)), end: today };
  }

  return {
    start: formatDateKey(new Date(now.getFullYear() - 1, 0, 1)),
    end: formatDateKey(new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()))
  };
};

const isInExplicitRange = (dateKey: string | undefined, range: DateRange) => {
  const value = normalizeDateKey(dateKey);
  return Boolean(range.start && range.end && value >= range.start && value <= range.end);
};

const percentChange = (current: number, previous: number) => {
  if (previous === 0) {
    return current === 0 ? 0 : 100;
  }
  return Math.round(((current - previous) / previous) * 1000) / 10;
};

const formatTrend = (change: number) => `${change >= 0 ? "+" : ""}${change.toFixed(1)}%`;

const orderCreatedKey = (order: TrackedOrder) => normalizeDateKey(order.createdAt ?? order.date);
const orderDeliveredKey = (order: TrackedOrder) =>
  order.deliveredDate ? normalizeDateKey(order.deliveredDate) : (order.status ?? "New") === "Delivered" ? orderCreatedKey(order) : "";

const parseExpenseDateKey = (value: string) => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  const parts = value.split("/");
  if (parts.length === 3) {
    const [day, month, year] = parts;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  return normalizeDateKey(value);
};

const makeCartId = () => `CART-${Math.floor(100000 + Math.random() * 900000)}`;
const makeAgentId = () => `agent-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const makeExpenseId = () => `EXP-${Math.floor(100000 + Math.random() * 900000)}`;
const makePayrollRunId = () => `PAY-${Math.floor(100000 + Math.random() * 900000)}`;
const makeNoteId = () => `note-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

const percentText = (value: number, total: number) => `${total === 0 ? 0 : Math.round((value / total) * 100)}%`;

const userInitials = (name: string) =>
  name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "U";

const storageKeys = {
  products: "protohub.products",
  stockMovements: "protohub.stockMovements",
  trackedOrders: "protohub.trackedOrders",
  users: "protohub.users",
  agents: "protohub.agents",
  agentStock: "protohub.agentStock",
  payStructures: "protohub.payStructures",
  payrollRuns: "protohub.payrollRuns",
  expenses: "protohub.expenses",
  abandonedCarts: "protohub.abandonedCarts",
  extraTeams: "protohub.extraTeams",
  repPenalties: "protohub.repPenalties",
  formCrossSellLabel: "protohub.formCrossSellLabel",
  formFreeGiftLabel: "protohub.formFreeGiftLabel",
  formAddonPromptText: "protohub.formAddonPromptText",
  formAddonYesLabel: "protohub.formAddonYesLabel",
  formAddonNoLabel: "protohub.formAddonNoLabel",
  formAddonNoMessage: "protohub.formAddonNoMessage",
  formOrderSummaryTitle: "protohub.formOrderSummaryTitle",
  formAddonPromptEnabled: "protohub.formAddonPromptEnabled",
  formOrderSummaryEnabled: "protohub.formOrderSummaryEnabled",
  waybillRecords: "protohub.waybillRecords",
  customerFlags: "protohub.customerFlags",
  systemNotifications: "protohub.systemNotifications",
  stockCounts: "protohub.stockCounts"
};

const defaultUsers: ManagedUser[] = [];

const defaultProducts: Product[] = [];

const defaultAgents: DeliveryAgentRecord[] = [];

const defaultAgentStock: AgentStockRecord[] = [];



const defaultTrackedOrders: TrackedOrder[] = [];
const defaultAbandonedCarts: AbandonedCartRecord[] = [];

const defaultExpenses: ExpenseRecord[] = [];
const defaultStockMovements: StockMovement[] = [];

const readStored = <T,>(key: string, fallback: T): T => {
  if (typeof window === "undefined") {
    return fallback;
  }

  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};

const readStoredExpenses = () => {
  if (typeof window === "undefined") return defaultExpenses;
  try {
    const raw = window.localStorage.getItem(storageKeys.expenses);
    if (!raw) return defaultExpenses;
    const parsed = JSON.parse(raw) as ExpenseRecord[];
    return Array.isArray(parsed) ? parsed : defaultExpenses;
  } catch {
    return defaultExpenses;
  }
};

const writeStored = <T,>(key: string, value: T) => {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Local storage can be unavailable in private browser modes.
  }
};

// One-time migration: clear stale mock data keys, keep auth tokens intact
const MIGRATION_KEY = "protohub.clearedMockData.v2";
if (typeof window !== "undefined" && !window.localStorage.getItem(MIGRATION_KEY)) {
  const mockDataKeys = [
    "protohub.products", "protohub.stockMovements", "protohub.trackedOrders",
    "protohub.users", "protohub.agents", "protohub.agentStock",
    "protohub.payStructures", "protohub.payrollRuns", "protohub.expenses",
    "protohub.abandonedCarts", "protohub.extraTeams", "protohub.repPenalties",
    "protohub.waybillRecords", "protohub.customerFlags", "protohub.systemNotifications",
    "protohub.stockCounts", "protohub.expensesSeeded", "protohub.seed150orders"
  ];
  mockDataKeys.forEach((key) => window.localStorage.removeItem(key));
  window.localStorage.setItem(MIGRATION_KEY, "true");
}

export function App({ onLogout }: { onLogout?: () => void }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [hashRoute, setHashRoute] = useState(() => (typeof window === "undefined" ? "" : window.location.hash));
  const [activePage, setActivePage] = useState<ActivePage>("Dashboard");
  const [period, setPeriod] = useState<Period>("Today");
  const [ordersPeriod, setOrdersPeriod] = useState<Period>("This Month");
  const [conversion, setConversion] = useState(0);
  const [ordersConversion, setOrdersConversion] = useState(0);
  const [currency, setCurrency] = useState<CurrencyCode>("NGN");
  const [showDateRange, setShowDateRange] = useState(false);
  const [dateRange, setDateRange] = useState<DateRange>({ start: "", end: "" });
  const [showOrdersDateRange, setShowOrdersDateRange] = useState(false);
  const [ordersDateRange, setOrdersDateRange] = useState<DateRange>({ start: "", end: "" });
  const [orderSearch, setOrderSearch] = useState("");
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(new Set());
  const [orderStatus, setOrderStatus] = useState<OrderStatus>("All Orders");
  const [orderSource, setOrderSource] = useState<OrderSource>("All Sources");
  const [orderLocation, setOrderLocation] = useState<OrderLocation>("All Locations");
  const [ordersPage, setOrdersPage] = useState(1);
  const [cartSearch, setCartSearch] = useState("");
  const [cartStatus, setCartStatus] = useState<CartStatus>("All statuses");
  const [scheduleRange, setScheduleRange] = useState<ScheduleRange>("Today");
  const [deliveriesPeriod, setDeliveriesPeriod] = useState<Period>("This Month");
  const [showDeliveriesDateRange, setShowDeliveriesDateRange] = useState(false);
  const [deliveriesDateRange, setDeliveriesDateRange] = useState<DateRange>({ start: "", end: "" });
  const [deliverySearch, setDeliverySearch] = useState("");
  const [deliveryAgent, setDeliveryAgent] = useState<DeliveryAgent>("All Agents");
  const [inventorySearch, setInventorySearch] = useState("");
  const [productName, setProductName] = useState("");
  const [productDescription, setProductDescription] = useState("");
  const [productSku, setProductSku] = useState("");
  const [productActive, setProductActive] = useState(true);
  const [unitCost, setUnitCost] = useState("0");
  const [sellingPrice, setSellingPrice] = useState("0");
  const [openingStock, setOpeningStock] = useState("0");
  const [reorderPoint, setReorderPoint] = useState("0");
  const [stockChange, setStockChange] = useState("0");
  const [products, setProducts] = useState<Product[]>(() => readStored<Product[]>(storageKeys.products, defaultProducts));
  const [inventoryView, setInventoryView] = useState<InventoryView>("dashboard");
  const [selectedProductId, setSelectedProductId] = useState("");
  const [stockProductId, setStockProductId] = useState("");
  const [stockMovements, setStockMovements] = useState<StockMovement[]>(() => readStored<StockMovement[]>(storageKeys.stockMovements, defaultStockMovements));
  const [historyProductFilter, setHistoryProductFilter] = useState("All Products");
  const [historyTypeFilter, setHistoryTypeFilter] = useState<"All Types" | StockMovementType>("All Types");
  const [historyStartDate, setHistoryStartDate] = useState("");
  const [historyEndDate, setHistoryEndDate] = useState("");
  const [pricingCurrency, setPricingCurrency] = useState<ProductCurrencyCode>("USD");
  const [pricingSellingPrice, setPricingSellingPrice] = useState("0");
  const [pricingCost, setPricingCost] = useState("0");
  const [selectedPricingCurrency, setSelectedPricingCurrency] = useState<ProductCurrencyCode>("NGN");
  const [packageName, setPackageName] = useState("");
  const [packageDescription, setPackageDescription] = useState("");
  const [packageQuantity, setPackageQuantity] = useState("1");
  const [packagePrice, setPackagePrice] = useState("0");
  const [packageCurrency, setPackageCurrency] = useState<ProductCurrencyCode>("NGN");
  const [packageDisplayOrder, setPackageDisplayOrder] = useState("1");
  const [selectedPackageId, setSelectedPackageId] = useState("");
  const [packageDescriptionDraft, setPackageDescriptionDraft] = useState("");
  const [salesPeriod, setSalesPeriod] = useState<Period>("This Month");
  const [showSalesDateRange, setShowSalesDateRange] = useState(false);
  const [salesDateRange, setSalesDateRange] = useState<DateRange>({ start: "", end: "" });
  const [salesSearch, setSalesSearch] = useState("");
  const [salesStatus, setSalesStatus] = useState<RepStatus>("All statuses");
  const [salesRepName, setSalesRepName] = useState("");
  const [salesRepEmail, setSalesRepEmail] = useState("");
  const [salesRepPassword, setSalesRepPassword] = useState("");
  const [salesRepRole, setSalesRepRole] = useState<EditableUserRole>("Sales Rep");
  const [salesRepActive, setSalesRepActive] = useState(true);
  const [agentSearch, setAgentSearch] = useState("");
  const [agentZone, setAgentZone] = useState<AgentZone>("All Zones");
  const [agentStatus, setAgentStatus] = useState<AgentStatus>("All Status");
  const [agentName, setAgentName] = useState("");
  const [agentPhone, setAgentPhone] = useState("");
  const [agentZoneInput, setAgentZoneInput] = useState("");
  const [agentAddress, setAgentAddress] = useState("");
  const [agentActive, setAgentActive] = useState(true);
  const [agents, setAgents] = useState<DeliveryAgentRecord[]>(() => readStored<DeliveryAgentRecord[]>(storageKeys.agents, defaultAgents));
  const [agentStock, setAgentStock] = useState<AgentStockRecord[]>(() => readStored<AgentStockRecord[]>(storageKeys.agentStock, defaultAgentStock));
  const [waybillRecords, setWaybillRecords] = useState<WaybillRecord[]>(() => readStored<WaybillRecord[]>(storageKeys.waybillRecords, []));
  const [customerFlags, setCustomerFlags] = useState<Record<string, CustomerFlag>>(() => readStored<Record<string, CustomerFlag>>(storageKeys.customerFlags, {}));
  const [systemNotifications, setSystemNotifications] = useState<SystemNotification[]>(() => readStored<SystemNotification[]>(storageKeys.systemNotifications, []));
  const [flagReasonDraft, setFlagReasonDraft] = useState("");
  const [flagTargetPhone, setFlagTargetPhone] = useState("");
  const [callOutcomeDraft, setCallOutcomeDraft] = useState<CallOutcome | "">("");
  const [stockCounts, setStockCounts] = useState<StockCountSession[]>(() => readStored<StockCountSession[]>(storageKeys.stockCounts, []));
  const [activeStockCountId, setActiveStockCountId] = useState<string | null>(null);
  const [stockCountEntryId, setStockCountEntryId] = useState<string | null>(null);
  const [stockCountTitleDraft, setStockCountTitleDraft] = useState("");
  const [stockCountAgentIdsDraft, setStockCountAgentIdsDraft] = useState<string[]>([]);
  const [agentCountDraft, setAgentCountDraft] = useState("");
  const [adminCountDraft, setAdminCountDraft] = useState("");
  const [stockCountNotesDraft, setStockCountNotesDraft] = useState("");
  const [writeOffReason, setWriteOffReason] = useState<WriteOffReason | "">("");
  const [writeOffCustomReason, setWriteOffCustomReason] = useState("");
  const [adjustStockEntryId, setAdjustStockEntryId] = useState<string | null>(null);
  const [waybillProductId, setWaybillProductId] = useState("");
  const [waybillQty, setWaybillQty] = useState("1");
  const [waybillFee, setWaybillFee] = useState("0");
  const [waybillPartner, setWaybillPartner] = useState("");
  const [waybillFromType, setWaybillFromType] = useState<"Warehouse" | "Agent">("Warehouse");
  const [waybillFromAgentId, setWaybillFromAgentId] = useState("");
  const [waybillToAgentId, setWaybillToAgentId] = useState("");
  const [waybillToState, setWaybillToState] = useState("");
  const [waybillDateSent, setWaybillDateSent] = useState(() => new Date().toISOString().slice(0, 10));
  const [waybillNote, setWaybillNote] = useState("");
  const [waybillStatusFilter, setWaybillStatusFilter] = useState<WaybillStatus | "All">("All");
  const [waybillProductFilter, setWaybillProductFilter] = useState("");
  const [waybillEditId, setWaybillEditId] = useState("");
  const [waybillErrors, setWaybillErrors] = useState<Record<string, string>>({});
  const [payrollTab, setPayrollTab] = useState<PayrollTab>("Pay Rates");
  const [payrollMonth, setPayrollMonth] = useState(() => new Date().toLocaleString("en-US", { month: "long", year: "numeric" }));
  const [payrollLabel, setPayrollLabel] = useState(() => `${new Date().toLocaleString("en-US", { month: "long", year: "numeric" })} Payroll`);
  const [payrollNotes, setPayrollNotes] = useState("");
  const [payStructureType, setPayStructureType] = useState<PayStructureType>("Commission");
  const [payRateUpdatedAt, setPayRateUpdatedAt] = useState("");
  const [payRateUserId, setPayRateUserId] = useState("owner");
  const [payStructures, setPayStructures] = useState<PayStructure[]>(() => readStored<PayStructure[]>(storageKeys.payStructures, []));
  const [payrollRuns, setPayrollRuns] = useState<PayrollRun[]>(() => readStored<PayrollRun[]>(storageKeys.payrollRuns, []));
  const [fixedSalary, setFixedSalary] = useState("0");
  const [commissionRate, setCommissionRate] = useState("0");
  const [customerPeriod, setCustomerPeriod] = useState<Period>("This Month");
  const [showCustomerDateRange, setShowCustomerDateRange] = useState(false);
  const [customerDateRange, setCustomerDateRange] = useState<DateRange>({ start: "", end: "" });
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerSource, setCustomerSource] = useState<CustomerSource>("Source: All");
  const [expensePeriod, setExpensePeriod] = useState<Period>("This Month");
  const [showExpenseDateRange, setShowExpenseDateRange] = useState(false);
  const [expenseDateRange, setExpenseDateRange] = useState<DateRange>({ start: "", end: "" });
  const [expenseSearch, setExpenseSearch] = useState("");
  const [expenseFilter, setExpenseFilter] = useState<ExpenseFilter>("All Types");
  const [expenseCurrency, setExpenseCurrency] = useState<CurrencyCode>("NGN");
  const [expenseType, setExpenseType] = useState<ExpenseType>("Other");
  const [expenseAmount, setExpenseAmount] = useState("0");
  const [expenseDate, setExpenseDate] = useState(() => todayKey());
  const [expenseProduct, setExpenseProduct] = useState("General Expense");
  const [expenseDescription, setExpenseDescription] = useState("");
  const [expenses, setExpenses] = useState<ExpenseRecord[]>(() => readStoredExpenses());
  const [financePeriod, setFinancePeriod] = useState<Period>("This Month");
  const [showFinanceDateRange, setShowFinanceDateRange] = useState(false);
  const [financeDateRange, setFinanceDateRange] = useState<DateRange>({ start: "", end: "" });
  const [financeTab, setFinanceTab] = useState<FinanceTab>("Financial Overview");
  const [financeRepSearch, setFinanceRepSearch] = useState("");
  const [financeProductSearch, setFinanceProductSearch] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [userRole, setUserRole] = useState<UserRole>("All Roles");
  const [userStatus, setUserStatus] = useState<UserStatus>("All Status");
  const [expandedPermissionsUserId, setExpandedPermissionsUserId] = useState<string | null>(null);
  const [userFullName, setUserFullName] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [userPassword, setUserPassword] = useState("");
  const [newUserRole, setNewUserRole] = useState<EditableUserRole>("Sales Rep");
  const [newUserActive, setNewUserActive] = useState(true);
  const [selectedUserId, setSelectedUserId] = useState("owner");
  const [users, setUsers] = useState<ManagedUser[]>(() => readStored<ManagedUser[]>(storageKeys.users, defaultUsers));
  const [calendarStartMonth, setCalendarStartMonth] = useState(() => new Date(2026, 4, 1));
  const [roundRobinTab, setRoundRobinTab] = useState<RoundRobinTab>("Active Sequence");
  const [roundRobinSearch, setRoundRobinSearch] = useState("");
  const [embedTab, setEmbedTab] = useState<EmbedTab>("Create Order Form");
  const [embedStateField, setEmbedStateField] = useState("Free-text input");
  const [formCrossSellLabel, setFormCrossSellLabel] = useState<string>(() => readStored<string>(storageKeys.formCrossSellLabel, "Optional add-ons"));
  const [formFreeGiftLabel, setFormFreeGiftLabel] = useState<string>(() => readStored<string>(storageKeys.formFreeGiftLabel, "Free gift included:"));
  const [formAddonPromptText, setFormAddonPromptText] = useState<string>(() => readStored<string>(storageKeys.formAddonPromptText, "Would you like to add an additional product?"));
  const [formAddonYesLabel, setFormAddonYesLabel] = useState<string>(() => readStored<string>(storageKeys.formAddonYesLabel, "Yes — show me add-ons"));
  const [formAddonNoLabel, setFormAddonNoLabel] = useState<string>(() => readStored<string>(storageKeys.formAddonNoLabel, "No, just submit my order"));
  const [formAddonNoMessage, setFormAddonNoMessage] = useState<string>(() => readStored<string>(storageKeys.formAddonNoMessage, "No problem — just hit \"Order Now\" below to submit your order as-is."));
  const [formOrderSummaryTitle, setFormOrderSummaryTitle] = useState<string>(() => readStored<string>(storageKeys.formOrderSummaryTitle, "Your Order Summary"));
  const [formAddonPromptEnabled, setFormAddonPromptEnabled] = useState<boolean>(() => readStored<boolean>(storageKeys.formAddonPromptEnabled, true));
  const [formOrderSummaryEnabled, setFormOrderSummaryEnabled] = useState<boolean>(() => readStored<boolean>(storageKeys.formOrderSummaryEnabled, true));
  const [orderFormAddonChoice, setOrderFormAddonChoice] = useState<"" | "yes" | "no">("");
  const [showEmailField, setShowEmailField] = useState(false);
  const [showWhatsappField, setShowWhatsappField] = useState(true);
  const [requireWhatsapp, setRequireWhatsapp] = useState(true);
  const [showPackageName, setShowPackageName] = useState(false);
  const [showDeliveryQuestion, setShowDeliveryQuestion] = useState(false);
  const [requireConfirmation, setRequireConfirmation] = useState(false);
  const [showCommitmentNotice, setShowCommitmentNotice] = useState(false);
  const [generatedProductId, setGeneratedProductId] = useState("");
  const [generatedEmbedProductIds, setGeneratedEmbedProductIds] = useState<string[]>([]);
  const [embedCurrencyByProduct, setEmbedCurrencyByProduct] = useState<Record<string, ProductCurrencyCode>>({});
  const [embedRedirectUrls, setEmbedRedirectUrls] = useState<Record<string, string>>({});
  const [embedCodeTabsByProduct, setEmbedCodeTabsByProduct] = useState<Record<string, EmbedCodeTab>>({});
  const [showOrderPreview, setShowOrderPreview] = useState(false);
  const [trackedOrders, setTrackedOrders] = useState<TrackedOrder[]>(() => readStored<TrackedOrder[]>(storageKeys.trackedOrders, defaultTrackedOrders));
  const [abandonedCarts, setAbandonedCarts] = useState<AbandonedCartRecord[]>(() => readStored<AbandonedCartRecord[]>(storageKeys.abandonedCarts, defaultAbandonedCarts));
  const [orderFormName, setOrderFormName] = useState("");
  const [orderFormPhone, setOrderFormPhone] = useState("");
  const [orderFormWhatsapp, setOrderFormWhatsapp] = useState("");
  const [orderFormEmail, setOrderFormEmail] = useState("");
  const [orderFormAddress, setOrderFormAddress] = useState("");
  const [orderFormCity, setOrderFormCity] = useState("");
  const [orderFormState, setOrderFormState] = useState("");
  const [orderFormPackageId, setOrderFormPackageId] = useState("");
  const [orderFormCrossSells, setOrderFormCrossSells] = useState<{ productId: string; quantity: number }[]>([]);
  const toggleOrderFormCrossSell = (productId: string) => setOrderFormCrossSells((prev) => prev.some((c) => c.productId === productId) ? prev.filter((c) => c.productId !== productId) : [...prev, { productId, quantity: 1 }]);
  const setOrderFormCrossSellQuantity = (productId: string, quantity: number) => setOrderFormCrossSells((prev) => prev.map((c) => c.productId === productId ? { ...c, quantity: Math.max(1, quantity) } : c));
  const [orderFormConfirmed, setOrderFormConfirmed] = useState(false);
  const [orderFormCommitmentAccepted, setOrderFormCommitmentAccepted] = useState(false);
  const [orderFormDeliveryWindow, setOrderFormDeliveryWindow] = useState("");
  const [publicOrderSubmitting, setPublicOrderSubmitting] = useState(false);
  const [abandonedDraftCartId, setAbandonedDraftCartId] = useState("");
  const [notificationFilter, setNotificationFilter] = useState<NotificationFilter>("All");
  const [adminCartNotifications, setAdminCartNotifications] = useState(false);
  const [tokens, setTokens] = useState(0);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [modal, setModal] = useState<ModalType>(null);
  const [toast, setToast] = useState("");
  const [notificationsRead, setNotificationsRead] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState("");
  const [orderAuditLog, setOrderAuditLog] = useState<{ id: string; from_status: string | null; to_status: string; note: string | null; created_at: string; changed_by: string | null }[]>([]);
  const [selectedCartId, setSelectedCartId] = useState("");
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [selectedSalesRepId, setSelectedSalesRepId] = useState("");
  const [createOrderCustomer, setCreateOrderCustomer] = useState("");
  const [createOrderPhone, setCreateOrderPhone] = useState("");
  const [createOrderWhatsapp, setCreateOrderWhatsapp] = useState("");
  const [createOrderEmail, setCreateOrderEmail] = useState("");
  const [createOrderAddress, setCreateOrderAddress] = useState("");
  const [createOrderCity, setCreateOrderCity] = useState("Lagos");
  const [createOrderState, setCreateOrderState] = useState("Lagos");
  const [createOrderProductId, setCreateOrderProductId] = useState("");
  const [createOrderPackageId, setCreateOrderPackageId] = useState("");
  const [createOrderQuantity, setCreateOrderQuantity] = useState("1");
  const [createOrderSource, setCreateOrderSource] = useState<Exclude<OrderSource, "All Sources">>("Website");
  const [createOrderRepId, setCreateOrderRepId] = useState("auto");
  const [createOrderContext, setCreateOrderContext] = useState<CreateOrderContext>("admin");
  const [createOrderAgentId, setCreateOrderAgentId] = useState("");
  const [reassignRepId, setReassignRepId] = useState("");
  const [handoverReason, setHandoverReason] = useState("");
  const [orderNoteDraft, setOrderNoteDraft] = useState("");
  const [orderFollowUpDate, setOrderFollowUpDate] = useState("");
  const [repConsoleTab, setRepConsoleTab] = useState<RepConsoleTab>("Dashboard");
  const [repConsoleRepId, setRepConsoleRepId] = useState("all");
  const [repOrderStatusTab, setRepOrderStatusTab] = useState<RepOrderStatusTab>("All Orders");
  const [repProductSearch, setRepProductSearch] = useState("");
  const [repProductSort, setRepProductSort] = useState("Name A-Z");
  const [repCartSearch, setRepCartSearch] = useState("");
  const [repScheduleRange, setRepScheduleRange] = useState<ScheduleRange>("Today");
  const [repOrderDetailId, setRepOrderDetailId] = useState("");
  const [statusChangeDraft, setStatusChangeDraft] = useState<Exclude<OrderStatus, "All Orders">>("Confirmed");
  const [statusChangeReason, setStatusChangeReason] = useState("");
  const [repScheduleDate, setRepScheduleDate] = useState(todayKey());
  const [showRepFollowUpField, setShowRepFollowUpField] = useState(false);
  const [assignStockProductId, setAssignStockProductId] = useState("");
  const [assignStockQty, setAssignStockQty] = useState("1");
  const [reconcileProductId, setReconcileProductId] = useState("");
  const [reconcileReturned, setReconcileReturned] = useState("0");
  const [reconcileDefective, setReconcileDefective] = useState("0");
  const [reconcileMissing, setReconcileMissing] = useState("0");
  const [reconcileNotes, setReconcileNotes] = useState("");
  const [showPasswordFields, setShowPasswordFields] = useState<Record<string, boolean>>({});
  const [tokenHistory, setTokenHistory] = useState<{ date: string; pack: string; amount: number }[]>([]);
  const toggleShowPassword = (key: string) => setShowPasswordFields((v) => ({ ...v, [key]: !v[key] }));
  const [newTeamName, setNewTeamName] = useState("");
  const [newTeamLeadId, setNewTeamLeadId] = useState("");
  const [extraTeams, setExtraTeams] = useState<{ id: string; name: string; leadId: string | undefined; productIds: string[] }[]>(() => readStored(storageKeys.extraTeams, []));
  const [remittanceTargetOrderId, setRemittanceTargetOrderId] = useState("");
  const [remittanceAmount, setRemittanceAmount] = useState("");
  const [remittanceLogisticsCost, setRemittanceLogisticsCost] = useState("");
  const [remittanceSearch, setRemittanceSearch] = useState("");
  const [remittancePartnerFilter, setRemittancePartnerFilter] = useState("All Partners");
  const [repDeliveryFee, setRepDeliveryFee] = useState("");
  const [repAmountToRemit, setRepAmountToRemit] = useState("");
  const [repExtraExpenses, setRepExtraExpenses] = useState<{ type: ExpenseType; amount: string; description: string }[]>([]);
  const [financeProductFilter, setFinanceProductFilter] = useState<string[]>([]);
  const [bonusSettingsProductId, setBonusSettingsProductId] = useState<string | null>(null);
  const [stateAvailabilityProductId, setStateAvailabilityProductId] = useState<string | null>(null);
  const [crossSellTargetOrderId, setCrossSellTargetOrderId] = useState<string | null>(null);
  const [crossSellProductId, setCrossSellProductId] = useState("");
  const [crossSellQuantity, setCrossSellQuantity] = useState("1");
  const [crossSellAmount, setCrossSellAmount] = useState("");
  const [freeGiftTargetOrderId, setFreeGiftTargetOrderId] = useState<string | null>(null);
  const [freeGiftProductId, setFreeGiftProductId] = useState("");
  const [freeGiftQuantity, setFreeGiftQuantity] = useState("1");
  const [manualBonusTargetOrderId, setManualBonusTargetOrderId] = useState<string | null>(null);
  const [manualBonusAmount, setManualBonusAmount] = useState("");
  const [manualBonusReasonText, setManualBonusReasonText] = useState("");
  const [repPenalties, setRepPenalties] = useState<RepPenaltyRecord[]>(() => readStored<RepPenaltyRecord[]>(storageKeys.repPenalties, []));
  const [penaltyTargetRepId, setPenaltyTargetRepId] = useState<string>("");
  const [penaltyType, setPenaltyType] = useState<RepPenaltyType>("Wrong Data Entry");
  const [penaltyAmount, setPenaltyAmount] = useState("500");
  const [penaltyRemoveAllBonuses, setPenaltyRemoveAllBonuses] = useState(false);
  const [penaltyReason, setPenaltyReason] = useState("");
  const [penaltyOrderId, setPenaltyOrderId] = useState("");
  const EmptyProductsIcon = emptyProductsIcon;
  const ownerName = users.find((u) => u.role === "Owner")?.name ?? "Admin";
  const selectedCurrency = currencies[currency];
  const selectedUser = users.find((user) => user.id === selectedUserId) ?? users[0];
  const filteredUsers = users.filter((user) => {
    const search = userSearch.trim().toLowerCase();
    const matchesSearch = !search || `${user.name} ${user.email}`.toLowerCase().includes(search);
    const matchesRole =
      userRole === "All Roles" ||
      (userRole === "Admin" ? user.role === "Admin" || user.role === "Owner" : user.role === userRole);
    const matchesStatus = userStatus === "All Status" || (userStatus === "Active" ? user.active : !user.active);
    return matchesSearch && matchesRole && matchesStatus;
  });
  const activeUserCount = users.filter((user) => user.active).length;
  const adminUserCount = users.filter((user) => user.role === "Admin" || user.role === "Owner").length;
  const salesUserCount = users.filter((user) => user.role === "Sales Rep").length;
  const inventoryUserCount = users.filter((user) => user.role === "Inventory Manager").length;
  const selectedProduct = products.find((product) => product.id === selectedProductId);
  const selectedPackage = selectedProduct?.packages.find((item) => item.id === selectedPackageId);
  const selectedPricing = selectedProduct?.pricings.find((item) => item.currency === selectedPricingCurrency);
  const selectedOrder = trackedOrders.find((order) => order.id === selectedOrderId);
  const selectedCart = abandonedCarts.find((cart) => cart.id === selectedCartId);
  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId);
  const selectedSalesRep = users.find((user) => user.id === selectedSalesRepId);
  const readyEmbedProducts = products.filter((product) => product.active && activeProductPackages(product).length > 0);
  const generatedProduct = products.find((product) => product.id === generatedProductId) ?? readyEmbedProducts[0];
  const previewProduct = generatedProduct ?? readyEmbedProducts[0];
  const previewPackages = previewProduct ? activeProductPackages(previewProduct) : [];
  const publicEmbedParams = hashRoute.startsWith("#/order-form/embed")
    ? new URLSearchParams(hashRoute.split("?")[1] ?? "")
    : null;
  const publicProductId = publicEmbedParams?.get("product") ?? "";
  const publicCurrency = (publicEmbedParams?.get("currency") as ProductCurrencyCode | null) ?? "NGN";
  const publicUtmSource = publicEmbedParams?.get("utm_source") ?? "direct";
  const publicUtmCampaign = publicEmbedParams?.get("utm_campaign") ?? "embed";
  const publicProduct = products.find((product) => product.id === publicProductId);
  const publicPackages = publicProduct ? activeProductPackages(publicProduct) : [];
  const previewCurrency = previewPackages[0]?.currency ?? "NGN";
  const shouldUseStateDropdown = (currencyCode: ProductCurrencyCode) => embedStateField === "Dropdown" && currencyCode === "NGN";
  const visibleProducts = products.filter((product) => {
    const search = inventorySearch.trim().toLowerCase();
    return !search || `${product.name} ${product.sku}`.toLowerCase().includes(search);
  });
  const inventoryValue = products.reduce((sum, product) => sum + productInventoryValue(product), 0);
  const totalInventoryUnits = products.reduce((sum, product) => sum + totalProductStock(product), 0);
  const agentInventoryUnits = products.reduce((sum, product) => sum + product.agentStock, 0);
  const distributionRate = totalInventoryUnits === 0 ? 0 : Math.round((agentInventoryUnits / totalInventoryUnits) * 100);
  const lowStockProducts = products.filter((product) => product.warehouseStock <= product.reorderPoint);
  const filteredStockMovements = stockMovements.filter((movement) => {
    const matchesProduct = historyProductFilter === "All Products" || movement.productId === historyProductFilter;
    const matchesType = historyTypeFilter === "All Types" || movement.type === historyTypeFilter;
    const movementDate = movement.date.slice(0, 10);
    const matchesStart = !historyStartDate || movementDate >= historyStartDate;
    const matchesEnd = !historyEndDate || movementDate <= historyEndDate;
    return matchesProduct && matchesType && matchesStart && matchesEnd;
  });

  const formatMoney = (amount: number) =>
    new Intl.NumberFormat(selectedCurrency.locale, {
      style: "currency",
      currency: selectedCurrency.currency,
      maximumFractionDigits: 0
    }).format(amount);
  const productEmbedCurrency = (product: Product | undefined) => (product ? embedCurrencyByProduct[product.id] ?? "NGN" : "NGN");
  const productEmbedRedirect = (product: Product | undefined) => (product ? embedRedirectUrls[product.id] ?? "" : "");
  const generatedEmbedProducts = readyEmbedProducts.filter((product) => generatedEmbedProductIds.includes(product.id));
  const productEmbedCodeTab = (productId: string) => embedCodeTabsByProduct[productId] ?? "Direct Link";
  const enabledEmbedFeatures = [
    showEmailField ? "Email capture" : null,
    showWhatsappField ? `WhatsApp ${requireWhatsapp ? "required" : "optional"}` : null,
    showPackageName ? "Package names shown" : null,
    showDeliveryQuestion ? "Delivery preference question" : null,
    requireConfirmation ? "Confirmation checkbox" : null,
    showCommitmentNotice ? "Commitment notice" : null
  ].filter(Boolean) as string[];
  const embedExperienceHighlights = [
    {
      label: "State input",
      value: embedStateField === "Dropdown" ? "Dropdown for NGN forms" : "Free-text for every currency"
    },
    {
      label: "Contact flow",
      value: showWhatsappField
        ? `${showEmailField ? "Email + " : ""}WhatsApp ${requireWhatsapp ? "required" : "optional"}`
        : `${showEmailField ? "Email only" : "Phone only"}`
    },
    {
      label: "Checkout guardrails",
      value: [requireConfirmation ? "Confirmation" : null, showCommitmentNotice ? "Commitment notice" : null].filter(Boolean).join(" + ") || "None"
    }
  ];

  const buildEmbedUrl = (product: Product | undefined = generatedProduct, currencyOverride?: ProductCurrencyCode, redirectOverride?: string) => {
    if (!product) {
      return "";
    }

    const params = new URLSearchParams({
      product: product.id,
      currency: currencyOverride ?? productEmbedCurrency(product)
    });
    const redirect = (redirectOverride ?? productEmbedRedirect(product)).trim();
    if (redirect) {
      params.set("redirect_url", redirect);
    }

    return `${window.location.origin}${window.location.pathname}#/order-form/embed?${params.toString()}`;
  };
  const buildIframeCode = (product: Product | undefined = generatedProduct) => {
    const url = buildEmbedUrl(product);
    const title = product ? `${product.name} Order Form` : "Protohub Order Form";
    return `<iframe
  id="ordo-order-embed"
  src="${url}"
  width="100%"
  height="800"
  frameborder="0"
  scrolling="no"
  style="border: none; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); overflow: hidden;"
  title="${title}"
></iframe>
<script>
  (function() {
    var iframe = document.getElementById("ordo-order-embed");
    if (!iframe) return;

    // Forward UTM params from this page into the iframe so orders
    // are correctly attributed to Facebook / TikTok / etc.
    var utmKeys = ["utm_source","utm_medium","utm_campaign","utm_content","utm_term"];
    var pageParams = new URLSearchParams(window.location.search);
    var extra = "";
    utmKeys.forEach(function(k) {
      var v = pageParams.get(k);
      if (v) extra += "&" + k + "=" + encodeURIComponent(v);
    });
    if (extra) iframe.src = iframe.src + extra;

    // Auto-resize iframe to fit form content.
    window.addEventListener("message", function(e) {
      if (e.data && e.data.type === "ordo-resize") {
        iframe.style.height = (e.data.height + 20) + "px";
      }
    });
  })();
</script>`;
  };
  const salesRepUsers = users.filter((user) => user.role === "Sales Rep");
  const activeSalesRepUsers = salesRepUsers.filter((user) => user.active);
  const activeAgents = agents.filter((agent) => agent.active);
  const deliveryAgentOptions = ["All Agents", "Unassigned", ...agents.map((agent) => agent.name)];
  const agentZoneOptions = ["All Zones", ...Array.from(new Set(agents.map((agent) => agent.zone).filter(Boolean)))];
  const agentStockValueFor = (agentId: string) =>
    agentStock
      .filter((stock) => stock.agentId === agentId)
      .reduce((sum, stock) => {
        const product = products.find((item) => item.id === stock.productId);
        if (!product) return sum;
        return sum + stock.quantity * (primaryPricing(product)?.sellingPrice ?? 0);
      }, 0);
  const agentIssueValueFor = (agentId: string, field: "defective" | "missing") =>
    agentStock
      .filter((stock) => stock.agentId === agentId)
      .reduce((sum, stock) => {
        const product = products.find((item) => item.id === stock.productId);
        if (!product) return sum;
        return sum + stock[field] * (primaryPricing(product)?.sellingPrice ?? 0);
      }, 0);
  const selectedPayUser = users.find((user) => user.id === payRateUserId) ?? users[0];
  const selectedPayStructure = payStructures.find((item) => item.userId === selectedPayUser?.id);
  const payStructureLabelFor = (structure?: PayStructure) => {
    if (!structure) {
      return "Not set";
    }

    if (structure.type === "Commission") {
      return `${formatMoney(structure.commissionRate)} per delivered order`;
    }

    if (structure.type === "Fixed Salary") {
      return `${formatMoney(structure.fixedSalary)} fixed monthly`;
    }

    return `${formatMoney(structure.fixedSalary)} fixed + ${formatMoney(structure.commissionRate)} per delivered order`;
  };
  const quantityForOrder = (order: TrackedOrder) => {
    const product = products.find((item) => item.id === order.productId);
    const packageRecord = product?.packages.find((item) => item.id === order.packageId);
    return order.quantity ?? packageRecord?.quantity ?? 1;
  };
  const costForOrder = (order: TrackedOrder) => {
    const product = products.find((item) => item.id === order.productId);
    if (!product) {
      return 0;
    }
    return quantityForOrder(order) * (primaryPricing(product)?.unitCost ?? 0);
  };

  const periodOrders = trackedOrders.filter((order) => isInPeriod(orderCreatedKey(order), ordersPeriod, ordersDateRange));
  const dashboardOrders = trackedOrders.filter((order) => isInPeriod(orderCreatedKey(order), period, dateRange));
  const deliveredOrderRows = trackedOrders.filter((order) => (order.status ?? "New") === "Delivered");
  const deliveredInPeriodRows = deliveredOrderRows.filter((order) => isInPeriod(orderDeliveredKey(order), deliveriesPeriod, deliveriesDateRange));
  const periodDeliveredOrders = periodOrders.filter((order) => (order.status ?? "New") === "Delivered");
  const ordersRevenue = periodDeliveredOrders.reduce((sum, order) => sum + order.amount, 0);
  const dashboardDeliveredOrders = dashboardOrders.filter((order) => (order.status ?? "New") === "Delivered");
  const dashboardRevenue = dashboardDeliveredOrders.reduce((sum, order) => sum + order.amount, 0);
  const dashboardCogs = dashboardDeliveredOrders.reduce((sum, order) => sum + costForOrder(order), 0);
  const dashboardExpenses = expenses.filter((expense) => isInPeriod(expense.date, period, dateRange));
  const dashboardExpenseTotal = dashboardExpenses.reduce((sum, expense) => sum + expense.amount, 0);
  const dashboardGrossProfit = dashboardRevenue - dashboardCogs;
  const dashboardNetProfit = dashboardGrossProfit - dashboardExpenseTotal;
  const dashboardCancelledCount = dashboardOrders.filter((order) => (order.status ?? "New") === "Cancelled").length;
  const dashboardCancelledRate = dashboardOrders.length === 0 ? 0 : Math.round((dashboardCancelledCount / dashboardOrders.length) * 100);
  const dashboardCogsRate = dashboardRevenue === 0 ? 0 : Math.round((dashboardCogs / dashboardRevenue) * 100);
  const dashboardExpenseRate = dashboardRevenue === 0 ? 0 : Math.round((dashboardExpenseTotal / dashboardRevenue) * 100);
  const dashboardNetMargin = dashboardRevenue === 0 ? 0 : Math.round((dashboardNetProfit / dashboardRevenue) * 100);
  const dashboardPreviousRange = explicitPeriodRange(period, dateRange, true);
  const dashboardPreviousOrders = trackedOrders.filter((order) => isInExplicitRange(orderCreatedKey(order), dashboardPreviousRange));
  const dashboardPreviousDelivered = dashboardPreviousOrders.filter((order) => (order.status ?? "New") === "Delivered");
  const dashboardPreviousRevenue = dashboardPreviousDelivered.reduce((sum, order) => sum + order.amount, 0);
  const dashboardPreviousCogs = dashboardPreviousDelivered.reduce((sum, order) => sum + costForOrder(order), 0);
  const dashboardPreviousExpenses = expenses.filter((expense) => isInExplicitRange(expense.date, dashboardPreviousRange)).reduce((sum, expense) => sum + expense.amount, 0);
  const dashboardPreviousGrossProfit = dashboardPreviousRevenue - dashboardPreviousCogs;
  const dashboardPreviousNetProfit = dashboardPreviousRevenue - dashboardPreviousCogs - dashboardPreviousExpenses;
  const deliveredHourForOrder = (order: TrackedOrder) => {
    const rawDate = order.deliveredDate ?? order.createdAt ?? order.date;
    const parsed = rawDate && !/^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? new Date(rawDate) : undefined;
    if (parsed && !Number.isNaN(parsed.getTime())) {
      return Math.min(23, Math.max(1, parsed.getHours()));
    }
    return Math.min(23, Math.max(1, new Date().getHours()));
  };
  const revenueByHour = (orders: TrackedOrder[]) =>
    orders.reduce<number[]>((acc, order) => {
      acc[deliveredHourForOrder(order)] += order.amount;
      return acc;
    }, Array.from({ length: 24 }, () => 0));
  const dashboardCurrentRevenueByHour = revenueByHour(dashboardDeliveredOrders);
  const dashboardPreviousRevenueByHour = revenueByHour(dashboardPreviousDelivered);
  let currentRevenueRunningTotal = 0;
  let previousRevenueRunningTotal = 0;
  const dashboardRevenueChartData = revenueData.map((point, index) => {
    const hour = index + 1;
    currentRevenueRunningTotal += dashboardCurrentRevenueByHour[hour] ?? 0;
    previousRevenueRunningTotal += dashboardPreviousRevenueByHour[hour] ?? 0;
    return { ...point, current: currentRevenueRunningTotal, previous: previousRevenueRunningTotal };
  });
  const dashboardRevenueChartMax = Math.max(10, dashboardRevenue, dashboardPreviousRevenue);
  const ordersDeliveryRateExact = periodOrders.length === 0 ? 0 : (periodDeliveredOrders.length / periodOrders.length) * 100;
  const ordersDeliveryRate = Math.round(ordersDeliveryRateExact);
  const ordersFailedRate = periodOrders.length === 0 ? 0 : Math.round((periodOrders.filter((order) => ["Cancelled", "Failed"].includes(order.status ?? "New")).length / periodOrders.length) * 100);
  const dashboardDeliveryRateExact = dashboardOrders.length === 0 ? 0 : (dashboardDeliveredOrders.length / dashboardOrders.length) * 100;
  const dashboardDeliveryRate = Math.round(dashboardDeliveryRateExact);
  const dashboardRevenuePerDeliveredOrder = dashboardDeliveredOrders.length === 0 ? 0 : dashboardRevenue / dashboardDeliveredOrders.length;
  const dashboardConversionLiftMax = Math.max(0, 100 - dashboardDeliveryRateExact);
  const dashboardTargetConversion = Math.min(100, dashboardDeliveryRateExact + conversion);
  const dashboardProjectedDelivered = dashboardOrders.length * (dashboardTargetConversion / 100);
  const dashboardProjectedRevenue = dashboardProjectedDelivered * dashboardRevenuePerDeliveredOrder;
  const dashboardOpportunity = Math.max(0, dashboardProjectedRevenue - dashboardRevenue);
  const ordersRevenuePerDeliveredOrder = periodDeliveredOrders.length === 0 ? 0 : ordersRevenue / periodDeliveredOrders.length;
  const ordersConversionLiftMax = Math.max(0, 100 - ordersDeliveryRateExact);
  const ordersTargetConversion = Math.min(100, ordersDeliveryRateExact + ordersConversion);
  const ordersProjectedRevenueValue = periodOrders.length * (ordersTargetConversion / 100) * ordersRevenuePerDeliveredOrder;
  const projectedRevenue = formatMoney(dashboardProjectedRevenue);
  const projectedOrdersRevenue = formatMoney(ordersProjectedRevenueValue);
  const filteredOrderRows = periodOrders.filter((order) => {
    const status = order.status ?? "New";
    const source = order.source ?? orderSourceFromUtm(order.utmSource);
    const location = order.location ?? orderLocationFromFields(order.city ?? "", order.state ?? "");
    const search = orderSearch.trim().toLowerCase();
    const matchesSearch =
      !search ||
      `${order.id} ${order.customer} ${order.phone} ${order.productName} ${order.packageName}`.toLowerCase().includes(search);
    const matchesStatus = orderStatus === "All Orders" || status === orderStatus;
    const matchesSource = orderSource === "All Sources" || source === orderSource;
    const matchesLocation = orderLocation === "All Locations" || location === orderLocation;

    return matchesSearch && matchesStatus && matchesSource && matchesLocation;
  });
  const ORDERS_PAGE_SIZE = 25;
  const ordersTotalPages = Math.max(1, Math.ceil(filteredOrderRows.length / ORDERS_PAGE_SIZE));
  const ordersPageClamped = Math.min(ordersPage, ordersTotalPages);
  const pagedOrderRows = filteredOrderRows.slice((ordersPageClamped - 1) * ORDERS_PAGE_SIZE, ordersPageClamped * ORDERS_PAGE_SIZE);
  const ordersByProduct = Object.entries(
    periodOrders.reduce<Record<string, { count: number; revenue: number }>>((acc, order) => {
      const current = acc[order.productName] ?? { count: 0, revenue: 0 };
      const isDelivered = (order.status ?? "New") === "Delivered";
      acc[order.productName] = { count: current.count + 1, revenue: current.revenue + (isDelivered ? order.amount : 0) };
      return acc;
    }, {})
  );
  const filteredAbandonedCarts = abandonedCarts.filter((cart) => {
    const search = cartSearch.trim().toLowerCase();
    const matchesSearch = !search || `${cart.id} ${cart.customer} ${cart.phone} ${cart.productName}`.toLowerCase().includes(search);
    const matchesStatus = cartStatus === "All statuses" || cart.status === cartStatus;
    return matchesSearch && matchesStatus;
  });
  const demoCarts = abandonedCarts.length;
  const periodCarts = abandonedCarts.filter((cart) => isInPeriod(cart.createdAt, period, dateRange));
  const assignedCartCount = abandonedCarts.filter((cart) => cart.assignedRepId && cart.status !== "Converted").length;
  const contactedCartCount = abandonedCarts.filter((cart) => ["Contacted", "Converted", "No response", "Not interested"].includes(cart.status)).length;
  const convertedCartCount = periodCarts.filter((cart) => cart.status === "Converted").length;
  const lostCartCount = abandonedCarts.filter((cart) => ["No response", "Not interested"].includes(cart.status)).length;
  const cartConversionRate = periodCarts.length === 0 ? 0 : Math.round((convertedCartCount / periodCarts.length) * 100);
  const scheduledDeliveryRows = trackedOrders.filter((order) => {
    const status = order.status ?? "New";
    return ["Confirmed", "In Process", "Dispatched", "Postponed"].includes(status) && normalizeDateKey(order.scheduledDate) === scheduleDateForRange(scheduleRange);
  });
  const agentNameForOrder = (order: TrackedOrder) => agents.find((agent) => agent.id === order.agentId)?.name ?? "Unassigned";
  const filteredDeliveryRows = deliveredInPeriodRows.filter((order) => {
    const search = deliverySearch.trim().toLowerCase();
    const agentName = agentNameForOrder(order);
    const matchesSearch = !search || `${order.id} ${order.customer} ${order.phone} ${order.productName}`.toLowerCase().includes(search);
    const matchesAgent = deliveryAgent === "All Agents" || agentName === deliveryAgent || (!order.agentId && deliveryAgent === "Unassigned");
    return matchesSearch && matchesAgent;
  });
  const deliveredRevenueInPeriod = deliveredInPeriodRows.reduce((sum, order) => sum + order.amount, 0);
  const averageFulfillmentDays =
    deliveredInPeriodRows.length === 0
      ? 0
      : Math.round((deliveredInPeriodRows.reduce((sum, order) => sum + fulfillmentDaysForOrder(order), 0) / deliveredInPeriodRows.length) * 10) / 10;
  const avgDeliveredPerDay = deliveredInPeriodRows.length === 0 ? 0 : Math.round((deliveredInPeriodRows.length / daysInPeriodSoFar(deliveriesPeriod, deliveriesDateRange)) * 10) / 10;
  const salesRepRows = salesRepUsers.map((user) => {
    const assigned = trackedOrders.filter((order) => order.assignedRepId === user.id && isInPeriod(orderCreatedKey(order), salesPeriod, salesDateRange));
    const delivered = assigned.filter((order) => (order.status ?? "New") === "Delivered");
    const revenue = delivered.reduce((sum, order) => sum + order.amount, 0);
    return {
      user,
      orders: assigned.length,
      delivered: delivered.length,
      conversion: assigned.length === 0 ? 0 : Math.round((delivered.length / assigned.length) * 100),
      revenue
    };
  });
  const filteredSalesRepRows = salesRepRows.filter((row) => {
    const search = salesSearch.trim().toLowerCase();
    const matchesSearch = !search || `${row.user.name} ${row.user.email}`.toLowerCase().includes(search);
    const matchesStatus = salesStatus === "All statuses" || (salesStatus === "Active" ? row.user.active : !row.user.active);
    return matchesSearch && matchesStatus;
  });
  const totalSalesRepOrders = salesRepRows.reduce((sum, row) => sum + row.orders, 0);
  const avgSalesConversion = salesRepRows.length === 0 ? 0 : Math.round(salesRepRows.reduce((sum, row) => sum + row.conversion, 0) / salesRepRows.length);
  const salesTeams = extraTeams;
  const teamForRep = (rep: ManagedUser) => salesTeams[salesRepUsers.findIndex((user) => user.id === rep.id) % salesTeams.length] ?? salesTeams[0];
  const productTeamScope = (product: Product) => salesTeams.filter((team) => team.productIds.includes(product.id)).map((team) => team.name);
  const agentRows = agents.map((agent) => {
    const assigned = trackedOrders.filter((order) => order.agentId === agent.id);
    const delivered = assigned.filter((order) => (order.status ?? "New") === "Delivered").length;
    const pending = assigned.filter((order) => !["Delivered", "Cancelled", "Failed"].includes(order.status ?? "New")).length;
    const status: Exclude<AgentStatus, "All Status"> = agent.active ? (pending > 0 ? "Order in Progress" : "Active") : "Inactive";
    return {
      agent,
      status,
      deliveries: delivered,
      pending,
      successRate: assigned.length === 0 ? 0 : Math.round((delivered / assigned.length) * 100),
      stockValue: agentStockValueFor(agent.id),
      defectiveValue: agentIssueValueFor(agent.id, "defective"),
      missingValue: agentIssueValueFor(agent.id, "missing")
    };
  });
  const totalAgentStockValue = agentRows.reduce((sum, row) => sum + row.stockValue, 0);
  const totalAgentDefectiveValue = agentRows.reduce((sum, row) => sum + row.defectiveValue, 0);
  const totalAgentMissingValue = agentRows.reduce((sum, row) => sum + row.missingValue, 0);
  const pendingAgentDeliveries = agentRows.reduce((sum, row) => sum + row.pending, 0);
  const filteredAgentRows = agentRows.filter((row) => {
    const search = agentSearch.trim().toLowerCase();
    const matchesSearch = !search || `${row.agent.name} ${row.agent.phone}`.toLowerCase().includes(search);
    const matchesZone = agentZone === "All Zones" || row.agent.zone === agentZone;
    const matchesStatus = agentStatus === "All Status" || row.status === agentStatus;
    return matchesSearch && matchesZone && matchesStatus;
  });
  const filteredExpenses = expenses.filter((expense) => {
    const search = expenseSearch.trim().toLowerCase();
    const matchesSearch = !search || `${expense.id} ${expense.type} ${expense.productName} ${expense.description}`.toLowerCase().includes(search);
    const matchesType = expenseFilter === "All Types" || expense.type === expenseFilter;
    return isInPeriod(expense.date, expensePeriod, expenseDateRange) && matchesSearch && matchesType;
  });
  const totalExpenses = filteredExpenses.reduce((sum, expense) => sum + expense.amount, 0);
  const productLinkedExpenses = filteredExpenses.filter((expense) => expense.productId).reduce((sum, expense) => sum + expense.amount, 0);
  const generalExpenses = totalExpenses - productLinkedExpenses;
  const dailyBurnRate = filteredExpenses.length === 0 ? 0 : Math.round(totalExpenses / Math.max(1, new Set(filteredExpenses.map((expense) => expense.date)).size));
  const expenseDeliveredRows = deliveredOrderRows.filter((order) => isInPeriod(orderDeliveredKey(order), expensePeriod, expenseDateRange));
  const expenseRevenue = expenseDeliveredRows.reduce((sum, order) => sum + order.amount, 0);
  const expenseCogs = expenseDeliveredRows.reduce((sum, order) => sum + costForOrder(order), 0);
  const expenseNetProfit = expenseRevenue - expenseCogs - totalExpenses;
  const expenseMargin = expenseRevenue === 0 ? 0 : Math.round((expenseNetProfit / expenseRevenue) * 1000) / 10;
  // Product filter helpers — applied across all finance computations
  const productFilterActive = financeProductFilter.length > 0;
  const orderMatchesProductFilter = (order: TrackedOrder) => !productFilterActive || (order.productId != null && financeProductFilter.includes(order.productId));
  const expenseMatchesProductFilter = (expense: ExpenseRecord) => !productFilterActive || (expense.productId == null) || financeProductFilter.includes(expense.productId);
  const financeExpenses = expenses.filter((expense) => isInPeriod(expense.date, financePeriod, financeDateRange) && expenseMatchesProductFilter(expense));
  const financeExpenseTotal = financeExpenses.reduce((sum, expense) => sum + expense.amount, 0);
  const financeProductLinkedExpenses = financeExpenses.filter((expense) => expense.productId).reduce((sum, expense) => sum + expense.amount, 0);
  const financeGeneralExpenses = financeExpenseTotal - financeProductLinkedExpenses;
  const financeDeliveredRows = deliveredOrderRows.filter((order) => isInPeriod(orderDeliveredKey(order), financePeriod, financeDateRange) && orderMatchesProductFilter(order));
  const financeRevenue = financeDeliveredRows.reduce((sum, order) => sum + order.amount, 0);
  const financeCogs = financeDeliveredRows.reduce((sum, order) => sum + costForOrder(order), 0);
  const financeGrossProfit = financeRevenue - financeCogs;
  const financeNetProfit = financeGrossProfit - financeExpenseTotal;
  const financeGrossMargin = financeRevenue === 0 ? 0 : Math.round((financeGrossProfit / financeRevenue) * 1000) / 10;
  const financeNetMargin = financeRevenue === 0 ? 0 : Math.round((financeNetProfit / financeRevenue) * 1000) / 10;
  const financeDeliveredCount = financeDeliveredRows.length;
  const financeAvgCpa = financeDeliveredCount === 0 ? 0 : Math.round(financeExpenseTotal / financeDeliveredCount);
  const financeRoi = financeCogs + financeExpenseTotal === 0 ? 0 : Math.round((financeNetProfit / (financeCogs + financeExpenseTotal)) * 100);
  const financeRepRows = salesRepUsers.map((user) => {
    const delivered = financeDeliveredRows.filter((order) => order.assignedRepId === user.id);
    const revenue = delivered.reduce((sum, order) => sum + order.amount, 0);
    const cogs = delivered.reduce((sum, order) => sum + costForOrder(order), 0);
    const allocatedExpenses = financeDeliveredCount === 0 ? 0 : Math.round(financeExpenseTotal * (delivered.length / financeDeliveredCount));
    const netProfit = revenue - cogs - allocatedExpenses;
    return {
      user,
      revenue,
      delivered: delivered.length,
      netProfit,
      cpa: delivered.length === 0 ? 0 : Math.round(allocatedExpenses / delivered.length),
      roi: cogs + allocatedExpenses === 0 ? 0 : Math.round((netProfit / (cogs + allocatedExpenses)) * 100)
    };
  });
  const filteredFinanceRepRows = financeRepRows.filter((row) => {
    const search = financeRepSearch.trim().toLowerCase();
    return !search || `${row.user.name} ${row.user.email}`.toLowerCase().includes(search);
  });
  const topFinanceRep = [...financeRepRows].sort((a, b) => b.netProfit - a.netProfit)[0];
  const financeAgentRows = agentRows.map((row) => {
    const delivered = financeDeliveredRows.filter((order) => order.agentId === row.agent.id);
    const revenue = delivered.reduce((sum, order) => sum + order.amount, 0);
    const cogs = delivered.reduce((sum, order) => sum + costForOrder(order), 0);
    return { ...row, deliveries: delivered.length, profitContribution: revenue - cogs };
  });
  const financeAgentDeliveredCount = financeAgentRows.reduce((sum, row) => sum + row.deliveries, 0);

  // ===== Remittance (Pay-on-Delivery cash reconciliation) =====
  const orderLogisticsCost = (order: TrackedOrder) => order.logisticsCost ?? 0;
  const orderAmountToRemit = (order: TrackedOrder) => Math.max(0, order.amount - orderLogisticsCost(order));
  const orderAmountRemitted = (order: TrackedOrder) => order.amountRemitted ?? 0;
  const orderRemittanceOutstanding = (order: TrackedOrder) => Math.max(0, orderAmountToRemit(order) - orderAmountRemitted(order));
  const orderRemittanceStatus = (order: TrackedOrder): "Pending" | "Partial" | "Paid" => {
    if (order.remittanceStatus) return order.remittanceStatus;
    const remitted = orderAmountRemitted(order);
    const expected = orderAmountToRemit(order);
    if (remitted <= 0) return "Pending";
    if (remitted >= expected) return "Paid";
    return "Partial";
  };

  // Per-partner aggregation for the selected finance period (delivered orders only)
  const remittanceDaysAgo = (order: TrackedOrder) => {
    const key = order.deliveredDate ?? orderCreatedKey(order);
    if (!key) return 0;
    const d = new Date(key);
    if (isNaN(d.getTime())) return 0;
    return Math.floor((Date.now() - d.getTime()) / 86400000);
  };
  const remittanceAgingLabel = (days: number): { label: string; cls: string } => {
    if (days <= 3) return { label: `${days}d`, cls: "bg-green-100 text-green-700" };
    if (days <= 7) return { label: `${days}d`, cls: "bg-amber-100 text-amber-700" };
    return { label: `${days}d overdue`, cls: "bg-red-100 text-red-700" };
  };
  const remittanceRows = (() => {
    const partnerMap = new Map<string, { partnerName: string; agentId: string | null; orderCount: number; revenue: number; logisticsCost: number; expected: number; remitted: number; outstanding: number; oldestUnpaidDays: number; orders: TrackedOrder[] }>();
    financeDeliveredRows.forEach((order) => {
      const agent = agents.find((a) => a.id === order.agentId);
      const partnerName = agent?.name ?? "Unassigned";
      const key = agent?.id ?? "unassigned";
      const current = partnerMap.get(key) ?? { partnerName, agentId: agent?.id ?? null, orderCount: 0, revenue: 0, logisticsCost: 0, expected: 0, remitted: 0, outstanding: 0, oldestUnpaidDays: 0, orders: [] };
      current.orderCount += 1;
      current.revenue += order.amount;
      current.logisticsCost += orderLogisticsCost(order);
      current.expected += orderAmountToRemit(order);
      current.remitted += orderAmountRemitted(order);
      current.outstanding += orderRemittanceOutstanding(order);
      if (orderRemittanceStatus(order) !== "Paid") {
        const days = remittanceDaysAgo(order);
        if (days > current.oldestUnpaidDays) current.oldestUnpaidDays = days;
      }
      current.orders.push(order);
      partnerMap.set(key, current);
    });
    return Array.from(partnerMap.values()).sort((a, b) => b.outstanding - a.outstanding);
  })();
  const totalRemittanceExpected = remittanceRows.reduce((s, r) => s + r.expected, 0);
  const totalRemittanceReceived = remittanceRows.reduce((s, r) => s + r.remitted, 0);
  const totalRemittanceOutstanding = remittanceRows.reduce((s, r) => s + r.outstanding, 0);
  const totalLogisticsCost = remittanceRows.reduce((s, r) => s + r.logisticsCost, 0);
  const remittancePartnerOptions = ["All Partners", ...remittanceRows.map((r) => r.partnerName)];
  const filteredRemittanceRows = remittanceRows.filter((row) => {
    const matchPartner = remittancePartnerFilter === "All Partners" || row.partnerName === remittancePartnerFilter;
    const search = remittanceSearch.trim().toLowerCase();
    const matchSearch = !search || row.partnerName.toLowerCase().includes(search);
    return matchPartner && matchSearch;
  });

  const recordRemittance = () => {
    const order = trackedOrders.find((o) => o.id === remittanceTargetOrderId);
    if (!order) { showToast("Order not found."); return; }
    const newLogistics = remittanceLogisticsCost.trim() === "" ? (order.logisticsCost ?? 0) : Math.max(0, Number(remittanceLogisticsCost) || 0);
    const newRemitted = remittanceAmount.trim() === "" ? (order.amountRemitted ?? 0) : Math.max(0, Number(remittanceAmount) || 0);
    const expected = Math.max(0, order.amount - newLogistics);
    const status: "Pending" | "Partial" | "Paid" = newRemitted <= 0 ? "Pending" : newRemitted >= expected ? "Paid" : "Partial";
    setTrackedOrders((prev) => prev.map((o) => o.id === order.id ? {
      ...o,
      logisticsCost: newLogistics,
      amountRemitted: newRemitted,
      remittanceStatus: status,
      notes: [orderTimelineNote(`Remittance updated — logistics ${formatMoney(newLogistics)}, received ${formatMoney(newRemitted)}, ${status.toLowerCase()}.`), ...(o.notes ?? [])]
    } : o));
    const _rrId = order.id;
    setModal(null);
    setRemittanceAmount("");
    setRemittanceLogisticsCost("");
    showToast(`${order.id} remittance saved (${status}).`);
    ordersApi.update(_rrId, { logistics_cost: newLogistics, amount_remitted: newRemitted, remittance_status: status }).catch(() => {});
  };

  const openRecordRemittance = (order: TrackedOrder) => {
    setRemittanceTargetOrderId(order.id);
    setRemittanceLogisticsCost(String(order.logisticsCost ?? ""));
    setRemittanceAmount(String(order.amountRemitted ?? ""));
    setModal("recordRemittance");
  };

  const remittanceTargetOrder = trackedOrders.find((o) => o.id === remittanceTargetOrderId);

  // ===== Customer flags =====
  const normalizePhone = (phone: string) => phone.replace(/\D/g, "");
  const isCustomerFlagged = (phone: string) => {
    const flag = customerFlags[normalizePhone(phone)];
    return flag?.flagged === true;
  };
  const openFlagCustomer = (phone: string) => {
    const existing = customerFlags[normalizePhone(phone)];
    setFlagTargetPhone(phone);
    setFlagReasonDraft(existing?.reason ?? "");
    setModal("flagCustomer" as ModalType);
  };
  const saveFlagCustomer = () => {
    const key = normalizePhone(flagTargetPhone);
    setCustomerFlags((prev) => ({ ...prev, [key]: { flagged: true, reason: flagReasonDraft.trim(), flaggedAt: new Date().toISOString() } }));
    setModal(null);
    showToast("Customer flagged.");
    customersApi.flag({ phone: flagTargetPhone, reason: flagReasonDraft.trim() }).catch(() => {});
  };
  const unflagCustomer = (phone: string) => {
    const key = normalizePhone(phone);
    setCustomerFlags((prev) => { const next = { ...prev }; delete next[key]; return next; });
    customersApi.unflag(phone).catch(() => {});
    showToast("Customer flag removed.");
  };

  // ===== System notifications =====
  const pushSystemNotification = (notification: Omit<SystemNotification, "id" | "read" | "createdAt">) => {
    setSystemNotifications((prev) => [
      { ...notification, id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, read: false, createdAt: new Date().toISOString() },
      ...prev
    ]);
  };
  const markAllNotificationsRead = () => {
    setSystemNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    notificationsApi.markAllRead().catch(() => {});
    showToast("All notifications marked as read.");
  };
  const unreadNotificationCount = systemNotifications.filter((n) => !n.read).length;

  // ===== Stock count =====
  const activeStockCount = stockCounts.find((s) => s.id === activeStockCountId) ?? null;

  const openNewStockCount = () => {
    const dateLabel = new Date().toLocaleDateString("en-NG", { day: "2-digit", month: "short", year: "numeric" });
    setStockCountTitleDraft(`Stock Count — ${dateLabel}`);
    setStockCountAgentIdsDraft(agents.map((a) => a.id));
    setModal("newStockCount");
  };

  const createStockCountSession = () => {
    const entries: StockCountEntry[] = [];
    for (const agentId of stockCountAgentIdsDraft) {
      const agent = agents.find((a) => a.id === agentId);
      if (!agent) continue;
      const stocks = agentStock.filter((s) => s.agentId === agentId && s.quantity > 0);
      for (const stock of stocks) {
        const product = products.find((p) => p.id === stock.productId);
        if (!product) continue;
        entries.push({
          id: `sce-${agentId}-${stock.productId}-${Date.now()}`,
          productId: stock.productId,
          productName: product.name,
          agentId,
          agentName: agent.name,
          systemQty: stock.quantity,
          status: "Pending"
        });
      }
    }
    const session: StockCountSession = {
      id: `sc-${Date.now()}`,
      title: stockCountTitleDraft.trim() || `Stock Count ${new Date().toLocaleDateString()}`,
      createdAt: new Date().toISOString(),
      createdBy: ownerName,
      status: "Open",
      entries
    };
    setStockCounts((prev) => [session, ...prev]);
    setActiveStockCountId(session.id);
    setModal(null);
    setInventoryView("stockcount");
    showToast("Stock count session created.");
  };

  const openStockCountEntry = (entryId: string) => {
    const entry = stockCounts.flatMap((s) => s.entries).find((e) => e.id === entryId);
    if (!entry) return;
    setStockCountEntryId(entryId);
    setAgentCountDraft(entry.agentCount !== undefined ? String(entry.agentCount) : "");
    setAdminCountDraft(entry.adminCount !== undefined ? String(entry.adminCount) : "");
    setStockCountNotesDraft(entry.notes ?? "");
    setModal("stockCountEntry");
  };

  const saveStockCountEntry = () => {
    const agentCount = agentCountDraft !== "" ? parseInt(agentCountDraft, 10) : undefined;
    const adminCount = adminCountDraft !== "" ? parseInt(adminCountDraft, 10) : undefined;
    let status: StockCountStatus = "Pending";
    if (agentCount !== undefined && adminCount !== undefined) {
      status = agentCount === adminCount ? "Verified" : "Discrepancy";
    } else if (agentCount !== undefined) {
      status = "Agent Submitted";
    } else if (adminCount !== undefined) {
      status = "Admin Confirmed";
    }
    const variance = agentCount !== undefined && adminCount !== undefined ? agentCount - adminCount : undefined;
    const verifiedAt = status === "Verified" ? new Date().toISOString() : undefined;
    const now = new Date().toISOString();
    setStockCounts((prev) => prev.map((session) => ({
      ...session,
      entries: session.entries.map((entry) =>
        entry.id === stockCountEntryId
          ? { ...entry, agentCount, adminCount, status, variance, verifiedAt, agentSubmittedAt: agentCount !== undefined ? now : entry.agentSubmittedAt, adminConfirmedAt: adminCount !== undefined ? now : entry.adminConfirmedAt, notes: stockCountNotesDraft.trim() || undefined }
          : entry
      )
    })));
    setModal(null);
    showToast(status === "Verified" ? "Verified — counts match." : status === "Discrepancy" ? "Discrepancy recorded." : "Count saved.");
  };

  const openAdjustStockFromCount = (entry: StockCountEntry) => {
    if (entry.agentCount === undefined) return;
    setAdjustStockEntryId(entry.id);
    setWriteOffReason("");
    setWriteOffCustomReason("");
    setModal("adjustStockCount");
  };

  const confirmAdjustStockFromCount = () => {
    const entry = stockCounts.flatMap((s) => s.entries).find((e) => e.id === adjustStockEntryId);
    if (!entry || entry.agentCount === undefined) return;
    const delta = entry.agentCount - entry.systemQty;
    const reasonLabel = writeOffReason === "Other" && writeOffCustomReason.trim() ? writeOffCustomReason.trim() : writeOffReason || "Unspecified";
    setAgentStock((prev) => prev.map((s) =>
      s.agentId === entry.agentId && s.productId === entry.productId ? { ...s, quantity: entry.agentCount! } : s
    ));
    setStockMovements((prev) => [{
      id: makeMovementId(),
      date: new Date().toISOString(),
      productId: entry.productId,
      productName: entry.productName,
      type: "Correction" as StockMovementType,
      qty: Math.abs(delta),
      balanceAfter: entry.agentCount!,
      agent: entry.agentName,
      by: ownerName,
      note: `Write-off: ${delta >= 0 ? "+" : ""}${delta} units — ${reasonLabel}. (Stock count reconciliation)`
    }, ...prev]);
    setStockCounts((prev) => prev.map((session) => ({
      ...session,
      entries: session.entries.map((e) =>
        e.id === entry.id ? { ...e, status: "Verified", systemQty: entry.agentCount!, variance: 0, verifiedAt: new Date().toISOString() } : e
      )
    })));
    setModal(null);
    showToast("Stock adjusted to match agent count.");
  };

  const closeStockCountSession = (sessionId: string) => {
    setStockCounts((prev) => prev.map((s) => s.id === sessionId ? { ...s, status: "Closed", closedAt: new Date().toISOString() } : s));
    showToast("Stock count session closed.");
  };


  // ===== Bonus settings + state availability + cross-sell + free gift + manual bonus + penalty openers =====
  const openBonusSettings = (product: Product) => {
    if (!product.bonusConfig) {
      setProducts((prev) => prev.map((p) => p.id === product.id ? { ...p, bonusConfig: defaultBonusConfig() } : p));
    }
    setBonusSettingsProductId(product.id);
    setModal("bonusSettings");
  };
  const openStateAvailability = (product: Product) => {
    setStateAvailabilityProductId(product.id);
    setModal("stateAvailability");
  };
  const openCrossSellModal = (order: TrackedOrder) => {
    setCrossSellTargetOrderId(order.id);
    setCrossSellProductId("");
    setCrossSellQuantity("1");
    setCrossSellAmount("");
    setModal("addCrossSell");
  };
  const openFreeGiftModal = (order: TrackedOrder) => {
    setFreeGiftTargetOrderId(order.id);
    setFreeGiftProductId("");
    setFreeGiftQuantity("1");
    setModal("addFreeGift");
  };
  const openManualBonusModal = (order: TrackedOrder) => {
    setManualBonusTargetOrderId(order.id);
    setManualBonusAmount(String(order.manualBonusOverride ?? ""));
    setManualBonusReasonText(order.manualBonusReason ?? "");
    setModal("manualBonus");
  };
  const openAddPenalty = (repId?: string, orderId?: string) => {
    setPenaltyTargetRepId(repId ?? "");
    setPenaltyOrderId(orderId ?? "");
    setPenaltyType("Wrong Data Entry");
    setPenaltyAmount("500");
    setPenaltyReason("");
    setPenaltyRemoveAllBonuses(false);
    setModal("addPenalty");
  };

  const updateProductBonusConfig = (productId: string, mutator: (cfg: ProductBonusConfig) => ProductBonusConfig) => {
    setProducts((prev) => prev.map((p) => p.id === productId ? { ...p, bonusConfig: mutator(p.bonusConfig ?? defaultBonusConfig()) } : p));
  };

  const updateProductStates = (productId: string, states: string[]) => {
    setProducts((prev) => prev.map((p) => p.id === productId ? { ...p, availableStates: states } : p));
  };

  const updateProductRole = (productId: string, role: ProductRole) => {
    setProducts((prev) => prev.map((p) => p.id === productId ? { ...p, role } : p));
  };

  const saveCrossSell = () => {
    const order = trackedOrders.find((o) => o.id === crossSellTargetOrderId);
    if (!order) return;
    const product = products.find((p) => p.id === crossSellProductId);
    const qty = Math.max(1, Number(crossSellQuantity) || 1);
    const price = Number(crossSellAmount) || (product ? (primaryPricing(product)?.sellingPrice ?? 0) * qty : 0);
    if (!product) {
      showToast("Pick a product");
      return;
    }
    const line: CrossSellLine = {
      id: makeCrossSellLineId(),
      productId: product.id,
      productName: product.name,
      quantity: qty,
      amount: price
    };
    setTrackedOrders((prev) => prev.map((o) => o.id === order.id ? {
      ...o,
      crossSellLines: [...(o.crossSellLines ?? []), line],
      amount: o.amount + price
    } : o));
    closeModal();
    showToast(`Cross-sell ${product.name} added to ${order.id}`);
  };

  const removeCrossSell = (orderId: string, lineId: string) => {
    setTrackedOrders((prev) => prev.map((o) => {
      if (o.id !== orderId) return o;
      const removed = (o.crossSellLines ?? []).find((line) => line.id === lineId);
      const refund = removed?.amount ?? 0;
      return {
        ...o,
        crossSellLines: (o.crossSellLines ?? []).filter((line) => line.id !== lineId),
        amount: Math.max(0, o.amount - refund)
      };
    }));
    showToast("Cross-sell removed");
  };

  const saveFreeGift = () => {
    const order = trackedOrders.find((o) => o.id === freeGiftTargetOrderId);
    if (!order) return;
    const product = products.find((p) => p.id === freeGiftProductId);
    if (!product) {
      showToast("Pick a free-gift product");
      return;
    }
    const qty = Math.max(1, Number(freeGiftQuantity) || 1);
    const line: FreeGiftLine = {
      id: makeFreeGiftLineId(),
      productId: product.id,
      productName: product.name,
      quantity: qty
    };
    setTrackedOrders((prev) => prev.map((o) => o.id === order.id ? {
      ...o,
      freeGiftLines: [...(o.freeGiftLines ?? []), line]
    } : o));
    closeModal();
    showToast(`Free gift ${product.name} added`);
  };

  const removeFreeGift = (orderId: string, lineId: string) => {
    setTrackedOrders((prev) => prev.map((o) => o.id === orderId ? {
      ...o,
      freeGiftLines: (o.freeGiftLines ?? []).filter((line) => line.id !== lineId)
    } : o));
    showToast("Free gift removed");
  };

  const saveManualBonus = () => {
    const order = trackedOrders.find((o) => o.id === manualBonusTargetOrderId);
    if (!order) return;
    const amount = Number(manualBonusAmount);
    if (Number.isNaN(amount) || amount < 0) {
      showToast("Enter a valid amount");
      return;
    }
    setTrackedOrders((prev) => prev.map((o) => o.id === order.id ? {
      ...o,
      manualBonusOverride: amount,
      manualBonusReason: manualBonusReasonText.trim(),
      bonusManuallyAdjusted: true
    } : o));
    closeModal();
    showToast(`Bonus override set on ${order.id}`);
  };

  const clearManualBonus = (orderId: string) => {
    setTrackedOrders((prev) => prev.map((o) => o.id === orderId ? {
      ...o,
      manualBonusOverride: undefined,
      manualBonusReason: undefined,
      bonusManuallyAdjusted: false
    } : o));
    showToast("Manual bonus cleared");
  };

  const savePenalty = () => {
    if (!penaltyTargetRepId) {
      showToast("Pick a sales rep");
      return;
    }
    const rep = users.find((u) => u.id === penaltyTargetRepId);
    const amount = Number(penaltyAmount) || 0;
    const record: RepPenaltyRecord = {
      id: makePenaltyId(),
      repId: penaltyTargetRepId,
      repName: rep?.name ?? "Unknown",
      type: penaltyType,
      amount,
      removeAllBonuses: penaltyRemoveAllBonuses,
      orderId: penaltyOrderId || undefined,
      reason: penaltyReason.trim(),
      date: new Date().toISOString(),
      by: ownerName
    };
    setRepPenalties((prev) => [record, ...prev]);
    closeModal();
    showToast(`Penalty applied to ${record.repName}`);
  };

  const removePenalty = (penaltyId: string) => {
    setRepPenalties((prev) => prev.filter((p) => p.id !== penaltyId));
    showToast("Penalty removed");
  };

  // ===== Bonus engine =====
  // Computes per-order bonus given the rep's weekly delivery rate.
  // Pure compute (no side-effects) — returns components for transparency.
  const computeOrderBonus = (
    order: TrackedOrder,
    repWeeklyDeliveryRate: number,
    repWeeklyAOV: number,
    repWeeklyOrderCount: number
  ) => {
    if (order.bonusManuallyAdjusted && typeof order.manualBonusOverride === "number") {
      return { base: 0, upgrade: 0, crossSell: 0, freeGift: 0, manual: order.manualBonusOverride, total: order.manualBonusOverride, components: [{ label: "Manual override", amount: order.manualBonusOverride }] };
    }
    if (order.status !== "Delivered") {
      return { base: 0, upgrade: 0, crossSell: 0, freeGift: 0, manual: 0, total: 0, components: [] as { label: string; amount: number }[] };
    }
    const product = products.find((p) => p.id === order.productId);
    const cfg = productBonusConfig(product);
    const components: { label: string; amount: number }[] = [];
    const qty = quantityForOrder(order);
    const isManualSourced = order.source === "WhatsApp";

    // Base or manual-source bonus (mutually exclusive — manual wins if WhatsApp)
    let base = 0;
    if (isManualSourced) {
      const m = cfg.manualOrderBonuses.find((rule) => rule.quantity === qty)
        ?? cfg.manualOrderBonuses.slice().sort((a, b) => Math.abs(a.quantity - qty) - Math.abs(b.quantity - qty))[0];
      base = m?.amount ?? 0;
      if (base > 0) components.push({ label: `Manual order ${qty}pcs`, amount: base });
    } else {
      const b = cfg.baseDelivered.find((rule) => rule.quantity === qty)
        ?? cfg.baseDelivered.slice().sort((a, b2) => Math.abs(a.quantity - qty) - Math.abs(b2.quantity - qty))[0];
      base = b?.amount ?? 0;
      if (base > 0) components.push({ label: `Base ${qty}pcs`, amount: base });
    }

    // Upgrade bonus (only if delivery rate gate met)
    let upgrade = 0;
    if (order.upsellFromQty && order.upsellToQty && order.upsellToQty > order.upsellFromQty && repWeeklyDeliveryRate >= cfg.upgradeRequiresMinDeliveryRate) {
      const rule = cfg.upgradeBonuses.find((r) => r.fromQty === order.upsellFromQty && r.toQty === order.upsellToQty);
      upgrade = rule?.amount ?? 0;
      if (upgrade > 0) components.push({ label: `Upgrade ${order.upsellFromQty}→${order.upsellToQty}`, amount: upgrade });
    }

    // Cross-sell bonus
    let crossSell = 0;
    if (order.crossSellLines && order.crossSellLines.length > 0) {
      const xsTotal = order.crossSellLines.reduce((sum, line) => sum + (line.amount || 0), 0);
      crossSell = Math.round(xsTotal * (cfg.crossSellPercent / 100)) + cfg.crossSellFixed * order.crossSellLines.length;
      if (crossSell > 0) components.push({ label: `Cross-sell ${cfg.crossSellPercent}%`, amount: crossSell });
    }

    // Free-gift bonus
    let freeGift = 0;
    if (order.freeGiftLines && order.freeGiftLines.length > 0 && cfg.freeGiftBonus > 0) {
      freeGift = cfg.freeGiftBonus * order.freeGiftLines.length;
      components.push({ label: `Free gifts (${order.freeGiftLines.length})`, amount: freeGift });
    }

    // Poor delivery rate gate — only base survives
    if (repWeeklyOrderCount >= cfg.deliveryRateMinOrders && repWeeklyDeliveryRate < cfg.poorDeliveryRatePercent) {
      const total = base;
      return { base, upgrade: 0, crossSell: 0, freeGift: 0, manual: 0, total, components: [{ label: `Base only (rate <${cfg.poorDeliveryRatePercent}%)`, amount: base }] };
    }

    void repWeeklyAOV;
    const total = base + upgrade + crossSell + freeGift;
    return { base, upgrade, crossSell, freeGift, manual: 0, total, components };
  };

  // Projected bonus: what the rep would earn IF this order is delivered — ignores status check
  const projectedOrderBonus = (order: TrackedOrder) => {
    if (order.bonusManuallyAdjusted && typeof order.manualBonusOverride === "number") {
      return { total: order.manualBonusOverride, components: [{ label: "Manual override", amount: order.manualBonusOverride }] };
    }
    const product = products.find((p) => p.id === order.productId);
    const cfg = productBonusConfig(product);
    const components: { label: string; amount: number }[] = [];
    const qty = quantityForOrder(order);
    const isManualSourced = order.source === "WhatsApp";
    let base = 0;
    if (isManualSourced) {
      const m = cfg.manualOrderBonuses.find((r) => r.quantity === qty)
        ?? cfg.manualOrderBonuses.slice().sort((a, b) => Math.abs(a.quantity - qty) - Math.abs(b.quantity - qty))[0];
      base = m?.amount ?? 0;
      if (base > 0) components.push({ label: `Manual order ${qty}pcs`, amount: base });
    } else {
      const b = cfg.baseDelivered.find((r) => r.quantity === qty)
        ?? cfg.baseDelivered.slice().sort((a, b2) => Math.abs(a.quantity - qty) - Math.abs(b2.quantity - qty))[0];
      base = b?.amount ?? 0;
      if (base > 0) components.push({ label: `Base ${qty}pcs`, amount: base });
    }
    let upgrade = 0;
    if (order.upsellFromQty && order.upsellToQty && order.upsellToQty > order.upsellFromQty) {
      const rule = cfg.upgradeBonuses.find((r) => r.fromQty === order.upsellFromQty && r.toQty === order.upsellToQty);
      upgrade = rule?.amount ?? 0;
      if (upgrade > 0) components.push({ label: `Upgrade ${order.upsellFromQty}→${order.upsellToQty}`, amount: upgrade });
    }
    let crossSell = 0;
    if (order.crossSellLines && order.crossSellLines.length > 0) {
      const xsTotal = order.crossSellLines.reduce((s, l) => s + (l.amount || 0), 0);
      crossSell = Math.round(xsTotal * (cfg.crossSellPercent / 100)) + cfg.crossSellFixed * order.crossSellLines.length;
      if (crossSell > 0) components.push({ label: `Cross-sell`, amount: crossSell });
    }
    let freeGift = 0;
    if (order.freeGiftLines && order.freeGiftLines.length > 0 && cfg.freeGiftBonus > 0) {
      freeGift = cfg.freeGiftBonus * order.freeGiftLines.length;
      components.push({ label: `Free gifts (${order.freeGiftLines.length})`, amount: freeGift });
    }
    return { total: base + upgrade + crossSell + freeGift, components };
  };

  // ===== Performance tiers (shared across State Performance & Product Profitability) =====
  // Industry benchmark for Nigerian POD ecommerce: ≥60% delivery = Good, 50-59% = Fair, <50% = Bad
  const performanceTier = (deliveryRate: number): "Good" | "Fair" | "Bad" => {
    if (deliveryRate >= 60) return "Good";
    if (deliveryRate >= 50) return "Fair";
    return "Bad";
  };
  const performanceTone = (tier: "Good" | "Fair" | "Bad") =>
    tier === "Good" ? "bg-green-100 text-green-700 border border-green-200"
    : tier === "Fair" ? "bg-amber-100 text-amber-700 border border-amber-200"
    : "bg-red-100 text-red-700 border border-red-200";

  // ===== State performance — every state with at least one period order, grouped =====
  const financePeriodOrders = trackedOrders.filter((order) => isInPeriod(orderCreatedKey(order), financePeriod, financeDateRange) && orderMatchesProductFilter(order));
  const stateRows = (() => {
    const map = new Map<string, { state: string; total: number; delivered: number; cancelled: number; failed: number; pending: number; revenue: number; cogs: number }>();
    financePeriodOrders.forEach((order) => {
      const stateName = (order.state || order.location || "Unknown").trim() || "Unknown";
      const status = order.status ?? "New";
      const cur = map.get(stateName) ?? { state: stateName, total: 0, delivered: 0, cancelled: 0, failed: 0, pending: 0, revenue: 0, cogs: 0 };
      cur.total += 1;
      if (status === "Delivered") {
        cur.delivered += 1;
        cur.revenue += order.amount;
        cur.cogs += costForOrder(order);
      } else if (status === "Cancelled") {
        cur.cancelled += 1;
      } else if (status === "Failed") {
        cur.failed += 1;
      } else {
        cur.pending += 1;
      }
      map.set(stateName, cur);
    });
    return Array.from(map.values()).map((s) => {
      const deliveryRate = s.total === 0 ? 0 : Math.round((s.delivered / s.total) * 100);
      return { ...s, deliveryRate, tier: performanceTier(deliveryRate), grossProfit: s.revenue - s.cogs };
    }).sort((a, b) => b.deliveryRate - a.deliveryRate || b.delivered - a.delivered);
  })();
  const topStateRows = stateRows.filter((s) => s.tier === "Good").slice(0, 5);
  const worstStateRows = [...stateRows].filter((s) => s.tier === "Bad" && s.total >= 2).reverse().slice(0, 5);

  // ===== Rep workspace: delivery fee + auto remit + optional extra expenses =====
  const repExtrasTotal = repExtraExpenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  const repAutoAmountToRemit = (orderAmount: number) => Math.max(0, orderAmount - (Number(repDeliveryFee) || 0) - repExtrasTotal);
  const updateRepDeliveryFee = (val: string, orderAmount: number) => {
    setRepDeliveryFee(val);
    const fee = Number(val) || 0;
    setRepAmountToRemit(String(Math.max(0, orderAmount - fee - repExtrasTotal)));
  };
  const updateRepExtraExpense = (index: number, key: "type" | "amount" | "description", val: string, orderAmount: number) => {
    const next = repExtraExpenses.map((item, i) => i === index ? { ...item, [key]: val } : item);
    setRepExtraExpenses(next);
    const newTotal = next.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
    const fee = Number(repDeliveryFee) || 0;
    setRepAmountToRemit(String(Math.max(0, orderAmount - fee - newTotal)));
  };
  const addRepExtraExpense = () => setRepExtraExpenses((prev) => [...prev, { type: "Other", amount: "", description: "" }]);
  const removeRepExtraExpense = (index: number, orderAmount: number) => {
    const next = repExtraExpenses.filter((_, i) => i !== index);
    setRepExtraExpenses(next);
    const newTotal = next.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
    const fee = Number(repDeliveryFee) || 0;
    setRepAmountToRemit(String(Math.max(0, orderAmount - fee - newTotal)));
  };
  const saveRepDeliveryDetails = (order: TrackedOrder) => {
    const fee = Math.max(0, Number(repDeliveryFee) || 0);
    const remit = Math.max(0, Number(repAmountToRemit) || 0);
    const expected = Math.max(0, order.amount - fee);
    const status: "Pending" | "Partial" | "Paid" = remit <= 0 ? "Pending" : remit >= expected ? "Paid" : "Partial";
    const validExtras = repExtraExpenses.filter((e) => Number(e.amount) > 0);
    setTrackedOrders((prev) => prev.map((o) => o.id === order.id ? {
      ...o,
      logisticsCost: fee,
      amountRemitted: remit,
      remittanceStatus: status,
      notes: [orderTimelineNote(`Delivery fee ${formatProductMoney(fee, o.currency)} · remitted ${formatProductMoney(remit, o.currency)} (${status})${validExtras.length > 0 ? ` · ${validExtras.length} extra expense${validExtras.length === 1 ? "" : "s"} logged` : ""}.`, undefined, repScopeName), ...(o.notes ?? [])]
    } : o));
    if (validExtras.length > 0) {
      const today = todayKey();
      const newExpenses: ExpenseRecord[] = validExtras.map((e) => ({
        id: makeExpenseId(),
        type: e.type,
        amount: Number(e.amount) || 0,
        currency,
        date: today,
        productId: order.productId,
        productName: order.productName,
        description: `${e.description.trim() || `${e.type} for order ${order.id}`} (auto-logged from rep console)`
      }));
      setExpenses((prev) => [...newExpenses, ...prev]);
    }
    setRepExtraExpenses([]);
    showToast(`${order.id} delivery details saved${validExtras.length > 0 ? ` · ${validExtras.length} expense${validExtras.length === 1 ? "" : "s"} added` : ""}.`);
  };
  const productProfitabilityRows = products.map((product) => {
    const allOrders = financePeriodOrders.filter((order) => order.productId === product.id);
    const delivered = financeDeliveredRows.filter((order) => order.productId === product.id);
    const unitsSold = delivered.reduce((sum, order) => {
      const packageRecord = product.packages.find((item) => item.id === order.packageId);
      return sum + (order.quantity ?? packageRecord?.quantity ?? 1);
    }, 0);
    const revenue = delivered.reduce((sum, order) => sum + order.amount, 0);
    const cogs = delivered.reduce((sum, order) => sum + costForOrder(order), 0);
    const productExpenses = financeExpenses.filter((expense) => expense.productId === product.id).reduce((sum, expense) => sum + expense.amount, 0);
    const netProfit = revenue - cogs - productExpenses;
    const totalOrders = allOrders.length;
    const deliveryRate = totalOrders === 0 ? 0 : Math.round((delivered.length / totalOrders) * 100);
    return {
      product,
      totalOrders,
      deliveredCount: delivered.length,
      deliveryRate,
      tier: performanceTier(deliveryRate),
      unitsSold,
      revenue,
      cogs,
      expenses: productExpenses,
      netProfit,
      margin: revenue === 0 ? 0 : Math.round((netProfit / revenue) * 100),
      roi: cogs + productExpenses === 0 ? 0 : Math.round((netProfit / (cogs + productExpenses)) * 100)
    };
  }).filter((row) => row.product.name.toLowerCase().includes(financeProductSearch.trim().toLowerCase()) || row.product.sku.toLowerCase().includes(financeProductSearch.trim().toLowerCase()));
  const avgProductMargin = productProfitabilityRows.filter((row) => row.revenue > 0).length === 0 ? 0 : Math.round(productProfitabilityRows.filter((row) => row.revenue > 0).reduce((sum, row) => sum + row.margin, 0) / productProfitabilityRows.filter((row) => row.revenue > 0).length);
  const financeRoas = financeExpenseTotal === 0 ? (financeRevenue > 0 ? "Uncapped" : "N/A") : (financeRevenue / financeExpenseTotal).toFixed(2);

  const financeChartData = (() => {
    const now = new Date();
    const mkDay = (d: Date) => formatDateKey(d);
    const revForDay = (day: string) => financeDeliveredRows.filter((o) => orderDeliveredKey(o) === day).reduce((s, o) => s + o.amount, 0);
    const expForDay = (day: string) => financeExpenses.filter((e) => normalizeDateKey(e.date) === day).reduce((s, e) => s + e.amount, 0);
    const revForMonth = (mk: string) => financeDeliveredRows.filter((o) => (orderDeliveredKey(o) ?? "").startsWith(mk)).reduce((s, o) => s + o.amount, 0);
    const expForMonth = (mk: string) => financeExpenses.filter((e) => normalizeDateKey(e.date).startsWith(mk)).reduce((s, e) => s + e.amount, 0);

    if (financePeriod === "Today") {
      const day = mkDay(now);
      return [{ label: "Today", revenue: revForDay(day), expenses: expForDay(day) }];
    }
    if (financePeriod === "This Week") {
      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - now.getDay());
      return Array.from({ length: 7 }, (_, i) => {
        const d = new Date(weekStart);
        d.setDate(weekStart.getDate() + i);
        const day = mkDay(d);
        return { label: d.toLocaleDateString("en-US", { weekday: "short" }), revenue: revForDay(day), expenses: expForDay(day) };
      }).filter((_, i) => {
        const d = new Date(weekStart);
        d.setDate(weekStart.getDate() + i);
        return d <= now;
      });
    }
    if (financePeriod === "This Month") {
      const year = now.getFullYear();
      const month = now.getMonth();
      return Array.from({ length: now.getDate() }, (_, i) => {
        const day = formatDateKey(new Date(year, month, i + 1));
        return { label: String(i + 1), revenue: revForDay(day), expenses: expForDay(day) };
      });
    }
    if (financePeriod === "This Year") {
      return Array.from({ length: now.getMonth() + 1 }, (_, i) => {
        const mk = `${now.getFullYear()}-${String(i + 1).padStart(2, "0")}`;
        return { label: new Date(`${mk}-01T00:00:00`).toLocaleDateString("en-US", { month: "short" }), revenue: revForMonth(mk), expenses: expForMonth(mk) };
      });
    }
    if (financePeriod === "Custom" && financeDateRange.start && financeDateRange.end) {
      const start = new Date(`${financeDateRange.start}T00:00:00`);
      const end = new Date(`${financeDateRange.end}T00:00:00`);
      const diffDays = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
      if (diffDays <= 35) {
        return Array.from({ length: diffDays }, (_, i) => {
          const d = new Date(start);
          d.setDate(start.getDate() + i);
          const day = mkDay(d);
          return { label: String(d.getDate()), revenue: revForDay(day), expenses: expForDay(day) };
        });
      }
      const months: string[] = [];
      const cur = new Date(start);
      while (cur <= end) {
        const mk = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}`;
        if (!months.includes(mk)) months.push(mk);
        cur.setMonth(cur.getMonth() + 1);
      }
      return months.map((mk) => ({ label: new Date(`${mk}-01T00:00:00`).toLocaleDateString("en-US", { month: "short", year: "2-digit" }), revenue: revForMonth(mk), expenses: expForMonth(mk) }));
    }
    return [{ label: "Period", revenue: financeRevenue, expenses: financeExpenseTotal }];
  })();
  const financeChartMax = Math.max(...financeChartData.map((d) => Math.max(d.revenue, d.expenses)), 1);

  const agentStockIssueLoss = totalAgentDefectiveValue + totalAgentMissingValue;
  const agentStockLossRate = totalAgentStockValue === 0 ? 0 : Math.round((agentStockIssueLoss / totalAgentStockValue) * 1000) / 10;
  const topAgentsByDeliveries = [...financeAgentRows].sort((a, b) => b.deliveries - a.deliveries).slice(0, 3);
  const topAgentsByIssues = [...financeAgentRows].sort((a, b) => (b.defectiveValue + b.missingValue) - (a.defectiveValue + a.missingValue)).slice(0, 3);
  const customerRecords = Object.values(
    trackedOrders.filter((order) => isInPeriod(orderCreatedKey(order), customerPeriod, customerDateRange)).reduce<Record<string, { id: string; name: string; email: string; phone: string; orders: number; successful: number; cancelled: number; totalSpend: number; source: string }>>((acc, order) => {
      const key = order.email ? order.email.toLowerCase() : `${order.phone.replace(/\D/g, "")}-${order.customer.trim().toLowerCase()}`;
      const status = order.status ?? "New";
      const source = order.source ?? orderSourceFromUtm(order.utmSource);
      const current = acc[key] ?? { id: key, name: order.customer, email: order.email || "-", phone: order.phone, orders: 0, successful: 0, cancelled: 0, totalSpend: 0, source };
      current.orders += 1;
      current.successful += status === "Delivered" ? 1 : 0;
      current.cancelled += status === "Cancelled" ? 1 : 0;
      current.totalSpend += status === "Delivered" ? order.amount : 0;
      acc[key] = current;
      return acc;
    }, {})
  );
  const filteredCustomers = customerRecords.filter((customer) => {
    const search = customerSearch.trim().toLowerCase();
    const matchesSearch = !search || `${customer.name} ${customer.email} ${customer.phone}`.toLowerCase().includes(search);
    const matchesSource = customerSource === "Source: All" || customer.source === customerSource;
    return matchesSearch && matchesSource;
  });
  const activeCustomerCount = customerRecords.filter((customer) => customer.successful > 0).length;
  const returningRate = customerRecords.length === 0 ? 0 : Math.round((customerRecords.filter((customer) => customer.orders > 1).length / customerRecords.length) * 1000) / 10;
  const avgLifetimeValue = customerRecords.length === 0 ? 0 : Math.round(customerRecords.reduce((sum, customer) => sum + customer.totalSpend, 0) / customerRecords.length);
  const payrollMonthDelivered = deliveredOrderRows.filter((order) => {
    const key = orderDeliveredKey(order);
    const monthLabel = payrollMonth.trim();
    if (!key) return false;
    try {
      const d = new Date(`${key}T00:00:00`);
      return d.toLocaleString("en-US", { month: "long", year: "numeric" }) === monthLabel;
    } catch { return false; }
  });
  // ===== Weekly stats per rep, used by bonus engine gates =====
  // Group rep orders by ISO-week so AOV / delivery-rate / order-count gates can be applied per-week.
  const repWeeklyStats = (() => {
    const byRep = new Map<string, Map<string, { delivered: number; total: number; revenue: number }>>();
    payrollMonthDelivered.forEach((o) => {
      const repId = o.assignedRepId;
      if (!repId) return;
      const key = orderDeliveredKey(o) || orderCreatedKey(o);
      if (!key) return;
      const d = new Date(`${key}T00:00:00`);
      const yearStart = new Date(d.getFullYear(), 0, 1);
      const weekIdx = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + yearStart.getDay() + 1) / 7);
      const weekKey = `${d.getFullYear()}-W${weekIdx}`;
      const rep = byRep.get(repId) ?? new Map();
      const cur = rep.get(weekKey) ?? { delivered: 0, total: 0, revenue: 0 };
      cur.delivered += 1;
      cur.total += 1;
      cur.revenue += o.amount;
      rep.set(weekKey, cur);
      byRep.set(repId, rep);
    });
    // Add non-delivered orders to total counts so delivery rate denominator is correct.
    trackedOrders.forEach((o) => {
      if (o.status === "Delivered") return;
      const repId = o.assignedRepId;
      if (!repId) return;
      const key = orderCreatedKey(o);
      if (!key) return;
      const d = new Date(`${key}T00:00:00`);
      const monthLabel = d.toLocaleString("en-US", { month: "long", year: "numeric" });
      if (monthLabel !== payrollMonth.trim()) return;
      const yearStart = new Date(d.getFullYear(), 0, 1);
      const weekIdx = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + yearStart.getDay() + 1) / 7);
      const weekKey = `${d.getFullYear()}-W${weekIdx}`;
      const rep = byRep.get(repId) ?? new Map();
      const cur = rep.get(weekKey) ?? { delivered: 0, total: 0, revenue: 0 };
      cur.total += 1;
      rep.set(weekKey, cur);
      byRep.set(repId, rep);
    });
    return byRep;
  })();

  // ===== Auto-bonus per rep: sum of computeOrderBonus across that rep's delivered orders + AOV/delivery-rate weekly tier bonuses =====
  const computeRepAutoBonus = (repId: string) => {
    const orders = payrollMonthDelivered.filter((o) => o.assignedRepId === repId);
    if (orders.length === 0) return { perOrder: 0, weeklyTiers: 0, total: 0 };
    let perOrder = 0;
    orders.forEach((o) => {
      const stats = repWeeklyStats.get(repId);
      const key = orderDeliveredKey(o) || orderCreatedKey(o);
      let rate = 100, aov = 0, count = orders.length;
      if (key && stats) {
        const d = new Date(`${key}T00:00:00`);
        const yearStart = new Date(d.getFullYear(), 0, 1);
        const weekIdx = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + yearStart.getDay() + 1) / 7);
        const w = stats.get(`${d.getFullYear()}-W${weekIdx}`);
        if (w) {
          rate = w.total > 0 ? (w.delivered / w.total) * 100 : 0;
          aov = w.delivered > 0 ? w.revenue / w.delivered : 0;
          count = w.total;
        }
      }
      perOrder += computeOrderBonus(o, rate, aov, count).total;
    });
    // Weekly tier bonuses (AOV + delivery rate) — once per week, using each week's strongest rule per product
    let weeklyTiers = 0;
    const weeks = repWeeklyStats.get(repId);
    if (weeks) {
      const repProducts = new Set(orders.map((o) => o.productId).filter(Boolean) as string[]);
      weeks.forEach((w) => {
        if (w.total === 0) return;
        const rate = (w.delivered / w.total) * 100;
        const aov = w.delivered > 0 ? w.revenue / w.delivered : 0;
        repProducts.forEach((pid) => {
          const cfg = productBonusConfig(products.find((p) => p.id === pid));
          // Delivery-rate tier (need min orders)
          if (w.total >= cfg.deliveryRateMinOrders && rate >= cfg.poorDeliveryRatePercent) {
            const drTier = cfg.deliveryRateBonuses
              .filter((r) => rate >= r.ratePercent)
              .sort((a, b) => b.ratePercent - a.ratePercent)[0];
            if (drTier) weeklyTiers += drTier.amount;
          }
          // AOV tier (need delivery-rate gate)
          if (rate >= cfg.aovRequiresMinDeliveryRate) {
            const aovTier = cfg.aovBonuses
              .filter((r) => aov >= r.threshold)
              .sort((a, b) => b.threshold - a.threshold)[0];
            if (aovTier) weeklyTiers += aovTier.amount;
          }
        });
      });
    }
    return { perOrder, weeklyTiers, total: perOrder + weeklyTiers };
  };

  // ===== Penalties for the period =====
  const repPenaltiesInPeriod = (repId: string) =>
    repPenalties.filter((pen) => {
      if (pen.repId !== repId) return false;
      try {
        const d = new Date(pen.date);
        return d.toLocaleString("en-US", { month: "long", year: "numeric" }) === payrollMonth.trim();
      } catch { return false; }
    });

  const payrollPreviewRows = users
    .map((user) => {
      const structure = payStructures.find((item) => item.userId === user.id);
      if (!structure) {
        return null;
      }

      const delivered = user.role === "Sales Rep"
        ? payrollMonthDelivered.filter((order) => order.assignedRepId === user.id).length
        : user.role === "Inventory Manager"
          ? 0
          : payrollMonthDelivered.length;
      const fixed = structure.type === "Commission" ? 0 : structure.fixedSalary;
      const commission = structure.type === "Fixed Salary" ? 0 : structure.commissionRate * delivered;
      const autoBonus = user.role === "Sales Rep" ? computeRepAutoBonus(user.id).total : 0;
      const deductions = user.role === "Sales Rep" ? repPenaltiesInPeriod(user.id).reduce((sum, p) => sum + p.amount, 0) : 0;
      const total = Math.max(0, fixed + commission + autoBonus - deductions);
      return { userId: user.id, name: user.name, delivered, fixedSalary: fixed, commission, autoBonus, deductions, total };
    })
    .filter(Boolean) as PayrollRun["rows"];
  const payrollGrandTotal = payrollPreviewRows.reduce((sum, row) => sum + row.total, 0);
  const roundRobinActiveRows = activeSalesRepUsers
    .map((user) => ({
      user,
      openOrders: trackedOrders.filter((order) => order.assignedRepId === user.id && !["Delivered", "Cancelled", "Failed"].includes(order.status ?? "New")).length,
      delivered: deliveredOrderRows.filter((order) => order.assignedRepId === user.id).length
    }))
    .sort((a, b) => a.openOrders - b.openOrders || a.user.name.localeCompare(b.user.name));
  const roundRobinExcludedRows = salesRepUsers
    .filter((user) => !user.active)
    .map((user) => ({
      user,
      openOrders: trackedOrders.filter((order) => order.assignedRepId === user.id && !["Delivered", "Cancelled", "Failed"].includes(order.status ?? "New")).length,
      delivered: deliveredOrderRows.filter((order) => order.assignedRepId === user.id).length
    }));
  const roundRobinRows = (roundRobinTab === "Active Sequence" ? roundRobinActiveRows : roundRobinExcludedRows).filter((row) => {
    const search = roundRobinSearch.trim().toLowerCase();
    return !search || `${row.user.name} ${row.user.email}`.toLowerCase().includes(search);
  });
  const selectedRepUser = repConsoleRepId === "all" ? undefined : salesRepUsers.find((user) => user.id === repConsoleRepId);
  const repScopeName = selectedRepUser?.name ?? "All reps";
  const repScopeDescription = selectedRepUser ? "Rep-only workspace view" : "Owner full-access audit view";
  const repOrders = repConsoleRepId === "all" ? trackedOrders : trackedOrders.filter((order) => order.assignedRepId === repConsoleRepId);
  const repDeliveredOrders = repOrders.filter((order) => (order.status ?? "New") === "Delivered");
  const repRevenue = repDeliveredOrders.reduce((sum, order) => sum + order.amount, 0);
  const repPendingCount = repOrders.filter((order) => (order.status ?? "New") === "New").length;
  const repConfirmedCount = repOrders.filter((order) => (order.status ?? "New") === "Confirmed").length;
  const repDeliveredThisMonth = repDeliveredOrders.filter((order) => isInPeriod(orderDeliveredKey(order), "This Month", { start: "", end: "" })).length;
  const repConversionRate = repOrders.length === 0 ? 0 : Math.round((repDeliveredOrders.length / repOrders.length) * 100);
  const repConfirmedRate = repOrders.length === 0 ? 0 : Math.round((repConfirmedCount / repOrders.length) * 100);
  const repPayForUser = (user?: ManagedUser): number => {
    if (!user) {
      return salesRepUsers.reduce((sum, rep) => sum + repPayForUser(rep), 0);
    }
    const structure = payStructures.find((item) => item.userId === user.id);
    const delivered = repDeliveredOrders.filter((order) => order.assignedRepId === user.id).length;
    if (!structure) {
      return 0;
    }
    const fixed = structure.type === "Commission" ? 0 : structure.fixedSalary;
    const commission = structure.type === "Fixed Salary" ? 0 : structure.commissionRate * delivered;
    return fixed + commission;
  };
  const responseTimeForOrder = (order: TrackedOrder) => {
    if ((order.status ?? "New") === "New") {
      return "Pending";
    }
    const created = new Date(`${orderCreatedKey(order)}T00:00:00`);
    const firstAction = (order.notes ?? [])
      .map((note) => new Date(note.date))
      .filter((date) => !Number.isNaN(date.getTime()))
      .sort((a, b) => a.getTime() - b.getTime())[0];
    if (!firstAction) {
      return "Same day";
    }
    const hours = Math.max(0, Math.round((firstAction.getTime() - created.getTime()) / 3_600_000));
    return hours < 1 ? "<1h" : `${hours}h`;
  };
  const repResponseHours = repOrders
    .map((order) => {
      const label = responseTimeForOrder(order);
      return label === "<1h" ? 0.5 : label.endsWith("h") ? Number(label.replace("h", "")) : undefined;
    })
    .filter((value): value is number => typeof value === "number");
  const repAvgResponse = repResponseHours.length === 0 ? "Same day" : `${Math.round(repResponseHours.reduce((sum, value) => sum + value, 0) / repResponseHours.length)}h`;
  const repAssignedCarts = repConsoleRepId === "all" ? abandonedCarts : abandonedCarts.filter((cart) => cart.assignedRepId === repConsoleRepId);
  const repCartMatches = (cart: AbandonedCartRecord) => `${cart.customer} ${cart.phone} ${cart.city ?? ""}`.toLowerCase().includes(repCartSearch.trim().toLowerCase());
  const filteredRepCarts = repAssignedCarts.filter(repCartMatches);
  const repCartStats = {
    total: repAssignedCarts.length,
    active: repAssignedCarts.filter((cart) => ["Open abandoned", "In progress", "Abandoned", "Assigned"].includes(cart.status)).length,
    contacted: repAssignedCarts.filter((cart) => ["Contacted", "Converted", "No response", "Not interested"].includes(cart.status)).length,
    needsAttention: repAssignedCarts.filter((cart) => ["Abandoned", "No response", "Open abandoned"].includes(cart.status)).length
  };
  const repStatusFilteredOrders = repOrders.filter((order) => {
    const status = order.status ?? "New";
    if (repOrderStatusTab === "Pending") {
      return status === "New";
    }
    if (repOrderStatusTab === "Confirmed") {
      return ["Confirmed", "In Process", "Dispatched"].includes(status);
    }
    if (repOrderStatusTab === "Follow-up") {
      return status === "Postponed" || (order.notes ?? []).some((note) => Boolean(note.followUpDate));
    }
    return true;
  });
  const repScheduledOrders = repOrders.filter((order) => {
    const status = order.status ?? "New";
    return ["Confirmed", "In Process", "Dispatched", "Postponed"].includes(status) && normalizeDateKey(order.scheduledDate) === scheduleDateForRange(repScheduleRange);
  });
  const repProducts = [...products]
    .filter((product) => {
      const search = repProductSearch.trim().toLowerCase();
      return !search || `${product.name} ${product.sku} ${product.description}`.toLowerCase().includes(search);
    })
    .sort((a, b) => {
      if (repProductSort === "Price") {
        return (primaryPricing(a)?.sellingPrice ?? 0) - (primaryPricing(b)?.sellingPrice ?? 0);
      }
      if (repProductSort === "Stock") {
        return totalProductStock(b) - totalProductStock(a);
      }
      return a.name.localeCompare(b.name);
    });
  const repCustomerRows = Object.values(
    repOrders.reduce<Record<string, { id: string; name: string; phone: string; orders: number; totalSpend: number; lastOrder: string }>>((acc, order) => {
      const key = (order.phone || order.customer).toLowerCase();
      const current = acc[key] ?? { id: key, name: order.customer, phone: order.phone, orders: 0, totalSpend: 0, lastOrder: order.date };
      current.orders += 1;
      current.totalSpend += (order.status ?? "New") === "Delivered" ? order.amount : 0;
      current.lastOrder = order.date;
      acc[key] = current;
      return acc;
    }, {})
  );
  const repLeaderboardRows = [...salesRepRows].sort((a, b) => b.revenue - a.revenue || b.delivered - a.delivered);
  const repNotifications = (() => {
    const seen = new Set<string>();
    const all = [
      ...repOrders.filter((order) => (order.status ?? "New") === "New").slice(0, 4).map((order) => ({ key: `new-${order.id}`, msg: `New order assigned: ${order.id} for ${order.customer}` })),
      ...repOrders.filter((order) => (order.notes ?? []).some((note) => note.followUpDate && normalizeDateKey(note.followUpDate) <= todayKey())).slice(0, 4).map((order) => ({ key: `fu-${order.id}`, msg: `Follow-up due: ${order.id} for ${order.customer}` })),
      ...repScheduledOrders.slice(0, 4).map((order) => ({ key: `sched-${order.id}`, msg: `Delivery scheduled ${repScheduleRange.toLowerCase()}: ${order.id}` }))
    ];
    return all.filter(({ key }) => { if (seen.has(key)) return false; seen.add(key); return true; }).map(({ msg }) => msg);
  })();
  const repOrderDetail = trackedOrders.find((order) => order.id === repOrderDetailId);

  const selectedPeriodLabel =
    period === "Custom" && dateRange.start && dateRange.end
      ? `${dateRange.start} to ${dateRange.end}`
      : period;

  const selectedOrdersPeriodLabel =
    ordersPeriod === "Custom" && ordersDateRange.start && ordersDateRange.end
      ? `${ordersDateRange.start} to ${ordersDateRange.end}`
      : ordersPeriod;

  const selectedDeliveriesPeriodLabel =
    deliveriesPeriod === "Custom" && deliveriesDateRange.start && deliveriesDateRange.end
      ? `${deliveriesDateRange.start} to ${deliveriesDateRange.end}`
      : deliveriesPeriod;

  const selectedSalesPeriodLabel =
    salesPeriod === "Custom" && salesDateRange.start && salesDateRange.end
      ? `${salesDateRange.start} to ${salesDateRange.end}`
      : salesPeriod;

  const selectedCustomerPeriodLabel =
    customerPeriod === "Custom" && customerDateRange.start && customerDateRange.end
      ? `${customerDateRange.start} to ${customerDateRange.end}`
      : customerPeriod;

  const selectedExpensePeriodLabel =
    expensePeriod === "Custom" && expenseDateRange.start && expenseDateRange.end
      ? `${expenseDateRange.start} to ${expenseDateRange.end}`
      : expensePeriod;

  const selectedFinancePeriodLabel =
    financePeriod === "Custom" && financeDateRange.start && financeDateRange.end
      ? `${financeDateRange.start} to ${financeDateRange.end}`
      : financePeriod;

  const dashboardCards = summaryCards.map((card) => {
    if (card.label === "Total Revenue") {
      return { ...card, value: formatMoney(dashboardRevenue), trend: formatTrend(percentChange(dashboardRevenue, dashboardPreviousRevenue)), helper: "Delivered orders only" };
    }

    if (card.label === "Gross Profit") {
      const grossMargin = dashboardRevenue === 0 ? 0 : Math.round((dashboardGrossProfit / dashboardRevenue) * 100);
      return { ...card, value: formatMoney(dashboardGrossProfit), trend: formatTrend(percentChange(dashboardGrossProfit, dashboardPreviousGrossProfit)), helper: `${grossMargin}% gross margin` };
    }

    if (card.label === "Net Profit") {
      const expenseHelper = dashboardExpenseTotal === 0 ? "No expenses counted this period" : `${formatMoney(dashboardExpenseTotal)} expenses deducted`;
      return { ...card, value: formatMoney(dashboardNetProfit), trend: formatTrend(percentChange(dashboardNetProfit, dashboardPreviousNetProfit)), helper: expenseHelper };
    }

    if (card.label === "Total Orders") {
      return { ...card, value: String(dashboardOrders.length), trend: formatTrend(percentChange(dashboardOrders.length, dashboardPreviousOrders.length)), helper: "All statuses counted" };
    }

    if (card.label === "Fulfillment Rate") {
      return { ...card, value: `${dashboardDeliveryRate}%`, trend: formatTrend(percentChange(dashboardDeliveryRate, dashboardPreviousOrders.length === 0 ? 0 : Math.round((dashboardPreviousDelivered.length / dashboardPreviousOrders.length) * 100))), helper: `${dashboardCancelledRate}% cancelled` };
    }

    return card;
  });

  const dashboardCartStats = cartStats.map((stat) => {
    if (stat.label === "Total") {
      return { ...stat, value: String(abandonedCarts.length) };
    }

    if (stat.label === "Active") {
      return { ...stat, value: String(abandonedCarts.filter((cart) => ["Open abandoned", "In progress", "Abandoned", "Assigned"].includes(cart.status)).length) };
    }

    if (stat.label === "Contacted") {
      return { ...stat, value: String(contactedCartCount) };
    }

    if (stat.label === "Needs attention") {
      return { ...stat, value: String(abandonedCarts.filter((cart) => ["Open abandoned", "Abandoned", "No response"].includes(cart.status)).length) };
    }

    return stat;
  });

  const notifications = notificationsRead
    ? []
    : [
        `${activePage} view refreshed.`,
        activePage === "Inventory" ? "Inventory stock tools are ready." : activePage === "Scheduled Deliveries" ? "Scheduled delivery ranges are ready." : activePage === "Deliveries" ? "Delivery filters are ready." : activePage === "Sales Reps" ? "Sales representative tools are ready." : activePage === "Sales Teams" ? "Sales team scopes are ready." : activePage === "Call Rep Console" ? "Call Rep console is ready." : activePage === "Agents" ? "Agent directory tools are ready." : activePage === "Payroll" ? "Payroll workspace is ready." : activePage === "Customers" ? "Customer directory filters are ready." : activePage === "Expenses" ? "Expense management tools are ready." : activePage === "Finance & Accounting" ? "Financial reports are ready." : activePage === "Ad Tracking" ? "Ad tracking attribution is ready." : activePage === "User Management" ? "User management controls are ready." : activePage === "Round-Robin" ? "Round-robin sequence controls are ready." : activePage === "Embed Form" ? "Embed form settings are ready." : activePage === "AI Agent" ? "AI Agent preview is in development." : activePage === "AI Sandbox" ? "AI Sandbox preview is in development." : activePage === "AI/SMS Tokens" ? "AI/SMS token tools are ready." : activePage === "Notifications" ? "Notification center is ready." : activePage === "Settings" ? "Settings controls are ready." : activePage === "Orders" ? "Order filters are ready." : activePage === "Abandoned Carts" ? "Captured cart filters are ready." : "Cart follow-up queue is ready."
      ];

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    document.scrollingElement?.scrollTo({ top: 0, left: 0, behavior: "instant" });
    setNotificationsRead(false);

    window.requestAnimationFrame(() => {
      document
        .querySelector<HTMLButtonElement>(".nav-list .nav-item.active")
        ?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    });
  }, [activePage]);

  useEffect(() => {
    document.body.classList.toggle("mobile-menu-lock", mobileMenuOpen);
    return () => document.body.classList.remove("mobile-menu-lock");
  }, [mobileMenuOpen]);

  useEffect(() => {
    const updateRoute = () => setHashRoute(window.location.hash);
    window.addEventListener("hashchange", updateRoute);
    return () => window.removeEventListener("hashchange", updateRoute);
  }, []);

  useEffect(() => {
    if (!hashRoute.startsWith("#/dashboard/sales-rep")) {
      return;
    }

    setActivePage("Call Rep Console");
    const [, rawPath = ""] = hashRoute.split("#");
    const parts = rawPath.split("?")[0].split("/").filter(Boolean);
    const section = parts[2];
    const orderId = section === "orders" ? parts[3] : "";
    const routeToTab: Record<string, RepConsoleTab> = {
      products: "Products",
      orders: "Orders",
      "scheduled-deliveries": "Scheduled Deliveries",
      "abandoned-carts": "Abandoned Carts",
      customers: "Customers",
      leaderboard: "Leaderboard",
      notifications: "Notifications",
      settings: "Settings"
    };

    setRepConsoleTab(routeToTab[section ?? ""] ?? "Dashboard");
    setRepOrderDetailId(orderId ?? "");
    if (orderId) {
      setSelectedOrderId(orderId);
    }
  }, [hashRoute]);

  useEffect(() => {
    if (hashRoute.startsWith("#/dashboard/sales-rep") || hashRoute.startsWith("#/order-form/embed")) {
      return;
    }

    const [, rawPath = ""] = hashRoute.split("#");
    const parts = rawPath.split("?")[0].split("/").filter(Boolean);
    if (parts[0] !== "dashboard") {
      return;
    }

    if (!parts[1]) {
      setActivePage("Dashboard");
      return;
    }

    if (parts[1] !== "admin") {
      return;
    }

    const section = parts[2] ?? "";
    const queryParams = new URLSearchParams(rawPath.split("?")[1] ?? "");
    if (section === "embed") {
      setEmbedTab(queryParams.get("tab") === "generate" ? "Generate" : "Create Order Form");
    }
    const adminRouteToPage: Record<string, ActivePage> = {
      "": "Dashboard",
      orders: "Orders",
      "abandoned-carts": "Abandoned Carts",
      "scheduled-deliveries": "Scheduled Deliveries",
      deliveries: "Deliveries",
      inventory: "Inventory",
      "sales-reps": "Sales Reps",
      "sales-teams": "Sales Teams",
      agents: "Agents",
      waybill: "Waybill",
      payroll: "Payroll",
      customers: "Customers",
      expenses: "Expenses",
      reports: "Finance & Accounting",
      "finance-accounting": "Finance & Accounting",
      "finance-and-accounting": "Finance & Accounting",
      "utm-tracking": "Ad Tracking",
      "ad-tracking": "Ad Tracking",
      users: "User Management",
      "user-management": "User Management",
      "round-robin": "Round-Robin",
      embed: "Embed Form",
      "embed-form": "Embed Form",
      "ai-agent": "AI Agent",
      "ai-sandbox": "AI Sandbox",
      "ai-tokens": "AI/SMS Tokens",
      notifications: "Notifications",
      settings: "Settings"
    };

    if (section === "orders" && parts[3]) {
      setActivePage("Call Rep Console");
      setRepConsoleRepId("all");
      setRepConsoleTab("Orders");
      setRepOrderDetailId(parts[3]);
      setSelectedOrderId(parts[3]);
      return;
    }

    if (section === "inventory" && parts[3] === "history") {
      setActivePage("Inventory");
      setInventoryView("history");
      return;
    }

    if (section === "sales-reps" && parts[3]) {
      setActivePage("Sales Reps");
      setSelectedSalesRepId(parts[3]);
      setModal("salesRepDetails");
      return;
    }

    if (section === "customers" && parts[3]) {
      setActivePage("Customers");
      setCustomerSearch(decodeURIComponent(parts[3]));
      return;
    }

    const nextPage = adminRouteToPage[section];
    if (nextPage) {
      setActivePage(nextPage);
      if (nextPage === "Inventory") {
        setInventoryView("dashboard");
      }
      if (nextPage === "Call Rep Console") {
        setRepConsoleTab("Dashboard");
        setRepOrderDetailId("");
      }
    }
  }, [hashRoute]);

  useEffect(() => {
    writeStored(storageKeys.products, products);
  }, [products]);

  useEffect(() => {
    writeStored(storageKeys.stockMovements, stockMovements);
  }, [stockMovements]);

  useEffect(() => {
    writeStored(storageKeys.trackedOrders, trackedOrders);
  }, [trackedOrders]);

  useEffect(() => {
    writeStored(storageKeys.users, users);
  }, [users]);

  useEffect(() => {
    writeStored(storageKeys.agents, agents);
  }, [agents]);

  useEffect(() => {
    writeStored(storageKeys.agentStock, agentStock);
  }, [agentStock]);

  useEffect(() => {
    writeStored(storageKeys.payStructures, payStructures);
  }, [payStructures]);

  useEffect(() => {
    writeStored(storageKeys.payrollRuns, payrollRuns);
  }, [payrollRuns]);

  useEffect(() => {
    writeStored(storageKeys.expenses, expenses);
  }, [expenses]);

  useEffect(() => {
    writeStored(storageKeys.abandonedCarts, abandonedCarts);
  }, [abandonedCarts]);

  useEffect(() => {
    writeStored(storageKeys.extraTeams, extraTeams);
  }, [extraTeams]);

  useEffect(() => {
    writeStored(storageKeys.repPenalties, repPenalties);
  }, [repPenalties]);

  useEffect(() => {
    writeStored(storageKeys.formCrossSellLabel, formCrossSellLabel);
  }, [formCrossSellLabel]);

  useEffect(() => {
    writeStored(storageKeys.formFreeGiftLabel, formFreeGiftLabel);
  }, [formFreeGiftLabel]);

  useEffect(() => { writeStored(storageKeys.formAddonPromptText, formAddonPromptText); }, [formAddonPromptText]);
  useEffect(() => { writeStored(storageKeys.formAddonYesLabel, formAddonYesLabel); }, [formAddonYesLabel]);
  useEffect(() => { writeStored(storageKeys.formAddonNoLabel, formAddonNoLabel); }, [formAddonNoLabel]);
  useEffect(() => { writeStored(storageKeys.formAddonNoMessage, formAddonNoMessage); }, [formAddonNoMessage]);
  useEffect(() => { writeStored(storageKeys.formOrderSummaryTitle, formOrderSummaryTitle); }, [formOrderSummaryTitle]);
  useEffect(() => { writeStored(storageKeys.formAddonPromptEnabled, formAddonPromptEnabled); }, [formAddonPromptEnabled]);
  useEffect(() => { writeStored(storageKeys.formOrderSummaryEnabled, formOrderSummaryEnabled); }, [formOrderSummaryEnabled]);
  useEffect(() => { writeStored(storageKeys.waybillRecords, waybillRecords); }, [waybillRecords]);
  useEffect(() => { writeStored(storageKeys.customerFlags, customerFlags); }, [customerFlags]);
  useEffect(() => { writeStored(storageKeys.systemNotifications, systemNotifications); }, [systemNotifications]);
  useEffect(() => { writeStored(storageKeys.stockCounts, stockCounts); }, [stockCounts]);
  useEffect(() => { setOrdersPage(1); }, [orderSearch, orderStatus, orderSource, orderLocation]);

  // ── API data loader ───────────────────────────────────────
  // On mount, if the user is authenticated, fetch live data from the API
  // and merge it into state (API data wins over localStorage cache).
  useEffect(() => {
    if (!auth.isLoggedIn()) return;
    let cancelled = false;

    const load = async () => {
      try {
        const [
          apiProducts,
          apiOrders,
          apiAgents,
          apiMovements,
          apiExpenses,
          apiWaybills,
          apiNotifications,
          apiStockCounts,
          apiTeam
        ] = await Promise.allSettled([
          productsApi.list(),
          ordersApi.list({ limit: "500" }),
          agentsApi.list(),
          stockApi.movements({ limit: "500" }),
          expensesApi.list(),
          waybillsApi.list(),
          notificationsApi.list(),
          stockApi.countSessions(),
          teamApi.list()
        ]);

        if (cancelled) return;

        if (apiProducts.status === "fulfilled" && apiProducts.value?.length) {
          setProducts(apiProducts.value as any);
        }
        if (apiOrders.status === "fulfilled" && apiOrders.value?.data?.length) {
          setTrackedOrders(apiOrders.value.data as any);
        }
        if (apiAgents.status === "fulfilled" && apiAgents.value?.length) {
          setAgents(apiAgents.value as any);
          // Flatten agent stock from nested agent.stock array
          const flat = (apiAgents.value as any[]).flatMap((a: any) =>
            (a.stock ?? []).map((s: any) => ({ agentId: a.id, productId: s.product_id, quantity: s.quantity }))
          );
          if (flat.length) setAgentStock(flat as any);
        }
        if (apiMovements.status === "fulfilled" && apiMovements.value?.data?.length) {
          setStockMovements(apiMovements.value.data as any);
        }
        if (apiExpenses.status === "fulfilled" && apiExpenses.value?.length) {
          setExpenses(apiExpenses.value as any);
        }
        if (apiWaybills.status === "fulfilled" && apiWaybills.value?.length) {
          setWaybillRecords(apiWaybills.value as any);
        }
        if (apiNotifications.status === "fulfilled" && apiNotifications.value?.length) {
          setSystemNotifications(apiNotifications.value as any);
        }
        if (apiStockCounts.status === "fulfilled" && apiStockCounts.value?.length) {
          setStockCounts(apiStockCounts.value as any);
        }
        if (apiTeam.status === "fulfilled" && apiTeam.value?.length) {
          setUsers(apiTeam.value.map((u: any) => ({
            id: u.id,
            name: u.name,
            email: u.email,
            role: u.role,
            active: u.active,
            created: u.created_at ? new Date(u.created_at).toLocaleDateString("en-GB") : ""
          })));
        }
      } catch (_) {
        // API unreachable — continue with localStorage data
      }
    };

    load();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch audit log when order details modal opens
  useEffect(() => {
    if (modal === "orderDetails" && selectedOrderId) {
      ordersApi.audit(selectedOrderId).then(setOrderAuditLog).catch(() => setOrderAuditLog([]));
    } else {
      setOrderAuditLog([]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modal, selectedOrderId]);

  // Supabase Realtime — listen for new orders and surface a notification
  useEffect(() => {
    const user = auth.getUser();
    if (!realtimeClient || !user?.orgId) return;

    const channel = realtimeClient
      .channel("orders-realtime")
      .on(
        "postgres_changes" as any,
        { event: "INSERT", schema: "public", table: "orders", filter: `org_id=eq.${user.orgId}` },
        (payload: any) => {
          const order = payload.new;
          if (!order) return;
          // Add to tracked orders if not already present
          setTrackedOrders((prev) => {
            if (prev.some((o) => o.id === order.id)) return prev;
            const newOrder = {
              id: order.id,
              customer: order.customer,
              phone: order.phone,
              whatsapp: order.whatsapp,
              email: order.email,
              address: order.address,
              city: order.city,
              state: order.state,
              productName: order.product_name,
              packageName: order.package_name,
              productId: order.product_id,
              packageId: order.package_id,
              quantity: order.quantity,
              amount: order.amount,
              currency: order.currency,
              source: order.source,
              location: order.location,
              assignedRepId: order.assigned_rep_id,
              status: order.status,
              date: order.date,
              createdAt: order.created_at,
              notes: []
            };
            return [newOrder as any, ...prev];
          });
          showToast(`New order from ${order.customer} just came in!`);
        }
      )
      .subscribe();

    return () => { realtimeClient!.removeChannel(channel); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When running as an iframe embed, send our scroll-height to the parent page so it can resize the iframe.
  useEffect(() => {
    if (!publicEmbedParams) return;
    const send = () => {
      const h = document.documentElement.scrollHeight;
      try { window.parent.postMessage({ type: "ordo-resize", height: h }, "*"); } catch (_) { /* cross-origin parent, ignore */ }
    };
    send();
    const ro = new ResizeObserver(send);
    ro.observe(document.documentElement);
    return () => ro.disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(publicEmbedParams)]);

  // When the customer's state changes, drop any picked cross-sells that are no longer available there.
  useEffect(() => {
    const main = publicProduct ?? previewProduct;
    if (!main || orderFormCrossSells.length === 0) return;
    setOrderFormCrossSells((prev) => prev.filter((c) => {
      const cp = products.find((p) => p.id === c.productId);
      if (!cp) return false;
      return crossSellVisibleInState(main, cp, orderFormState);
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderFormState, publicProduct, previewProduct]);

  useEffect(() => {
    if (publicProduct && publicPackages.length > 0 && !publicPackages.some((item) => item.id === orderFormPackageId)) {
      setOrderFormPackageId(publicPackages[0].id);
    }
  }, [orderFormPackageId, publicPackages, publicProduct]);

  useEffect(() => {
    const formTouched = Boolean(
      orderFormName.trim() ||
      orderFormPhone.trim() ||
      orderFormWhatsapp.trim() ||
      orderFormEmail.trim() ||
      orderFormAddress.trim() ||
      orderFormCity.trim() ||
      orderFormState.trim()
    );
    const captureProduct = publicProduct ?? (showOrderPreview ? previewProduct : undefined);
    const capturePackages = publicProduct ? publicPackages : previewPackages;
    const chosenPackage = capturePackages.find((item) => item.id === orderFormPackageId) ?? capturePackages[0];

    if (!formTouched || !captureProduct || !chosenPackage) {
      return;
    }

    const cartPatch: AbandonedCartRecord = {
      id: abandonedDraftCartId || makeCartId(),
      customer: orderFormName.trim() || "Partial lead",
      phone: orderFormPhone.trim() || orderFormWhatsapp.trim() || "No phone yet",
      whatsapp: orderFormWhatsapp.trim(),
      email: orderFormEmail.trim(),
      city: orderFormCity.trim(),
      state: orderFormState.trim(),
      productId: captureProduct.id,
      packageId: chosenPackage.id,
      productName: captureProduct.name,
      packageName: chosenPackage.name,
      amount: chosenPackage.price,
      currency: chosenPackage.currency,
      source: publicProduct ? orderSourceFromUtm(publicUtmSource) : "Website",
      status: abandonedDraftCartId ? "In progress" : "Open abandoned",
      assignedRepId: abandonedCarts.find((cart) => cart.id === abandonedDraftCartId)?.assignedRepId,
      lastActivity: new Date().toISOString(),
      createdAt: todayKey()
    };

    setAbandonedCarts((value) => {
      if (abandonedDraftCartId && value.some((cart) => cart.id === abandonedDraftCartId)) {
        return value.map((cart) => (cart.id === abandonedDraftCartId ? { ...cart, ...cartPatch, createdAt: cart.createdAt, status: cart.status === "Converted" ? "Converted" : cartPatch.status } : cart));
      }
      return [cartPatch, ...value];
    });
    if (!abandonedDraftCartId) {
      setAbandonedDraftCartId(cartPatch.id);
    }
  }, [
    orderFormName,
    orderFormPhone,
    orderFormWhatsapp,
    orderFormEmail,
    orderFormAddress,
    orderFormCity,
    orderFormState,
    orderFormPackageId,
    publicProduct,
    publicUtmSource,
    previewProduct,
    showOrderPreview
  ]);

  const showToast = (message: string) => setToast(message);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(""), 3000);
    return () => clearTimeout(id);
  }, [toast]);

  const handlePeriodChange = (nextPeriod: Period) => {
    setPeriod(nextPeriod);
    setShowDateRange(false);
    showToast(`Dashboard period set to ${nextPeriod}.`);
  };

  const handleOrdersPeriodChange = (nextPeriod: Period) => {
    setOrdersPeriod(nextPeriod);
    setShowOrdersDateRange(false);
    showToast(`Orders period set to ${nextPeriod}.`);
  };

  const applyDateRange = () => {
    if (!dateRange.start || !dateRange.end) {
      showToast("Choose both a start date and an end date.");
      return;
    }

    if (!isDateValue(dateRange.start) || !isDateValue(dateRange.end)) {
      showToast("Use YYYY-MM-DD for both dates.");
      return;
    }

    if (dateRange.start > dateRange.end) {
      showToast("Start date must be before the end date.");
      return;
    }

    setPeriod("Custom");
    setShowDateRange(false);
    showToast(`Dashboard date range set to ${dateRange.start} to ${dateRange.end}.`);
  };

  const clearDateRange = () => {
    setDateRange({ start: "", end: "" });
    setPeriod("Today");
    setShowDateRange(false);
    showToast("Date range cleared. Dashboard period reset to Today.");
  };

  const applyOrdersDateRange = () => {
    if (!ordersDateRange.start || !ordersDateRange.end) {
      showToast("Choose both a start date and an end date for Orders.");
      return;
    }

    if (!isDateValue(ordersDateRange.start) || !isDateValue(ordersDateRange.end)) {
      showToast("Use YYYY-MM-DD for both Orders dates.");
      return;
    }

    if (ordersDateRange.start > ordersDateRange.end) {
      showToast("Orders start date must be before the end date.");
      return;
    }

    setOrdersPeriod("Custom");
    setShowOrdersDateRange(false);
    showToast(`Orders date range set to ${ordersDateRange.start} to ${ordersDateRange.end}.`);
  };

  const clearOrdersDateRange = () => {
    setOrdersDateRange({ start: "", end: "" });
    setOrdersPeriod("This Month");
    setShowOrdersDateRange(false);
    showToast("Orders date range cleared. Period reset to This Month.");
  };

  const handleDeliveriesPeriodChange = (nextPeriod: Period) => {
    setDeliveriesPeriod(nextPeriod);
    setShowDeliveriesDateRange(false);
    showToast(`Deliveries period set to ${nextPeriod}.`);
  };

  const applyDeliveriesDateRange = () => {
    if (!deliveriesDateRange.start || !deliveriesDateRange.end) {
      showToast("Choose both a start date and an end date for Deliveries.");
      return;
    }

    if (!isDateValue(deliveriesDateRange.start) || !isDateValue(deliveriesDateRange.end)) {
      showToast("Use YYYY-MM-DD for both Deliveries dates.");
      return;
    }

    if (deliveriesDateRange.start > deliveriesDateRange.end) {
      showToast("Deliveries start date must be before the end date.");
      return;
    }

    setDeliveriesPeriod("Custom");
    setShowDeliveriesDateRange(false);
    showToast(`Deliveries date range set to ${deliveriesDateRange.start} to ${deliveriesDateRange.end}.`);
  };

  const clearDeliveriesDateRange = () => {
    setDeliveriesDateRange({ start: "", end: "" });
    setDeliveriesPeriod("This Month");
    setShowDeliveriesDateRange(false);
    showToast("Deliveries date range cleared. Period reset to This Month.");
  };

  const handleSalesPeriodChange = (nextPeriod: Period) => {
    setSalesPeriod(nextPeriod);
    setShowSalesDateRange(false);
    showToast(`Sales Representatives period set to ${nextPeriod}.`);
  };

  const applySalesDateRange = () => {
    if (!salesDateRange.start || !salesDateRange.end) {
      showToast("Choose both a start date and an end date for Sales Reps.");
      return;
    }

    if (!isDateValue(salesDateRange.start) || !isDateValue(salesDateRange.end)) {
      showToast("Use YYYY-MM-DD for both Sales Reps dates.");
      return;
    }

    if (salesDateRange.start > salesDateRange.end) {
      showToast("Sales Reps start date must be before the end date.");
      return;
    }

    setSalesPeriod("Custom");
    setShowSalesDateRange(false);
    showToast(`Sales Reps date range set to ${salesDateRange.start} to ${salesDateRange.end}.`);
  };

  const clearSalesDateRange = () => {
    setSalesDateRange({ start: "", end: "" });
    setSalesPeriod("This Month");
    setShowSalesDateRange(false);
    showToast("Sales Reps date range cleared. Period reset to This Month.");
  };

  const handleCustomerPeriodChange = (nextPeriod: Period) => {
    setCustomerPeriod(nextPeriod);
    setShowCustomerDateRange(false);
    showToast(`Customer period set to ${nextPeriod}.`);
  };

  const applyCustomerDateRange = () => {
    if (!customerDateRange.start || !customerDateRange.end) {
      showToast("Choose both a start date and an end date for Customers.");
      return;
    }

    if (!isDateValue(customerDateRange.start) || !isDateValue(customerDateRange.end)) {
      showToast("Use YYYY-MM-DD for both Customer dates.");
      return;
    }

    if (customerDateRange.start > customerDateRange.end) {
      showToast("Customer start date must be before the end date.");
      return;
    }

    setCustomerPeriod("Custom");
    setShowCustomerDateRange(false);
    showToast(`Customer date range set to ${customerDateRange.start} to ${customerDateRange.end}.`);
  };

  const clearCustomerDateRange = () => {
    setCustomerDateRange({ start: "", end: "" });
    setCustomerPeriod("This Month");
    setShowCustomerDateRange(false);
    showToast("Customer date range cleared. Period reset to This Month.");
  };

  const handleExpensePeriodChange = (nextPeriod: Period) => {
    setExpensePeriod(nextPeriod);
    setShowExpenseDateRange(false);
    showToast(`Expenses period set to ${nextPeriod}.`);
  };

  const applyExpenseDateRange = () => {
    if (!expenseDateRange.start || !expenseDateRange.end) {
      showToast("Choose both a start date and an end date for Expenses.");
      return;
    }

    if (!isDateValue(expenseDateRange.start) || !isDateValue(expenseDateRange.end)) {
      showToast("Use YYYY-MM-DD for both Expense dates.");
      return;
    }

    if (expenseDateRange.start > expenseDateRange.end) {
      showToast("Expense start date must be before the end date.");
      return;
    }

    setExpensePeriod("Custom");
    setShowExpenseDateRange(false);
    showToast(`Expenses date range set to ${expenseDateRange.start} to ${expenseDateRange.end}.`);
  };

  const clearExpenseDateRange = () => {
    setExpenseDateRange({ start: "", end: "" });
    setExpensePeriod("This Month");
    setShowExpenseDateRange(false);
    showToast("Expenses date range cleared. Period reset to This Month.");
  };

  const handleFinancePeriodChange = (nextPeriod: Period) => {
    setFinancePeriod(nextPeriod);
    setShowFinanceDateRange(false);
    showToast(`Financial reports period set to ${nextPeriod}.`);
  };

  const applyFinanceDateRange = () => {
    if (!financeDateRange.start || !financeDateRange.end) {
      showToast("Choose both a start date and an end date for Financial Reports.");
      return;
    }

    if (!isDateValue(financeDateRange.start) || !isDateValue(financeDateRange.end)) {
      showToast("Use YYYY-MM-DD for both Financial Reports dates.");
      return;
    }

    if (financeDateRange.start > financeDateRange.end) {
      showToast("Financial Reports start date must be before the end date.");
      return;
    }

    setFinancePeriod("Custom");
    setShowFinanceDateRange(false);
    showToast(`Financial Reports date range set to ${financeDateRange.start} to ${financeDateRange.end}.`);
  };

  const clearFinanceDateRange = () => {
    setFinanceDateRange({ start: "", end: "" });
    setFinancePeriod("This Month");
    setShowFinanceDateRange(false);
    showToast("Financial Reports date range cleared. Period reset to This Month.");
  };

  const renderDateRangeCalendar = (
    testId: string,
    range: DateRange,
    setRange: Dispatch<SetStateAction<DateRange>>,
    onApply: () => void,
    onCancel: () => void
  ) => {
    const months = [calendarStartMonth, addMonths(calendarStartMonth, 1)];
    const hasFullRange = Boolean(range.start && range.end);

    return (
      <div
        className="absolute top-full left-0 z-50 mt-1 w-[640px] max-w-[calc(100vw-2rem)] bg-white border border-gray-200 rounded-2xl shadow-2xl overflow-hidden"
        data-testid={testId}
      >
        {/* Month grids */}
        <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-6">
          {months.map((monthDate, monthIndex) => (
            <section key={monthLabel(monthDate)} className={monthIndex === 1 ? "hidden sm:block" : ""}>
              {/* Month navigation header */}
              <div className="flex items-center justify-between mb-3">
                {monthIndex === 0 ? (
                  <button
                    type="button"
                    aria-label="Previous month"
                    onClick={() => setCalendarStartMonth((value) => addMonths(value, -1))}
                    className="!min-h-0 w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-800 hover:bg-gray-100 transition-colors text-xl leading-none"
                  >
                    ‹
                  </button>
                ) : (
                  <span className="w-8 h-8" />
                )}
                <span className="text-sm font-bold text-gray-900 tracking-tight">{monthLabel(monthDate)}</span>
                {monthIndex === 1 ? (
                  <button
                    type="button"
                    aria-label="Next month"
                    onClick={() => setCalendarStartMonth((value) => addMonths(value, 1))}
                    className="!min-h-0 w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-800 hover:bg-gray-100 transition-colors text-xl leading-none"
                  >
                    ›
                  </button>
                ) : (
                  /* On mobile (single month view) the first month also needs a next button */
                  <button
                    type="button"
                    aria-label="Next month"
                    onClick={() => setCalendarStartMonth((value) => addMonths(value, 1))}
                    className="!min-h-0 sm:hidden w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-800 hover:bg-gray-100 transition-colors text-xl leading-none"
                  >
                    ›
                  </button>
                )}
              </div>

              {/* Weekday labels */}
              <div className="grid grid-cols-7 mb-1">
                {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
                  <span key={d} className="h-7 flex items-center justify-center text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                    {d}
                  </span>
                ))}
              </div>

              {/* Day grid */}
              <div className="grid grid-cols-7">
                {getCalendarDays(monthDate).map((day) => {
                  const isStart = day.key === range.start;
                  const isEnd = day.key === range.end;
                  const isSelected = isStart || isEnd;
                  const inRange = Boolean(range.start && range.end && day.key > range.start && day.key < range.end);

                  let cls = "!min-h-0 h-9 w-full flex items-center justify-center text-sm transition-all select-none ";

                  if (!day.inMonth) {
                    cls += "text-gray-200 pointer-events-none";
                  } else if (isSelected) {
                    cls += "bg-[#1A6FBF] text-white font-bold ";
                    if (hasFullRange) {
                      cls += isStart ? "rounded-l-lg rounded-r-none" : "rounded-r-lg rounded-l-none";
                    } else {
                      cls += "rounded-lg";
                    }
                  } else if (inRange) {
                    cls += "bg-blue-50 text-blue-700 font-medium rounded-none";
                  } else {
                    cls += "text-gray-700 font-medium rounded-lg hover:bg-gray-100 cursor-pointer";
                  }

                  return (
                    <button
                      type="button"
                      key={day.key}
                      onClick={() => setRange((value) => chooseRangeDate(value, day.key))}
                      className={cls}
                    >
                      {day.day}
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 bg-gray-50 border-t border-gray-100 flex items-center justify-between gap-4">
          <div className="flex-1 min-w-0">
            {range.start || range.end ? (
              <div className="flex items-center gap-1.5 text-sm min-w-0">
                <span className="font-bold text-[#1A6FBF] shrink-0">{range.start || "—"}</span>
                {range.end && <ArrowRight className="w-3 h-3 text-gray-400 shrink-0" />}
                {range.end && <span className="font-bold text-[#1A6FBF] shrink-0">{range.end}</span>}
              </div>
            ) : (
              <span className="text-sm text-gray-400">Select a start then end date</span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onCancel}
              className="!min-h-0 px-4 py-2 text-sm font-semibold text-gray-600 border border-gray-200 bg-white rounded-xl hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onApply}
              className="!min-h-0 px-4 py-2 text-sm font-semibold bg-[#1A6FBF] text-white rounded-xl hover:bg-blue-700 transition-colors"
            >
              Apply
            </button>
          </div>
        </div>
      </div>
    );
  };

  const exportReport = () => {
    const rows = [
      ["Dashboard Report"],
      ["Period", selectedPeriodLabel],
      ["Currency", selectedCurrency.label],
      ["Total Revenue", formatMoney(dashboardRevenue)],
      ["COGS", formatMoney(dashboardCogs)],
      ["Gross Profit", formatMoney(dashboardGrossProfit)],
      ["Expenses", formatMoney(dashboardExpenseTotal)],
      ["Net Profit", formatMoney(dashboardNetProfit)],
      ["Total Orders", String(dashboardOrders.length)],
      ["Fulfillment Rate", `${dashboardDeliveryRate}%`],
      ["Cancellation Rate", `${dashboardCancelledRate}%`],
      ["Abandoned Carts", String(demoCarts)]
    ];

    const csv = rows
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");

    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `dashboard-report-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast("Dashboard report exported as CSV.");
  };

  const exportOrdersCsv = () => {
    const rows = [
      ["Orders Report"],
      ["Period", selectedOrdersPeriodLabel],
      ["Currency", selectedCurrency.label],
      ["Search", orderSearch || "All"],
      ["Status", orderStatus],
      ["Source", orderSource],
      ["Location", orderLocation],
      ["Total Handled", String(filteredOrderRows.length)],
      ["Delivery Rate", `${ordersDeliveryRate}%`],
      ["Revenue Generated", formatMoney(ordersRevenue)],
      [],
      ["Order ID", "Customer", "Phone", "Product", "Package", "Status", "Source", "Location", "Amount", "Date"],
      ...filteredOrderRows.map((order) => [
        order.id,
        order.customer,
        order.phone,
        order.productName,
        order.packageName,
        order.status ?? "New",
        order.source ?? orderSourceFromUtm(order.utmSource),
        order.location ?? orderLocationFromFields(order.city ?? "", order.state ?? ""),
        formatProductMoney(order.amount, order.currency),
        order.date
      ])
    ];

    const csv = rows
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");

    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `orders-report-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast("Orders CSV exported.");
  };

  const exportRepOrdersCsv = () => {
    const rows = [
      ["Call Rep Orders Report"],
      ["Scope", repScopeName],
      ["Mode", repScopeDescription],
      ["Status Tab", repOrderStatusTab],
      ["Revenue", formatMoney(repRevenue)],
      ["Total Orders", String(repOrders.length)],
      ["Conversion", `${repConversionRate}%`],
      [],
      ["Order ID", "Customer", "Phone", "Source", "Status", "Response Time", "Location", "Created Date", "Amount"],
      ...repStatusFilteredOrders.map((order) => [
        order.id,
        order.customer,
        order.phone,
        order.source ?? orderSourceFromUtm(order.utmSource),
        order.status ?? "New",
        responseTimeForOrder(order),
        order.location ?? orderLocationFromFields(order.city ?? "", order.state ?? ""),
        order.date,
        formatProductMoney(order.amount, order.currency)
      ])
    ];

    const csv = rows
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");

    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `call-rep-orders-${slugify(repScopeName)}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast("Call rep orders exported.");
  };

  const exportAgentsCsv = () => {
    const rows = [
      ["Agents Report"],
      ["Currency", selectedCurrency.label],
      ["Search", agentSearch || "All"],
      ["Zone", agentZone],
      ["Status", agentStatus],
      ["Total Agents", String(agents.length)],
      ["Active on Duty", String(agents.filter((agent) => agent.active).length)],
      ["Stock with Agents", formatMoney(totalAgentStockValue)],
      [],
      ["Name", "Phone", "Zone", "Status", "Success Rate", "Stock Value"],
      ...filteredAgentRows.map((row) => [row.agent.name, row.agent.phone, row.agent.zone, row.status, `${row.successRate}%`, formatMoney(row.stockValue)])
    ];

    const csv = rows
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");

    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `agents-report-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast("Agents CSV exported.");
  };

  const exportCustomersCsv = () => {
    const rows = [
      ["Customer Directory"],
      ["Period", selectedCustomerPeriodLabel],
      ["Currency", selectedCurrency.label],
      ["Search", customerSearch || "All"],
      ["Source", customerSource],
      ["Total Customers", String(customerRecords.length)],
      ["Active Customers", String(activeCustomerCount)],
      ["Returning Rate", `${returningRate}%`],
      ["Avg Lifetime Value", formatMoney(avgLifetimeValue)],
      [],
      ["Name", "Email", "Phone", "Orders", "Successful", "Cancelled", "Total Spend", "Source"],
      ...filteredCustomers.map((customer) => [customer.name, customer.email, customer.phone, customer.orders, customer.successful, customer.cancelled, formatMoney(customer.totalSpend), customer.source])
    ];

    const csv = rows
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");

    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `customers-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast("Customer data exported.");
  };

  const exportExpensesCsv = () => {
    const rows = [
      ["Expense Management"],
      ["Period", selectedExpensePeriodLabel],
      ["Currency", selectedCurrency.label],
      ["Search", expenseSearch || "All"],
      ["Type", expenseFilter],
      ["Total Expenses", formatMoney(totalExpenses)],
      ["Product-Linked", formatMoney(productLinkedExpenses)],
      ["General Expenses", formatMoney(generalExpenses)],
      ["Daily Burn Rate", formatMoney(dailyBurnRate)],
      [],
      ["Date", "Type", "Product / Ref", "Amount", "Description"],
      ...filteredExpenses.map((expense) => [displayDateFromKey(expense.date), expense.type, expense.productName, formatMoney(expense.amount), expense.description])
    ];

    const csv = rows
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");

    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `expenses-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast("Expenses exported.");
  };

  const exportUserData = () => {
    const rows = [
      ["User Management"],
      ["Total Users", String(users.length)],
      ["Active Users", String(activeUserCount)],
      ["New Users (Month)", String(users.length)],
      ["Role Filter", userRole],
      ["Status Filter", userStatus],
      ["Name", "Email", "Role", "Status", "Created"],
      ...users.map((user) => [user.name, user.email, user.role, user.active ? "Active" : "Inactive", user.created])
    ];

    const csv = rows
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");

    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `users-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast("User data exported.");
  };

  const exportInventoryCsv = () => {
    const rows = [
      ["Inventory Report"],
      ["Currency", selectedCurrency.label],
      ["Search", inventorySearch || "All"],
      ["Total Products", String(products.length)],
      ["Total Inventory Value", formatMoney(inventoryValue)],
      ["Total Units", String(totalInventoryUnits)],
      [],
      ["Product", "SKU", "Unit Cost", "Selling Price", "Warehouse Stock", "Agent Stock", "Units Sold", "Status"],
      ...products.map((product) => {
        const pricing = primaryPricing(product);
        return [
          product.name,
          product.sku,
          formatProductMoney(pricing?.unitCost ?? 0, pricing?.currency ?? "NGN"),
          formatProductMoney(pricing?.sellingPrice ?? 0, pricing?.currency ?? "NGN"),
          String(product.warehouseStock),
          String(product.agentStock),
          String(product.unitsSold),
          product.active ? "Active" : "Inactive"
        ];
      })
    ];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `inventory-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast("Inventory exported as CSV.");
  };

  const printWaybill = (w: WaybillRecord) => {
    const win = window.open("", "_blank", "width=800,height=600");
    if (!win) return;
    win.document.write(`<!DOCTYPE html><html><head><title>Waybill ${w.id}</title>
<style>body{font-family:Arial,sans-serif;margin:40px;color:#111}h1{font-size:20px;margin-bottom:4px}h2{font-size:14px;font-weight:normal;color:#555;margin:0 0 24px}table{width:100%;border-collapse:collapse;margin-top:16px}th,td{border:1px solid #ddd;padding:8px 12px;text-align:left;font-size:13px}th{background:#f5f5f5;font-weight:600}.badge{display:inline-block;padding:2px 10px;border-radius:12px;font-size:12px;font-weight:600}.status-transit{background:#dbeafe;color:#1d4ed8}.status-received{background:#dcfce7;color:#15803d}.status-returned{background:#fef3c7;color:#92400e}.status-cancelled{background:#f3f4f6;color:#6b7280}@media print{button{display:none}}</style></head>
<body>
<h1>ProtoHub CRM — Waybill</h1>
<h2>${w.id} · Printed ${new Date().toLocaleDateString("en-GB")}</h2>
<table>
<tr><th>Product</th><td>${w.productName}</td><th>Quantity</th><td>${w.quantity} units</td></tr>
<tr><th>From</th><td>${w.sendingState}</td><th>To</th><td>${w.receivingState}</td></tr>
<tr><th>Logistics Partner</th><td>${w.logisticsPartner || "—"}</td><th>Waybill Fee</th><td>${w.waybillFee > 0 ? "₦" + w.waybillFee.toLocaleString() : "—"}</td></tr>
<tr><th>Date Sent</th><td>${w.dateSent}</td><th>Date Received</th><td>${w.dateReceived || "—"}</td></tr>
<tr><th>Status</th><td><span class="badge status-${w.status === "In Transit" ? "transit" : w.status === "Received" ? "received" : w.status === "Returned" ? "returned" : "cancelled"}">${w.status}</span></td><th>Notes</th><td>${w.note || "—"}</td></tr>
</table>
<br/><button onclick="window.print()" style="padding:8px 20px;background:#1A6FBF;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px">Print</button>
</body></html>`);
    win.document.close();
  };

  const exportFinancialReport = () => {
    const rows = [
      ["Financial Report"],
      ["Tab", financeTab],
      ["Period", selectedFinancePeriodLabel],
      ["Currency", selectedCurrency.label],
      ["Revenue", formatMoney(financeRevenue)],
      ["COGS", formatMoney(financeCogs)],
      ["Gross Profit", formatMoney(financeGrossProfit)],
      ["Gross Margin", `${financeGrossMargin}%`],
      ["Total Expenses", formatMoney(financeExpenseTotal)],
      ["Net Profit", formatMoney(financeNetProfit)],
      ["Net Margin", `${financeNetMargin}%`],
      ["Delivered Orders", String(financeDeliveredCount)]
    ];

    const csv = rows
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");

    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `financial-report-${slugify(financeTab)}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast(`${financeTab} report exported.`);
  };

  const handleNavClick = (label: string) => {
    setMobileMenuOpen(false);
    if (hashRoute.startsWith("#/order-form/embed")) {
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#`);
      setHashRoute("#");
    }

    const adminHashByLabel: Record<string, string> = {
      Dashboard: "#/dashboard/admin",
      Orders: "#/dashboard/admin/orders",
      "Abandoned Carts": "#/dashboard/admin/abandoned-carts",
      "Scheduled Deliveries": "#/dashboard/admin/scheduled-deliveries",
      Deliveries: "#/dashboard/admin/deliveries",
      Inventory: "#/dashboard/admin/inventory",
      "Sales Reps": "#/dashboard/admin/sales-reps",
      "Sales Teams": "#/dashboard/admin/sales-teams",
      Agents: "#/dashboard/admin/agents",
      Waybill: "#/dashboard/admin/waybill",
      Payroll: "#/dashboard/admin/payroll",
      Customers: "#/dashboard/admin/customers",
      Expenses: "#/dashboard/admin/expenses",
      "Finance & Accounting": "#/dashboard/admin/reports",
      "Ad Tracking": "#/dashboard/admin/utm-tracking",
      "User Management": "#/dashboard/admin/users",
      "Round-Robin": "#/dashboard/admin/round-robin",
      "Embed Form": "#/dashboard/admin/embed",
      "AI Agent": "#/dashboard/admin/ai-agent",
      "AI Sandbox": "#/dashboard/admin/ai-sandbox",
      "AI/SMS Tokens": "#/dashboard/admin/ai-tokens",
      Notifications: "#/dashboard/admin/notifications",
      Settings: "#/dashboard/admin/settings"
    };
    const syncAdminHash = (nextLabel: string) => {
      const nextHash = adminHashByLabel[nextLabel];
      if (nextHash) {
        window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${nextHash}`);
        setHashRoute(nextHash);
      }
    };

    if (label === "Dashboard") {
      syncAdminHash(label);
      setActivePage("Dashboard");
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    if (label === "Orders") {
      syncAdminHash(label);
      setActivePage("Orders");
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    if (label === "Abandoned Carts") {
      syncAdminHash(label);
      setActivePage("Abandoned Carts");
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    if (label === "Scheduled Deliveries" || label === "Deliveries" || label === "Inventory" || label === "Sales Reps" || label === "Sales Teams" || label === "Call Rep Console" || label === "Agents" || label === "Waybill" || label === "Payroll" || label === "Customers" || label === "Expenses" || label === "Finance & Accounting" || label === "Ad Tracking" || label === "User Management" || label === "Round-Robin" || label === "Embed Form" || label === "AI Agent" || label === "AI Sandbox" || label === "AI/SMS Tokens" || label === "Notifications" || label === "Settings") {
      if (label === "Inventory") {
        setInventoryView("dashboard");
      }
      if (label === "Call Rep Console") {
        setRepConsoleTab("Dashboard");
        setRepOrderDetailId("");
        window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#/dashboard/sales-rep`);
        setHashRoute("#/dashboard/sales-rep");
      } else {
        syncAdminHash(label);
      }
      setActivePage(label as ActivePage);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    showToast(`${label} is a future module. Dashboard stays open for now.`);
  };

  const addTokens = () => {
    setTokens((value) => value + 100);
    setTokenHistory((prev) => [{ date: new Date().toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }), pack: "Top-up", amount: 100 }, ...prev]);
    setModal(null);
    showToast("100 AI/SMS tokens added.");
  };

  const buyTokenPack = (amount: number, packName: string) => {
    setTokens((value) => value + amount);
    setTokenHistory((prev) => [{ date: new Date().toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }), pack: packName, amount }, ...prev]);
    showToast(`${packName} token pack added. ${amount} tokens are ready to use.`);
  };

  const resetProductForm = () => {
    setProductName("");
    setProductDescription("");
    setProductSku("");
    setProductActive(true);
    setUnitCost("0");
    setSellingPrice("0");
    setOpeningStock("0");
    setReorderPoint("0");
  };

  const openAddProductModal = () => {
    resetProductForm();
    setModal("addProduct");
  };

  const createProduct = () => {
    if (!productName.trim()) {
      showToast("Product name is required.");
      return;
    }
    if (Number(sellingPrice) <= 0) {
      showToast("Selling price must be greater than zero.");
      return;
    }

    const id = makeProductId();
    const stock = Math.max(0, Number(openingStock) || 0);
    const product: Product = {
      id,
      name: productName.trim(),
      description: productDescription.trim(),
      sku: productSku.trim() || makeSku(productName),
      active: productActive,
      reorderPoint: Math.max(0, Number(reorderPoint) || 0),
      warehouseStock: stock,
      agentStock: 0,
      unitsSold: 0,
      pricings: [
        {
          currency: (currency as ProductCurrencyCode) ?? "NGN",
          sellingPrice: Math.max(0, Number(sellingPrice) || 0),
          unitCost: Math.max(0, Number(unitCost) || 0),
          primary: true
        }
      ],
      packages: [],
      packageDescription: "",
      createdAt: displayDateFromKey(todayKey())
    };

    setProducts((value) => [...value, product]);
    setSelectedProductId(id);
    setStockProductId(id);
    if (stock > 0) {
      setStockMovements((value) => [
        {
          id: makeMovementId(),
          date: new Date().toISOString(),
          productId: id,
          productName: product.name,
          type: "Stock Added",
          qty: stock,
          balanceAfter: stock,
          by: ownerName,
          note: "Opening stock"
        },
        ...value
      ]);
    }
    resetProductForm();
    setModal(null);
    showToast(`Product "${product.name}" created.`);
    productsApi.create({ name: product.name, sku: product.sku, description: product.description, reorderPoint: product.reorderPoint, active: product.active })
      .then((saved: any) => {
        setProducts((prev) => prev.map((p) => p.id === id ? { ...p, id: saved.id } : p));
        setSelectedProductId(saved.id);
        if (stock > 0) stockApi.update({ productId: saved.id, change: stock, note: "Opening stock" }).catch(() => {});
      })
      .catch(() => showToast("Product saved locally — sync to database failed."));
  };

  const submitStockUpdate = () => {
    const product = products.find((item) => item.id === stockProductId);
    const change = Number(stockChange) || 0;

    if (!product) {
      showToast("Choose a product first.");
      return;
    }

    if (change === 0) {
      showToast("Enter a positive or negative stock quantity.");
      return;
    }

    const nextBalance = Math.max(0, product.warehouseStock + change);
    const actualChange = nextBalance - product.warehouseStock;
    setProducts((value) => value.map((item) => (item.id === product.id ? { ...item, warehouseStock: nextBalance } : item)));
    setStockMovements((value) => [
      {
        id: makeMovementId(),
        date: new Date().toISOString(),
        productId: product.id,
        productName: product.name,
        type: actualChange >= 0 ? "Stock Added" : "Correction",
        qty: actualChange,
        balanceAfter: nextBalance,
        by: ownerName,
        note: actualChange >= 0 ? "Manual stock increase" : "Manual stock reduction"
      },
      ...value
    ]);
    // Low-stock notification on manual reduction
    if (actualChange < 0 && nextBalance <= product.reorderPoint && product.warehouseStock > product.reorderPoint) {
      pushSystemNotification({
        type: "low_stock",
        message: `Low stock: ${product.name} — warehouse down to ${nextBalance} unit${nextBalance === 1 ? "" : "s"} (reorder point: ${product.reorderPoint})`,
        productId: product.id
      });
    }
    const _suProdId = product.id;
    setStockChange("0");
    setModal(null);
    showToast(`${product.name} stock updated to ${nextBalance}.`);
    stockApi.update({ productId: _suProdId, change: actualChange, note: actualChange >= 0 ? "Manual stock increase" : "Manual stock reduction" }).catch(() => {});
  };

  const openProductDetails = (product: Product) => {
    setSelectedProductId(product.id);
    setModal("productDetails");
  };

  const openDeleteProduct = (product: Product) => {
    setSelectedProductId(product.id);
    setModal("deleteProduct");
  };

  const deleteSelectedProduct = () => {
    if (!selectedProduct) {
      showToast("Choose a product first.");
      return;
    }

    const activeStatuses: TrackedOrder["status"][] = ["New", "Confirmed", "In Process", "Dispatched"];
    const activeOrders = trackedOrders.filter((o) => o.productId === selectedProduct.id && activeStatuses.includes(o.status));
    if (activeOrders.length > 0) {
      showToast(`Complete or cancel ${activeOrders.length} active order${activeOrders.length !== 1 ? "s" : ""} before deleting this product.`);
      return;
    }

    // Remove product, clean up cross-sell/free-gift refs in other products
    setProducts((prev) =>
      prev
        .filter((p) => p.id !== selectedProduct.id)
        .map((p) => ({
          ...p,
          crossSellProductIds: (p.crossSellProductIds ?? []).filter((id) => id !== selectedProduct.id),
          freeGiftProductIds: (p.freeGiftProductIds ?? []).filter((id) => id !== selectedProduct.id),
        }))
    );
    setStockMovements((value) => value.filter((movement) => movement.productId !== selectedProduct.id));
    setAgentStock((value) => value.filter((stock) => stock.productId !== selectedProduct.id));
    const _dpId = selectedProduct.id;
    setSelectedProductId("");
    setInventoryView("dashboard");
    setModal(null);
    showToast(`${selectedProduct.name} deleted.`);
    productsApi.delete(_dpId).catch(() => {});
  };

  const duplicateProduct = (source: Product) => {
    const newId = makeProductId();
    const baseName = `${source.name} (Copy)`;
    let candidateName = baseName;
    let suffix = 2;
    while (products.some((p) => p.name.toLowerCase() === candidateName.toLowerCase())) {
      candidateName = `${baseName} ${suffix}`;
      suffix += 1;
    }
    const clone: Product = {
      ...source,
      id: newId,
      name: candidateName,
      sku: makeSku(candidateName),
      warehouseStock: 0,
      agentStock: 0,
      unitsSold: 0,
      createdAt: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
      pricings: source.pricings.map((p) => ({ ...p })),
      packages: source.packages.map((pkg) => ({ ...pkg, id: makePackageId() })),
      availableStates: source.availableStates ? [...source.availableStates] : undefined,
      bonusConfig: source.bonusConfig ? {
        ...source.bonusConfig,
        baseDelivered: source.bonusConfig.baseDelivered.map((r) => ({ ...r, id: makeBonusRuleId() })),
        upgradeBonuses: source.bonusConfig.upgradeBonuses.map((r) => ({ ...r, id: makeBonusRuleId() })),
        manualOrderBonuses: source.bonusConfig.manualOrderBonuses.map((r) => ({ ...r, id: makeBonusRuleId() })),
        aovBonuses: source.bonusConfig.aovBonuses.map((r) => ({ ...r, id: makeBonusRuleId() })),
        deliveryRateBonuses: source.bonusConfig.deliveryRateBonuses.map((r) => ({ ...r, id: makeBonusRuleId() }))
      } : undefined,
      crossSellProductIds: source.crossSellProductIds ? [...source.crossSellProductIds] : undefined,
      freeGiftProductIds: source.freeGiftProductIds ? [...source.freeGiftProductIds] : undefined
    };
    setProducts((prev) => [clone, ...prev]);
    showToast(`Duplicated as "${candidateName}". Stock reset to 0.`);
  };

  const toggleProductActive = (product: Product) => {
    setProducts((prev) => prev.map((p) => p.id === product.id ? { ...p, active: !p.active } : p));
    showToast(`${product.name} is now ${!product.active ? "active" : "inactive"}.`);
  };

  const previewProductForm = (product: Product) => {
    setGeneratedProductId(product.id);
    setActivePage("Embed Form");
    setEmbedTab("Create Order Form");
    setModal(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
    showToast(`Previewing ${product.name} order form. Scroll to the right panel.`);
  };

  const crossSellPriceFor = (mainProduct: Product, crossSellProduct: Product) => {
    const override = mainProduct.crossSellPriceOverrides?.[crossSellProduct.id];
    if (typeof override === "number" && override >= 0) return override;
    return primaryPricing(crossSellProduct)?.sellingPrice ?? 0;
  };

  // Does this attached cross-sell appear when the customer is in `state`?
  // Order of precedence:
  //  1. Per-attachment override on the main product (most specific) — empty list = available everywhere
  //  2. The cross-sell product's own availableStates
  //  3. No restrictions = available everywhere
  // When `state` is empty we don't filter (form not yet committed to a state).
  const crossSellVisibleInState = (mainProduct: Product, crossSellProduct: Product, state: string) => {
    if (!state) return true;
    const attachmentRule = mainProduct.crossSellStateRestrictions?.[crossSellProduct.id];
    if (attachmentRule && attachmentRule.length > 0) return attachmentRule.includes(state);
    const productRule = crossSellProduct.availableStates;
    if (productRule && productRule.length > 0) return productRule.includes(state);
    return true;
  };

  const freeGiftVisibleInState = (mainProduct: Product, giftProduct: Product, state: string) => {
    if (!state) return true;
    const attachmentRule = mainProduct.freeGiftStateRestrictions?.[giftProduct.id];
    if (attachmentRule && attachmentRule.length > 0) return attachmentRule.includes(state);
    const productRule = giftProduct.availableStates;
    if (productRule && productRule.length > 0) return productRule.includes(state);
    return true;
  };

  const openEditProduct = (product: Product) => {
    setSelectedProductId(product.id);
    setProductName(product.name);
    setProductDescription(product.description);
    setProductSku(product.sku);
    setProductActive(product.active);
    setReorderPoint(String(product.reorderPoint));
    setModal("editProduct");
  };

  const saveEditProduct = () => {
    if (!selectedProduct) return;
    if (!productName.trim()) { showToast("Product name is required."); return; }
    const _epId = selectedProduct.id;
    setProducts((prev) => prev.map((p) => p.id === selectedProduct.id ? {
      ...p,
      name: productName.trim(),
      description: productDescription.trim(),
      sku: productSku.trim() || p.sku,
      active: productActive,
      reorderPoint: Number(reorderPoint) || 0
    } : p));
    setModal(null);
    showToast(`${productName.trim()} saved.`);
    productsApi.update(_epId, { name: productName.trim(), description: productDescription.trim(), sku: productSku.trim() || selectedProduct.sku, active: productActive, reorder_point: Number(reorderPoint) || 0 }).catch(() => {});
  };

  const openPricingView = (product: Product) => {
    setSelectedProductId(product.id);
    setInventoryView("pricing");
    setActivePage("Inventory");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const openPackagesView = (product: Product) => {
    setSelectedProductId(product.id);
    setPackageDescriptionDraft(product.packageDescription);
    setInventoryView("packages");
    setActivePage("Inventory");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const openAddPricing = () => {
    const existingCodes = new Set(selectedProduct?.pricings.map((p) => p.currency) ?? []);
    const nextCurrency = (Object.keys(productCurrencies) as ProductCurrencyCode[]).find((c) => !existingCodes.has(c)) ?? "USD";
    setPricingCurrency(nextCurrency);
    setPricingSellingPrice("0");
    setPricingCost("0");
    setModal("addPricing");
  };

  const openEditPricing = (pricing: ProductPricing) => {
    setSelectedPricingCurrency(pricing.currency);
    setPricingCurrency(pricing.currency);
    setPricingSellingPrice(String(pricing.sellingPrice));
    setPricingCost(String(pricing.unitCost));
    setModal("editPricing");
  };

  const savePricing = () => {
    if (!selectedProduct) {
      showToast("Choose a product first.");
      return;
    }
    if (Number(pricingSellingPrice) <= 0) {
      showToast("Selling price must be greater than zero.");
      return;
    }

    const nextPricing = {
      currency: modal === "addPricing" ? pricingCurrency : selectedPricingCurrency,
      sellingPrice: Math.max(0, Number(pricingSellingPrice) || 0),
      unitCost: Math.max(0, Number(pricingCost) || 0),
      primary: false
    };

    if (modal === "addPricing" && selectedProduct.pricings.some((item) => item.currency === nextPricing.currency)) {
      showToast(`${productCurrencies[nextPricing.currency].label} pricing already exists.`);
      return;
    }

    const _spProdId = selectedProduct.id;
    setProducts((value) =>
      value.map((product) =>
        product.id === selectedProduct.id
          ? {
              ...product,
              pricings:
                modal === "addPricing"
                  ? [...product.pricings, nextPricing]
                  : product.pricings.map((item) => (item.currency === selectedPricingCurrency ? { ...item, ...nextPricing, primary: item.primary } : item))
            }
          : product
      )
    );
    setModal(null);
    showToast(`${productCurrencies[nextPricing.currency].label} pricing saved.`);
    if (modal === "addPricing") {
      productsApi.createPricing(_spProdId, { currency: nextPricing.currency, selling_price: nextPricing.sellingPrice, unit_cost: nextPricing.unitCost, primary: false }).catch(() => {});
    }
  };

  const deletePricing = (code: ProductCurrencyCode) => {
    if (!selectedProduct) {
      return;
    }

    const pricing = selectedProduct.pricings.find((p) => p.currency === code);
    if (pricing?.primary) {
      showToast("Primary pricing cannot be deleted. Set another currency as primary first.");
      return;
    }

    setProducts((value) =>
      value.map((product) =>
        product.id === selectedProduct.id ? { ...product, pricings: product.pricings.filter((pricing) => pricing.currency !== code) } : product
      )
    );
    showToast(`${productCurrencies[code].label} pricing removed.`);
  };

  const resetPackageForm = () => {
    setPackageName("");
    setPackageDescription("");
    setPackageQuantity("1");
    setPackagePrice("0");
    setPackageCurrency("NGN");
    setPackageDisplayOrder("1");
    setSelectedPackageId("");
  };

  const openAddPackage = () => {
    resetPackageForm();
    setModal("addPackage");
  };

  const openEditPackage = (item: ProductPackage) => {
    setSelectedPackageId(item.id);
    setPackageName(item.name);
    setPackageDescription(item.description);
    setPackageQuantity(String(item.quantity));
    setPackagePrice(String(item.price));
    setPackageCurrency(item.currency);
    setPackageDisplayOrder(String(item.displayOrder));
    setModal("editPackage");
  };

  const savePackage = () => {
    if (!selectedProduct || !packageName.trim()) {
      showToast("Package name is required.");
      return;
    }

    const packageRecord: ProductPackage = {
      id: modal === "editPackage" && selectedPackage ? selectedPackage.id : makePackageId(),
      name: packageName.trim(),
      description: packageDescription.trim(),
      quantity: Math.max(1, Number(packageQuantity) || 1),
      price: Math.max(0, Number(packagePrice) || 0),
      currency: packageCurrency,
      displayOrder: Math.max(1, Number(packageDisplayOrder) || 1),
      active: true
    };

    const _pkgProdId = selectedProduct.id;
    setProducts((value) =>
      value.map((product) =>
        product.id === selectedProduct.id
          ? {
              ...product,
              packages:
                modal === "editPackage"
                  ? product.packages.map((item) => (item.id === packageRecord.id ? packageRecord : item))
                  : [...product.packages, packageRecord]
            }
          : product
      )
    );
    resetPackageForm();
    setModal(null);
    showToast(`Package "${packageRecord.name}" saved.`);
    if (modal === "addPackage") {
      productsApi.createPackage(_pkgProdId, { name: packageRecord.name, description: packageRecord.description, quantity: packageRecord.quantity, price: packageRecord.price, currency: packageRecord.currency, display_order: packageRecord.displayOrder, active: packageRecord.active }).catch(() => {});
    } else if (modal === "editPackage" && selectedPackage) {
      productsApi.updatePackage(_pkgProdId, selectedPackage.id, { name: packageRecord.name, description: packageRecord.description, quantity: packageRecord.quantity, price: packageRecord.price, currency: packageRecord.currency, display_order: packageRecord.displayOrder }).catch(() => {});
    }
  };

  const openDeletePackage = (item: ProductPackage) => {
    setSelectedPackageId(item.id);
    setModal("deletePackage");
  };

  const deleteSelectedPackage = () => {
    if (!selectedProduct || !selectedPackage) {
      showToast("Choose a package first.");
      return;
    }

    setProducts((value) =>
      value.map((product) =>
        product.id === selectedProduct.id ? { ...product, packages: product.packages.filter((item) => item.id !== selectedPackage.id) } : product
      )
    );
    setModal(null);
    showToast(`Package "${selectedPackage.name}" deleted.`);
  };

  const savePackageDescription = () => {
    if (!selectedProduct) {
      return;
    }
    if (packageDescriptionDraft === selectedProduct.packageDescription) {
      showToast("No changes to save.");
      return;
    }
    setProducts((value) =>
      value.map((product) => (product.id === selectedProduct.id ? { ...product, packageDescription: packageDescriptionDraft } : product))
    );
    showToast("Package description saved.");
  };

  const generateEmbedUrl = (productOverride?: Product) => {
    const product = productOverride ?? generatedProduct ?? readyEmbedProducts[0];
    if (!product) {
      showToast("Create a product package first.");
      return;
    }

    setGeneratedProductId(product.id);
    setGeneratedEmbedProductIds((value) => (value.includes(product.id) ? value : [...value, product.id]));
    setEmbedCodeTabsByProduct((value) => ({ ...value, [product.id]: "Direct Link" }));
    showToast(`${product.name} embed URL generated.`);
  };
  const setProductEmbedCodeTab = (productId: string, tab: EmbedCodeTab) => {
    setEmbedCodeTabsByProduct((value) => ({ ...value, [productId]: tab }));
  };
  const updateShowWhatsappField = (checked: boolean) => {
    setShowWhatsappField(checked);
    if (!checked) {
      setRequireWhatsapp(false);
    }
  };

  const copyText = async (value: string, label: string) => {
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(value);
      } else {
        const el = document.createElement("textarea");
        el.value = value;
        el.style.position = "fixed";
        el.style.opacity = "0";
        document.body.appendChild(el);
        el.select();
        document.execCommand("copy");
        document.body.removeChild(el);
      }
      showToast(`${label} copied.`);
    } catch {
      showToast(`Could not copy ${label} — please copy it manually.`);
    }
  };

  const repForNewRecord = () => {
    if (createOrderContext === "rep") {
      return selectedRepUser?.id ?? activeSalesRepUsers[0]?.id ?? salesRepUsers[0]?.id;
    }

    if (createOrderRepId !== "auto") {
      return createOrderRepId;
    }

    const candidates = activeSalesRepUsers.length > 0 ? activeSalesRepUsers : salesRepUsers;
    if (candidates.length === 0) {
      showToast("No sales reps available — order created unassigned. Add a sales rep first.");
      return undefined;
    }
    return [...candidates].sort((a, b) => {
      const aOpen = trackedOrders.filter((order) => order.assignedRepId === a.id && !["Delivered", "Cancelled", "Failed"].includes(order.status ?? "New")).length;
      const bOpen = trackedOrders.filter((order) => order.assignedRepId === b.id && !["Delivered", "Cancelled", "Failed"].includes(order.status ?? "New")).length;
      return aOpen - bOpen;
    })[0]?.id;
  };

  const deductProductStockForOrder = (order: TrackedOrder) => {
    if (!order.productId || order.stockDeducted) {
      return;
    }

    const product = products.find((item) => item.id === order.productId);
    if (!product) {
      return;
    }

    const quantity = quantityForOrder(order);
    const sourceStock = order.agentId ? agentStock.find((stock) => stock.agentId === order.agentId && stock.productId === product.id) : undefined;
    const nextBalance = order.agentId ? Math.max(0, (sourceStock?.quantity ?? 0) - quantity) : Math.max(0, product.warehouseStock - quantity);
    setProducts((value) =>
      value.map((item) =>
        item.id === product.id
          ? {
              ...item,
              warehouseStock: order.agentId ? item.warehouseStock : nextBalance,
              agentStock: order.agentId ? Math.max(0, item.agentStock - quantity) : item.agentStock,
              unitsSold: item.unitsSold + quantity
            }
          : item
      )
    );
    if (order.agentId) {
      setAgentStock((value) =>
        value.map((stock) =>
          stock.agentId === order.agentId && stock.productId === product.id ? { ...stock, quantity: nextBalance } : stock
        )
      );
    }
    setStockMovements((value) => [
      {
        id: makeMovementId(),
        date: new Date().toISOString(),
        productId: product.id,
        productName: product.name,
        type: "Order Fulfilled",
        qty: -quantity,
        balanceAfter: nextBalance,
        agent: order.agentId ? agents.find((agent) => agent.id === order.agentId)?.name : undefined,
        order: order.id,
        by: ownerName,
        note: "Order delivered"
      },
      ...value
    ]);
    // Fire low-stock notification if warehouse stock crosses reorder point
    if (!order.agentId) {
      const newWarehouseStock = Math.max(0, product.warehouseStock - quantity);
      if (newWarehouseStock <= product.reorderPoint && product.warehouseStock > product.reorderPoint) {
        pushSystemNotification({
          type: "low_stock",
          message: `Low stock: ${product.name} — warehouse down to ${newWarehouseStock} unit${newWarehouseStock === 1 ? "" : "s"} (reorder point: ${product.reorderPoint})`,
          productId: product.id
        });
      }
    }
  };

  const orderTimelineNote = (text: string, followUpDate?: string, by = ownerName): OrderNote => ({
    id: makeNoteId(),
    text,
    by,
    date: new Date().toISOString(),
    followUpDate
  });

  const restoreProductStockForOrder = (order: TrackedOrder) => {
    if (!order.productId || !order.stockDeducted) {
      return;
    }
    const product = products.find((p) => p.id === order.productId);
    if (!product) {
      return;
    }
    const qty = quantityForOrder(order);
    const sourceStock = order.agentId ? agentStock.find((s) => s.agentId === order.agentId && s.productId === product.id) : undefined;
    const nextBalance = order.agentId ? (sourceStock?.quantity ?? 0) + qty : product.warehouseStock + qty;
    setProducts((prev) =>
      prev.map((p) =>
        p.id === product.id
          ? {
              ...p,
              warehouseStock: order.agentId ? p.warehouseStock : p.warehouseStock + qty,
              agentStock: order.agentId ? p.agentStock + qty : p.agentStock,
              unitsSold: Math.max(0, p.unitsSold - qty)
            }
          : p
      )
    );
    if (order.agentId) {
      setAgentStock((prev) =>
        prev.map((s) =>
          s.agentId === order.agentId && s.productId === product.id ? { ...s, quantity: nextBalance } : s
        )
      );
    }
    setStockMovements((prev) => [
      {
        id: makeMovementId(),
        date: new Date().toISOString(),
        productId: product.id,
        productName: product.name,
        type: "Return",
        qty,
        balanceAfter: nextBalance,
        agent: order.agentId ? agents.find((a) => a.id === order.agentId)?.name : undefined,
        order: order.id,
        by: ownerName,
        note: `Stock restored: ${order.id} status reversed from Delivered`
      },
      ...prev
    ]);
  };

  const updateOrderStatus = (orderId: string, nextStatus: Exclude<OrderStatus, "All Orders">, reason?: string) => {
    const order = trackedOrders.find((item) => item.id === orderId);
    if (!order) {
      return;
    }

    if (nextStatus === "Delivered") {
      deductProductStockForOrder(order);
    } else if (order.status === "Delivered" && order.stockDeducted) {
      restoreProductStockForOrder(order);
    }

    const response =
      nextStatus === "Delivered"
          ? "Delivered successfully"
          : nextStatus === "Cancelled"
          ? "Cancelled"
          : nextStatus === "Failed"
            ? "Delivery failed"
            : nextStatus === "Dispatched"
              ? "Out for delivery"
              : nextStatus === "In Process"
                ? "Call in process"
              : nextStatus === "Confirmed"
                ? "Confirmed by sales rep"
                : nextStatus === "Postponed"
                  ? "Delivery postponed"
                  : "Awaiting confirmation";
    setTrackedOrders((value) =>
      value.map((item) =>
        item.id === orderId
          ? {
              ...item,
              status: nextStatus,
              response,
              deliveredDate: nextStatus === "Delivered" ? todayKey() : order.status === "Delivered" ? undefined : item.deliveredDate,
              stockDeducted: nextStatus === "Delivered" ? true : order.status === "Delivered" ? false : item.stockDeducted,
              notes: [
                orderTimelineNote(`Status changed from ${item.status ?? "New"} to ${nextStatus}.${reason ? ` Reason: ${reason}` : ""}`),
                ...(item.notes ?? [])
              ]
            }
          : item
      )
    );
    showToast(`${orderId} moved to ${nextStatus}.`);
    ordersApi.updateStatus(orderId, { status: nextStatus, reason }).catch(() => {});
  };

  const bulkUpdateOrderStatus = (nextStatus: Exclude<OrderStatus, "All Orders">) => {
    if (selectedOrderIds.size === 0) return;
    selectedOrderIds.forEach((orderId) => updateOrderStatus(orderId, nextStatus));
    showToast(`${selectedOrderIds.size} order${selectedOrderIds.size > 1 ? "s" : ""} moved to ${nextStatus}.`);
    setSelectedOrderIds(new Set());
  };

  const scheduleOrder = (orderId: string, range: ScheduleRange) => {
    const order = trackedOrders.find((o) => o.id === orderId);
    if (order && ["Delivered", "Cancelled", "Failed"].includes(order.status ?? "")) {
      showToast(`Cannot schedule a ${order.status} order.`);
      return;
    }
    const scheduledDate = scheduleDateForRange(range);
    setTrackedOrders((value) =>
      value.map((o) =>
        o.id === orderId
          ? {
              ...o,
              status: o.status === "New" || !o.status ? "Confirmed" : o.status,
              scheduledDate,
              response: `Scheduled for ${displayDateFromKey(scheduledDate)}`,
              notes: [
                orderTimelineNote(`Delivery scheduled for ${displayDateFromKey(scheduledDate)}.`),
                ...(o.notes ?? [])
              ]
            }
          : o
      )
    );
    showToast(`${orderId} scheduled for ${displayDateFromKey(scheduledDate)}.`);
  };


  const markDraftCartConverted = (orderId: string) => {
    if (!abandonedDraftCartId) {
      return;
    }

    setAbandonedCarts((value) =>
      value.map((cart) =>
        cart.id === abandonedDraftCartId
          ? { ...cart, status: "Converted", lastActivity: new Date().toISOString() }
          : cart
      )
    );
    setAbandonedDraftCartId("");
    showToast(`Recovered cart converted to ${orderId}.`);
  };

  const resetCreateOrderForm = () => {
    const product = products[0];
    const firstPackage = product ? activeProductPackages(product)[0] : undefined;
    setCreateOrderCustomer("");
    setCreateOrderPhone("");
    setCreateOrderWhatsapp("");
    setCreateOrderEmail("");
    setCreateOrderAddress("");
    setCreateOrderCity("Lagos");
    setCreateOrderState("Lagos");
    setCreateOrderProductId(product?.id ?? "");
    setCreateOrderPackageId(firstPackage?.id ?? "");
    setCreateOrderQuantity(String(firstPackage?.quantity ?? 1));
    setCreateOrderSource("Website");
    setCreateOrderRepId("auto");
    setCreateOrderAgentId("");
  };

  const openCreateOrderModal = () => {
    setCreateOrderContext("admin");
    resetCreateOrderForm();
    setModal("createOrder");
  };

  const openRepCreateOrderModal = () => {
    setCreateOrderContext("rep");
    resetCreateOrderForm();
    setCreateOrderRepId(selectedRepUser?.id ?? "auto");
    setModal("createOrder");
  };

  const createManualOrder = () => {
    const product = products.find((item) => item.id === createOrderProductId);
    if (!product || !createOrderCustomer.trim() || !createOrderPhone.trim()) {
      showToast("Choose a product and enter customer name and phone.");
      return;
    }

    const packageRecord = product.packages.find((item) => item.id === createOrderPackageId);
    const quantity = Math.max(1, Number(createOrderQuantity) || packageRecord?.quantity || 1);
    const pricing = primaryPricing(product);
    const amount = packageRecord?.price ?? quantity * (pricing?.sellingPrice ?? 0);
    const order: TrackedOrder = {
      id: makeOrderId(),
      productId: product.id,
      packageId: packageRecord?.id,
      customer: createOrderCustomer.trim(),
      phone: createOrderPhone.trim(),
      whatsapp: createOrderWhatsapp.trim() || createOrderPhone.trim(),
      email: createOrderEmail.trim() || undefined,
      address: createOrderAddress.trim(),
      city: createOrderCity.trim(),
      state: createOrderState.trim(),
      productName: product.name,
      packageName: packageRecord?.name ?? "Manual package",
      quantity,
      amount,
      currency: packageRecord?.currency ?? pricing?.currency ?? "NGN",
      utmSource: createOrderSource.toLowerCase(),
      utmCampaign: "manual",
      source: createOrderSource,
      status: "New",
      response: "Awaiting confirmation",
      location: orderLocationFromFields(createOrderCity, createOrderState),
      assignedRepId: repForNewRecord(),
      createdAt: todayKey(),
      date: displayDateFromKey(todayKey()),
      notes: [{ id: makeNoteId(), text: createOrderContext === "rep" ? "Order created by sales rep console." : "Order created manually.", by: createOrderContext === "rep" ? repScopeName : ownerName, date: new Date().toISOString() }]
    };
    setTrackedOrders((value) => [order, ...value]);
    setModal(null);
    setCreateOrderContext("admin");
    showToast(`${order.id} created and assigned to ${users.find((user) => user.id === order.assignedRepId)?.name ?? "round-robin queue"}.`);
    ordersApi.create(order).catch(() => showToast(`${order.id} saved locally — sync failed.`));
  };

  const openOrderModal = (order: TrackedOrder, nextModal: ModalType) => {
    setSelectedOrderId(order.id);
    setReassignRepId(order.assignedRepId ?? activeSalesRepUsers[0]?.id ?? "");
    setHandoverReason("");
    setCreateOrderAgentId(order.agentId ?? "");
    setOrderNoteDraft("");
    setOrderFollowUpDate("");
    if (nextModal === "editOrderItems") {
      setCreateOrderCustomer(order.customer);
      setCreateOrderPhone(order.phone);
      setCreateOrderWhatsapp(order.whatsapp ?? "");
      setCreateOrderEmail(order.email ?? "");
      setCreateOrderAddress(order.address ?? "");
      setCreateOrderCity(order.city ?? "");
      setCreateOrderState(order.state ?? "");
      setCreateOrderProductId(order.productId ?? "");
      setCreateOrderPackageId(order.packageId ?? "");
      setCreateOrderQuantity(String(quantityForOrder(order)));
      setCreateOrderSource(order.source ?? orderSourceFromUtm(order.utmSource));
      setCreateOrderRepId(order.assignedRepId ?? "auto");
    }
    setModal(nextModal);
  };

  const openAdminOrderDetailPage = (order: TrackedOrder) => {
    const nextHash = `#/dashboard/admin/orders/${order.id}`;
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${nextHash}`);
    setHashRoute(nextHash);
    setActivePage("Call Rep Console");
    setRepConsoleRepId("all");
    setRepConsoleTab("Orders");
    setRepOrderDetailId(order.id);
    setSelectedOrderId(order.id);
    setModal(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
    showToast(`${order.id} detail workflow opened with owner access.`);
  };

  const saveOrderAgent = () => {
    if (!selectedOrder) {
      return;
    }

    const agentName = agents.find((agent) => agent.id === createOrderAgentId)?.name ?? "Unassigned";
    setTrackedOrders((value) =>
      value.map((order) =>
        order.id === selectedOrder.id
          ? {
              ...order,
              agentId: createOrderAgentId || undefined,
              response: createOrderAgentId ? "Assigned to delivery agent" : "Delivery agent cleared",
              notes: [
                orderTimelineNote(`Fulfillment assignment updated to ${agentName}.`),
                ...(order.notes ?? [])
              ]
            }
          : order
      )
    );
    const _soaId = selectedOrder.id;
    if (modal !== "orderWorkflow") {
      setModal(null);
    }
    showToast(`${selectedOrder.id} delivery agent updated.`);
    ordersApi.update(_soaId, { agent_id: createOrderAgentId || null }).catch(() => {});
  };

  const openEditSelectedOrder = () => {
    if (!selectedOrder) {
      return;
    }

    setCreateOrderCustomer(selectedOrder.customer);
    setCreateOrderPhone(selectedOrder.phone);
    setCreateOrderWhatsapp(selectedOrder.whatsapp ?? "");
    setCreateOrderEmail(selectedOrder.email ?? "");
    setCreateOrderAddress(selectedOrder.address ?? "");
    setCreateOrderCity(selectedOrder.city ?? "");
    setCreateOrderState(selectedOrder.state ?? "");
    setCreateOrderProductId(selectedOrder.productId ?? "");
    setCreateOrderPackageId(selectedOrder.packageId ?? "");
    setCreateOrderQuantity(String(quantityForOrder(selectedOrder)));
    setCreateOrderSource(selectedOrder.source ?? orderSourceFromUtm(selectedOrder.utmSource));
    setCreateOrderRepId(selectedOrder.assignedRepId ?? "auto");
    setCreateOrderAgentId(selectedOrder.agentId ?? "");
    setModal("editOrderItems");
  };

  const saveSelectedOrderEdit = () => {
    if (!selectedOrder) {
      return;
    }

    const product = products.find((item) => item.id === createOrderProductId);
    if (!product || !createOrderCustomer.trim() || !createOrderPhone.trim()) {
      showToast("Choose a product and enter customer name and phone.");
      return;
    }

    const packageRecord = product.packages.find((item) => item.id === createOrderPackageId);
    const quantity = Math.max(1, Number(createOrderQuantity) || packageRecord?.quantity || 1);
    const pricing = primaryPricing(product);
    const amount = packageRecord?.price ?? quantity * (pricing?.sellingPrice ?? 0);
    const _soeId = selectedOrder.id;
    setTrackedOrders((value) =>
      value.map((order) =>
        order.id === selectedOrder.id
          ? {
              ...order,
              productId: product.id,
              packageId: packageRecord?.id,
              customer: createOrderCustomer.trim(),
              phone: createOrderPhone.trim(),
              whatsapp: createOrderWhatsapp.trim(),
              address: createOrderAddress.trim(),
              city: createOrderCity.trim(),
              state: createOrderState.trim(),
              productName: product.name,
              packageName: packageRecord?.name ?? "Manual package",
              quantity,
              amount,
              currency: packageRecord?.currency ?? pricing?.currency ?? "NGN",
              email: createOrderEmail.trim() || order.email,
              source: createOrderSource,
              utmSource: createOrderSource.toLowerCase(),
              location: orderLocationFromFields(createOrderCity, createOrderState),
              assignedRepId: createOrderRepId === "auto" ? order.assignedRepId : createOrderRepId,
              agentId: createOrderAgentId || undefined,
              notes: [
                { id: makeNoteId(), text: "Order details edited.", by: ownerName, date: new Date().toISOString() },
                ...(order.notes ?? [])
              ]
            }
          : order
      )
    );
    ordersApi.update(_soeId, { customer: createOrderCustomer.trim(), phone: createOrderPhone.trim(), whatsapp: createOrderWhatsapp.trim(), address: createOrderAddress.trim(), city: createOrderCity.trim(), state: createOrderState.trim(), product_id: product.id, package_id: packageRecord?.id, product_name: product.name, package_name: packageRecord?.name ?? "Manual package", quantity, amount, source: createOrderSource, assigned_rep_id: createOrderRepId === "auto" ? selectedOrder.assignedRepId : createOrderRepId, agent_id: createOrderAgentId || null }).catch(() => {});
    setModal(null);
    showToast(`${selectedOrder.id} updated.`);
  };

  const reassignSelectedOrder = () => {
    if (!selectedOrder || !reassignRepId) {
      showToast("Choose the new sales rep.");
      return;
    }

    setTrackedOrders((value) =>
      value.map((order) =>
        order.id === selectedOrder.id
          ? {
              ...order,
              assignedRepId: reassignRepId,
              response: `Reassigned: ${handoverReason.trim() || "handover noted"}`,
              notes: [
                { id: makeNoteId(), text: `Reassigned to ${users.find((user) => user.id === reassignRepId)?.name ?? "rep"} - ${handoverReason.trim() || "No reason supplied"}`, by: ownerName, date: new Date().toISOString() },
                ...(order.notes ?? [])
              ]
            }
          : order
      )
    );
    setModal(null);
    showToast(`${selectedOrder.id} reassigned.`);
  };

  const addOrderNote = () => {
    if (!selectedOrder || !orderNoteDraft.trim()) {
      showToast("Add a note before saving.");
      return;
    }

    setTrackedOrders((value) =>
      value.map((order) =>
        order.id === selectedOrder.id
          ? {
              ...order,
              notes: [
                { id: makeNoteId(), text: orderNoteDraft.trim(), by: ownerName, date: new Date().toISOString(), followUpDate: orderFollowUpDate || undefined },
                ...(order.notes ?? [])
              ],
              response: orderFollowUpDate ? `Follow-up set for ${displayDateFromKey(orderFollowUpDate)}` : order.response
            }
          : order
      )
    );
    setOrderNoteDraft("");
    setOrderFollowUpDate("");
    setShowRepFollowUpField(false);
    showToast(`${selectedOrder.id} timeline updated.`);
  };

  const openRepOrderDetail = (order: TrackedOrder) => {
    setSelectedOrderId(order.id);
    setRepOrderDetailId(order.id);
    setRepConsoleTab("Orders");
    setCreateOrderAgentId(order.agentId ?? "");
    setRepScheduleDate(normalizeDateKey(order.scheduledDate));
    setShowRepFollowUpField(false);
    setRepDeliveryFee(order.logisticsCost != null ? String(order.logisticsCost) : "");
    setRepAmountToRemit(order.amountRemitted != null ? String(order.amountRemitted) : String(Math.max(0, order.amount - (order.logisticsCost ?? 0))));
    setRepExtraExpenses([]);
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#/dashboard/sales-rep/orders/${order.id}`);
    setHashRoute(`#/dashboard/sales-rep/orders/${order.id}`);
  };

  const closeRepOrderDetail = () => {
    setRepOrderDetailId("");
    const nextHash = hashRoute.startsWith("#/dashboard/admin/orders") ? "#/dashboard/admin/orders" : "#/dashboard/sales-rep/orders";
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${nextHash}`);
    setHashRoute(nextHash);
  };

  const openRepStatusChangeModal = (order: TrackedOrder) => {
    const currentStatus = order.status ?? "New";
    setSelectedOrderId(order.id);
    setStatusChangeDraft(currentStatus === "New" ? "Confirmed" : currentStatus);
    setStatusChangeReason("");
    setCallOutcomeDraft(order.callOutcome ?? "");
    setModal("changeOrderStatus");
  };

  const submitRepStatusChange = () => {
    if (!selectedOrder) return;
    const requiresReason = ["Cancelled", "Failed", "Postponed"].includes(statusChangeDraft);
    if (requiresReason && !statusChangeReason.trim()) {
      showToast("A reason is required when cancelling, failing, or postponing an order.");
      return;
    }
    updateOrderStatus(selectedOrder.id, statusChangeDraft, statusChangeReason.trim());
    if (callOutcomeDraft) {
      setTrackedOrders((prev) => prev.map((o) => o.id === selectedOrder.id ? { ...o, callOutcome: callOutcomeDraft as CallOutcome } : o));
    }
    setStatusChangeReason("");
    setCallOutcomeDraft("");
    setModal(null);
  };

  const openRepEditOrderCustomer = (order: TrackedOrder) => {
    setSelectedOrderId(order.id);
    setCreateOrderCustomer(order.customer);
    setCreateOrderPhone(order.phone);
    setCreateOrderWhatsapp(order.whatsapp ?? "");
    setCreateOrderEmail(order.email ?? "");
    setCreateOrderAddress(order.address ?? "");
    setCreateOrderCity(order.city ?? "");
    setCreateOrderState(order.state ?? "");
    setModal("editOrderCustomer");
  };

  const saveOrderCustomerEdit = () => {
    if (!selectedOrder || !createOrderCustomer.trim() || !createOrderPhone.trim()) {
      showToast("Customer name and phone are required.");
      return;
    }

    setTrackedOrders((value) =>
      value.map((order) =>
        order.id === selectedOrder.id
          ? {
              ...order,
              customer: createOrderCustomer.trim(),
              phone: createOrderPhone.trim(),
              whatsapp: createOrderWhatsapp.trim() || createOrderPhone.trim(),
              email: createOrderEmail.trim() || order.email,
              address: createOrderAddress.trim(),
              city: createOrderCity.trim(),
              state: createOrderState.trim(),
              location: orderLocationFromFields(createOrderCity, createOrderState),
              notes: [
                orderTimelineNote("Customer and delivery details edited from call rep console.", undefined, repScopeName),
                ...(order.notes ?? [])
              ]
            }
          : order
      )
    );
    const _soceId = selectedOrder.id;
    setModal(null);
    showToast(`${selectedOrder.id} customer details saved.`);
    ordersApi.update(_soceId, { customer: createOrderCustomer.trim(), phone: createOrderPhone.trim(), whatsapp: createOrderWhatsapp.trim() || createOrderPhone.trim(), address: createOrderAddress.trim(), city: createOrderCity.trim(), state: createOrderState.trim() }).catch(() => {});
  };

  const saveRepScheduleDate = () => {
    if (!selectedOrder || !isDateValue(repScheduleDate)) {
      showToast("Choose a valid delivery date.");
      return;
    }

    setTrackedOrders((value) =>
      value.map((order) =>
        order.id === selectedOrder.id
          ? {
              ...order,
              status: order.status === "New" || !order.status ? "Confirmed" : order.status,
              scheduledDate: repScheduleDate,
              response: `Scheduled for ${displayDateFromKey(repScheduleDate)}`,
              notes: [
                orderTimelineNote(`Delivery date committed for ${displayDateFromKey(repScheduleDate)}.`, undefined, repScopeName),
                ...(order.notes ?? [])
              ]
            }
          : order
      )
    );
    showToast(`${selectedOrder.id} scheduled for ${displayDateFromKey(repScheduleDate)}.`);
  };

  const printInvoiceForOrder = (order: TrackedOrder) => {
    const printWindow = window.open("", "_blank", "width=780,height=920");
    if (!printWindow) {
      showToast("Print window was blocked.");
      return;
    }
    printWindow.document.write(`<html><head><title>Invoice ${order.id}</title><style>body{font-family:Arial,sans-serif;padding:32px;color:#111827}h1{margin:0 0 8px}.meta{color:#667085;margin-bottom:24px}table{width:100%;border-collapse:collapse;margin-top:20px}th,td{border:1px solid #d0d5dd;padding:12px;text-align:left}.total{font-size:22px;font-weight:800;text-align:right;margin-top:24px}</style></head><body><h1>Protohub Invoice</h1><p class="meta">${order.id} · ${order.customer} · ${order.date}</p><p><strong>Phone:</strong> ${order.phone}</p><p><strong>Address:</strong> ${order.address ?? ""} ${order.city ?? ""} ${order.state ?? ""}</p><table><thead><tr><th>Product</th><th>Package</th><th>Qty</th><th>Total</th></tr></thead><tbody><tr><td>${order.productName}</td><td>${order.packageName}</td><td>${quantityForOrder(order)}</td><td>${formatProductMoney(order.amount, order.currency)}</td></tr></tbody></table><p class="total">Grand Total: ${formatProductMoney(order.amount, order.currency)}</p></body></html>`);
    printWindow.document.close();
    printWindow.print();
    showToast(`Print invoice opened for ${order.id}.`);
  };

  const downloadInvoiceForOrder = (order: TrackedOrder) => {
    const pdfEscape = (value: string) => value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
    const invoiceLines = [
      "Protohub Invoice",
      `Order: ${order.id}`,
      `Customer: ${order.customer}`,
      `Phone: ${order.phone}`,
      `Address: ${[order.address, order.city, order.state].filter(Boolean).join(", ")}`,
      `Product: ${order.productName}`,
      `Package: ${order.packageName}`,
      `Quantity: ${quantityForOrder(order)}`,
      `Grand Total: ${formatProductMoney(order.amount, order.currency)}`
    ];
    const stream = `BT\n/F1 14 Tf\n${invoiceLines.map((line, index) => `1 0 0 1 72 ${740 - index * 28} Tm (${pdfEscape(line)}) Tj`).join("\n")}\nET`;
    const objects = [
      "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
      "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
      "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n",
      "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
      `5 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`
    ];
    const offsets: number[] = [];
    let pdf = "%PDF-1.4\n";
    objects.forEach((object) => {
      offsets.push(pdf.length);
      pdf += object;
    });
    const xrefStart = pdf.length;
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n `).join("\n")}\n`;
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
    const url = URL.createObjectURL(new Blob([pdf], { type: "application/pdf" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${order.id}-invoice.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast(`Invoice downloaded for ${order.id}.`);
  };

  const deleteSelectedOrder = () => {
    if (!selectedOrder) {
      return;
    }
    if (selectedOrder.stockDeducted && selectedOrder.productId) {
      const product = products.find((p) => p.id === selectedOrder.productId);
      const qty = quantityForOrder(selectedOrder);
      if (product) {
        setProducts((prev) => prev.map((p) => p.id === product.id ? { ...p, warehouseStock: p.warehouseStock + qty, unitsSold: Math.max(0, p.unitsSold - qty) } : p));
        setStockMovements((prev) => [{ id: makeMovementId(), date: new Date().toISOString(), productId: product.id, productName: product.name, type: "Return", qty, balanceAfter: product.warehouseStock + qty, order: selectedOrder.id, by: ownerName, note: `Stock restored: order ${selectedOrder.id} deleted` }, ...prev]);
      }
    }
    const _doId = selectedOrder.id;
    const _doStockDeducted = selectedOrder.stockDeducted;
    setTrackedOrders((value) => value.filter((order) => order.id !== selectedOrder.id));
    setModal(null);
    showToast(`${_doId} deleted${_doStockDeducted ? " and stock restored" : ""}.`);
    ordersApi.delete(_doId).catch(() => {});
  };

  const submitPreviewOrder = () => {
    if (!previewProduct || !orderFormName.trim() || !orderFormPhone.trim()) {
      showToast("Customer name and phone are required.");
      return;
    }

    if (showWhatsappField && requireWhatsapp && !orderFormWhatsapp.trim()) {
      showToast("WhatsApp number is required.");
      return;
    }

    if (requireConfirmation && !orderFormConfirmed) {
      showToast("Please confirm before submitting.");
      return;
    }

    if (showCommitmentNotice && !orderFormCommitmentAccepted) {
      showToast("Please acknowledge the commitment fee notice.");
      return;
    }

    const chosenPackage = previewPackages.find((item) => item.id === orderFormPackageId) ?? previewPackages[0];
    if (!chosenPackage) {
      showToast("Choose a package first.");
      return;
    }

    const orderId = makeOrderId();
    const location = orderLocationFromFields(orderFormCity, orderFormState);
    const xsLines: CrossSellLine[] = orderFormCrossSells.map((c) => {
      const p = products.find((pp) => pp.id === c.productId);
      const unitPrice = p ? crossSellPriceFor(previewProduct, p) : 0;
      const price = unitPrice * c.quantity;
      return { id: makeCrossSellLineId(), productId: c.productId, productName: p?.name ?? "Add-on", quantity: c.quantity, amount: price };
    });
    const xsTotal = xsLines.reduce((s, l) => s + l.amount, 0);
    const giftLines: FreeGiftLine[] = (previewProduct.freeGiftProductIds ?? []).map((gid) => {
      const p = products.find((pp) => pp.id === gid);
      if (!p || !freeGiftVisibleInState(previewProduct, p, orderFormState.trim())) return null;
      return { id: makeFreeGiftLineId(), productId: gid, productName: p.name, quantity: 1 };
    }).filter(Boolean) as FreeGiftLine[];

    setTrackedOrders((value) => [
      {
        id: orderId,
        productId: previewProduct.id,
        packageId: chosenPackage.id,
        customer: orderFormName.trim(),
        phone: orderFormPhone.trim(),
        whatsapp: orderFormWhatsapp.trim(),
        email: orderFormEmail.trim(),
        address: orderFormAddress.trim(),
        city: orderFormCity.trim(),
        state: orderFormState.trim(),
        productName: previewProduct.name,
        packageName: chosenPackage.name,
        quantity: chosenPackage.quantity,
        amount: chosenPackage.price + xsTotal,
        currency: chosenPackage.currency,
        utmSource: "website",
        utmCampaign: "embed_preview",
        source: "Website",
        status: "New",
        response: "Awaiting confirmation",
        location,
        deliveryWindow: orderFormDeliveryWindow.trim() || undefined,
        assignedRepId: repForNewRecord(),
        crossSellLines: xsLines.length > 0 ? xsLines : undefined,
        freeGiftLines: giftLines.length > 0 ? giftLines : undefined,
        notes: [
          { id: makeNoteId(), text: abandonedDraftCartId ? `Converted from abandoned cart ${abandonedDraftCartId}.` : "Order submitted from embed preview.", by: "System", date: new Date().toISOString() },
          ...(orderFormDeliveryWindow.trim() ? [{ id: makeNoteId(), text: `Preferred delivery window: ${orderFormDeliveryWindow.trim()}`, by: "Customer", date: new Date().toISOString() }] : [])
        ],
        createdAt: todayKey(),
        date: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
      },
      ...value
    ]);
    markDraftCartConverted(orderId);
    setOrderFormName("");
    setOrderFormPhone("");
    setOrderFormWhatsapp("");
    setOrderFormEmail("");
    setOrderFormAddress("");
    setOrderFormCity("");
    setOrderFormState("");
    setOrderFormDeliveryWindow("");
    setOrderFormConfirmed(false);
    setOrderFormCommitmentAccepted(false);
    setOrderFormCrossSells([]);
    showToast("Preview order submitted and attributed to Ad Tracking.");
  };

  const submitPublicOrder = () => {
    if (publicOrderSubmitting) return;
    if (!publicProduct || !orderFormName.trim() || !orderFormPhone.trim()) {
      showToast("Customer name and phone are required.");
      return;
    }

    if (showWhatsappField && requireWhatsapp && !orderFormWhatsapp.trim()) {
      showToast("WhatsApp number is required.");
      return;
    }

    if (requireConfirmation && !orderFormConfirmed) {
      showToast("Please confirm before submitting.");
      return;
    }

    if (showCommitmentNotice && !orderFormCommitmentAccepted) {
      showToast("Please acknowledge the commitment fee notice.");
      return;
    }

    const chosenPackage = publicPackages.find((item) => item.id === orderFormPackageId) ?? publicPackages[0];
    if (!chosenPackage) {
      showToast("Choose a package first.");
      return;
    }

    const orderId = makeOrderId();
    const source = orderSourceFromUtm(publicUtmSource);
    const location = orderLocationFromFields(orderFormCity, orderFormState);
    const xsLines: CrossSellLine[] = orderFormCrossSells.map((c) => {
      const p = products.find((pp) => pp.id === c.productId);
      const unitPrice = p ? crossSellPriceFor(publicProduct, p) : 0;
      const price = unitPrice * c.quantity;
      return { id: makeCrossSellLineId(), productId: c.productId, productName: p?.name ?? "Add-on", quantity: c.quantity, amount: price };
    });
    const xsTotal = xsLines.reduce((s, l) => s + l.amount, 0);
    const giftLines: FreeGiftLine[] = (publicProduct.freeGiftProductIds ?? []).map((gid) => {
      const p = products.find((pp) => pp.id === gid);
      if (!p || !freeGiftVisibleInState(publicProduct, p, orderFormState.trim())) return null;
      return { id: makeFreeGiftLineId(), productId: gid, productName: p.name, quantity: 1 };
    }).filter(Boolean) as FreeGiftLine[];

    setTrackedOrders((value) => [
      {
        id: orderId,
        productId: publicProduct.id,
        packageId: chosenPackage.id,
        customer: orderFormName.trim(),
        phone: orderFormPhone.trim(),
        whatsapp: orderFormWhatsapp.trim(),
        email: orderFormEmail.trim(),
        address: orderFormAddress.trim(),
        city: orderFormCity.trim(),
        state: orderFormState.trim(),
        productName: publicProduct.name,
        packageName: chosenPackage.name,
        quantity: chosenPackage.quantity,
        amount: chosenPackage.price + xsTotal,
        currency: chosenPackage.currency,
        utmSource: publicUtmSource,
        utmCampaign: publicUtmCampaign,
        source,
        status: "New",
        response: "Awaiting confirmation",
        location,
        deliveryWindow: orderFormDeliveryWindow.trim() || undefined,
        assignedRepId: repForNewRecord(),
        crossSellLines: xsLines.length > 0 ? xsLines : undefined,
        freeGiftLines: giftLines.length > 0 ? giftLines : undefined,
        notes: [
          { id: makeNoteId(), text: abandonedDraftCartId ? `Converted from abandoned cart ${abandonedDraftCartId}.` : "Order submitted from public embed form.", by: "System", date: new Date().toISOString() },
          ...(orderFormDeliveryWindow.trim() ? [{ id: makeNoteId(), text: `Preferred delivery window: ${orderFormDeliveryWindow.trim()}`, by: "Customer", date: new Date().toISOString() }] : [])
        ],
        createdAt: todayKey(),
        date: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
      },
      ...value
    ]);
    setPublicOrderSubmitting(true);
    markDraftCartConverted(orderId);
    setOrderFormName("");
    setOrderFormPhone("");
    setOrderFormWhatsapp("");
    setOrderFormEmail("");
    setOrderFormAddress("");
    setOrderFormCity("");
    setOrderFormState("");
    setOrderFormDeliveryWindow("");
    setOrderFormConfirmed(false);
    setOrderFormCommitmentAccepted(false);
    setOrderFormCrossSells([]);
    showToast("Order submitted. It is now visible in Ad Tracking.");
    setTimeout(() => setPublicOrderSubmitting(false), 3000);
  };

  const createTeam = () => {
    if (!newTeamName.trim()) { showToast("Team name is required."); return; }
    if (salesTeams.some((t) => t.name.toLowerCase() === newTeamName.trim().toLowerCase())) { showToast(`A team named "${newTeamName.trim()}" already exists.`); return; }
    setExtraTeams((prev) => [...prev, { id: `team-${Date.now().toString(36)}`, name: newTeamName.trim(), leadId: newTeamLeadId || undefined, productIds: [] }]);
    setNewTeamName("");
    setNewTeamLeadId("");
    setModal(null);
    showToast(`Team "${newTeamName.trim()}" created.`);
  };

  const createSalesRep = () => {
    if (!salesRepName.trim() || !salesRepEmail.trim()) {
      showToast("Sales rep name and email are required.");
      return;
    }
    if (salesRepPassword.trim().length > 0 && salesRepPassword.trim().length < 6) {
      showToast("Password must be at least 6 characters.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(salesRepEmail.trim())) {
      showToast("Please enter a valid email address.");
      return;
    }
    if (users.some((u) => u.email.toLowerCase() === salesRepEmail.trim().toLowerCase())) {
      showToast("A user with this email already exists.");
      return;
    }

    const rep: ManagedUser = {
      id: `rep-${Date.now().toString(36)}`,
      name: salesRepName.trim(),
      email: salesRepEmail.trim(),
      role: salesRepRole,
      active: salesRepActive,
      created: displayDateFromKey(todayKey())
    };
    setUsers((value) => [...value, rep]);
    setSalesRepName("");
    setSalesRepEmail("");
    setSalesRepPassword("");
    setSalesRepRole("Sales Rep");
    setSalesRepActive(true);
    setModal(null);
    showToast(`Sales rep "${rep.name}" created and added to round-robin.`);
    if (salesRepPassword.trim()) {
      authApi.invite({ name: rep.name, email: rep.email, password: salesRepPassword.trim(), role: rep.role }).catch(() => showToast("Sales rep saved locally — invite sync failed."));
    }
  };

  const createAgent = () => {
    if (!agentName.trim() || !agentPhone.trim() || !agentZoneInput.trim()) {
      showToast("Agent name, phone number, and primary zone are required.");
      return;
    }
    if (agents.some((a) => a.phone === agentPhone.trim())) {
      showToast("An agent with this phone number already exists.");
      return;
    }

    const agent: DeliveryAgentRecord = {
      id: makeAgentId(),
      name: agentName.trim(),
      phone: agentPhone.trim(),
      zone: agentZoneInput.trim(),
      address: agentAddress.trim(),
      active: agentActive,
      created: displayDateFromKey(todayKey())
    };
    const _agLocalId = agent.id;
    setAgents((value) => [...value, agent]);
    setSelectedAgentId(agent.id);
    setAgentName("");
    setAgentPhone("");
    setAgentZoneInput("");
    setAgentAddress("");
    setModal(null);
    showToast(`Agent "${agent.name}" created.`);
    agentsApi.create({ name: agent.name, zone: agent.zone, phone: agent.phone, status: agent.active ? "Active" : "Inactive" })
      .then((saved: any) => {
        setAgents((prev) => prev.map((a) => a.id === _agLocalId ? { ...a, id: saved.id } : a));
        setSelectedAgentId(saved.id);
      })
      .catch(() => showToast(`Agent saved locally — sync failed.`));
  };

  const openAgentModal = (agent: DeliveryAgentRecord, nextModal: ModalType) => {
    setSelectedAgentId(agent.id);
    setAssignStockProductId(products[0]?.id ?? "");
    setAssignStockQty("1");
    setReconcileProductId(agentStock.find((stock) => stock.agentId === agent.id)?.productId ?? products[0]?.id ?? "");
    setReconcileReturned("0");
    setReconcileDefective("0");
    setReconcileMissing("0");
    setReconcileNotes("");
    setAgentName(agent.name);
    setAgentPhone(agent.phone);
    setAgentZoneInput(agent.zone);
    setAgentAddress(agent.address);
    setAgentActive(agent.active);
    setModal(nextModal);
  };

  const assignStockToSelectedAgent = () => {
    if (!selectedAgent || !assignStockProductId) {
      showToast("Choose an agent and product.");
      return;
    }

    const quantity = Math.max(1, Number(assignStockQty) || 1);
    const product = products.find((item) => item.id === assignStockProductId);
    if (!product || product.warehouseStock < quantity) {
      showToast("Not enough warehouse stock for this assignment.");
      return;
    }

    setProducts((value) =>
      value.map((item) =>
        item.id === product.id
          ? { ...item, warehouseStock: item.warehouseStock - quantity, agentStock: item.agentStock + quantity }
          : item
      )
    );
    setAgentStock((value) => {
      const existing = value.find((stock) => stock.agentId === selectedAgent.id && stock.productId === product.id);
      if (existing) {
        return value.map((stock) => (stock === existing ? { ...stock, quantity: stock.quantity + quantity } : stock));
      }
      return [...value, { agentId: selectedAgent.id, productId: product.id, quantity, defective: 0, missing: 0 }];
    });
    setStockMovements((value) => [
      { id: makeMovementId(), date: new Date().toISOString(), productId: product.id, productName: product.name, type: "Distributed to Agent", qty: -quantity, balanceAfter: product.warehouseStock - quantity, agent: selectedAgent.name, by: ownerName, note: "Assigned from agent directory" },
      ...value
    ]);
    const _assAgId = selectedAgent.id;
    const _assProdId = product.id;
    setAssignStockQty("1");
    setModal(null);
    showToast(`${quantity} ${product.name} assigned to ${selectedAgent.name}.`);
    agentsApi.assignStock(_assAgId, { productId: _assProdId, quantity }).catch(() => {});
  };

  const reconcileSelectedAgentStock = () => {
    if (!selectedAgent || !reconcileProductId) {
      showToast("Choose an agent and product.");
      return;
    }

    const product = products.find((item) => item.id === reconcileProductId);
    const currentStock = agentStock.find((stock) => stock.agentId === selectedAgent.id && stock.productId === reconcileProductId);
    const currentQuantity = currentStock?.quantity ?? 0;
    const returned = Math.max(0, Number(reconcileReturned) || 0);
    const defective = Math.max(0, Number(reconcileDefective) || 0);
    const missing = Math.max(0, Number(reconcileMissing) || 0);
    const totalRemoved = returned + defective + missing;

    if (totalRemoved === 0) {
      showToast("Enter at least one quantity to reconcile.");
      return;
    }
    if (totalRemoved > currentQuantity) {
      showToast(`Cannot reconcile ${totalRemoved} units — agent only has ${currentQuantity}.`);
      return;
    }

    const nextQuantity = currentQuantity - totalRemoved;

    // Accumulate defective/missing tallies — do NOT reset to 0
    setAgentStock((value) =>
      value.map((stock) =>
        stock.agentId === selectedAgent.id && stock.productId === reconcileProductId
          ? {
              ...stock,
              quantity: nextQuantity,
              defective: (stock.defective ?? 0) + defective,
              missing: (stock.missing ?? 0) + missing,
            }
          : stock
      )
    );

    if (product) {
      // Return good stock to warehouse
      if (returned > 0) {
        setProducts((value) =>
          value.map((p) =>
            p.id === product.id
              ? { ...p, warehouseStock: p.warehouseStock + returned, agentStock: Math.max(0, p.agentStock - returned) }
              : p
          )
        );
      }

      const noteSuffix = reconcileNotes.trim() ? ` — ${reconcileNotes.trim()}` : "";
      const newMovements: StockMovement[] = [];

      // Log return and write-offs as separate movements so the history is readable
      if (returned > 0) {
        newMovements.push({
          id: makeMovementId(),
          date: new Date().toISOString(),
          productId: product.id,
          productName: product.name,
          type: "Return",
          qty: returned,
          balanceAfter: product.warehouseStock + returned,
          agent: selectedAgent.name,
          by: ownerName,
          note: `${returned} unit${returned !== 1 ? "s" : ""} returned to warehouse${noteSuffix}`,
        });
      }

      if (defective > 0 || missing > 0) {
        const parts: string[] = [];
        if (defective > 0) parts.push(`${defective} defective`);
        if (missing > 0) parts.push(`${missing} missing`);
        newMovements.push({
          id: makeMovementId(),
          date: new Date().toISOString(),
          productId: product.id,
          productName: product.name,
          type: "Correction",
          qty: -(defective + missing),
          balanceAfter: nextQuantity,
          agent: selectedAgent.name,
          by: ownerName,
          note: `${parts.join(", ")} written off${noteSuffix}`,
        });
      }

      if (newMovements.length > 0) {
        setStockMovements((value) => [...newMovements, ...value]);
      }
    }

    setModal(null);
    showToast(`${selectedAgent.name} stock reconciled.`);
  };

  const updateSelectedAgent = () => {
    if (!selectedAgent || !agentName.trim() || !agentPhone.trim() || !agentZoneInput.trim()) {
      showToast("Agent name, phone, and zone are required.");
      return;
    }
    if (agents.some((a) => a.id !== selectedAgent.id && a.phone === agentPhone.trim())) {
      showToast("Another agent already has this phone number.");
      return;
    }

    const _uaId = selectedAgent.id;
    setAgents((value) =>
      value.map((agent) =>
        agent.id === selectedAgent.id
          ? { ...agent, name: agentName.trim(), phone: agentPhone.trim(), zone: agentZoneInput.trim(), address: agentAddress.trim(), active: agentActive }
          : agent
      )
    );
    setModal(null);
    showToast(`${agentName.trim()} updated.`);
    agentsApi.update(_uaId, { name: agentName.trim(), zone: agentZoneInput.trim(), phone: agentPhone.trim(), status: agentActive ? "Active" : "Inactive" }).catch(() => {});
  };

  const deleteSelectedAgent = () => {
    if (!selectedAgent) return;

    const agentStockRows = agentStock.filter((s) => s.agentId === selectedAgent.id);
    const activeStatuses: TrackedOrder["status"][] = ["New", "Confirmed", "In Process", "Dispatched"];
    const activeOrders = trackedOrders.filter((o) => o.agentId === selectedAgent.id && activeStatuses.includes(o.status));

    // Block deletion if agent has live active/dispatched orders
    if (activeOrders.length > 0) {
      showToast(`Reassign ${activeOrders.length} active order${activeOrders.length !== 1 ? "s" : ""} before deleting this agent.`);
      return;
    }

    // Return each product's stock to the warehouse and log a movement
    const now = new Date().toISOString();
    const newMovements: StockMovement[] = [];
    const productUpdates = new Map<string, number>(); // productId → qty to return

    for (const row of agentStockRows) {
      if (row.quantity > 0) {
        productUpdates.set(row.productId, (productUpdates.get(row.productId) ?? 0) + row.quantity);
      }
    }

    if (productUpdates.size > 0) {
      setProducts((prev) =>
        prev.map((p) => {
          const qty = productUpdates.get(p.id);
          if (!qty) return p;
          newMovements.push({
            id: makeMovementId(),
            date: now,
            productId: p.id,
            productName: p.name,
            type: "Return",
            qty,
            balanceAfter: p.warehouseStock + qty,
            agent: selectedAgent.name,
            by: ownerName,
            note: `Stock returned to warehouse — agent "${selectedAgent.name}" deleted`,
          });
          return { ...p, warehouseStock: p.warehouseStock + qty, agentStock: Math.max(0, p.agentStock - qty) };
        })
      );
      setStockMovements((prev) => [...newMovements, ...prev]);
    }

    // Unassign this agent from historical (non-active) orders so they don't show a ghost agent name
    setTrackedOrders((prev) =>
      prev.map((o) => (o.agentId === selectedAgent.id ? { ...o, agentId: undefined } : o))
    );

    // Remove agent and their stock records
    const _daId = selectedAgent.id;
    setAgents((prev) => prev.filter((a) => a.id !== selectedAgent.id));
    setAgentStock((prev) => prev.filter((s) => s.agentId !== selectedAgent.id));
    setModal(null);
    showToast(`${selectedAgent.name} deleted. ${productUpdates.size > 0 ? "Stock returned to warehouse." : ""}`);
    agentsApi.delete(_daId).catch(() => {});
  };

  const openCreateWaybill = () => {
    setWaybillProductId("");
    setWaybillQty("1");
    setWaybillFee("0");
    setWaybillPartner("");
    setWaybillFromType("Warehouse");
    setWaybillFromAgentId("");
    setWaybillToAgentId("");
    setWaybillToState("");
    setWaybillDateSent(new Date().toISOString().slice(0, 10));
    setWaybillNote("");
    setWaybillErrors({});
    setModal("createWaybill");
  };

  const createWaybill = () => {
    const errs: Record<string, string> = {};
    if (!waybillProductId) errs.product = "Select a product.";
    const qty = Math.max(1, Number(waybillQty) || 1);
    if (!waybillQty || Number(waybillQty) < 1) errs.qty = "Quantity must be at least 1.";
    if (!waybillPartner.trim()) errs.partner = "Logistics partner is required.";
    if (waybillFromType === "Agent" && !waybillFromAgentId) errs.fromAgent = "Select a sending agent.";
    const toAgent = waybillToAgentId ? agents.find((ag) => ag.id === waybillToAgentId) : null;
    const receivingState = toAgent?.zone ?? waybillToState.trim();
    if (!receivingState) errs.toState = "Receiving state is required.";
    if (!waybillDateSent) errs.dateSent = "Date sent is required.";
    if (Object.keys(errs).length > 0) { setWaybillErrors(errs); return; }
    setWaybillErrors({});

    const product = products.find((p) => p.id === waybillProductId);
    if (!product) return;
    const fee = Math.max(0, Number(waybillFee) || 0);

    if (waybillFromType === "Warehouse") {
      if (product.warehouseStock < qty) {
        setWaybillErrors({ qty: `Not enough warehouse stock. Available: ${product.warehouseStock}` });
        return;
      }
    } else {
      const agentRow = agentStock.find((s) => s.agentId === waybillFromAgentId && s.productId === waybillProductId);
      if (!agentRow || agentRow.quantity < qty) {
        setWaybillErrors({ qty: `Not enough agent stock. Available: ${agentRow?.quantity ?? 0}` });
        return;
      }
    }

    const fromAgent = waybillFromType === "Agent" ? agents.find((a) => a.id === waybillFromAgentId) : null;
    const sendingState = waybillFromType === "Warehouse" ? "Lagos" : (fromAgent?.zone ?? "");

    const record: WaybillRecord = {
      id: `WB-${Date.now().toString(36).toUpperCase()}`,
      productId: waybillProductId,
      productName: product.name,
      quantity: qty,
      waybillFee: fee,
      logisticsPartner: waybillPartner.trim(),
      sendingState,
      receivingState,
      fromAgentId: waybillFromType === "Agent" ? waybillFromAgentId : undefined,
      toAgentId: waybillToAgentId || undefined,
      dateSent: waybillDateSent,
      status: "In Transit",
      note: waybillNote.trim() || undefined,
      createdBy: ownerName,
      createdAt: new Date().toISOString(),
    };

    if (waybillFromType === "Warehouse") {
      setProducts((prev) => prev.map((p) => p.id === product.id ? { ...p, warehouseStock: p.warehouseStock - qty } : p));
    } else {
      setAgentStock((prev) => prev.map((s) => s.agentId === waybillFromAgentId && s.productId === waybillProductId ? { ...s, quantity: s.quantity - qty } : s));
      setProducts((prev) => prev.map((p) => p.id === product.id ? { ...p, agentStock: Math.max(0, p.agentStock - qty) } : p));
    }

    setStockMovements((prev) => [{
      id: makeMovementId(),
      date: new Date().toISOString(),
      productId: product.id,
      productName: product.name,
      type: "Waybill Out",
      qty: -qty,
      balanceAfter: waybillFromType === "Warehouse" ? product.warehouseStock - qty : 0,
      agent: waybillFromType === "Warehouse" ? (toAgent?.name ?? receivingState) : (fromAgent?.name ?? sendingState),
      by: ownerName,
      note: `Waybill ${record.id}: ${sendingState} → ${receivingState} via ${waybillPartner.trim()}${waybillNote.trim() ? " — " + waybillNote.trim() : ""}`,
    }, ...prev]);

    setWaybillRecords((prev) => [record, ...prev]);
    setModal(null);
    showToast(`Waybill created — ${qty} × ${product.name} → ${receivingState}.`);
    waybillsApi.create({ id: record.id, productId: record.productId, productName: record.productName, quantity: record.quantity, waybillFee: record.waybillFee, fromLocation: record.sendingState, toLocation: record.receivingState, carrier: record.logisticsPartner, agentId: record.toAgentId, notes: record.note, dispatchedDate: record.dateSent }).catch(() => {});
  };

  const markWaybillReceived = (waybillId: string) => {
    const record = waybillRecords.find((w) => w.id === waybillId);
    if (!record || record.status !== "In Transit") return;
    const product = products.find((p) => p.id === record.productId);
    const today = new Date().toISOString().slice(0, 10);

    if (record.toAgentId) {
      setAgentStock((prev) => {
        const existing = prev.find((s) => s.agentId === record.toAgentId && s.productId === record.productId);
        if (existing) {
          return prev.map((s) => s === existing ? { ...s, quantity: s.quantity + record.quantity } : s);
        }
        return [...prev, { agentId: record.toAgentId!, productId: record.productId, quantity: record.quantity, defective: 0, missing: 0 }];
      });
      setProducts((prev) => prev.map((p) => p.id === record.productId ? { ...p, agentStock: p.agentStock + record.quantity } : p));
    } else {
      setProducts((prev) => prev.map((p) => p.id === record.productId ? { ...p, warehouseStock: p.warehouseStock + record.quantity } : p));
    }

    if (product) {
      const toAgent = record.toAgentId ? agents.find((a) => a.id === record.toAgentId) : null;
      setStockMovements((prev) => [{
        id: makeMovementId(),
        date: new Date().toISOString(),
        productId: product.id,
        productName: product.name,
        type: "Waybill In",
        qty: record.quantity,
        balanceAfter: record.toAgentId ? 0 : product.warehouseStock + record.quantity,
        agent: toAgent?.name ?? record.receivingState,
        by: ownerName,
        note: `Waybill ${record.id} received: ${record.sendingState} → ${record.receivingState}`,
      }, ...prev]);
    }

    setWaybillRecords((prev) => prev.map((w) => w.id === waybillId ? { ...w, status: "Received", dateReceived: today } : w));
    waybillsApi.updateStatus(waybillId, { status: "Received" }).catch(() => {});
    showToast(`Waybill marked received.`);
  };

  const cancelWaybill = (waybillId: string) => {
    const record = waybillRecords.find((w) => w.id === waybillId);
    if (!record || record.status !== "In Transit") return;
    const product = products.find((p) => p.id === record.productId);

    if (record.fromAgentId) {
      setAgentStock((prev) => prev.map((s) => s.agentId === record.fromAgentId && s.productId === record.productId ? { ...s, quantity: s.quantity + record.quantity } : s));
      setProducts((prev) => prev.map((p) => p.id === record.productId ? { ...p, agentStock: p.agentStock + record.quantity } : p));
    } else {
      setProducts((prev) => prev.map((p) => p.id === record.productId ? { ...p, warehouseStock: p.warehouseStock + record.quantity } : p));
    }

    if (product) {
      setStockMovements((prev) => [{
        id: makeMovementId(),
        date: new Date().toISOString(),
        productId: product.id,
        productName: product.name,
        type: "Waybill In",
        qty: record.quantity,
        balanceAfter: record.fromAgentId ? 0 : product.warehouseStock + record.quantity,
        agent: record.fromAgentId ? agents.find((a) => a.id === record.fromAgentId)?.name ?? record.sendingState : "Warehouse",
        by: ownerName,
        note: `Waybill ${record.id} cancelled — stock returned to ${record.fromAgentId ? record.sendingState : "warehouse"}`,
      }, ...prev]);
    }

    setWaybillRecords((prev) => prev.map((w) => w.id === waybillId ? { ...w, status: "Cancelled" } : w));
    showToast(`Waybill cancelled. Stock returned to sender.`);
  };

  const openEditWaybill = (record: WaybillRecord) => {
    setWaybillEditId(record.id);
    setWaybillFee(String(record.waybillFee));
    setWaybillPartner(record.logisticsPartner);
    setWaybillToAgentId(record.toAgentId ?? "");
    setWaybillToState(record.receivingState);
    setWaybillDateSent(record.dateSent);
    setWaybillNote(record.note ?? "");
    setWaybillErrors({});
    setModal("editWaybill");
  };

  const saveEditWaybill = () => {
    const errs: Record<string, string> = {};
    if (!waybillPartner.trim()) errs.partner = "Logistics partner is required.";
    const toAgent = waybillToAgentId ? agents.find((a) => a.id === waybillToAgentId) : null;
    const receivingState = toAgent?.zone ?? waybillToState.trim();
    if (!receivingState) errs.toState = "Receiving state is required.";
    if (!waybillDateSent) errs.dateSent = "Date sent is required.";
    if (Object.keys(errs).length > 0) { setWaybillErrors(errs); return; }
    setWaybillErrors({});
    setWaybillRecords((prev) => prev.map((w) => w.id === waybillEditId ? {
      ...w,
      waybillFee: Math.max(0, Number(waybillFee) || 0),
      logisticsPartner: waybillPartner.trim(),
      toAgentId: waybillToAgentId || undefined,
      receivingState,
      dateSent: waybillDateSent,
      note: waybillNote.trim() || undefined,
    } : w));
    setModal(null);
    showToast("Waybill updated.");
  };

  const openCartModal = (cart: AbandonedCartRecord, nextModal: ModalType) => {
    setSelectedCartId(cart.id);
    setReassignRepId(cart.assignedRepId ?? activeSalesRepUsers[0]?.id ?? "");
    setModal(nextModal);
  };

  const assignSelectedCart = () => {
    if (!selectedCart || !reassignRepId) {
      showToast("Choose a sales rep.");
      return;
    }

    setAbandonedCarts((value) => value.map((cart) => (cart.id === selectedCart.id ? { ...cart, assignedRepId: reassignRepId, status: "Assigned", lastActivity: new Date().toISOString() } : cart)));
    setModal(null);
    showToast(`${selectedCart.id} assigned to ${users.find((user) => user.id === reassignRepId)?.name ?? "sales rep"}.`);
  };

  const updateCartStatus = (cartId: string, status: Exclude<CartStatus, "All statuses">) => {
    setAbandonedCarts((value) => value.map((cart) => (cart.id === cartId ? { ...cart, status, lastActivity: new Date().toISOString() } : cart)));
    showToast(`${cartId} marked ${status}.`);
  };

  const convertSelectedCart = () => {
    if (!selectedCart) {
      return;
    }

    const order: TrackedOrder = {
      id: makeOrderId(),
      productId: selectedCart.productId,
      packageId: selectedCart.packageId,
      customer: selectedCart.customer,
      phone: selectedCart.phone,
      whatsapp: selectedCart.whatsapp,
      email: selectedCart.email,
      city: selectedCart.city,
      state: selectedCart.state,
      productName: selectedCart.productName,
      packageName: selectedCart.packageName,
      quantity: products.find((product) => product.id === selectedCart.productId)?.packages.find((item) => item.id === selectedCart.packageId)?.quantity ?? 1,
      amount: selectedCart.amount,
      currency: selectedCart.currency,
      utmSource: selectedCart.source.toLowerCase(),
      utmCampaign: "cart_recovery",
      source: selectedCart.source,
      status: "New",
      response: "Converted from abandoned cart",
      location: orderLocationFromFields(selectedCart.city ?? "", selectedCart.state ?? ""),
      assignedRepId: selectedCart.assignedRepId ?? repForNewRecord(),
      createdAt: todayKey(),
      date: displayDateFromKey(todayKey()),
      notes: [{ id: makeNoteId(), text: `Converted from ${selectedCart.id}.`, by: ownerName, date: new Date().toISOString() }]
    };
    setTrackedOrders((value) => [order, ...value]);
    setAbandonedCarts((value) => value.map((cart) => (cart.id === selectedCart.id ? { ...cart, status: "Converted", lastActivity: new Date().toISOString() } : cart)));
    setModal(null);
    showToast(`${selectedCart.id} converted to ${order.id}.`);
  };

  const openAddUserModal = () => {
    setSelectedUserId("");
    setUserFullName("");
    setUserEmail("");
    setUserPassword("");
    setNewUserRole("Sales Rep");
    setNewUserActive(true);
    setModal("addUser");
  };

  const openEditUserModal = (user: ManagedUser) => {
    setSelectedUserId(user.id);
    setUserFullName(user.name);
    setUserEmail(user.email);
    setUserPassword("");
    setNewUserRole(user.role);
    setNewUserActive(user.active);
    setModal("editUser");
  };

  const openResetPasswordModal = (user: ManagedUser) => {
    setSelectedUserId(user.id);
    setUserPassword("");
    setModal("resetUserPassword");
  };

  const openDeleteUserModal = (user: ManagedUser) => {
    setSelectedUserId(user.id);
    setModal("deleteUser");
  };

  const toggleUserPermission = (userId: string, permission: UserPermission) => {
    setUsers((prev) => prev.map((u) => {
      if (u.id !== userId || u.role === "Owner") return u;
      const perms = u.permissions ?? defaultPermsByRole[u.role] ?? [];
      return { ...u, permissions: perms.includes(permission) ? perms.filter((p) => p !== permission) : [...perms, permission] };
    }));
    showToast("Permissions updated.");
  };

  const openPayRateModal = (userId: string) => {
    const structure = payStructures.find((item) => item.userId === userId);
    setPayRateUserId(userId);
    setPayStructureType(structure?.type ?? "Commission");
    setFixedSalary(String(structure?.fixedSalary ?? 0));
    setCommissionRate(String(structure?.commissionRate ?? 0));
    setModal("setRate");
  };

  const savePayRate = () => {
    if (!selectedPayUser) {
      showToast("Choose a user for this pay structure.");
      return;
    }

    const needsFixed = payStructureType !== "Commission";
    const needsCommission = payStructureType !== "Fixed Salary";

    if (needsFixed && Number(fixedSalary) <= 0) {
      showToast("Enter a fixed salary amount.");
      return;
    }

    if (needsCommission && Number(commissionRate) <= 0) {
      showToast("Enter a rate per delivered order.");
      return;
    }

    const updatedAt = displayDateFromKey(todayKey());
    const nextStructure: PayStructure = {
      userId: selectedPayUser.id,
      type: payStructureType,
      fixedSalary: payStructureType === "Commission" ? 0 : Number(fixedSalary) || 0,
      commissionRate: payStructureType === "Fixed Salary" ? 0 : Number(commissionRate) || 0,
      updatedAt
    };
    setPayStructures((value) => {
      const exists = value.some((item) => item.userId === selectedPayUser.id);
      return exists ? value.map((item) => (item.userId === selectedPayUser.id ? nextStructure : item)) : [...value, nextStructure];
    });
    setPayRateUpdatedAt(updatedAt);
    setModal(null);
    showToast(`Pay structure saved for ${selectedPayUser.name}.`);
  };

  const previewPayroll = () => {
    setPayrollLabel(`${payrollMonth} Payroll`);
    const totalRows = payrollPreviewRows.length;
    if (totalRows === 0) {
      showToast("No pay rates set yet. Use Pay Rates tab to configure pay structures.");
    } else {
      showToast(`${totalRows} team member${totalRows === 1 ? "" : "s"} included in ${payrollMonth} preview.`);
    }
  };

  const savePayrollDraft = () => {
    if (payrollPreviewRows.length === 0) {
      showToast("Set at least one pay rate before saving payroll.");
      return;
    }

    const run: PayrollRun = {
      id: makePayrollRunId(),
      month: payrollMonth,
      label: payrollLabel || `${payrollMonth} Payroll`,
      notes: payrollNotes,
      total: payrollGrandTotal,
      createdAt: new Date().toISOString(),
      rows: payrollPreviewRows
    };
    setPayrollRuns((value) => [run, ...value]);
    setPayrollTab("History");
    showToast(`${run.label} saved as a draft.`);
  };

  const createExpense = () => {
    if (!expenseAmount.trim()) {
      showToast("Expense amount is required.");
      return;
    }

    const product = products.find((item) => item.id === expenseProduct);
    const amount = Math.max(0, Number(expenseAmount) || 0);
    const record: ExpenseRecord = {
      id: makeExpenseId(),
      type: expenseType,
      amount,
      currency: expenseCurrency,
      date: parseExpenseDateKey(expenseDate),
      productId: product?.id,
      productName: product?.name ?? expenseProduct,
      description: expenseDescription.trim() || `${expenseType} expense`
    };
    setExpenses((value) => [record, ...value]);
    setExpenseAmount("0");
    setExpenseDescription("");
    setExpenseDate(todayKey());
    setExpenseProduct("General Expense");
    setExpenseCurrency("NGN");
    setModal(null);
    showToast(`${expenseType} expense for ${new Intl.NumberFormat(currencies[expenseCurrency]?.locale ?? "en-NG", { style: "currency", currency: expenseCurrency, maximumFractionDigits: 0 }).format(amount)} created.`);
    expensesApi.create({ id: record.id, date: record.date, category: record.type, description: record.description, amount: record.amount, currency: record.currency }).catch(() => {});
  };

  const createUser = () => {
    if (!userFullName.trim() || !userEmail.trim()) {
      showToast("User name and email are required.");
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userEmail.trim())) {
      showToast("Please enter a valid email address.");
      return;
    }

    if (userPassword.trim().length < 6) {
      showToast("Password must be at least 6 characters.");
      return;
    }

    if (users.some((user) => user.email.toLowerCase() === userEmail.trim().toLowerCase())) {
      showToast("A user with this email already exists.");
      return;
    }

    const id = `${Date.now()}-${slugify(userEmail.trim())}`;
    setUsers((value) => [
      ...value,
      {
        id,
        name: userFullName.trim(),
        email: userEmail.trim(),
        role: newUserRole,
        active: newUserActive,
        created: displayDateFromKey(todayKey())
      }
    ]);
    setUserPassword("");
    setShowPasswordFields({});
    setModal(null);
    showToast(`User "${userFullName.trim()}" created.`);
    if (userPassword.trim()) {
      authApi.invite({ name: userFullName.trim(), email: userEmail.trim(), password: userPassword.trim(), role: newUserRole }).catch(() => showToast("User saved locally — invite sync failed."));
    }
  };

  const updateUser = () => {
    if (!selectedUser || !userFullName.trim() || !userEmail.trim()) {
      showToast("User name and email are required.");
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userEmail.trim())) {
      showToast("Please enter a valid email address.");
      return;
    }

    if (userPassword.trim() && userPassword.trim().length < 6) {
      showToast("New password must be at least 6 characters.");
      return;
    }

    if (users.some((user) => user.id !== selectedUser.id && user.email.toLowerCase() === userEmail.trim().toLowerCase())) {
      showToast("Another user already uses this email.");
      return;
    }
    if (selectedUser.role === "Owner" && newUserRole !== "Owner") {
      showToast("The Owner role cannot be changed.");
      return;
    }

    const _uuId = selectedUser.id;
    setUsers((value) =>
      value.map((user) =>
        user.id === selectedUser.id
          ? { ...user, name: userFullName.trim(), email: userEmail.trim(), role: newUserRole, active: newUserActive }
          : user
      )
    );
    setUserPassword("");
    setShowPasswordFields({});
    setModal(null);
    showToast(`User "${userFullName.trim()}" updated.`);
    teamApi.update(_uuId, { name: userFullName.trim(), role: newUserRole, active: newUserActive }).catch(() => {});
  };

  const resetUserPassword = () => {
    if (!selectedUser) {
      showToast("Choose a user first.");
      return;
    }

    if (userPassword.trim().length < 6) {
      showToast("Temporary password must be at least 6 characters.");
      return;
    }

    setUserPassword("");
    setShowPasswordFields({});
    setModal(null);
    showToast(`Password reset for ${selectedUser.name}.`);
  };

  const deleteSelectedUser = () => {
    if (!selectedUser) {
      showToast("Choose a user first.");
      return;
    }
    if (selectedUser.role === "Owner") {
      showToast("The Owner account cannot be deleted.");
      return;
    }

    const activeStatuses: TrackedOrder["status"][] = ["New", "Confirmed", "In Process", "Dispatched"];
    const activeOrders = trackedOrders.filter((o) => o.assignedRepId === selectedUser.id && activeStatuses.includes(o.status));
    if (activeOrders.length > 0) {
      showToast(`Reassign ${activeOrders.length} active order${activeOrders.length !== 1 ? "s" : ""} before deleting this user.`);
      return;
    }

    // Unassign historical orders so they don't show a ghost rep name
    setTrackedOrders((prev) =>
      prev.map((o) => (o.assignedRepId === selectedUser.id ? { ...o, assignedRepId: undefined } : o))
    );
    setUsers((value) => value.filter((user) => user.id !== selectedUser.id));
    setModal(null);
    showToast(`"${selectedUser.name}" deleted.`);
  };

  const repTabRoute = (tab: RepConsoleTab) =>
    tab === "Dashboard" ? "#/dashboard/sales-rep" : `#/dashboard/sales-rep/${slugify(tab)}`;

  const openRepTab = (tab: RepConsoleTab) => {
    setRepConsoleTab(tab);
    setRepOrderDetailId("");
    const nextRoute = repTabRoute(tab);
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${nextRoute}`);
    setHashRoute(nextRoute);
  };

  const agentsForOrder = (order: TrackedOrder) => {
    const location = `${order.location ?? ""} ${order.city ?? ""} ${order.state ?? ""}`.toLowerCase();
    const matchingAgents = activeAgents.filter((agent) => location.includes(agent.zone.toLowerCase()) || agent.zone.toLowerCase().includes(order.city?.toLowerCase() ?? ""));
    return matchingAgents.length > 0 ? matchingAgents : activeAgents;
  };

  const statusCompletedAt = (order: TrackedOrder, status: Exclude<OrderStatus, "All Orders">) => {
    if (status === "Delivered" && order.deliveredDate) {
      return displayDateFromKey(order.deliveredDate);
    }
    const note = (order.notes ?? []).find((item) => item.text.includes(`to ${status}`));
    if (note) {
      return new Date(note.date).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    }
    if ((order.status ?? "New") === status) {
      return "Current";
    }
    return "Pending";
  };

  const renderRepOrderTable = (orders: TrackedOrder[], emptyLabel = "No orders found") => (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200 text-left">
            <th className="px-4 py-3 font-semibold text-gray-500 uppercase text-[10px] tracking-wider">Order #</th>
            <th className="px-4 py-3 font-semibold text-gray-500 uppercase text-[10px] tracking-wider">Customer Name</th>
            <th className="px-4 py-3 font-semibold text-gray-500 uppercase text-[10px] tracking-wider text-center">Source</th>
            <th className="px-4 py-3 font-semibold text-gray-500 uppercase text-[10px] tracking-wider text-center">Status</th>
            <th className="px-4 py-3 font-semibold text-gray-500 uppercase text-[10px] tracking-wider text-center">Response</th>
            <th className="px-4 py-3 font-semibold text-gray-500 uppercase text-[10px] tracking-wider">Location</th>
            <th className="px-4 py-3 font-semibold text-gray-500 uppercase text-[10px] tracking-wider">Created</th>
            <th className="px-4 py-3 font-semibold text-gray-500 uppercase text-[10px] tracking-wider text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {orders.length === 0 ? (
            <tr><td colSpan={8} className="px-4 py-12 text-center text-gray-400 font-medium italic">{emptyLabel}</td></tr>
          ) : (
            orders.map((order) => {
              const status = order.status ?? "New";
              return (
                <tr key={order.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-4 font-bold text-[#1A6FBF]">{order.id}</td>
                  <td className="px-4 py-4">
                    <div className="font-bold text-gray-900">{order.customer}</div>
                    <div className="text-xs text-gray-500">{order.phone}</div>
                  </td>
                  <td className="px-4 py-4 text-center text-gray-500 text-xs font-medium">
                    {order.source ?? orderSourceFromUtm(order.utmSource)}
                  </td>
                  <td className="px-4 py-4 text-center">
                    <span className={`status-pill status-${slugify(status)}`}>{status}</span>
                    <div className="text-[10px] text-gray-400 font-medium mt-1 uppercase tracking-tight">{order.response ?? "Awaiting confirmation"}</div>
                  </td>
                  <td className="px-4 py-4 text-center text-gray-600 font-medium">{responseTimeForOrder(order)}</td>
                  <td className="px-4 py-4 text-gray-600 text-xs">
                    {order.location ?? orderLocationFromFields(order.city ?? "", order.state ?? "")}
                  </td>
                  <td className="px-4 py-4 text-gray-500 text-xs">{order.date}</td>
                  <td className="px-4 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        className="p-1.5 text-gray-400 hover:text-[#25D366] rounded-md hover:bg-green-50 transition-colors"
                        title="Open WhatsApp"
                        aria-label={`WhatsApp ${order.id}`}
                        onClick={() => { const phone = (order.whatsapp || order.phone).replace(/\D/g, ""); window.open(`https://wa.me/${phone}`, "_blank", "noopener,noreferrer"); }}
                      >
                        <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current" aria-hidden="true"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z"/></svg>
                      </button>
                      <button 
                        className="px-3 py-1.5 text-xs font-bold border border-gray-200 bg-white text-gray-700 rounded-md hover:bg-gray-50 transition-colors flex items-center gap-1.5" 
                        onClick={() => openRepOrderDetail(order)}
                      >
                        <Eye className="w-3.5 h-3.5" /> Details
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );

  const renderRepOrderDetail = (order: TrackedOrder) => (
    <div className="space-y-6 pb-12">
      {/* Header & Breadcrumbs */}
      <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <nav className="flex items-center gap-2 text-sm font-medium text-gray-500 mb-2">
            <button className="hover:text-[#1A6FBF] transition-colors" onClick={closeRepOrderDetail}>Orders</button>
            <ArrowRight className="w-4 h-4" />
            <span className="text-gray-900">{order.id}</span>
          </nav>
          <h1 className="text-2xl font-bold text-[#1A6FBF]">{order.customer}</h1>
          <p className="text-sm font-medium text-gray-500 mt-1">
            {order.phone} · {order.location ?? orderLocationFromFields(order.city ?? "", order.state ?? "")} · {repScopeDescription}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium border border-gray-200 bg-white text-gray-700 rounded-md hover:bg-gray-50 transition-colors" onClick={() => openRepStatusChangeModal(order)}>
            <Repeat2 className="w-4 h-4" /> Change Status
          </button>
          <button className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium border border-gray-200 bg-white text-gray-700 rounded-md hover:bg-gray-50 transition-colors" onClick={() => printInvoiceForOrder(order)}>
            <BookOpen className="w-4 h-4" /> Print Invoice
          </button>
          <button className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium border border-gray-200 bg-white text-gray-700 rounded-md hover:bg-gray-50 transition-colors" onClick={() => downloadInvoiceForOrder(order)}>
            <Download className="w-4 h-4" /> Download Invoice
          </button>
          <button className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium bg-[#1A6FBF] text-white rounded-md hover:bg-blue-700 transition-colors shadow-sm" onClick={() => openRepEditOrderCustomer(order)}>
            <Pencil className="w-4 h-4" /> Edit Order
          </button>
        </div>
      </header>

      {/* Main Grid: Customer Info & Order Items */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Customer Info Card */}
        <article className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="text-base font-bold text-gray-900">Customer Info</h2>
          </div>
          <div className="p-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-4 gap-x-8">
              <div>
                <span className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Name</span>
                <strong className="text-sm text-gray-900">{order.customer}</strong>
              </div>
              <div>
                <span className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Phone</span>
                <strong className="text-sm text-gray-900">{order.phone}</strong>
              </div>
              <div className="sm:col-span-2">
                <span className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Shipping Address</span>
                <strong className="text-sm text-gray-900">{order.address || "No address"}</strong>
              </div>
              <div>
                <span className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">City</span>
                <strong className="text-sm text-gray-900">{order.city || "-"}</strong>
              </div>
              <div>
                <span className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">State</span>
                <strong className="text-sm text-gray-900">{order.state || "-"}</strong>
              </div>
            </div>
          </div>
        </article>

        {/* Order Items Card */}
        <article className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="text-base font-bold text-gray-900">Order Items</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-left">
                  <th className="px-4 py-3 font-semibold text-gray-500 uppercase text-[10px] tracking-wider">Product</th>
                  <th className="px-4 py-3 font-semibold text-gray-500 uppercase text-[10px] tracking-wider text-center">Qty</th>
                  <th className="px-4 py-3 font-semibold text-gray-500 uppercase text-[10px] tracking-wider">Price per unit</th>
                  <th className="px-4 py-3 font-semibold text-gray-500 uppercase text-[10px] tracking-wider text-right">Total Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                <tr className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-4">
                    <div className="font-medium text-gray-900">{order.productName}</div>
                    <div className="text-xs text-gray-400">{order.packageName}</div>
                  </td>
                  <td className="px-4 py-4 text-center text-gray-700">{quantityForOrder(order)}</td>
                  <td className="px-4 py-4 text-gray-700">{formatProductMoney(Math.round(order.amount / Math.max(1, quantityForOrder(order))), order.currency)}</td>
                  <td className="px-4 py-4 text-right font-semibold text-gray-900">{formatProductMoney(order.amount, order.currency)}</td>
                </tr>
                {(order.crossSellLines ?? []).map((line) => (
                  <tr key={line.id} className="bg-amber-50/40">
                    <td className="px-4 py-3 text-xs"><span className="font-medium text-amber-800">↳ Cross-sell</span><div className="text-gray-700">{line.productName}</div></td>
                    <td className="px-4 py-3 text-center text-xs text-gray-700">{line.quantity}</td>
                    <td className="px-4 py-3 text-xs text-gray-700">{formatProductMoney(Math.round(line.amount / Math.max(1, line.quantity)), order.currency)}</td>
                    <td className="px-4 py-3 text-right text-xs">
                      <span className="font-semibold text-gray-900">{formatProductMoney(line.amount, order.currency)}</span>
                      <button className="!min-h-0 ml-2 text-red-500 hover:text-red-700" onClick={() => removeCrossSell(order.id, line.id)}>×</button>
                    </td>
                  </tr>
                ))}
                {(order.freeGiftLines ?? []).map((line) => (
                  <tr key={line.id} className="bg-emerald-50/40">
                    <td className="px-4 py-3 text-xs"><span className="font-medium text-emerald-800">🎁 Free Gift</span><div className="text-gray-700">{line.productName}</div></td>
                    <td className="px-4 py-3 text-center text-xs text-gray-700">{line.quantity}</td>
                    <td className="px-4 py-3 text-xs text-gray-500 italic">FREE</td>
                    <td className="px-4 py-3 text-right text-xs">
                      <span className="text-gray-500">—</span>
                      <button className="!min-h-0 ml-2 text-red-500 hover:text-red-700" onClick={() => removeFreeGift(order.id, line.id)}>×</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-5 py-3 border-t border-gray-100 flex flex-wrap items-center gap-2">
            <button className="!min-h-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-amber-300 text-amber-700 text-xs font-semibold hover:bg-amber-50" onClick={() => openCrossSellModal(order)}>+ Cross-sell / Upsell Item</button>
            <button className="!min-h-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-emerald-300 text-emerald-700 text-xs font-semibold hover:bg-emerald-50" onClick={() => openFreeGiftModal(order)}>+ Free Gift</button>
          </div>
        </article>
      </div>

      {/* Bonus & Upsell Tracking */}
      <section className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-bold text-gray-900">Bonus &amp; Upsell Tracking</h2>
          <p className="text-xs text-gray-500 mt-0.5">Record when you upgraded the customer's pack. The bonus is computed automatically using the product's bonus rules.</p>
        </div>
        <div className="p-5 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Upsell from (qty)</span>
            <input className="border border-gray-200 rounded-lg px-3 py-2 text-sm" inputMode="numeric" placeholder="e.g. 3" value={order.upsellFromQty ?? ""} onChange={(e) => {
              const v = e.target.value === "" ? undefined : Number(e.target.value);
              setTrackedOrders((prev) => prev.map((o) => o.id === order.id ? { ...o, upsellFromQty: v } : o));
            }} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Upsell to (qty)</span>
            <input className="border border-gray-200 rounded-lg px-3 py-2 text-sm" inputMode="numeric" placeholder="e.g. 5" value={order.upsellToQty ?? ""} onChange={(e) => {
              const v = e.target.value === "" ? undefined : Number(e.target.value);
              setTrackedOrders((prev) => prev.map((o) => o.id === order.id ? { ...o, upsellToQty: v } : o));
            }} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Note</span>
            <input className="border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder="e.g. Yes/Upgraded" value={order.upsellNote ?? ""} onChange={(e) => {
              const v = e.target.value;
              setTrackedOrders((prev) => prev.map((o) => o.id === order.id ? { ...o, upsellNote: v } : o));
            }} />
          </label>
        </div>
        {(() => {
          const isDelivered = order.status === "Delivered";
          const earned = isDelivered ? computeOrderBonus(order, 100, 0, 0) : null;
          const projected = projectedOrderBonus(order);
          return (
            <div className={`mx-5 mb-5 p-3 border rounded-lg flex flex-col gap-1.5 ${isDelivered ? "bg-emerald-50 border-emerald-200" : "bg-gray-50 border-gray-200"}`}>
              <div className="flex items-center justify-between">
                <div className="flex flex-col">
                  <strong className="text-sm text-gray-900">{isDelivered ? "Earned Bonus" : "Projected Bonus"}</strong>
                  {!isDelivered && <span className="text-xs text-gray-400">Estimated if order is delivered</span>}
                </div>
                <span className={`text-lg font-extrabold ${isDelivered ? "text-emerald-700" : "text-gray-500"}`}>
                  {formatProductMoney(isDelivered ? (earned?.total ?? 0) : projected.total, order.currency)}
                </span>
              </div>
              {(isDelivered ? earned?.components ?? [] : projected.components).length > 0 && (
                <ul className="text-xs text-gray-600 list-disc pl-5">
                  {(isDelivered ? earned?.components ?? [] : projected.components).map((c, i) => (
                    <li key={i}>{c.label}: <span className="font-semibold">{formatProductMoney(c.amount, order.currency)}</span></li>
                  ))}
                </ul>
              )}
              {(isDelivered ? earned?.components ?? [] : projected.components).length === 0 && (
                <p className="text-xs text-gray-400">No bonus rules matched — check product bonus settings.</p>
              )}
              {order.bonusManuallyAdjusted && (
                <p className="text-xs text-amber-700">Manual override active: {formatProductMoney(order.manualBonusOverride ?? 0, order.currency)}{order.manualBonusReason ? ` — ${order.manualBonusReason}` : ""}</p>
              )}
              <div className="flex items-center gap-2 pt-1">
                <button className="!min-h-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-blue-300 text-blue-700 text-xs font-semibold hover:bg-blue-50" onClick={() => openManualBonusModal(order)}>{order.bonusManuallyAdjusted ? "Edit Manual Bonus" : "Manual Adjust"}</button>
              </div>
            </div>
          );
        })()}
      </section>

      {/* Status Workflow Panel */}
      <section className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-base font-bold text-gray-900">Status Workflow</h2>
          <span className={`status-pill status-${slugify(order.status ?? "New")}`}>{order.status ?? "New"}</span>
        </div>
        <div className="p-6">
          <div className="flex items-center justify-between relative">
            {/* Background Line */}
            <div className="absolute top-5 left-8 right-8 h-0.5 bg-gray-100 -z-0"></div>
            
            {(["Confirmed", "In Process", "Dispatched", "Delivered"] as Exclude<OrderStatus, "All Orders">[]).map((status) => {
              const isActive = (order.status ?? "New") === status;
              const statusOrder = ["Confirmed", "In Process", "Dispatched", "Delivered"];
              const currentIdx = statusOrder.indexOf(order.status ?? "");
              const thisIdx = statusOrder.indexOf(status);
              const isCompleted = currentIdx > thisIdx;
              return (
                <article key={status} className={`flex flex-col items-center gap-2 relative z-10 w-1/4 ${isActive ? "text-[#1A6FBF]" : "text-gray-400"}`}>
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300 ${isActive ? "bg-blue-50 text-[#1A6FBF] ring-4 ring-blue-50" : isCompleted ? "bg-green-50 text-green-500" : "bg-white border-2 border-gray-100 text-gray-300"}`}>
                    {isCompleted ? <BadgeCheck className="w-6 h-6" /> : <CheckCircle2 className="w-5 h-5" />}
                  </div>
                  <div className="text-center">
                    <strong className={`block text-xs uppercase tracking-wider font-bold ${isActive ? "text-gray-900" : "text-gray-400"}`}>{status}</strong>
                    <span className="text-[10px] font-medium text-gray-400 mt-0.5">{statusCompletedAt(order, status)}</span>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      {/* Fulfillment & Timeline Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Fulfillment Assignment Card */}
        <article className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="text-base font-bold text-gray-900 m-0">Fulfillment Assignment</h2>
            <p className="text-xs text-gray-400 mt-0.5 font-medium">Agents suggested from customer zone first.</p>
          </div>
          <div className="p-5 space-y-5">
            <div className="space-y-2">
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Assign Agent</label>
              <div className="flex gap-2">
                <select 
                  className="flex-1 h-10 px-3 border border-gray-200 rounded-md bg-white text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#1A6FBF]"
                  value={createOrderAgentId} 
                  onChange={(event) => setCreateOrderAgentId(event.target.value)} 
                  aria-label="Assign delivery agent"
                >
                  <option value="">Unassigned</option>
                  {agentsForOrder(order).map((agent) => <option key={agent.id} value={agent.id}>{agent.name} · {agent.zone}</option>)}
                </select>
                <button className="px-4 py-2 bg-[#1A6FBF] text-white rounded-md text-sm font-medium hover:bg-blue-700 transition-colors shadow-sm shrink-0" onClick={saveOrderAgent}>Assign Agent</button>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Schedule Date</label>
              <div className="flex gap-2">
                <input 
                  type="date" 
                  className="flex-1 h-10 px-3 border border-gray-200 rounded-md bg-white text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#1A6FBF]"
                  value={repScheduleDate} 
                  onChange={(event) => setRepScheduleDate(event.target.value)} 
                  aria-label="Schedule delivery date" 
                />
                <button className="px-4 py-2 border border-gray-200 bg-white text-gray-700 rounded-md text-sm font-medium hover:bg-gray-50 transition-colors shrink-0 inline-flex items-center gap-2" onClick={saveRepScheduleDate}>
                  <CalendarClock className="w-4 h-4" /> Schedule
                </button>
              </div>
            </div>
          </div>
        </article>

        {/* Communication Timeline Card */}
        <article className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden flex flex-col">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-base font-bold text-gray-900">Timeline & Notes</h2>
            <button className="text-[10px] font-bold text-[#1A6FBF] uppercase tracking-wider hover:underline" onClick={() => setShowRepFollowUpField((value) => !value)}>
              + Schedule Follow-up
            </button>
          </div>
          <div className="p-5 flex-1 flex flex-col space-y-4">
            <div className="flex-1 overflow-y-auto max-h-[300px] space-y-4 pr-2 custom-scrollbar">
              {(order.notes ?? []).length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-8">No timeline entries yet.</p>
              ) : (
                (order.notes ?? []).map((note) => (
                  <div key={note.id} className="relative pl-4 border-l-2 border-gray-100">
                    <div className="absolute -left-[5px] top-1 w-2 h-2 rounded-full bg-gray-200"></div>
                    <div className="flex items-center justify-between mb-1">
                      <strong className="text-xs font-bold text-gray-900">{note.by}</strong>
                      <span className="text-[10px] text-gray-400 font-medium">
                        {new Date(note.date).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                      </span>
                    </div>
                    <p className="text-sm text-gray-600 leading-relaxed">{note.text}</p>
                    {note.followUpDate && (
                      <div className="mt-1 inline-flex items-center gap-1.5 px-2 py-0.5 bg-blue-50 text-[#1A6FBF] rounded text-[10px] font-bold uppercase tracking-wide">
                        <Clock className="w-3 h-3" /> Follow-up {displayDateFromKey(note.followUpDate)}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
            
            <div className="space-y-3 pt-4 border-t border-gray-100 mt-auto">
              {showRepFollowUpField && (
                <div className="space-y-1">
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Follow-up Date</span>
                  <input type="date" className="w-full h-9 px-3 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#1A6FBF]" value={orderFollowUpDate} onChange={(event) => setOrderFollowUpDate(event.target.value)} />
                </div>
              )}
              <textarea 
                className="w-full p-3 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#1A6FBF] resize-none h-20" 
                value={orderNoteDraft} 
                onChange={(event) => setOrderNoteDraft(event.target.value)} 
                placeholder="Call summary, objection, delivery instruction..." 
              />
              <button className="w-full py-2 bg-[#1A6FBF] text-white rounded-md text-sm font-semibold hover:bg-blue-700 transition-colors shadow-sm" onClick={addOrderNote}>Post Note</button>
            </div>
          </div>
        </article>
      </div>

      {/* Delivery Fee & Remittance — POD cash reconciliation, editable by reps */}
      <section className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden border-l-4 border-l-emerald-500">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-gray-900">Delivery Fee & Remittance</h2>
            <p className="text-xs text-gray-400 font-medium">Add the courier's delivery fee — Amount to Remit auto-fills. Optionally log extra expenses (storekeeper, waybill, etc.).</p>
          </div>
          <span className={`status-pill status-${slugify(order.remittanceStatus ?? (order.amountRemitted == null ? "Pending" : (order.amountRemitted >= order.amount - (order.logisticsCost ?? 0) ? "Paid" : "Partial")))}`}>{order.remittanceStatus ?? (order.amountRemitted == null ? "Pending" : (order.amountRemitted >= order.amount - (order.logisticsCost ?? 0) ? "Paid" : "Partial"))}</span>
        </div>
        <div className="p-5 space-y-5">
          {/* Top row — order amount (read), delivery fee (input), amount to remit (auto + editable) */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Order Amount</label>
              <div className="h-10 px-3 flex items-center bg-gray-50 border border-gray-200 rounded-md">
                <strong className="text-sm text-gray-900">{formatProductMoney(order.amount, order.currency)}</strong>
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Delivery Fee ({productCurrencies[order.currency].symbol})</label>
              <input
                type="text"
                inputMode="decimal"
                value={repDeliveryFee}
                onChange={(e) => updateRepDeliveryFee(e.target.value, order.amount)}
                placeholder="e.g. 4000"
                className="w-full h-10 px-3 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#1A6FBF]"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center justify-between">
                Amount to Remit ({productCurrencies[order.currency].symbol})
                <button type="button" className="!min-h-0 text-[10px] font-semibold text-[#1A6FBF] hover:underline" onClick={() => setRepAmountToRemit(String(repAutoAmountToRemit(order.amount)))}>Reset to auto</button>
              </label>
              <input
                type="text"
                inputMode="decimal"
                value={repAmountToRemit}
                onChange={(e) => setRepAmountToRemit(e.target.value)}
                placeholder="auto-calculated"
                className="w-full h-10 px-3 border border-emerald-300 bg-emerald-50/40 rounded-md text-sm font-semibold text-emerald-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <p className="text-[10px] text-gray-400">Auto = Order − Delivery − Extras. Override if partner remits a different amount.</p>
            </div>
          </div>

          {/* Extra expenses (optional) */}
          <div className="border-t border-gray-100 pt-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-sm font-bold text-gray-800">Extra Expenses <span className="text-gray-400 font-normal">(optional)</span></h3>
                <p className="text-xs text-gray-400">e.g. storekeeper fee, waybill, additional delivery surcharge — auto-saved to Expenses on save.</p>
              </div>
              <button type="button" onClick={addRepExtraExpense} className="!min-h-0 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold border border-gray-200 bg-gray-50 text-gray-700 rounded-md hover:bg-gray-100 transition-colors">
                <Plus className="w-3 h-3" /> Add expense
              </button>
            </div>
            {repExtraExpenses.length === 0 ? (
              <p className="text-xs text-gray-400 italic px-1 py-2">No extra expenses logged.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {repExtraExpenses.map((extra, i) => (
                  <div key={i} className="grid grid-cols-12 gap-2 items-center bg-gray-50 rounded-lg p-2">
                    <select value={extra.type} onChange={(e) => updateRepExtraExpense(i, "type", e.target.value, order.amount)} className="col-span-3 h-9 px-2 border border-gray-200 rounded-md text-xs bg-white focus:outline-none focus:ring-2 focus:ring-[#1A6FBF]">
                      {expenseTypes.map((t) => <option key={t}>{t}</option>)}
                    </select>
                    <input value={extra.amount} onChange={(e) => updateRepExtraExpense(i, "amount", e.target.value, order.amount)} inputMode="decimal" placeholder="Amount" className="col-span-3 h-9 px-2 border border-gray-200 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-[#1A6FBF]" />
                    <input value={extra.description} onChange={(e) => updateRepExtraExpense(i, "description", e.target.value, order.amount)} placeholder="Note (optional, e.g. 'storekeeper at Abuja hub')" className="col-span-5 h-9 px-2 border border-gray-200 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-[#1A6FBF]" />
                    <button type="button" onClick={() => removeRepExtraExpense(i, order.amount)} className="!min-h-0 col-span-1 h-9 flex items-center justify-center text-red-500 hover:text-red-700 hover:bg-red-50 rounded-md transition-colors" aria-label="Remove expense">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
                <div className="text-xs text-gray-500 px-1 mt-1">
                  Extras subtotal: <strong className="text-gray-900">{formatProductMoney(repExtrasTotal, order.currency)}</strong>
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center justify-end pt-2 border-t border-gray-100">
            <button onClick={() => saveRepDeliveryDetails(order)} className="inline-flex items-center gap-2 px-5 py-2.5 bg-emerald-600 text-white rounded-md text-sm font-bold hover:bg-emerald-700 transition-colors shadow-sm">
              <HandCoins className="w-4 h-4" /> Save Delivery & Remittance
            </button>
          </div>
        </div>
      </section>

      {/* Action Required Panel */}
      <section className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden border-l-4 border-l-[#1A6FBF]">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-gray-900">Action Required</h2>
            <p className="text-xs text-gray-400 font-medium">Owner and rep workflow controls</p>
          </div>
        </div>
        <div className="p-5 flex flex-wrap items-center gap-3">
          <button className="flex-1 min-w-[140px] px-4 py-3 border border-gray-200 bg-white text-gray-700 rounded-lg text-sm font-bold hover:bg-gray-50 transition-colors shadow-sm" onClick={() => { openRepStatusChangeModal(order); setStatusChangeDraft("Postponed"); }}>
            Postpone Order
          </button>
          <button className="flex-1 min-w-[140px] px-4 py-3 bg-red-50 text-red-600 rounded-lg text-sm font-bold hover:bg-red-100 transition-colors shadow-sm border border-red-100" onClick={() => { openRepStatusChangeModal(order); setStatusChangeDraft("Cancelled"); }}>
            Cancel Order
          </button>
          <button className="flex-2 min-w-[200px] px-4 py-3 bg-[#1A6FBF] text-white rounded-lg text-sm font-bold hover:bg-blue-700 transition-colors shadow-md" onClick={() => { openRepStatusChangeModal(order); setStatusChangeDraft("Confirmed"); }}>
            Confirm Order Now
          </button>
        </div>
      </section>
    </div>
  );

  const renderRepConsole = () => {
    if (repOrderDetail) {
      return renderRepOrderDetail(repOrderDetail);
    }

    return (
      <div className="space-y-6">
        <header className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-1">
            <nav className="flex items-center gap-2 text-sm font-medium text-gray-500 mb-1">
              <span>Dashboard</span>
              <ArrowRight className="w-4 h-4" />
              <strong className="text-gray-900">Sales Rep Workspace</strong>
            </nav>
            <h1 className="text-2xl font-bold text-[#1A6FBF]">Call Rep Console</h1>
            <p className="text-sm font-medium text-gray-500 max-w-2xl">
              Owner/admin has full access to the exact sales-rep workflow: calls, status reasons, schedules, carts, customers, and invoices.
            </p>
          </div>
          
          <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex flex-col gap-2 min-w-[280px]">
            <div className="flex items-center justify-between gap-4">
              <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">View as</span>
              <select 
                className="h-8 px-2 border border-gray-200 rounded text-xs font-medium bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[#1A6FBF]"
                value={repConsoleRepId} 
                onChange={(event) => setRepConsoleRepId(event.target.value)}
              >
                <option value="all">All reps (Owner full access)</option>
                {salesRepUsers.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
              </select>
            </div>
            <div className="flex flex-col">
              <strong className="text-sm text-gray-900">{repScopeName}</strong>
              <span className="text-[10px] text-gray-400 font-medium">{repScopeDescription}</span>
            </div>
          </div>
        </header>

        <nav className="flex items-center gap-1 bg-gray-100 p-1 rounded-lg w-fit overflow-x-auto no-scrollbar" aria-label="Sales rep workspace sections">
          {repConsoleTabs.map((tab) => (
            <button
              key={tab}
              className={`relative px-4 py-1.5 rounded-md text-sm font-bold transition-all duration-200 whitespace-nowrap ${repConsoleTab === tab ? "bg-white text-[#1A6FBF] shadow-sm" : "text-gray-500 hover:text-gray-700 hover:bg-gray-200"}`}
              onClick={() => openRepTab(tab)}
            >
              {tab}
              {tab === "Notifications" && repNotifications.length > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-0.5 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center leading-none">
                  {repNotifications.length}
                </span>
              )}
            </button>
          ))}
        </nav>

        {repConsoleTab === "Dashboard" ? (
          <div className="space-y-6">
            <section className="grid grid-cols-2 lg:grid-cols-4 gap-4" aria-label="Call rep summary">
              {[
                { title: "Revenue", value: formatMoney(repRevenue), helper: "Delivered orders only", icon: CircleDollarSign, tone: "blue" },
                { title: "Total Orders", value: String(repOrders.length), helper: "All assigned statuses", icon: ShoppingCart, tone: "orange" },
                { title: "Pending (New)", value: String(repPendingCount), helper: "Not yet acted on", icon: Clock, tone: "cyan" },
                { title: "Confirmed", value: String(repConfirmedCount), helper: `${repConfirmedRate}% of total`, icon: BadgeCheck, tone: "green" },
                { title: "Delivered Month", value: String(repDeliveredThisMonth), helper: "Target tracking", icon: PackageCheck, tone: "green" },
                { title: "Conversion %", value: `${repConversionRate}%`, helper: "Delivered / total", icon: TrendingUp, tone: "blue" },
                { title: "Avg Response", value: repAvgResponse, helper: "Created to first action", icon: Zap, tone: "cyan" },
                { title: "Est. Earnings", value: formatMoney(repPayForUser(selectedRepUser)), helper: "Payroll rate based", icon: Banknote, tone: "green" }
              ].map((card) => {
                const Icon = card.icon;
                return (
                  <article className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm hover:shadow-md transition-shadow" key={card.title}>
                    <div className="flex items-center justify-between mb-2">
                      <span className={`w-10 h-10 rounded-full flex items-center justify-center ${card.tone === "blue" ? "bg-blue-50 text-blue-500" : card.tone === "orange" ? "bg-orange-50 text-orange-500" : card.tone === "cyan" ? "bg-cyan-50 text-cyan-500" : "bg-green-50 text-green-500"}`}>
                        <Icon className="w-5 h-5" />
                      </span>
                    </div>
                    <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{card.title}</h2>
                    <strong className="text-2xl font-bold text-gray-900 block my-1">{card.value}</strong>
                    <p className="text-[10px] text-gray-400 font-medium">{card.helper}</p>
                  </article>
                );
              })}
            </section>

            <section className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 px-5 py-4 border-b border-gray-200">
                <h2 className="text-base font-bold text-gray-900">Assigned Orders</h2>
                <div className="flex items-center gap-1 bg-gray-50 p-1 rounded-lg">
                  {repOrderStatusTabs.map((tab) => (
                    <button 
                      key={tab} 
                      className={`px-3 py-1 text-xs font-bold rounded-md transition-colors ${repOrderStatusTab === tab ? "bg-white text-[#1A6FBF] shadow-sm" : "text-gray-500 hover:text-gray-700"}`} 
                      onClick={() => setRepOrderStatusTab(tab)}
                    >
                      {tab}
                    </button>
                  ))}
                </div>
              </div>
              <div className="p-0">
                {renderRepOrderTable(repStatusFilteredOrders.slice(0, 6))}
              </div>
            </section>

            <section className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-200">
                <h2 className="text-base font-bold text-gray-900">Abandoned Carts Assigned</h2>
                <p className="text-xs text-gray-400 font-medium mt-0.5">{repScopeName} follow-up queue only.</p>
              </div>
              <div className="grid grid-cols-2 lg:grid-cols-4 divide-x divide-gray-100 border-b border-gray-100">
                {[
                  { label: "Total", value: repCartStats.total, icon: ShoppingCart, color: "text-gray-400" },
                  { label: "Active", value: repCartStats.active, icon: HandCoins, color: "text-blue-500" },
                  { label: "Contacted", value: repCartStats.contacted, icon: MessageCircle, color: "text-green-500" },
                  { label: "Attention", value: repCartStats.needsAttention, icon: Bell, color: "text-red-500" }
                ].map((stat) => (
                  <article key={stat.label} className="p-5 flex flex-col items-center gap-1 group hover:bg-gray-50 transition-colors">
                    <stat.icon className={`w-5 h-5 ${stat.color} mb-1`} />
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{stat.label}</span>
                    <strong className="text-xl font-bold text-gray-900">{stat.value}</strong>
                  </article>
                ))}
              </div>
            </section>
          </div>
        ) : repConsoleTab === "Products" ? (
          <section className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="flex flex-wrap items-center gap-3 px-5 py-4 border-b border-gray-200">
              <label className="relative flex items-center flex-1 min-w-[200px]">
                <Search className="absolute left-3 w-4 h-4 text-gray-400 pointer-events-none" />
                <input 
                  className="w-full pl-9 pr-4 h-9 border border-gray-200 rounded-md text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[#1A6FBF] focus:bg-white transition-colors"
                  value={repProductSearch} 
                  onChange={(event) => setRepProductSearch(event.target.value)} 
                  placeholder="Search product, SKU, description..." 
                />
              </label>
              <select 
                className="h-9 px-3 border border-gray-200 rounded-md bg-white text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#1A6FBF]"
                value={repProductSort} 
                onChange={(event) => setRepProductSort(event.target.value)} 
                aria-label="Sort products"
              >
                <option>Name A-Z</option>
                <option>Price</option>
                <option>Stock</option>
              </select>
            </div>
            <div className="p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {repProducts.map((product) => {
                const pricing = primaryPricing(product);
                const available = totalProductStock(product);
                return (
                  <article className="bg-gray-50 rounded-xl border border-gray-100 p-4 hover:border-[#1A6FBF] hover:bg-white transition-all group" key={product.id}>
                    <div className="flex justify-between items-start mb-2">
                      <h2 className="text-sm font-bold text-gray-900 line-clamp-1">{product.name}</h2>
                      <span className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter">{product.sku}</span>
                    </div>
                    <p className="text-xs text-gray-500 line-clamp-2 h-8 mb-3">{product.description}</p>
                    <div className="flex items-center justify-between mt-auto pt-3 border-t border-gray-200/50">
                      <strong className="text-[#1A6FBF] font-bold">{formatProductMoney(pricing?.sellingPrice ?? 0, pricing?.currency ?? "NGN")}</strong>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${available > 0 ? "bg-green-50 text-green-600" : "bg-red-50 text-red-600"}`}>
                        {available} in stock
                      </span>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ) : repConsoleTab === "Orders" ? (
          <section className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 px-5 py-4 border-b border-gray-200 bg-gray-50/50">
              <div>
                <h2 className="text-base font-bold text-gray-900">Orders</h2>
                <p className="text-xs text-gray-500 font-medium">Dedicated full order list for {repScopeName}.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium bg-[#1A6FBF] text-white rounded-md hover:bg-blue-700 transition-colors shadow-sm" onClick={openRepCreateOrderModal}>
                  <Plus className="w-4 h-4" /> Create Order
                </button>
                <button className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium border border-gray-200 bg-white text-gray-700 rounded-md hover:bg-gray-50 transition-colors" onClick={() => showToast("Use the status tabs to filter rep orders.")}>
                  <Filter className="w-4 h-4" /> Filter
                </button>
                <button className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium border border-gray-200 bg-white text-gray-700 rounded-md hover:bg-gray-50 transition-colors" onClick={exportRepOrdersCsv}>
                  <Download className="w-4 h-4" /> Export
                </button>
              </div>
            </div>
            <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-1 overflow-x-auto no-scrollbar">
              {repOrderStatusTabs.map((tab) => (
                <button 
                  key={tab} 
                  className={`px-3 py-1 text-xs font-bold rounded-full transition-colors whitespace-nowrap ${repOrderStatusTab === tab ? "bg-[#1A6FBF] text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`} 
                  onClick={() => setRepOrderStatusTab(tab)}
                >
                  {tab}
                </button>
              ))}
            </div>
            <div className="p-0">
              {renderRepOrderTable(repStatusFilteredOrders)}
            </div>
          </section>
        ) : repConsoleTab === "Scheduled Deliveries" ? (
          <section className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 px-5 py-4 border-b border-gray-200">
              <h2 className="text-base font-bold text-gray-900">Scheduled Deliveries</h2>
              <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-lg">
                {scheduleRanges.map((range) => (
                  <button 
                    key={range} 
                    className={`px-3 py-1 text-xs font-bold rounded-md transition-colors ${repScheduleRange === range ? "bg-white text-[#1A6FBF] shadow-sm" : "text-gray-500 hover:text-gray-700"}`} 
                    onClick={() => setRepScheduleRange(range)}
                  >
                    {range}
                  </button>
                ))}
              </div>
            </div>
            <div className="p-0">
              {renderRepOrderTable(repScheduledOrders, "No scheduled deliveries in this range.")}
            </div>
          </section>
        ) : repConsoleTab === "Abandoned Carts" ? (
          <section className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-200">
              <label className="relative flex items-center flex-1 max-w-md">
                <Search className="absolute left-3 w-4 h-4 text-gray-400 pointer-events-none" />
                <input 
                  className="w-full pl-9 pr-4 h-9 border border-gray-200 rounded-md text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[#1A6FBF] focus:bg-white transition-colors"
                  value={repCartSearch} 
                  onChange={(event) => setRepCartSearch(event.target.value)} 
                  placeholder="Search customer, phone, city..." 
                />
              </label>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200 text-left">
                    <th className="px-4 py-3 font-semibold text-gray-500 uppercase text-[10px] tracking-wider">Cart</th>
                    <th className="px-4 py-3 font-semibold text-gray-500 uppercase text-[10px] tracking-wider">Customer</th>
                    <th className="px-4 py-3 font-semibold text-gray-500 uppercase text-[10px] tracking-wider">Product</th>
                    <th className="px-4 py-3 font-semibold text-gray-500 uppercase text-[10px] tracking-wider">Status</th>
                    <th className="px-4 py-3 font-semibold text-gray-500 uppercase text-[10px] tracking-wider">Last Activity</th>
                    <th className="px-4 py-3 font-semibold text-gray-500 uppercase text-[10px] tracking-wider text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredRepCarts.length === 0 ? (
                    <tr><td colSpan={6} className="px-4 py-12 text-center text-gray-400 font-medium">No assigned carts found</td></tr>
                  ) : (
                    filteredRepCarts.map((cart) => (
                      <tr key={cart.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-4 font-bold text-gray-900">{cart.id}</td>
                        <td className="px-4 py-4">
                          <div className="font-bold text-gray-900">{cart.customer}</div>
                          <div className="text-xs text-gray-500">{cart.phone} · {cart.city ?? "-"}</div>
                        </td>
                        <td className="px-4 py-4">
                          <div className="font-medium text-gray-900">{cart.productName}</div>
                          <div className="text-xs text-gray-400">{cart.packageName}</div>
                        </td>
                        <td className="px-4 py-4">
                          <select
                            className="h-8 px-2 border border-gray-200 rounded text-xs font-medium bg-white focus:outline-none focus:ring-2 focus:ring-[#1A6FBF] disabled:opacity-50 disabled:cursor-not-allowed"
                            value={cart.status}
                            disabled={cart.status === "Converted"}
                            onChange={(event) => { updateCartStatus(cart.id, event.target.value as Exclude<CartStatus, "All statuses">); showToast(`${cart.id} marked ${event.target.value}.`); }}
                          >
                            {cartStatuses.filter((status) => status !== "All statuses").map((status) => <option key={status}>{status}</option>)}
                          </select>
                        </td>
                        <td className="px-4 py-4 text-gray-500">
                          {new Date(cart.lastActivity).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                        </td>
                        <td className="px-4 py-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button className="px-3 py-1.5 text-xs font-bold border border-gray-200 bg-white text-gray-700 rounded-md hover:bg-gray-50 transition-colors flex items-center gap-1.5" onClick={() => openCartModal(cart, "assignCart")}>
                              <UserPlus className="w-3 h-3" /> Assign
                            </button>
                            <button className="px-3 py-1.5 text-xs font-bold bg-[#1A6FBF] text-white rounded-md hover:bg-blue-700 transition-colors shadow-sm flex items-center gap-1.5" onClick={() => openCartModal(cart, "convertCart")}>
                              <ShoppingCart className="w-3 h-3" /> Convert
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        ) : repConsoleTab === "Customers" ? (
          <section className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-200">
              <h2 className="text-base font-bold text-gray-900">Customers</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200 text-left">
                    <th className="px-4 py-3 font-semibold text-gray-500 uppercase text-[10px] tracking-wider">Customer</th>
                    <th className="px-4 py-3 font-semibold text-gray-500 uppercase text-[10px] tracking-wider">Phone</th>
                    <th className="px-4 py-3 font-semibold text-gray-500 uppercase text-[10px] tracking-wider">Total Orders</th>
                    <th className="px-4 py-3 font-semibold text-gray-500 uppercase text-[10px] tracking-wider">Total Spend</th>
                    <th className="px-4 py-3 font-semibold text-gray-500 uppercase text-[10px] tracking-wider text-right">Last Order</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {repCustomerRows.length === 0 ? (
                    <tr><td colSpan={5} className="px-4 py-12 text-center text-gray-400 font-medium">No customers yet</td></tr>
                  ) : (
                    repCustomerRows.map((customer) => (
                      <tr key={customer.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-4 font-bold text-gray-900">{customer.name}</td>
                        <td className="px-4 py-4 text-gray-600 font-medium">{customer.phone}</td>
                        <td className="px-4 py-4 text-gray-600">{customer.orders}</td>
                        <td className="px-4 py-4 font-bold text-[#1A6FBF]">{formatMoney(customer.totalSpend)}</td>
                        <td className="px-4 py-4 text-right text-gray-500">{customer.lastOrder}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        ) : repConsoleTab === "Leaderboard" ? (
          <section className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-200">
              <h2 className="text-base font-bold text-gray-900">Leaderboard</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200 text-left">
                    <th className="px-4 py-3 font-semibold text-gray-500 uppercase text-[10px] tracking-wider">Rank</th>
                    <th className="px-4 py-3 font-semibold text-gray-500 uppercase text-[10px] tracking-wider">Sales Rep</th>
                    <th className="px-4 py-3 font-semibold text-gray-500 uppercase text-[10px] tracking-wider">Revenue</th>
                    <th className="px-4 py-3 font-semibold text-gray-500 uppercase text-[10px] tracking-wider">Delivered</th>
                    <th className="px-4 py-3 font-semibold text-gray-500 uppercase text-[10px] tracking-wider text-right">Conversion</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {repLeaderboardRows.map((row, index) => (
                    <tr key={row.user.id} className={`hover:bg-gray-50 transition-colors ${row.user.id === selectedRepUser?.id ? "bg-blue-50/50" : ""}`}>
                      <td className="px-4 py-4 font-bold text-gray-400">#{index + 1}</td>
                      <td className="px-4 py-4">
                        <div className="font-bold text-gray-900">{row.user.name}</div>
                        <div className="text-xs text-gray-500">{row.user.email}</div>
                      </td>
                      <td className="px-4 py-4 font-bold text-green-600">{formatMoney(row.revenue)}</td>
                      <td className="px-4 py-4 text-gray-700 font-medium">{row.delivered}</td>
                      <td className="px-4 py-4 text-right font-bold text-[#1A6FBF]">{row.conversion}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : repConsoleTab === "Notifications" ? (
          <section className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-200">
              <h2 className="text-base font-bold text-gray-900">Notifications</h2>
            </div>
            <div className="p-5 space-y-3">
              {repNotifications.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-12">No rep alerts right now.</p>
              ) : (
                repNotifications.map((notification) => (
                  <article key={notification} className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg border border-gray-100">
                    <Bell className="w-4 h-4 text-[#1A6FBF] mt-0.5 shrink-0" />
                    <span className="text-sm text-gray-700 font-medium">{notification}</span>
                  </article>
                ))
              )}
            </div>
          </section>
        ) : (
          <section className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-200">
              <h2 className="text-base font-bold text-gray-900">Settings</h2>
            </div>
            <div className="p-5 space-y-6">
              {selectedRepUser ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <article className="p-4 bg-gray-50 rounded-lg border border-gray-100">
                    <span className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Name</span>
                    <strong className="text-sm text-gray-900">{selectedRepUser.name}</strong>
                  </article>
                  <article className="p-4 bg-gray-50 rounded-lg border border-gray-100">
                    <span className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Email</span>
                    <strong className="text-sm text-gray-900">{selectedRepUser.email}</strong>
                  </article>
                  <article className="p-4 bg-gray-50 rounded-lg border border-gray-100">
                    <span className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Status</span>
                    <strong className={`text-sm ${selectedRepUser.active ? "text-green-600" : "text-red-600"}`}>
                      {selectedRepUser.active ? "Active" : "Inactive"}
                    </strong>
                  </article>
                  <article className="p-4 bg-gray-50 rounded-lg border border-gray-100">
                    <span className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Role</span>
                    <strong className="text-sm text-gray-900">{selectedRepUser.role}</strong>
                  </article>
                </div>
              ) : (
                <p className="text-sm text-gray-500 font-medium italic">Owner full-access mode is active. Choose a sales rep to edit an individual rep profile.</p>
              )}
              {selectedRepUser && (
                <button className="inline-flex items-center gap-2 px-4 py-2 bg-[#1A6FBF] text-white rounded-md text-sm font-bold hover:bg-blue-700 transition-colors shadow-sm" onClick={() => { setSelectedSalesRepId(selectedRepUser.id); setSalesRepName(selectedRepUser.name); setSalesRepEmail(selectedRepUser.email); setSalesRepActive(selectedRepUser.active); setModal("editSalesRep"); }}>
                  <Pencil className="w-4 h-4" /> Edit Profile
                </button>
              )}
            </div>
          </section>
        )}
      </div>
    );
  };

  const dismissModal = () => {
    setModal(null);
    setCreateOrderContext("admin");
    setUserPassword("");
    setShowPasswordFields({});
    setUserFullName("");
    setUserEmail("");
    setSalesRepName("");
    setSalesRepEmail("");
    setSalesRepPassword("");
  };
  const closeModal = dismissModal;

  if (publicEmbedParams) {
    return (
      <main className="public-order-page" data-theme={theme}>
        <section className="public-order-shell">
          {!publicProduct ? (
            <article className="panel public-order-empty">
              <EmptyProductsIcon />
              <h1>Order form unavailable</h1>
              <p>This embed link does not match a product in your local workspace yet.</p>
              <button className="primary-button" onClick={() => { window.location.hash = "#"; setActivePage("Inventory"); setInventoryView("dashboard"); }}>Back to Inventory</button>
            </article>
          ) : publicPackages.length === 0 ? (
            <article className="panel public-order-empty">
              <PackageCheck />
              <h1>{publicProduct.name}</h1>
              <p>Create at least one active package for this product before sharing the embed link.</p>
              <button className="primary-button" onClick={() => { window.location.hash = "#"; openPackagesView(publicProduct); }}>Manage Packages</button>
            </article>
          ) : (() => {
            // Compute summary data once so both the rail and (if no rail) inline summary can use it
            const chosenPkg = publicPackages.find((it) => it.id === orderFormPackageId) ?? publicPackages[0];
            const summaryXsLines = chosenPkg ? orderFormCrossSells.map((c) => {
              const cp = products.find((pp) => pp.id === c.productId);
              if (!cp) return null;
              const unit = crossSellPriceFor(publicProduct, cp);
              return { name: cp.name, qty: c.quantity, total: unit * c.quantity };
            }).filter(Boolean) as { name: string; qty: number; total: number }[] : [];
            const summaryGiftLines = (publicProduct.freeGiftProductIds ?? []).map((gid) => products.find((p) => p.id === gid)).filter((g) => g && freeGiftVisibleInState(publicProduct, g, orderFormState)) as Product[];
            const summaryTotal = chosenPkg ? chosenPkg.price + summaryXsLines.reduce((s, l) => s + l.total, 0) : 0;
            const orderSummaryBlock = formOrderSummaryEnabled && chosenPkg ? (
              <div className="panel public-order-summary-rail" style={{ padding: 16, display: "grid", gap: 6 }}>
                <strong style={{ fontSize: 14 }}>{formOrderSummaryTitle}</strong>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "4px 0", borderBottom: "1px solid #f0f0f0" }}>
                  <span>{publicProduct.name} · {chosenPkg.name}</span>
                  <strong>{formatProductMoney(chosenPkg.price, chosenPkg.currency)}</strong>
                </div>
                {summaryXsLines.map((l, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "2px 0", color: "#92400e" }}>
                    <span>↳ {l.name} × {l.qty}</span>
                    <span>{formatProductMoney(l.total, chosenPkg.currency)}</span>
                  </div>
                ))}
                {summaryGiftLines.map((g) => (
                  <div key={g.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "2px 0", color: "#047857" }}>
                    <span>🎁 {g.name}</span>
                    <span>FREE</span>
                  </div>
                ))}
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 16, padding: "10px 0 0", marginTop: 4, borderTop: "2px solid #1A6FBF", fontWeight: 800 }}>
                  <span>Total</span>
                  <span style={{ color: "#1A6FBF" }}>{formatProductMoney(summaryTotal, chosenPkg.currency)}</span>
                </div>
              </div>
            ) : null;
            return (
              <div className="public-form-layout">
                <article className="panel public-order-card public-form-main">
                  <header>
                    <span className="public-brand">Protohub</span>
                    <h1>{publicProduct.name}</h1>
                    <p>{publicProduct.description || "Choose a package and complete your order details."}</p>
                  </header>
                  {publicProduct.formCustomText?.trim() && (
                    <div style={{ padding: "10px 12px", background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 12, fontSize: 13, color: "#075985", whiteSpace: "pre-line" }}>{publicProduct.formCustomText}</div>
                  )}
                  <div className="preview-grid">
                    <span className="form-section-head">Contact Details</span>
                    <label><span>Your Name</span><input value={orderFormName} onChange={(event) => setOrderFormName(event.target.value)} placeholder="Customer name" /></label>
                    <label><span>Phone Number</span><input value={orderFormPhone} onChange={(event) => setOrderFormPhone(event.target.value)} placeholder="+234 801 234 5678" inputMode="tel" /></label>
                    {showWhatsappField && <label><span>WhatsApp Number{requireWhatsapp ? " *" : ""}</span><input value={orderFormWhatsapp} onChange={(event) => setOrderFormWhatsapp(event.target.value)} placeholder="+234 801 234 5678" inputMode="tel" /></label>}
                    {showEmailField && <label><span>Email</span><input value={orderFormEmail} onChange={(event) => setOrderFormEmail(event.target.value)} placeholder="customer@example.com" type="email" /></label>}
                    <span className="form-section-head">Delivery Address</span>
                    <label className="field-full"><span>Address</span><input value={orderFormAddress} onChange={(event) => setOrderFormAddress(event.target.value)} placeholder="Full delivery address" /></label>
                    <label><span>City</span><input value={orderFormCity} onChange={(event) => setOrderFormCity(event.target.value)} placeholder="City" /></label>
                    <label>
                      <span>State</span>
                      {shouldUseStateDropdown(publicCurrency) ? (() => {
                        const allowed = publicProduct?.availableStates && publicProduct.availableStates.length > 0
                          ? nigeriaStates.filter((state) => publicProduct.availableStates!.includes(state))
                          : nigeriaStates;
                        return (
                          <select value={orderFormState} onChange={(event) => setOrderFormState(event.target.value)}>
                            <option value="">Select state</option>
                            {allowed.map((state) => <option key={state} value={state}>{state}</option>)}
                          </select>
                        );
                      })() : (
                        <input value={orderFormState} onChange={(event) => setOrderFormState(event.target.value)} placeholder="State" />
                      )}
                      {publicProduct?.availableStates && publicProduct.availableStates.length > 0 && (
                        <small className="text-xs text-gray-500 mt-1 block">Available in {publicProduct.availableStates.length} state{publicProduct.availableStates.length !== 1 ? "s" : ""}.</small>
                      )}
                    </label>
                  </div>
                  <div className="package-picker">
                    {publicPackages.map((item) => (
                      <label className={`payment-option ${orderFormPackageId === item.id ? "selected" : ""}`} key={item.id}>
                        <input type="radio" name="public-package" checked={orderFormPackageId === item.id} onChange={() => setOrderFormPackageId(item.id)} />
                        <strong>{showPackageName ? item.name : `${publicProduct.name} x${item.quantity}`}</strong>
                        <span>{item.description || "Pay on delivery"} - {formatProductMoney(item.price, item.currency)}</span>
                      </label>
                    ))}
                  </div>
                  {formAddonPromptEnabled && (() => {
                    const allXs = (publicProduct.crossSellProductIds ?? []).map((id) => products.find((p) => p.id === id)).filter(Boolean) as Product[];
                    const xs = allXs.filter((cp) => crossSellVisibleInState(publicProduct, cp, orderFormState));
                    if (allXs.length === 0 || xs.length === 0) return null;
                    return (
                      <div style={{ padding: 10, border: "1px solid #d1d5db", background: "#f9fafb", borderRadius: 12 }}>
                        <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 6 }}>{formAddonPromptText}</label>
                        <select value={orderFormAddonChoice} onChange={(e) => setOrderFormAddonChoice(e.target.value as "" | "yes" | "no")} style={{ width: "100%", padding: "6px 10px", border: "1px solid #d1d5db", borderRadius: 8, fontSize: 13 }}>
                          <option value="">— choose —</option>
                          <option value="yes">{formAddonYesLabel}</option>
                          <option value="no">{formAddonNoLabel}</option>
                        </select>
                      </div>
                    );
                  })()}
                  {(!formAddonPromptEnabled || orderFormAddonChoice === "yes") && (() => {
                    const allXs = (publicProduct.crossSellProductIds ?? []).map((id) => products.find((p) => p.id === id)).filter(Boolean) as Product[];
                    const xs = allXs.filter((cp) => crossSellVisibleInState(publicProduct, cp, orderFormState));
                    if (xs.length === 0) return null;
                    const hiddenCount = allXs.length - xs.length;
                    return (
                      <div className="cross-sell-picker" style={{ padding: 12, border: "1px solid #f59e0b40", background: "#fffbeb", borderRadius: 12 }}>
                        <strong style={{ fontSize: 14, display: "block", marginBottom: 8 }}>{formCrossSellLabel}{hiddenCount > 0 && orderFormState ? ` (showing ${xs.length} of ${allXs.length} for ${orderFormState})` : ""}</strong>
                        {xs.map((cp) => {
                          const sel = orderFormCrossSells.find((c) => c.productId === cp.id);
                          const standardPrice = primaryPricing(cp)?.sellingPrice ?? 0;
                          const price = crossSellPriceFor(publicProduct, cp);
                          const currency = primaryPricing(cp)?.currency ?? "NGN";
                          const discounted = price < standardPrice;
                          return (
                            <label key={cp.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", fontSize: 13 }}>
                              <input type="checkbox" checked={Boolean(sel)} onChange={() => toggleOrderFormCrossSell(cp.id)} />
                              <span style={{ flex: 1 }}>
                                <strong>{cp.name}</strong> · {formatProductMoney(price, currency)}
                                {discounted && <span style={{ marginLeft: 6, textDecoration: "line-through", color: "#9ca3af", fontSize: 12 }}>{formatProductMoney(standardPrice, currency)}</span>}
                              </span>
                              {sel && <input type="number" min={1} style={{ width: 56, padding: "2px 6px", border: "1px solid #d1d5db", borderRadius: 6 }} value={sel.quantity} onChange={(e) => setOrderFormCrossSellQuantity(cp.id, Number(e.target.value) || 1)} />}
                            </label>
                          );
                        })}
                      </div>
                    );
                  })()}
                  {formAddonPromptEnabled && orderFormAddonChoice === "no" && (
                    <div style={{ padding: 10, border: "1px solid #d1d5db", background: "#f3f4f6", borderRadius: 12, fontSize: 13, color: "#4b5563" }}>{formAddonNoMessage}</div>
                  )}
                  {(() => {
                    const allGifts = (publicProduct.freeGiftProductIds ?? []).map((id) => products.find((p) => p.id === id)).filter(Boolean) as Product[];
                    const gifts = allGifts.filter((g) => freeGiftVisibleInState(publicProduct, g, orderFormState));
                    if (gifts.length === 0) return null;
                    return (
                      <div style={{ padding: 10, border: "1px solid #10b98140", background: "#ecfdf5", borderRadius: 12, fontSize: 13 }}>
                        <strong>🎁 {formFreeGiftLabel}</strong> {gifts.map((g) => g.name).join(", ")}
                      </div>
                    );
                  })()}
                  {showDeliveryQuestion && <label><span>When would you like it delivered?</span><input value={orderFormDeliveryWindow} onChange={(e) => setOrderFormDeliveryWindow(e.target.value)} placeholder="e.g., Tomorrow afternoon" /></label>}
                  {showCommitmentNotice && (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                      <div className="flex items-start gap-3">
                        <Banknote className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                        <div>
                          <strong className="block text-sm">Commitment fee notice</strong>
                          <p className="mt-1 text-xs leading-5 text-amber-800">Some high-risk deliveries may require a small commitment fee before dispatch.</p>
                        </div>
                      </div>
                      <label className="mt-3 flex cursor-pointer items-start gap-2 text-sm text-amber-900">
                        <input type="checkbox" className="mt-0.5 h-4 w-4 accent-amber-600" checked={orderFormCommitmentAccepted} onChange={(event) => setOrderFormCommitmentAccepted(event.target.checked)} />
                        I understand that a commitment fee may be requested before delivery.
                      </label>
                    </div>
                  )}
                  {requireConfirmation && <label className="preview-check"><input type="checkbox" checked={orderFormConfirmed} onChange={(event) => setOrderFormConfirmed(event.target.checked)} /> I confirm this order is correct.</label>}
                  <button className="primary-button" onClick={submitPublicOrder} disabled={publicOrderSubmitting} style={{ opacity: publicOrderSubmitting ? 0.65 : 1, cursor: publicOrderSubmitting ? "not-allowed" : "pointer" }}>
                    {publicOrderSubmitting ? "Submitting…" : "Order Now"}
                  </button>
                </article>
                {orderSummaryBlock}
              </div>
            );
          })()}
        </section>
        {toast && (
          <div className="toast" role="status" aria-live="polite">
            <CheckCircle2 />
            <span>{toast}</span>
            <button aria-label="Dismiss message" onClick={() => setToast("")}><X /></button>
          </div>
        )}
      </main>
    );
  }

  return (
    <div className={`app-shell !flex h-screen bg-[#EBEBEB] overflow-hidden ${collapsed ? "is-collapsed" : ""}`} data-theme={theme}>
      {/* Mobile Backdrop */}
      {mobileMenuOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 bg-white border-r border-gray-200 transform transition-all duration-200 ease-in-out lg:static lg:translate-x-0 lg:h-screen flex flex-col overflow-hidden
          ${mobileMenuOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}
          ${collapsed ? "w-[72px] py-3" : "w-[280px] py-4"}`}
        aria-label="Primary navigation"
      >
        {/* Logo */}
        <div className={`flex items-center border-b border-gray-100 shrink-0 ${collapsed ? "justify-center px-2 pb-3" : "gap-3 px-5 pb-5"}`}>
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-[#1A6FBF] to-blue-700 flex items-center justify-center text-white font-extrabold text-base shrink-0 shadow-sm">
            O
          </div>
          {!collapsed && (
            <div className="flex flex-col">
              <span className="font-bold text-[15px] leading-tight text-gray-900">Protohub</span>
              <span className="text-[11px] text-gray-500 leading-tight">Management System</span>
            </div>
          )}
        </div>

        {/* Nav items */}
        <nav className="flex-1 min-h-0 overflow-y-auto px-2 py-3 space-y-0.5">
          {navItems.map((item) => {
            const isActive = activePage === item.label;
            return (
              <button
                type="button"
                title={collapsed ? item.label : undefined}
                className={`w-full flex items-center rounded-lg text-sm transition-all relative
                  ${collapsed ? "justify-center px-0 py-2.5" : "gap-3 px-3 py-2.5"}
                  ${isActive
                    ? `bg-blue-50 text-[#1A6FBF] font-semibold ${!collapsed ? "before:absolute before:left-0 before:top-1 before:bottom-1 before:w-1 before:bg-[#1A6FBF] before:rounded-full" : ""}`
                    : "text-gray-600 font-medium hover:bg-gray-100 hover:text-gray-900"
                  }`}
                key={item.label}
                onClick={() => {
                  handleNavClick(item.label);
                  if (window.matchMedia("(max-width: 1024px)").matches) {
                    setMobileMenuOpen(false);
                  }
                }}
              >
                <item.icon className={`w-5 h-5 shrink-0 ${isActive ? "text-[#1A6FBF]" : "text-gray-400"}`} />
                {!collapsed && <span className="truncate">{item.label}</span>}
              </button>
            );
          })}
        </nav>

        {/* Collapse toggle */}
        <div className={`hidden lg:flex items-center shrink-0 pb-2 ${collapsed ? "justify-center px-2" : "justify-end px-3"}`}>
          <button
            type="button"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            onClick={() => setCollapsed((v) => !v)}
          >
            <ChevronLeft className={`w-4 h-4 transition-transform duration-200 ${collapsed ? "rotate-180" : ""}`} />
          </button>
        </div>

        {/* User card + Sign out */}
        <div className={`border-t border-gray-100 flex flex-col shrink-0 ${collapsed ? "items-center px-2 pt-3 pb-2 gap-2" : "px-4 pt-4 pb-2 gap-3"}`}>
          {(() => {
            const ownerUser = users.find((u) => u.role === "Owner") ?? users[0];
            return (
              <div className={`flex items-center rounded-lg hover:bg-gray-50 transition-colors ${collapsed ? "justify-center p-1.5" : "gap-3 p-2"}`}>
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#1A6FBF] to-blue-700 flex items-center justify-center text-white text-xs font-bold shrink-0">
                  {userInitials(ownerUser?.name ?? "U")}
                </div>
                {!collapsed && (
                  <div className="flex flex-col min-w-0">
                    <span className="font-semibold text-sm leading-tight text-gray-900 truncate">{ownerUser?.name ?? "—"}</span>
                    <span className="text-[11px] text-gray-500 leading-tight">{ownerUser?.role ?? "—"}</span>
                  </div>
                )}
              </div>
            );
          })()}
          <button
            title={collapsed ? "Sign Out" : undefined}
            className={`flex items-center text-red-500 text-sm font-medium hover:text-red-600 transition-colors ${collapsed ? "justify-center p-1.5 rounded-lg hover:bg-red-50 w-full" : "gap-2 px-2 pb-2"}`}
            onClick={() => setModal("signout")}
          >
            <LogOut className="w-4 h-4 shrink-0" />
            {!collapsed && <span>Sign Out</span>}
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top Bar */}
        <header className="h-14 bg-white border-b border-gray-200 px-4 flex items-center justify-between shrink-0">
          <div className="flex items-center lg:hidden">
            <button
              className="p-2 -ml-2 text-gray-600 hover:text-gray-900"
              onClick={() => setMobileMenuOpen(true)}
            >
              <Menu className="w-5 h-5" />
            </button>
          </div>
          
          <div className="ml-auto flex items-center gap-4">
            <button
              className={`hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border hover:bg-opacity-80 transition-colors ${tokens === 0 ? "border-red-200 bg-red-50 text-red-600 hover:bg-red-100" : "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"}`}
              onClick={() => setModal("tokens")}
            >
              <Zap className="w-3.5 h-3.5" />
              {tokens === 0 ? "0 tokens — Buy more" : `${tokens} tokens`}
            </button>
            
            <button className="text-gray-600 hover:text-gray-900 relative" onClick={() => setModal("notifications")}>
              <Bell className="w-5 h-5" />
              {unreadNotificationCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-0.5 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center leading-none">
                  {unreadNotificationCount}
                </span>
              )}
            </button>
            <button className="text-gray-600 hover:text-gray-900" onClick={() => setModal("help")}>
              <HelpCircle className="w-5 h-5" />
            </button>
            <button
              className="text-gray-600 hover:text-gray-900"
              onClick={() => setTheme(theme === "light" ? "dark" : "light")}
            >
              {theme === "light" ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
            </button>
          </div>
        </header>

        {/* Page Content Scrollable Area */}
        <main className="flex-1 min-h-0 overflow-y-auto p-4 pt-2 lg:pt-4 lg:p-8">
          <div className="flex flex-col gap-4 sm:gap-6 pb-8">
          {activePage === "Dashboard" ? (
            <>
              <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-6 px-5 py-4 bg-gradient-to-r from-blue-50 to-transparent rounded-2xl border border-blue-100">
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="inline-block w-2 h-2 rounded-full bg-[#1A6FBF]" />
                    <span className="text-xs font-semibold text-[#1A6FBF] uppercase tracking-widest">Admin Overview</span>
                  </div>
                  <h1 className="text-2xl font-bold text-gray-900">Administrator Dashboard</h1>
                  <p className="text-sm text-gray-500">Monitor your business performance in real-time</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button className="!min-h-0 inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold bg-[#1A6FBF] text-white rounded-lg hover:bg-blue-700 transition-colors shadow-sm" onClick={exportReport}>
                    <Download className="w-4 h-4" /> Export Report
                  </button>
                </div>
              </header>

              {/* Getting-started checklist — shown only for new accounts with no data */}
              {products.length === 0 && trackedOrders.length === 0 && (
                <div className="rounded-2xl border border-blue-200 bg-blue-50 p-5 flex flex-col gap-4">
                  <div>
                    <p className="text-sm font-bold text-blue-800">Welcome to ProtoHub! Here's how to get started:</p>
                    <p className="text-xs text-blue-600 mt-0.5">Complete these steps to start tracking your business.</p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {[
                      { step: "1", label: "Add your first product", desc: "Go to Inventory → Add Product", page: "Inventory" as ActivePage },
                      { step: "2", label: "Invite your team", desc: "Go to User Management → Add User", page: "User Management" as ActivePage },
                      { step: "3", label: "Create your first order", desc: "Go to Orders → Create Order", page: "Orders" as ActivePage }
                    ].map((item) => (
                      <button
                        key={item.step}
                        onClick={() => setActivePage(item.page)}
                        className="!min-h-0 text-left flex gap-3 items-start p-3 rounded-xl bg-white border border-blue-100 hover:border-blue-300 transition-colors"
                      >
                        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-[#1A6FBF] text-white text-xs font-bold shrink-0">{item.step}</span>
                        <div>
                          <p className="text-sm font-semibold text-gray-900">{item.label}</p>
                          <p className="text-xs text-gray-500 mt-0.5">{item.desc}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-3 mb-6">
                <div className="inline-flex items-center bg-gray-100 p-1 rounded-lg">
                  {periods.map((item) => (
                    <button
                      className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${period === item ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-900"}`}
                      onClick={() => handlePeriodChange(item)}
                      key={item}
                    >
                      {item}
                    </button>
                  ))}
                </div>
                <div className="relative">
                  <button className="inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium border border-gray-200 bg-white text-gray-700 rounded-md hover:bg-gray-50 transition-colors" onClick={() => setShowDateRange((value) => !value)}>
                    <CalendarDays className="w-4 h-4" /> {period === "Custom" ? "Edit date range" : "Pick a date range"}
                  </button>
                  {showDateRange && renderDateRangeCalendar("date-range-panel", dateRange, setDateRange, applyDateRange, () => setShowDateRange(false))}
                </div>
                <select
                  className="h-9 px-3 border border-gray-200 rounded-md bg-white text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#1A6FBF] transition-colors"
                  aria-label="Currency"
                  value={currency}
                  onChange={(event) => {
                    const nextCurrency = event.target.value as CurrencyCode;
                    setCurrency(nextCurrency);
                    showToast(`Currency changed to ${currencies[nextCurrency].label}.`);
                  }}
                >
                  <option value="NGN">₦ Nigerian Naira</option>
                  <option value="USD">$ US Dollar</option>
                  <option value="GBP">£ British Pound</option>
                </select>
              </div>

              <div className="flex items-center gap-3 text-sm text-gray-500 font-medium mb-4">
                <strong className="text-gray-900">Currency: {selectedCurrency.label}</strong>
                <span>Period: {selectedPeriodLabel}</span>
              </div>

              <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4" aria-label="Business summary">
                {dashboardCards.map((card) => {
                  const toneMap: Record<string, { bar: string; icon: string }> = {
                    blue:    { bar: "bg-blue-500",    icon: "bg-blue-50 text-blue-600" },
                    emerald: { bar: "bg-emerald-500", icon: "bg-emerald-50 text-emerald-600" },
                    violet:  { bar: "bg-violet-500",  icon: "bg-violet-50 text-violet-600" },
                    orange:  { bar: "bg-orange-500",  icon: "bg-orange-50 text-orange-600" },
                    teal:    { bar: "bg-teal-500",    icon: "bg-teal-50 text-teal-600" },
                    positive:{ bar: "bg-emerald-500", icon: "bg-emerald-50 text-emerald-600" },
                    negative:{ bar: "bg-red-500",     icon: "bg-red-50 text-red-600" },
                  };
                  const t = toneMap[card.tone] ?? toneMap.blue;
                  const trendIsPositive = card.trend?.startsWith("+");
                  const trendClass = trendIsPositive
                    ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                    : "bg-red-50 text-red-700 border border-red-200";
                  return (
                    <article className="bg-white rounded-xl border border-gray-200 overflow-hidden flex flex-col shadow-sm" key={card.label}>
                      <div className={`h-1 ${t.bar}`} />
                      <div className="p-5 flex flex-col gap-4 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${t.icon}`}>
                            <card.icon className="w-5 h-5" />
                          </div>
                          {card.trend && (
                            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-bold ${trendClass}`}>
                              {card.trend}
                            </span>
                          )}
                        </div>
                        <div className="flex flex-col gap-0.5">
                          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{card.label}</span>
                          <strong className="text-2xl font-bold text-gray-900 leading-tight">{card.value}</strong>
                        </div>
                        <span className="text-xs text-gray-400">{card.helper}</span>
                      </div>
                    </article>
                  );
                })}
              </section>

              <section className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden flex flex-col">
                <div className="p-5 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex flex-col gap-0.5">
                    <h2 className="text-base font-bold text-gray-900 m-0">Abandoned Cart Follow-up</h2>
                    <p className="text-xs text-gray-400 m-0">Track captured carts and how fast the team is converting them.</p>
                  </div>
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-50 border border-emerald-200 text-sm font-semibold text-emerald-700 whitespace-nowrap">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />{convertedCartCount} converted
                  </span>
                </div>
                <div className="p-5 grid grid-cols-2 lg:grid-cols-4 gap-4">
                  {dashboardCartStats.map((stat) => {
                    const cartToneMap: Record<string, { icon: string; dot: string }> = {
                      blue:   { icon: "bg-blue-50 text-blue-600",   dot: "bg-blue-500" },
                      orange: { icon: "bg-orange-50 text-orange-600", dot: "bg-orange-500" },
                      emerald:{ icon: "bg-emerald-50 text-emerald-600", dot: "bg-emerald-500" },
                      rose:   { icon: "bg-rose-50 text-rose-600",   dot: "bg-rose-500" },
                    };
                    const ct = cartToneMap[stat.tone ?? "blue"] ?? cartToneMap.blue;
                    return (
                      <div className="flex flex-col gap-3 p-4 rounded-xl bg-gray-50 border border-gray-100" key={stat.label}>
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{stat.label}</span>
                          <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${ct.icon}`}>
                            <stat.icon className="w-3.5 h-3.5" />
                          </div>
                        </div>
                        <strong className="text-2xl font-bold text-gray-900">{stat.value}</strong>
                      </div>
                    );
                  })}
                </div>
                <div className="px-5 pb-4">
                  <button className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#1A6FBF] hover:text-blue-700 transition-colors" onClick={() => setModal("carts")}>
                    Open abandoned carts <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </section>

              <section className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 flex flex-col gap-5">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-violet-50 text-violet-600 flex items-center justify-center shrink-0">
                    <Zap className="w-4 h-4" />
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-gray-900 m-0">Revenue Opportunity Simulator</h2>
                    <p className="text-xs text-gray-400 m-0">Drag the slider to model conversion lift impact on revenue</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1 p-4 bg-blue-50 rounded-xl border border-blue-100">
                    <span className="text-xs font-semibold text-blue-500 uppercase tracking-wide">Conversion rate</span>
                    <strong className="text-2xl font-bold text-blue-900">{dashboardDeliveryRateExact.toFixed(1)}%</strong>
                  </div>
                  <div className="flex flex-col gap-1 p-4 bg-emerald-50 rounded-xl border border-emerald-100">
                    <span className="text-xs font-semibold text-emerald-600 uppercase tracking-wide">Current revenue</span>
                    <strong className="text-2xl font-bold text-emerald-900">{formatMoney(dashboardRevenue)}</strong>
                  </div>
                </div>
                <label className="flex flex-col gap-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-gray-600">Lift slider</span>
                    <span className="font-bold text-[#1A6FBF]">+{conversion}pp → {dashboardTargetConversion.toFixed(1)}%</span>
                  </div>
                  <input
                    type="range"
                    className="w-full accent-[#1A6FBF]"
                    min="0"
                    max={dashboardConversionLiftMax}
                    value={conversion}
                    onChange={(event) => setConversion(Number(event.target.value))}
                  />
                </label>
                <div className="flex items-center gap-2 flex-wrap">
                  {[10, 20, 30, 100].map((rate) => (
                    <button key={rate} className="!min-h-0 px-3 py-1 text-xs font-semibold border border-gray-200 bg-white text-gray-600 rounded-lg hover:border-[#1A6FBF] hover:text-[#1A6FBF] transition-colors" onClick={() => setConversion(Math.min(rate, dashboardConversionLiftMax))}>
                      {rate === 100 ? "Max" : `+${rate}pp`}
                    </button>
                  ))}
                </div>
                <div className="flex flex-col gap-2 pt-3 border-t border-gray-100">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-500">Projected revenue</span>
                    <strong className="text-sm font-bold text-[#1A6FBF]">{projectedRevenue}</strong>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-500">Upside opportunity</span>
                    <strong className="text-sm font-bold text-emerald-600">{formatMoney(dashboardOpportunity)}</strong>
                  </div>
                  <p className="text-xs text-gray-400 m-0">{dashboardProjectedDelivered.toFixed(1)} additional orders delivered at target rate.</p>
                </div>
              </section>

              <section className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 flex flex-col gap-4" aria-label="Dashboard math rules">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-orange-50 text-orange-600 flex items-center justify-center shrink-0">
                    <ChevronRight className="w-4 h-4" />
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-gray-900 m-0">Dashboard Math Rules</h2>
                    <p className="text-xs text-gray-400 m-0">Revenue and profit count only after delivery — total orders counts all created orders.</p>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {[
                    { label: "Revenue",       color: "blue",    formula: "SUM(grand total) where status = Delivered" },
                    { label: "COGS",          color: "orange",  formula: "Unit cost × delivered quantity" },
                    { label: "Gross Profit",  color: "emerald", formula: `${formatMoney(dashboardRevenue)} − ${formatMoney(dashboardCogs)} = ${formatMoney(dashboardGrossProfit)}` },
                    { label: "Net Profit",    color: "violet",  formula: `${formatMoney(dashboardGrossProfit)} − ${formatMoney(dashboardExpenseTotal)} = ${formatMoney(dashboardNetProfit)}` },
                    { label: "Fulfillment",   color: "teal",    formula: `${dashboardDeliveredOrders.length} delivered / ${dashboardOrders.length} orders = ${dashboardDeliveryRateExact.toFixed(1)}%` },
                    { label: "Net Margin",    color: "rose",    formula: `Net profit / revenue = ${dashboardNetMargin}%` },
                  ].map(({ label, formula, color }) => {
                    const dotMap: Record<string, string> = {
                      blue: "bg-blue-500", orange: "bg-orange-500", emerald: "bg-emerald-500",
                      violet: "bg-violet-500", teal: "bg-teal-500", rose: "bg-rose-500"
                    };
                    const labelMap: Record<string, string> = {
                      blue: "text-blue-700", orange: "text-orange-700", emerald: "text-emerald-700",
                      violet: "text-violet-700", teal: "text-teal-700", rose: "text-rose-700"
                    };
                    return (
                      <div key={label} className="flex flex-col gap-1.5 p-3.5 bg-gray-50 rounded-xl border border-gray-100">
                        <div className="flex items-center gap-1.5">
                          <span className={`w-2 h-2 rounded-full shrink-0 ${dotMap[color]}`} />
                          <span className={`text-xs font-bold uppercase tracking-wide ${labelMap[color]}`}>{label}</span>
                        </div>
                        <span className="text-sm text-gray-600 leading-snug">{formula}</span>
                      </div>
                    );
                  })}
                </div>
                <div className="flex items-center gap-2 flex-wrap text-xs font-medium text-gray-500 pt-3 border-t border-gray-100">
                  <span className="font-semibold text-gray-700">Customer pays</span><ArrowRight className="w-3 h-3" />
                  <span>Revenue</span><ArrowRight className="w-3 h-3" />
                  <span>− COGS ({dashboardCogsRate}%)</span><ArrowRight className="w-3 h-3" />
                  <span>− Expenses ({dashboardExpenseRate}%)</span><ArrowRight className="w-3 h-3" />
                  <strong className="text-gray-900">Net Profit</strong>
                </div>
              </section>

              <section className="grid grid-cols-1 lg:grid-cols-5 gap-4">
                <article className="lg:col-span-3 bg-white rounded-xl border border-gray-200 shadow-sm p-5 flex flex-col gap-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-base font-bold text-gray-900 m-0">Revenue Performance</h2>
                      <p className="text-xs text-gray-400 m-0">Current vs. previous period</p>
                    </div>
                    <div className="flex items-center gap-4 text-xs font-semibold text-gray-500">
                      <span className="flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-full bg-[#1A6FBF]" /> Current</span>
                      <span className="flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-full bg-violet-400" /> Previous</span>
                    </div>
                  </div>
                  <ResponsiveContainer width="100%" height={260}>
                    <LineChart data={dashboardRevenueChartData} margin={{ left: -24, right: 16, top: 8, bottom: 0 }}>
                      <XAxis dataKey="hour" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#9ca3af" }} />
                      <YAxis hide domain={[0, dashboardRevenueChartMax]} />
                      <Tooltip contentStyle={{ borderRadius: 10, border: "1px solid #e5e7eb", fontSize: 12 }} />
                      <Line type="monotone" dataKey="current" stroke="#1A6FBF" strokeWidth={2.5} dot={false} />
                      <Line type="monotone" dataKey="previous" stroke="#a78bfa" strokeWidth={2} strokeDasharray="4 3" dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </article>

                <article className="lg:col-span-2 bg-white rounded-xl border border-gray-200 shadow-sm p-5 flex flex-col gap-4">
                  <div>
                    <h2 className="text-base font-bold text-gray-900 m-0">Top Selling Products</h2>
                    <p className="text-xs text-gray-400 m-0">By delivered revenue this period</p>
                  </div>
                  {ordersByProduct.length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center gap-3 py-8 text-gray-300">
                      <EmptyProductsIcon />
                      <p className="text-sm font-medium m-0 text-gray-400">No product sales in this period</p>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {ordersByProduct.slice(0, 5).map(([name, item], idx) => {
                        const rankColors = ["bg-[#1A6FBF] text-white", "bg-emerald-500 text-white", "bg-orange-400 text-white", "bg-violet-400 text-white", "bg-teal-400 text-white"];
                        return (
                          <div className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0" key={name}>
                            <span className={`w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center shrink-0 ${rankColors[idx] ?? "bg-gray-200 text-gray-600"}`}>{idx + 1}</span>
                            <span className="text-sm font-medium text-gray-700 truncate flex-1">{name}</span>
                            <div className="flex flex-col items-end shrink-0">
                              <em className="font-bold text-gray-900 not-italic text-sm">{formatMoney(item.revenue)}</em>
                              <span className="text-xs text-gray-400">{item.count} orders</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </article>
              </section>

              <section className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
                  <h3 className="text-base font-bold text-gray-900 m-0">Recent Transactions</h3>
                  <button className="!min-h-0 text-[#1A6FBF] text-xs font-bold hover:underline whitespace-nowrap" onClick={() => setActivePage("Orders")}>View All Orders</button>
                </div>
                {dashboardOrders.length === 0 ? (
                  <div className="flex flex-col items-center justify-center gap-3 py-14">
                    <ShoppingCart className="w-10 h-10 text-gray-300" />
                    <p className="text-sm font-medium m-0 text-gray-400">No orders in this period</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr>
                          <th className="px-3 sm:px-6 py-3 sm:py-4 text-left text-xs font-medium text-gray-400">Order ID</th>
                          <th className="px-3 sm:px-6 py-3 sm:py-4 text-left text-xs font-medium text-gray-400">Customer</th>
                          <th className="px-3 sm:px-6 py-3 sm:py-4 text-left text-xs font-medium text-gray-400">Date</th>
                          <th className="px-3 sm:px-6 py-3 sm:py-4 text-left text-xs font-medium text-gray-400">Amount</th>
                          <th className="px-3 sm:px-6 py-3 sm:py-4 text-left text-xs font-medium text-gray-400">Status</th>
                          <th className="px-3 sm:px-6 py-3 sm:py-4 text-left text-xs font-medium text-gray-400">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...dashboardOrders]
                          .sort((a, b) => normalizeDateKey(b.createdAt ?? b.date).localeCompare(normalizeDateKey(a.createdAt ?? a.date)))
                          .slice(0, 5)
                          .map((order) => (
                          <tr key={order.id} className="border-t border-gray-100 hover:bg-gray-50/60 transition-colors cursor-pointer">
                            <td className="px-3 sm:px-6 py-3 sm:py-4 font-semibold text-gray-500">{order.id}</td>
                            <td className="px-3 sm:px-6 py-3 sm:py-4">
                              <p className="font-medium text-sm text-gray-900 m-0">{order.customer}</p>
                              <p className="text-xs text-gray-400 m-0 mt-0.5">{order.phone}</p>
                            </td>
                            <td className="px-3 sm:px-6 py-3 sm:py-4 text-xs text-gray-400 whitespace-nowrap">{displayDateFromKey(order.createdAt ?? order.date)}</td>
                            <td className="px-3 sm:px-6 py-3 sm:py-4 font-semibold text-gray-900 whitespace-nowrap">{formatProductMoney(order.amount, order.currency)}</td>
                            <td className="px-3 sm:px-6 py-3 sm:py-4">
                              <span className={`inline-flex items-center justify-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${statusBadgeClasses(order.status ?? "New")}`}>{order.status ?? "New"}</span>
                            </td>
                            <td className="px-3 sm:px-6 py-3 sm:py-4">
                              <button className="!min-h-0 w-8 h-8 flex items-center justify-center rounded-md hover:bg-gray-100 transition-colors text-gray-500" onClick={() => { setSelectedOrderId(order.id); setModal("orderDetails"); }}>
                                <Eye className="w-4 h-4" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

            </>
          ) : activePage === "Orders" ? (
            <div className="space-y-6">
              {/* Header */}
              <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
                <div className="flex flex-col gap-1">
                  <h1 className="text-2xl font-bold text-[#1A6FBF]">Orders Management</h1>
                  <p className="text-sm font-medium text-gray-500">Track and manage all customer orders in real-time</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold border border-gray-200 bg-white text-gray-700 rounded-lg hover:bg-gray-50 transition-colors" onClick={exportOrdersCsv}>
                    <Download className="w-4 h-4" /> Export CSV
                  </button>
                  <button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-[#1A6FBF] text-white rounded-lg hover:bg-blue-700 transition-colors" onClick={openCreateOrderModal}>
                    <Plus className="w-4 h-4" /> Create Order
                  </button>
                </div>
              </header>

              {/* Period + date + currency controls */}
              <div className="flex flex-wrap items-center gap-3">
                <div className="inline-flex items-center bg-gray-100 p-1 rounded-lg">
                  {periods.map((item) => (
                    <button
                      key={item}
                      className={`!min-h-0 px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${ordersPeriod === item ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-900"}`}
                      onClick={() => handleOrdersPeriodChange(item)}
                    >
                      {item}
                    </button>
                  ))}
                </div>
                <div className="relative">
                  <button className="!min-h-0 inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium border border-gray-200 bg-white text-gray-700 rounded-lg hover:bg-gray-50 transition-colors" onClick={() => setShowOrdersDateRange((v) => !v)}>
                    <CalendarDays className="w-4 h-4" /> {ordersPeriod === "Custom" ? "Edit date range" : "Date range"}
                  </button>
                  {showOrdersDateRange && renderDateRangeCalendar("orders-date-range-panel", ordersDateRange, setOrdersDateRange, applyOrdersDateRange, () => setShowOrdersDateRange(false))}
                </div>
                <select
                  className="!min-h-0 h-9 px-3 border border-gray-200 rounded-lg bg-white text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#1A6FBF]"
                  aria-label="Currency"
                  value={currency}
                  onChange={(event) => { const c = event.target.value as CurrencyCode; setCurrency(c); showToast(`Currency changed to ${currencies[c].label}.`); }}
                >
                  <option value="NGN">₦ Naira</option>
                  <option value="USD">$ Dollar</option>
                  <option value="GBP">£ Pound</option>
                </select>
              </div>

              {/* Active filter context pill */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-50 border border-blue-100 text-xs font-semibold text-[#1A6FBF]">
                  <CalendarDays className="w-3 h-3" /> {selectedOrdersPeriodLabel}
                </span>
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-gray-100 border border-gray-200 text-xs font-semibold text-gray-600">
                  {currency} · {selectedCurrency.label}
                </span>
                <span className="text-xs text-gray-400">· All amounts in this currency</span>
              </div>

              {/* Metric cards */}
              <section className="grid grid-cols-2 lg:grid-cols-4 gap-4" aria-label="Orders summary">
                {[
                  { label: "Total Orders", value: periodOrders.length, sub: "this period", icon: BookOpen, color: "bg-blue-50 text-blue-500" },
                  { label: "Delivery Rate", value: `${ordersDeliveryRate}%`, sub: "of orders delivered", icon: Truck, color: "bg-green-50 text-green-500" },
                  { label: "Revenue", value: formatMoney(ordersRevenue), sub: "delivered orders only", icon: CircleDollarSign, color: "bg-purple-50 text-purple-500" },
                  { label: "Pending", value: periodOrders.filter((o) => o.status === "In Process" || o.status === "Confirmed").length, sub: "awaiting delivery", icon: Clock, color: "bg-amber-50 text-amber-500" },
                ].map(({ label, value, sub, icon: Icon, color }) => (
                  <article key={label} className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm hover:shadow-md transition-shadow">
                    <span className={`w-10 h-10 rounded-full flex items-center justify-center mb-3 ${color}`}><Icon className="w-5 h-5" /></span>
                    <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{label}</h2>
                    <strong className="text-2xl font-bold text-gray-900 block my-1">{value}</strong>
                    <p className="text-[10px] text-gray-400 font-medium">{sub}</p>
                  </article>
                ))}
              </section>

              {/* Two-column insight row */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

                {/* Orders by Product */}
                <section className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                  <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100">
                    <span className="w-8 h-8 rounded-lg bg-blue-50 text-[#1A6FBF] flex items-center justify-center shrink-0"><BookOpen className="w-4 h-4" /></span>
                    <div>
                      <h2 className="text-sm font-bold text-gray-900">Orders by Product</h2>
                      <p className="text-xs text-gray-400">All statuses · {selectedOrdersPeriodLabel}</p>
                    </div>
                  </div>
                  {ordersByProduct.length === 0 ? (
                    <div className="px-5 py-10 text-center text-sm text-gray-400">No orders in this period.</div>
                  ) : (
                    <div className="divide-y divide-gray-100">
                      {ordersByProduct.map(([productName, item]) => (
                        <div key={productName} className="flex items-center justify-between px-5 py-3 hover:bg-gray-50 transition-colors">
                          <span className="text-sm font-semibold text-gray-800">{productName}</span>
                          <div className="text-right">
                            <span className="text-sm font-bold text-gray-900">{formatMoney(item.revenue)}</span>
                            <span className="text-xs text-gray-400 block">{item.count} order{item.count === 1 ? "" : "s"}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                {/* Revenue Opportunity */}
                <section className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 flex flex-col gap-4">
                  <div className="flex items-start gap-3">
                    <span className="w-8 h-8 rounded-lg bg-purple-50 text-purple-500 flex items-center justify-center shrink-0"><TrendingUp className="w-4 h-4" /></span>
                    <div>
                      <h2 className="text-sm font-bold text-gray-900">Revenue Opportunity</h2>
                      <p className="text-xs text-gray-400">Model the impact of a higher delivery conversion rate.</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1 p-3 bg-gray-50 rounded-lg border border-gray-100">
                      <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Current rate</span>
                      <strong className="text-xl font-bold text-gray-900">{ordersDeliveryRateExact.toFixed(1)}%</strong>
                    </div>
                    <div className="flex flex-col gap-1 p-3 bg-gray-50 rounded-lg border border-gray-100">
                      <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Current revenue</span>
                      <strong className="text-xl font-bold text-gray-900">{formatMoney(ordersRevenue)}</strong>
                    </div>
                  </div>
                  <label className="flex flex-col gap-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-gray-600">Conversion lift</span>
                      <span className="font-bold text-[#1A6FBF]">+{ordersConversion}pp → {ordersTargetConversion.toFixed(1)}%</span>
                    </div>
                    <input type="range" className="w-full accent-[#1A6FBF]" min="0" max={ordersConversionLiftMax} value={ordersConversion} onChange={(e) => setOrdersConversion(Number(e.target.value))} />
                    <div className="flex items-center gap-1.5">
                      {[10, 20, 30, 100].map((rate) => (
                        <button key={rate} className="!min-h-0 px-2.5 py-1 text-[10px] font-bold border border-gray-200 bg-white text-gray-600 rounded-md hover:bg-gray-50 hover:border-[#1A6FBF] hover:text-[#1A6FBF] transition-colors" onClick={() => setOrdersConversion(Math.min(rate, ordersConversionLiftMax))}>
                          {rate === 100 ? "Max" : `+${rate}pp`}
                        </button>
                      ))}
                    </div>
                  </label>
                  <div className="flex items-center justify-between pt-3 border-t border-gray-100">
                    <span className="text-xs font-medium text-gray-500">Projected revenue</span>
                    <strong className="text-lg font-bold text-[#1A6FBF]">{projectedOrdersRevenue}</strong>
                  </div>
                </section>
              </div>

              {/* Orders table */}
              <section className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden" aria-label="Orders table">
                {/* Toolbar */}
                <div className="flex flex-wrap items-center gap-3 px-5 py-4 border-b border-gray-100">
                  <label className="relative flex items-center flex-1 min-w-[180px]">
                    <Search className="absolute left-3 w-4 h-4 text-gray-400 pointer-events-none" />
                    <span className="sr-only">Search orders</span>
                    <input
                      className="w-full pl-9 pr-4 h-9 border border-gray-200 rounded-lg text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[#1A6FBF] focus:bg-white transition-colors"
                      value={orderSearch}
                      onChange={(e) => setOrderSearch(e.target.value)}
                      placeholder="Order #, name, phone…"
                    />
                  </label>
                  <select className="!min-h-0 h-9 px-3 border border-gray-200 rounded-lg bg-white text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#1A6FBF]" aria-label="Order status" value={orderStatus} onChange={(e) => { setOrderStatus(e.target.value as OrderStatus); showToast(`Status: ${e.target.value}`); }}>
                    {orderStatuses.map((s) => <option key={s}>{s}</option>)}
                  </select>
                  <select className="!min-h-0 h-9 px-3 border border-gray-200 rounded-lg bg-white text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#1A6FBF]" aria-label="Order source" value={orderSource} onChange={(e) => { setOrderSource(e.target.value as OrderSource); showToast(`Source: ${e.target.value}`); }}>
                    {orderSources.map((s) => <option key={s}>{s}</option>)}
                  </select>
                  <select className="!min-h-0 h-9 px-3 border border-gray-200 rounded-lg bg-white text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#1A6FBF]" aria-label="Order location" value={orderLocation} onChange={(e) => { setOrderLocation(e.target.value as OrderLocation); showToast(`Location: ${e.target.value}`); }}>
                    {orderLocations.map((l) => <option key={l}>{l}</option>)}
                  </select>
                </div>

                {/* Bulk action bar */}
                {selectedOrderIds.size > 0 && (
                  <div className="flex items-center gap-3 px-5 py-2 bg-blue-50 border-b border-blue-100 text-sm">
                    <span className="font-semibold text-blue-800">{selectedOrderIds.size} selected</span>
                    <span className="text-blue-300">·</span>
                    <span className="text-blue-700 font-medium">Mark as:</span>
                    {(["Confirmed","In Process","Dispatched","Delivered","Postponed","Cancelled"] as const).map((s) => (
                      <button key={s} onClick={() => bulkUpdateOrderStatus(s)} className="!min-h-0 px-2.5 py-1 text-xs font-semibold border border-blue-200 bg-white text-blue-700 rounded-md hover:bg-blue-600 hover:text-white hover:border-blue-600 transition-colors">{s}</button>
                    ))}
                    <button onClick={() => setSelectedOrderIds(new Set())} className="!min-h-0 ml-auto px-2.5 py-1 text-xs font-semibold text-gray-500 hover:text-gray-700 transition-colors">Clear</button>
                  </div>
                )}

                {/* Table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200 text-left">
                        <th className="px-4 py-3 w-8">
                          <input
                            type="checkbox"
                            className="rounded border-gray-300"
                            checked={pagedOrderRows.length > 0 && pagedOrderRows.every((o) => selectedOrderIds.has(o.id))}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedOrderIds((prev) => new Set([...prev, ...pagedOrderRows.map((o) => o.id)]));
                              } else {
                                setSelectedOrderIds((prev) => {
                                  const next = new Set(prev);
                                  pagedOrderRows.forEach((o) => next.delete(o.id));
                                  return next;
                                });
                              }
                            }}
                          />
                        </th>
                        {["Order","Customer","Product","Rep / Agent","Source","Status","Location","Actions"].map((h) => (
                          <th key={h} className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {filteredOrderRows.length === 0 ? (
                        <tr><td colSpan={9} className="px-4 py-12 text-center text-sm text-gray-400">No orders found</td></tr>
                      ) : (
                        pagedOrderRows.map((order) => {
                          const source = order.source ?? orderSourceFromUtm(order.utmSource);
                          const status = order.status ?? "New";
                          const location = order.location ?? orderLocationFromFields(order.city ?? "", order.state ?? "");
                          return (
                            <tr key={order.id} className={`hover:bg-gray-50 transition-colors ${selectedOrderIds.has(order.id) ? "bg-blue-50" : ""}`}>
                              <td className="px-4 py-3.5 w-8">
                                <input
                                  type="checkbox"
                                  className="rounded border-gray-300"
                                  checked={selectedOrderIds.has(order.id)}
                                  onChange={(e) => {
                                    setSelectedOrderIds((prev) => {
                                      const next = new Set(prev);
                                      if (e.target.checked) next.add(order.id); else next.delete(order.id);
                                      return next;
                                    });
                                  }}
                                />
                              </td>
                              <td className="px-4 py-3.5 whitespace-nowrap">
                                <div className="font-bold text-[#1A6FBF] text-xs">{order.id}</div>
                                <div className="text-[10px] text-gray-400 mt-0.5">{order.date}</div>
                              </td>
                              <td className="px-4 py-3.5">
                                <div className="font-semibold text-gray-900 text-sm">{order.customer}</div>
                                <div className="text-xs text-gray-400 mt-0.5">{order.phone}</div>
                              </td>
                              <td className="px-4 py-3.5">
                                <div className="font-semibold text-gray-900 text-sm">{order.productName}</div>
                                <div className="text-xs text-gray-400 mt-0.5">{order.packageName} · Qty {quantityForOrder(order)} · {formatProductMoney(order.amount, order.currency)}</div>
                              </td>
                              <td className="px-4 py-3.5">
                                <div className="font-semibold text-gray-900 text-sm">{users.find((u) => u.id === order.assignedRepId)?.name ?? "Unassigned"}</div>
                                <div className="text-xs text-gray-400 mt-0.5">{agentNameForOrder(order)}</div>
                              </td>
                              <td className="px-4 py-3.5">
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-gray-100 text-gray-600">{source}</span>
                              </td>
                              <td className="px-4 py-3.5">
                                <span className={`status-pill status-${slugify(status)}`}>{status}</span>
                                <div className="text-[10px] text-gray-400 mt-0.5">{order.response ?? "Awaiting confirmation"}</div>
                                {order.callOutcome && <span className={`inline-block mt-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold ${order.callOutcome === "Confirmed" ? "bg-green-100 text-green-700" : order.callOutcome === "Refused" ? "bg-red-100 text-red-700" : order.callOutcome === "No Answer" || order.callOutcome === "Not Reached" ? "bg-gray-100 text-gray-500" : "bg-amber-100 text-amber-700"}`}>{order.callOutcome}</span>}
                              </td>
                              <td className="px-4 py-3.5 text-xs text-gray-600 whitespace-nowrap">{location}</td>
                              <td className="px-4 py-3.5">
                                <div className="flex items-center gap-1">
                                  <button className="!min-h-0 p-1.5 text-gray-400 hover:text-[#25D366] rounded-md hover:bg-green-50 transition-colors" title="Open WhatsApp" onClick={() => { const phone = (order.whatsapp || order.phone).replace(/\D/g, ""); window.open(`https://wa.me/${phone}`, "_blank", "noopener,noreferrer"); }}><svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-current" aria-hidden="true"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z"/></svg></button>
                                  <button className="!min-h-0 inline-flex items-center gap-1 px-2 py-1 text-[10px] font-semibold border border-gray-200 bg-white text-gray-700 rounded-md hover:bg-gray-50 transition-colors whitespace-nowrap" onClick={() => openAdminOrderDetailPage(order)}><Eye className="w-3 h-3" /> Details</button>
                                  <button className="!min-h-0 p-1.5 text-gray-400 hover:text-blue-600 rounded-md hover:bg-blue-50 transition-colors" title="Schedule delivery" onClick={() => openOrderModal(order, "scheduleOrder")}><CalendarClock className="w-3.5 h-3.5" /></button>
                                  <button className="!min-h-0 p-1.5 text-gray-400 hover:text-gray-700 rounded-md hover:bg-gray-100 transition-colors" title="Edit" onClick={() => openOrderModal(order, "editOrderItems")}><Pencil className="w-3.5 h-3.5" /></button>
                                  <button className="!min-h-0 p-1.5 text-red-400 hover:text-red-600 rounded-md hover:bg-red-50 transition-colors" title="Delete" onClick={() => openOrderModal(order, "deleteOrder")}><Trash2 className="w-3.5 h-3.5" /></button>
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Pagination */}
                <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 bg-gray-50 text-xs text-gray-500">
                  <span>
                    {filteredOrderRows.length === 0
                      ? "0 orders"
                      : `${(ordersPageClamped - 1) * ORDERS_PAGE_SIZE + 1}–${Math.min(ordersPageClamped * ORDERS_PAGE_SIZE, filteredOrderRows.length)} of ${filteredOrderRows.length} order${filteredOrderRows.length === 1 ? "" : "s"}`}
                  </span>
                  {ordersTotalPages > 1 && (
                    <div className="flex items-center gap-1">
                      <button
                        className="!min-h-0 px-2.5 py-1 rounded-md border border-gray-200 bg-white text-gray-600 hover:bg-gray-100 disabled:opacity-40 disabled:pointer-events-none transition-colors"
                        disabled={ordersPageClamped <= 1}
                        onClick={() => setOrdersPage((p) => Math.max(1, p - 1))}
                      >
                        ‹ Prev
                      </button>
                      {Array.from({ length: ordersTotalPages }, (_, i) => i + 1)
                        .filter((p) => p === 1 || p === ordersTotalPages || Math.abs(p - ordersPageClamped) <= 1)
                        .reduce<(number | "…")[]>((acc, p, idx, arr) => {
                          if (idx > 0 && typeof arr[idx - 1] === "number" && (p as number) - (arr[idx - 1] as number) > 1) acc.push("…");
                          acc.push(p);
                          return acc;
                        }, [])
                        .map((p, idx) =>
                          p === "…"
                            ? <span key={`ellipsis-${idx}`} className="px-1 text-gray-400 select-none">…</span>
                            : <button
                                key={p}
                                className={`!min-h-0 w-7 h-7 rounded-md border text-xs font-semibold transition-colors ${ordersPageClamped === p ? "border-[#1A6FBF] bg-[#1A6FBF] text-white" : "border-gray-200 bg-white text-gray-600 hover:bg-gray-100"}`}
                                onClick={() => setOrdersPage(p as number)}
                              >{p}</button>
                        )}
                      <button
                        className="!min-h-0 px-2.5 py-1 rounded-md border border-gray-200 bg-white text-gray-600 hover:bg-gray-100 disabled:opacity-40 disabled:pointer-events-none transition-colors"
                        disabled={ordersPageClamped >= ordersTotalPages}
                        onClick={() => setOrdersPage((p) => Math.min(ordersTotalPages, p + 1))}
                      >
                        Next ›
                      </button>
                    </div>
                  )}
                </div>
              </section>
            </div>
          ) : activePage === "Abandoned Carts" ? (
            <>
              <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-6">
                <div className="flex flex-col gap-1">
                  <h1 className="text-2xl font-bold text-[#1A6FBF]">Abandoned Carts</h1>
                  <p className="text-sm font-medium text-gray-500">Track captured carts, monitor rep follow-up, and reassign leads when needed.</p>
                </div>
              </header>

              <section className="grid grid-cols-2 lg:grid-cols-4 gap-4" aria-label="Abandoned carts summary">
                {[
                  { label: "Open Carts", value: abandonedCarts.filter((cart) => ["Open abandoned", "Abandoned", "In progress"].includes(cart.status)).length, icon: ShoppingCart },
                  { label: "Assigned", value: assignedCartCount, icon: UserRound },
                  { label: "Contacted", value: contactedCartCount, icon: BadgeCheck },
                  { label: "Conversion Rate", value: `${cartConversionRate}%`, sub: `${convertedCartCount} converted · ${lostCartCount} lost`, icon: TrendingUp },
                ].map(({ label, value, sub, icon: Icon }) => (
                  <article key={label} className="bg-white rounded-xl border border-gray-200 p-5 flex items-center justify-between shadow-sm">
                    <div className="flex flex-col gap-1">
                      <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{label}</span>
                      <strong className="text-3xl font-bold text-gray-900">{value}</strong>
                      {sub && <span className="text-xs text-gray-400">{sub}</span>}
                    </div>
                    <span className="w-10 h-10 rounded-full bg-cyan-50 border border-cyan-100 flex items-center justify-center text-cyan-500 shrink-0">
                      <Icon className="w-5 h-5" />
                    </span>
                  </article>
                ))}
              </section>

              <section className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden" aria-label="Captured abandoned carts">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-4 border-b border-gray-200">
                  <h2 className="text-base font-bold text-gray-900 m-0">Captured abandoned carts</h2>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="relative flex items-center">
                      <Search className="absolute left-3 w-4 h-4 text-gray-400 pointer-events-none" />
                      <span className="sr-only">Search abandoned carts</span>
                      <input
                        className="pl-9 pr-4 h-9 border border-gray-200 rounded-md text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[#1A6FBF] focus:bg-white w-56 transition-colors"
                        value={cartSearch}
                        onChange={(event) => setCartSearch(event.target.value)}
                        placeholder="Search customer, phone, cart..."
                      />
                    </label>
                    <button
                      className="inline-flex items-center px-3 py-2 text-sm font-medium border border-gray-200 bg-white text-gray-700 rounded-md hover:bg-gray-50 transition-colors"
                      onClick={() => showToast(cartSearch ? `${filteredAbandonedCarts.length} cart${filteredAbandonedCarts.length === 1 ? "" : "s"} found for "${cartSearch}".` : `Showing all ${filteredAbandonedCarts.length} carts.`)}
                    >
                      Search
                    </button>
                    <select
                      className="h-9 px-3 border border-gray-200 rounded-md bg-white text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#1A6FBF]"
                      aria-label="Abandoned cart status"
                      value={cartStatus}
                      onChange={(event) => {
                        setCartStatus(event.target.value as CartStatus);
                        showToast(`Abandoned cart status set to ${event.target.value}.`);
                      }}
                    >
                      {cartStatuses.map((status) => <option key={status}>{status}</option>)}
                    </select>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs font-semibold text-gray-500 uppercase tracking-wide bg-gray-50 border-b border-gray-200">
                        <th className="px-4 py-3 text-left">Cart</th>
                        <th className="px-4 py-3 text-left">Customer</th>
                        <th className="px-4 py-3 text-left">Product</th>
                        <th className="px-4 py-3 text-left">Rep</th>
                        <th className="px-4 py-3 text-left">Source</th>
                        <th className="px-4 py-3 text-left">Status</th>
                        <th className="px-4 py-3 text-left">Last Activity</th>
                        <th className="px-4 py-3 text-left">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {filteredAbandonedCarts.length === 0 ? (
                        <tr><td colSpan={8} className="px-4 py-10 text-center text-sm text-gray-400">No carts found</td></tr>
                      ) : (
                        filteredAbandonedCarts.map((cart) => (
                          <tr key={cart.id} className="hover:bg-gray-50 transition-colors">
                            <td className="px-4 py-3 font-semibold text-[#1A6FBF]">{cart.id}</td>
                            <td className="px-4 py-3">
                              <div className="font-medium text-gray-900">{cart.customer}</div>
                              <div className="text-xs text-gray-400">{cart.phone}</div>
                            </td>
                            <td className="px-4 py-3">
                              <div className="font-medium text-gray-900">{cart.productName}</div>
                              <div className="text-xs text-gray-400">{cart.packageName} · {formatProductMoney(cart.amount, cart.currency)}</div>
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-700">{users.find((user) => user.id === cart.assignedRepId)?.name ?? "Unassigned"}</td>
                            <td className="px-4 py-3 text-sm text-gray-600">{cart.source}</td>
                            <td className="px-4 py-3"><span className={`status-pill status-${slugify(cart.status)}`}>{cart.status}</span></td>
                            <td className="px-4 py-3 text-sm text-gray-500">{displayDateFromKey(cart.createdAt)}</td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-1 flex-wrap">
                                <button className="p-1.5 text-gray-400 hover:text-gray-700 rounded hover:bg-gray-100 transition-colors" title="Details" aria-label="Details" onClick={() => openCartModal(cart, "cartDetails")}><Eye className="w-4 h-4" /></button>
                                <button className="p-1.5 text-gray-400 hover:text-gray-700 rounded hover:bg-gray-100 transition-colors" title="Assign" aria-label="Assign" onClick={() => openCartModal(cart, "assignCart")}><UserPlus className="w-4 h-4" /></button>
                                <button className="px-2 py-1 text-xs font-medium border border-gray-200 bg-white text-gray-700 rounded hover:bg-gray-50 transition-colors disabled:opacity-40" disabled={cart.status === "Converted"} onClick={() => updateCartStatus(cart.id, "Contacted")}>Contacted</button>
                                <button className="px-2 py-1 text-xs font-medium border border-gray-200 bg-white text-gray-700 rounded hover:bg-gray-50 transition-colors disabled:opacity-40" disabled={cart.status === "Converted"} onClick={() => updateCartStatus(cart.id, "No response")}>No Response</button>
                                <button className="px-2 py-1 text-xs font-medium border border-red-100 bg-red-50 text-red-600 rounded hover:bg-red-100 transition-colors disabled:opacity-40" disabled={cart.status === "Converted"} onClick={() => updateCartStatus(cart.id, "Not interested")}>Not Interested</button>
                                <button className="p-1.5 text-[#1A6FBF] hover:text-blue-700 rounded hover:bg-blue-50 transition-colors disabled:opacity-40" title="Convert" aria-label="Convert" disabled={cart.status === "Converted"} onClick={() => openCartModal(cart, "convertCart")}><ArrowRight className="w-4 h-4" /></button>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          ) : activePage === "Scheduled Deliveries" ? (
            <div className="space-y-6">
              <header className="space-y-1">
                <h1 className="text-2xl font-bold text-[#1A6FBF]">Scheduled Deliveries</h1>
                <p className="text-sm font-medium text-gray-500">Orders sales reps have committed to deliver on a specific date. Defaults to today.</p>
              </header>

              <section className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="flex flex-wrap items-center gap-2 p-4 border-b border-gray-200 bg-gray-50/50">
                  <div className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-xs font-bold text-[#1A6FBF] shadow-sm">
                    <CalendarDays className="w-4 h-4" /> {scheduleRange}
                  </div>
                  <div className="flex items-center gap-1 bg-gray-200/50 p-1 rounded-lg ml-auto">
                    {scheduleRanges.map((range) => (
                      <button
                        key={range}
                        className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${scheduleRange === range ? "bg-white text-[#1A6FBF] shadow-sm" : "text-gray-500 hover:text-gray-700 hover:bg-gray-200/50"}`}
                        onClick={() => {
                          setScheduleRange(range);
                          showToast(`Scheduled deliveries range set to ${range}.`);
                        }}
                      >
                        {range}
                      </button>
                    ))}
                  </div>
                </div>
                
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200 text-left">
                        <th className="px-4 py-3 font-semibold text-gray-500 uppercase text-[10px] tracking-wider">Order</th>
                        <th className="px-4 py-3 font-semibold text-gray-500 uppercase text-[10px] tracking-wider">Customer</th>
                        <th className="px-4 py-3 font-semibold text-gray-500 uppercase text-[10px] tracking-wider">Product</th>
                        <th className="px-4 py-3 font-semibold text-gray-500 uppercase text-[10px] tracking-wider">Rep / Agent</th>
                        <th className="px-4 py-3 font-semibold text-gray-500 uppercase text-[10px] tracking-wider">Status</th>
                        <th className="px-4 py-3 font-semibold text-gray-500 uppercase text-[10px] tracking-wider text-right">Scheduled</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {scheduledDeliveryRows.length === 0 ? (
                        <tr><td colSpan={6} className="px-4 py-12 text-center text-gray-400 font-medium italic">No scheduled deliveries in this range.</td></tr>
                      ) : (
                        scheduledDeliveryRows.map((order) => (
                          <tr key={order.id} className="hover:bg-gray-50 transition-colors">
                            <td className="px-4 py-4 font-bold text-gray-900">{order.id}</td>
                            <td className="px-4 py-4">
                              <div className="font-bold text-gray-900">{order.customer}</div>
                              <div className="text-xs text-gray-500">{order.phone}</div>
                            </td>
                            <td className="px-4 py-4">
                              <div className="font-medium text-gray-900">{order.productName}</div>
                              <div className="text-xs text-gray-400">{order.packageName}</div>
                            </td>
                            <td className="px-4 py-4">
                              <div className="font-medium text-gray-900">{users.find((user) => user.id === order.assignedRepId)?.name ?? "Unassigned"}</div>
                              <div className="text-xs text-gray-500 font-medium">{agentNameForOrder(order)}</div>
                            </td>
                            <td className="px-4 py-4">
                              <span className={`status-pill status-${slugify(order.status ?? "New")}`}>{order.status ?? "New"}</span>
                            </td>
                            <td className="px-4 py-4 text-right font-bold text-[#1A6FBF]">
                              {displayDateFromKey(order.scheduledDate)}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          ) : activePage === "Deliveries" ? (
            <div className="space-y-6">
              <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
                <div className="flex flex-col gap-1">
                  <h1 className="text-2xl font-bold text-[#1A6FBF]">Deliveries</h1>
                  <p className="text-sm font-medium text-gray-500">Orders fulfilled in the selected period, anchored to delivery date</p>
                </div>
              </header>

              <div className="flex flex-wrap items-center gap-3">
                <div className="inline-flex items-center bg-gray-100 p-1 rounded-lg">
                  {periods.map((item) => (
                    <button
                      className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${deliveriesPeriod === item ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-900"}`}
                      onClick={() => handleDeliveriesPeriodChange(item)}
                      key={item}
                    >
                      {item}
                    </button>
                  ))}
                </div>
                <div className="relative">
                  <button className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border border-gray-200 bg-white text-gray-700 rounded-md hover:bg-gray-50 transition-colors" onClick={() => setShowDeliveriesDateRange((value) => !value)}>
                    <CalendarDays className="w-4 h-4" /> {deliveriesPeriod === "Custom" ? "Edit date range" : "Pick a date range"}
                  </button>
                  {showDeliveriesDateRange && renderDateRangeCalendar("deliveries-date-range-panel", deliveriesDateRange, setDeliveriesDateRange, applyDeliveriesDateRange, () => setShowDeliveriesDateRange(false))}
                </div>
                <select className="h-9 px-3 border border-gray-200 rounded-md bg-white text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#1A6FBF] transition-colors" aria-label="Currency" value={currency} onChange={(event) => {
                  const nextCurrency = event.target.value as CurrencyCode;
                  setCurrency(nextCurrency);
                  showToast(`Currency changed to ${currencies[nextCurrency].label}.`);
                }}>
                  <option value="NGN">₦ Nigerian Naira</option>
                  <option value="USD">$ US Dollar</option>
                  <option value="GBP">£ British Pound</option>
                </select>
              </div>

              <section className="grid grid-cols-2 lg:grid-cols-4 gap-4" aria-label="Deliveries summary">
                {[
                  { title: "Total Delivered", value: String(deliveredInPeriodRows.length), helper: "orders fulfilled", icon: PackageCheck, tone: "green" },
                  { title: "Total Revenue", value: formatMoney(deliveredRevenueInPeriod), helper: "from delivered orders", icon: CircleDollarSign, tone: "blue" },
                  { title: "Avg Fulfillment", value: `${averageFulfillmentDays.toFixed(1)} days`, helper: "order to delivery", icon: Clock, tone: "orange" },
                  { title: "Avg Per Day", value: `${avgDeliveredPerDay.toFixed(1)} orders`, helper: "daily delivery rate", icon: TrendingUp, tone: "cyan" }
                ].map((metric) => {
                  const Icon = metric.icon;
                  return (
                    <article className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm hover:shadow-md transition-shadow" key={metric.title}>
                      <div className="flex items-center justify-between mb-3">
                        <span className={`w-10 h-10 rounded-full flex items-center justify-center ${metric.tone === "green" ? "bg-green-50 text-green-500" : metric.tone === "blue" ? "bg-blue-50 text-blue-500" : metric.tone === "orange" ? "bg-orange-50 text-orange-500" : "bg-cyan-50 text-cyan-500"}`}>
                          <Icon className="w-5 h-5" />
                        </span>
                      </div>
                      <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{metric.title}</h2>
                      <strong className="text-2xl font-bold text-gray-900 block my-1">{metric.value}</strong>
                      <p className="text-[10px] text-gray-400 font-medium">{metric.helper}</p>
                    </article>
                  );
                })}
              </section>

              <section className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="flex flex-wrap items-center gap-3 p-4 border-b border-gray-100">
                  <label className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 focus-within:ring-2 focus-within:ring-[#1A6FBF] flex-1 max-w-xs min-w-0">
                    <Search className="w-4 h-4 text-gray-400 shrink-0" />
                    <span className="sr-only">Search deliveries</span>
                    <input className="bg-transparent outline-none text-sm w-full min-w-0" value={deliverySearch} onChange={(event) => setDeliverySearch(event.target.value)} placeholder="Search customer or order #" />
                  </label>
                  <button className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border border-gray-200 bg-white text-gray-700 rounded-md hover:bg-gray-50 transition-colors" onClick={() => showToast(deliverySearch ? `${filteredDeliveryRows.length} deliver${filteredDeliveryRows.length === 1 ? "y" : "ies"} found for "${deliverySearch}".` : `Showing all ${filteredDeliveryRows.length} deliveries.`)}>Search</button>
                  <select className="h-9 px-3 border border-gray-200 rounded-md bg-white text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#1A6FBF] transition-colors" aria-label="Delivery agent" value={deliveryAgent} onChange={(event) => {
                    setDeliveryAgent(event.target.value as DeliveryAgent);
                    showToast(`Delivery agent filter set to ${event.target.value}.`);
                  }}>
                    {deliveryAgentOptions.map((agent) => <option key={agent}>{agent}</option>)}
                  </select>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200 text-left">
                        <th className="px-4 py-3 font-semibold text-gray-500 uppercase text-[10px] tracking-wider">Order #</th>
                        <th className="px-4 py-3 font-semibold text-gray-500 uppercase text-[10px] tracking-wider">Customer</th>
                        <th className="px-4 py-3 font-semibold text-gray-500 uppercase text-[10px] tracking-wider">Products</th>
                        <th className="px-4 py-3 font-semibold text-gray-500 uppercase text-[10px] tracking-wider">Location</th>
                        <th className="px-4 py-3 font-semibold text-gray-500 uppercase text-[10px] tracking-wider">Agent</th>
                        <th className="px-4 py-3 font-semibold text-gray-500 uppercase text-[10px] tracking-wider">Delivered</th>
                        <th className="px-4 py-3 font-semibold text-gray-500 uppercase text-[10px] tracking-wider">Fulfillment</th>
                        <th className="px-4 py-3 font-semibold text-gray-500 uppercase text-[10px] tracking-wider">Revenue</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {filteredDeliveryRows.length === 0 ? (
                        <tr><td colSpan={8} className="px-4 py-12 text-center text-gray-400 font-medium italic">No deliveries found for this period</td></tr>
                      ) : (
                        filteredDeliveryRows.map((order) => (
                          <tr key={order.id} className="hover:bg-gray-50 transition-colors">
                            <td className="px-4 py-4 font-bold text-gray-900">{order.id}</td>
                            <td className="px-4 py-4">
                              <div className="font-bold text-gray-900">{order.customer}</div>
                              <div className="text-xs text-gray-500">{order.phone}</div>
                            </td>
                            <td className="px-4 py-4">
                              <div className="font-medium text-gray-900">{order.productName}</div>
                              <div className="text-xs text-gray-400">{order.packageName} · Qty {quantityForOrder(order)}</div>
                            </td>
                            <td className="px-4 py-4 text-gray-700">{order.location ?? orderLocationFromFields(order.city ?? "", order.state ?? "")}</td>
                            <td className="px-4 py-4 text-gray-700">{agentNameForOrder(order)}</td>
                            <td className="px-4 py-4 text-gray-700">{displayDateFromKey(order.deliveredDate)}</td>
                            <td className="px-4 py-4 font-medium text-gray-900">{fulfillmentDaysForOrder(order).toFixed(1)} days</td>
                            <td className="px-4 py-4 font-bold text-[#1A6FBF]">{formatProductMoney(order.amount, order.currency)}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 text-xs text-gray-500">
                  <span>{filteredDeliveryRows.length} deliver{filteredDeliveryRows.length === 1 ? "y" : "ies"}</span>
                  <div className="flex items-center gap-1">
                    
                    
                  </div>
                </div>
              </section>
            </div>
          ) : activePage === "Sales Reps" ? (
            <div className="space-y-6">
              <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
                <div className="flex flex-col gap-1">
                  <h1 className="text-2xl font-bold text-[#1A6FBF]">Sales Representatives</h1>
                  <p className="text-sm font-medium text-gray-500">Manage and monitor your sales team performance</p>
                </div>
                <button className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-[#1A6FBF] text-white rounded-md hover:bg-blue-700 transition-colors" onClick={() => setModal("addSalesRep")}>
                  <Plus className="w-4 h-4" /> Add Sales Rep
                </button>
              </header>

              <div className="flex flex-wrap items-center gap-3">
                <div className="inline-flex items-center bg-gray-100 p-1 rounded-lg">
                  {periods.map((item) => (
                    <button
                      className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${salesPeriod === item ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-900"}`}
                      onClick={() => handleSalesPeriodChange(item)}
                      key={item}
                    >
                      {item}
                    </button>
                  ))}
                </div>
                <div className="relative">
                  <button className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border border-gray-200 bg-white text-gray-700 rounded-md hover:bg-gray-50 transition-colors" onClick={() => setShowSalesDateRange((value) => !value)}>
                    <CalendarDays className="w-4 h-4" /> {salesPeriod === "Custom" ? "Edit date range" : "Pick a date range"}
                  </button>
                  {showSalesDateRange && renderDateRangeCalendar("sales-date-range-panel", salesDateRange, setSalesDateRange, applySalesDateRange, () => setShowSalesDateRange(false))}
                </div>
              </div>

              <section className="grid grid-cols-2 lg:grid-cols-4 gap-4" aria-label="Sales representatives summary">
                {[
                  { title: "Total Reps", value: String(salesRepUsers.length), helper: "team members", icon: UserRound, tone: "blue" },
                  { title: "Active Reps", value: String(activeSalesRepUsers.length), helper: "round-robin eligible", icon: CheckCircle2, tone: "green" },
                  { title: "Total Orders", value: String(totalSalesRepOrders), helper: selectedSalesPeriodLabel, icon: ShoppingCart, tone: "orange" },
                  { title: "Avg Conversion", value: `${avgSalesConversion}%`, helper: selectedSalesPeriodLabel, icon: TrendingUp, tone: "blue" }
                ].map((metric) => {
                  const Icon = metric.icon;
                  return (
                    <article className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm hover:shadow-md transition-shadow" key={metric.title}>
                      <div className="flex items-center justify-between mb-2">
                        <span className={`w-10 h-10 rounded-full flex items-center justify-center ${metric.tone === "blue" ? "bg-blue-50 text-blue-500" : metric.tone === "green" ? "bg-green-50 text-green-500" : "bg-orange-50 text-orange-500"}`}>
                          <Icon className="w-5 h-5" />
                        </span>
                      </div>
                      <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{metric.title}</h2>
                      <strong className="text-2xl font-bold text-gray-900 block my-1">{metric.value}</strong>
                      <p className="text-[10px] text-gray-400 font-medium">{metric.helper}</p>
                    </article>
                  );
                })}
              </section>

              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
                <h2 className="text-sm font-bold text-gray-700 mb-3">Performance Leaderboard (Top 5)</h2>
                <div className="flex flex-col gap-2">
                  {[...salesRepRows].sort((a, b) => b.revenue - a.revenue).slice(0, 5).map((row, idx) => (
                    <div key={row.user.id} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                      <div className="flex items-center gap-3">
                        <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${idx === 0 ? "bg-yellow-100 text-yellow-700" : idx === 1 ? "bg-gray-100 text-gray-600" : idx === 2 ? "bg-orange-100 text-orange-700" : "bg-gray-50 text-gray-400"}`}>{idx + 1}</span>
                        <span className="text-sm font-semibold text-gray-900">{row.user.name}</span>
                      </div>
                      <span className="text-sm font-bold text-[#1A6FBF]">{formatMoney(row.revenue)}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm focus-within:ring-2 focus-within:ring-[#1A6FBF] flex-1 max-w-xs min-w-0">
                  <Search className="w-4 h-4 text-gray-400 shrink-0" />
                  <span className="sr-only">Search sales representatives</span>
                  <input className="bg-transparent outline-none text-sm w-full min-w-0" value={salesSearch} onChange={(event) => setSalesSearch(event.target.value)} placeholder="Search by name, email..." />
                </label>
                <select className="h-9 px-3 border border-gray-200 rounded-md bg-white text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#1A6FBF] transition-colors" aria-label="Sales rep status" value={salesStatus} onChange={(event) => {
                  setSalesStatus(event.target.value as RepStatus);
                  showToast(`Sales rep status filter set to ${event.target.value}.`);
                }}>
                  {repStatuses.map((status) => <option key={status}>{status}</option>)}
                </select>
              </div>

              <section className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden" aria-label="Sales representatives table">
                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                  <h2 className="text-sm font-bold text-gray-800">All Sales Representatives</h2>
                  <button className="w-8 h-8 flex items-center justify-center rounded-md border border-gray-200 bg-gray-50 text-gray-500 hover:bg-gray-100 transition-colors" title="Refresh" aria-label="Refresh sales representatives" onClick={() => showToast("Sales representatives refreshed.")}><RefreshCw className="w-4 h-4" /></button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200 text-left">
                        <th className="px-4 py-3 font-semibold text-gray-500 uppercase text-[10px] tracking-wider">Name</th>
                        <th className="px-4 py-3 font-semibold text-gray-500 uppercase text-[10px] tracking-wider">Email</th>
                        <th className="px-4 py-3 font-semibold text-gray-500 uppercase text-[10px] tracking-wider">Role</th>
                        <th className="px-4 py-3 font-semibold text-gray-500 uppercase text-[10px] tracking-wider">Status</th>
                        <th className="px-4 py-3 font-semibold text-gray-500 uppercase text-[10px] tracking-wider">Orders</th>
                        <th className="px-4 py-3 font-semibold text-gray-500 uppercase text-[10px] tracking-wider">Delivered</th>
                        <th className="px-4 py-3 font-semibold text-gray-500 uppercase text-[10px] tracking-wider">Conversion</th>
                        <th className="px-4 py-3 font-semibold text-gray-500 uppercase text-[10px] tracking-wider">Revenue</th>
                        <th className="px-4 py-3 font-semibold text-gray-500 uppercase text-[10px] tracking-wider">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {filteredSalesRepRows.length === 0 ? (
                        <tr><td colSpan={9} className="px-4 py-12 text-center text-gray-400 font-medium italic">No sales representatives found</td></tr>
                      ) : (
                        filteredSalesRepRows.map((row) => (
                          <tr key={row.user.id} className="hover:bg-gray-50 transition-colors">
                            <td className="px-4 py-4 font-bold text-gray-900">{row.user.name}</td>
                            <td className="px-4 py-4 text-gray-600">{row.user.email}</td>
                            <td className="px-4 py-4"><span className="role-pill">{row.user.role}</span></td>
                            <td className="px-4 py-4"><span className={`status-pill status-${row.user.active ? "active" : "inactive"}`}>{row.user.active ? "Active" : "Inactive"}</span></td>
                            <td className="px-4 py-4 text-gray-700">{row.orders}</td>
                            <td className="px-4 py-4 text-gray-700">{row.delivered}</td>
                            <td className="px-4 py-4 font-semibold text-gray-900">{row.conversion}%</td>
                            <td className="px-4 py-4 font-bold text-[#1A6FBF]">{formatMoney(row.revenue)}</td>
                            <td className="px-4 py-4">
                              <div className="flex items-center gap-1">
                                <button className="w-8 h-8 flex items-center justify-center rounded border border-gray-200 text-gray-500 hover:bg-gray-100 transition-colors" title="View" aria-label="View" onClick={() => { setSelectedSalesRepId(row.user.id); setModal("salesRepDetails"); }}><Eye className="w-4 h-4" /></button>
                                <button className="w-8 h-8 flex items-center justify-center rounded border border-gray-200 text-gray-500 hover:bg-gray-100 transition-colors" title="Edit" aria-label="Edit" onClick={() => { setSelectedSalesRepId(row.user.id); setSalesRepName(row.user.name); setSalesRepEmail(row.user.email); setSalesRepActive(row.user.active); setModal("editSalesRep"); }}><Pencil className="w-4 h-4" /></button>
                                <button className="w-8 h-8 flex items-center justify-center rounded border border-gray-200 text-gray-500 hover:bg-gray-100 transition-colors" title="Toggle active" aria-label="Toggle active" onClick={() => { setUsers((value) => value.map((user) => user.id === row.user.id ? { ...user, active: !user.active } : user)); showToast(`${row.user.name} status updated.`); }}><RefreshCw className="w-4 h-4" /></button>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 text-xs text-gray-500">
                  <span>{filteredSalesRepRows.length} Sales Rep{filteredSalesRepRows.length === 1 ? "" : "s"}</span>
                  <div className="flex items-center gap-1">
                    
                    
                  </div>
                </div>
              </section>
            </div>
          ) : activePage === "Sales Teams" ? (
            <div className="space-y-6">
              <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
                <div className="flex flex-col gap-1">
                  <h1 className="text-2xl font-bold text-[#1A6FBF]">Sales Teams</h1>
                  <p className="text-sm font-medium text-gray-500">Group reps, assign team leads, and scope products to the team responsible for selling them.</p>
                </div>
                <button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-[#1A6FBF] text-white rounded-lg hover:bg-[#1560a8] transition-colors" onClick={() => { setNewTeamName(""); setNewTeamLeadId(""); setModal("createTeam"); }}>
                  <Plus className="w-4 h-4" /> Create Team
                </button>
              </header>

              <section className="grid grid-cols-2 lg:grid-cols-4 gap-4" aria-label="Sales teams summary">
                {[
                  { label: "Total Teams", value: salesTeams.length, helper: "active selling groups", icon: Users, tone: "blue" },
                  { label: "Assigned Reps", value: salesRepUsers.length, helper: "mapped to a team", icon: UserRound, tone: "green" },
                  { label: "Scoped Products", value: products.filter((p) => productTeamScope(p).length > 0).length, helper: "product-team links", icon: PackageCheck, tone: "orange" },
                  { label: "All-Team Products", value: products.filter((p) => productTeamScope(p).length === 0).length, helper: "visible to every rep", icon: Boxes, tone: "purple" },
                ].map(({ label, value, helper, icon: Icon, tone }) => (
                  <article key={label} className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm hover:shadow-md transition-shadow">
                    <div className="flex items-center justify-between mb-2">
                      <span className={`w-10 h-10 rounded-full flex items-center justify-center ${tone === "blue" ? "bg-blue-50 text-blue-500" : tone === "green" ? "bg-green-50 text-green-500" : tone === "orange" ? "bg-orange-50 text-orange-500" : "bg-purple-50 text-purple-500"}`}>
                        <Icon className="w-5 h-5" />
                      </span>
                    </div>
                    <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{label}</h2>
                    <strong className="text-2xl font-bold text-gray-900 block my-1">{value}</strong>
                    <p className="text-[10px] text-gray-400 font-medium">{helper}</p>
                  </article>
                ))}
              </section>

              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-sm font-bold text-gray-800">Team Configuration</h2>
                  <button className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-gray-200 bg-gray-50 text-gray-600 rounded-md hover:bg-gray-100 transition-colors" onClick={() => showToast("Team creation will save name, lead, members, and product scope.")}><Info className="w-3.5 h-3.5" /> Workflow</button>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  {[
                    { label: "Team Name", value: salesTeams[0]?.name ?? "No teams yet" },
                    { label: "Team Lead", value: users.find((user) => user.id === salesTeams[0]?.leadId)?.name ?? "Unassigned" },
                    { label: "Product Scope", value: salesTeams.length === 0 ? "Create a team to configure scope" : "Specific products or all teams" },
                    { label: "Assignment Rule", value: "Round-robin inside team" },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex flex-col gap-1">
                      <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{label}</span>
                      <strong className="text-sm font-semibold text-gray-800">{value}</strong>
                    </div>
                  ))}
                </div>
              </div>

              <section className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden" aria-label="Team members">
                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                  <h2 className="text-sm font-bold text-gray-800">Team Members</h2>
                  <span className="text-xs font-medium text-gray-500 bg-gray-100 px-2 py-1 rounded-full">{salesRepUsers.length} reps assigned</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200 text-left">
                        {["Sales Rep", "Current Team", "Team Lead", "Orders", "Delivered", "Conversion"].map((h) => (
                          <th key={h} className="px-4 py-3 font-semibold text-gray-500 uppercase text-[10px] tracking-wider">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {salesRepRows.length === 0 ? (
                        <tr><td colSpan={6} className="px-4 py-12 text-center text-gray-400 font-medium italic">No sales reps available for team assignment</td></tr>
                      ) : (
                        salesRepRows.map((row) => {
                          const team = teamForRep(row.user);
                          const lead = users.find((user) => user.id === team?.leadId);
                          return (
                            <tr key={row.user.id} className="hover:bg-gray-50 transition-colors">
                              <td className="px-4 py-4">
                                <div className="font-bold text-gray-900">{row.user.name}</div>
                                <div className="text-xs text-gray-500">{row.user.email}</div>
                              </td>
                              <td className="px-4 py-4 text-gray-700">{team?.name ?? "Unassigned"}</td>
                              <td className="px-4 py-4 text-gray-700">{lead?.name ?? "No lead"}</td>
                              <td className="px-4 py-4 text-gray-700">{row.orders}</td>
                              <td className="px-4 py-4 text-gray-700">{row.delivered}</td>
                              <td className="px-4 py-4 font-semibold text-gray-900">{row.conversion}%</td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden" aria-label="Product team links">
                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                  <h2 className="text-sm font-bold text-gray-800">Product Links</h2>
                  <span className="text-xs font-medium text-gray-500">All teams or scoped teams</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200 text-left">
                        {["Product", "SKU", "Scoped Team", "Selling Price", "Available Units"].map((h) => (
                          <th key={h} className="px-4 py-3 font-semibold text-gray-500 uppercase text-[10px] tracking-wider">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {products.map((product) => {
                        const scope = productTeamScope(product);
                        const pricing = primaryPricing(product);
                        return (
                          <tr key={product.id} className="hover:bg-gray-50 transition-colors">
                            <td className="px-4 py-4">
                              <div className="font-bold text-gray-900">{product.name}</div>
                              <div className="text-xs text-gray-400">{product.description}</div>
                            </td>
                            <td className="px-4 py-4 text-gray-600 font-mono text-xs">{product.sku}</td>
                            <td className="px-4 py-4 text-gray-700">{scope.length === 0 ? "All teams" : scope.join(", ")}</td>
                            <td className="px-4 py-4 font-semibold text-gray-900">{formatProductMoney(pricing?.sellingPrice ?? 0, pricing?.currency ?? "NGN")}</td>
                            <td className="px-4 py-4 text-gray-700">{totalProductStock(product)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          ) : activePage === "Call Rep Console" ? (
            renderRepConsole()
          ) : activePage === "Agents" ? (
            <div className="space-y-6">
              <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
                <div className="flex flex-col gap-1">
                  <h1 className="text-2xl font-bold text-[#1A6FBF]">Agent Logistics &amp; Performance</h1>
                  <p className="text-sm font-medium text-gray-500">Manage and monitor external delivery agents and their performance metrics across regions</p>
                </div>
                <div className="flex items-center gap-2">
                  <button className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border border-gray-200 bg-white text-gray-700 rounded-md hover:bg-gray-50 transition-colors" onClick={exportAgentsCsv}>
                    <Download className="w-4 h-4" /> Export CSV
                  </button>
                  <button className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-[#1A6FBF] text-white rounded-md hover:bg-blue-700 transition-colors" onClick={() => setModal("addAgent")}>
                    <Plus className="w-4 h-4" /> Add Agent
                  </button>
                </div>
              </header>

              <div className="flex items-center gap-3">
                <select className="h-9 px-3 border border-gray-200 rounded-md bg-white text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#1A6FBF] transition-colors" aria-label="Currency" value={currency} onChange={(event) => {
                  const nextCurrency = event.target.value as CurrencyCode;
                  setCurrency(nextCurrency);
                  showToast(`Currency changed to ${currencies[nextCurrency].label}.`);
                }}>
                  <option value="NGN">₦ Nigerian Naira</option>
                  <option value="USD">$ US Dollar</option>
                  <option value="GBP">£ British Pound</option>
                </select>
                <span className="text-xs font-medium text-gray-500">All amounts shown in {selectedCurrency.label}</span>
              </div>

              <section className="grid grid-cols-2 lg:grid-cols-3 gap-4" aria-label="Agents summary">
                {[
                  { title: "Total Agents", value: String(agents.length), icon: UserRound, tone: "blue", warning: false },
                  { title: "Active on Duty", value: String(agents.filter((agent) => agent.active).length), icon: CheckCircle2, tone: "green", warning: false },
                  { title: "Stock with Agents", value: formatMoney(totalAgentStockValue), icon: EmptyProductsIcon, tone: "orange", warning: false },
                  { title: "Pending Deliveries", value: String(pendingAgentDeliveries), icon: Truck, tone: "purple", warning: false },
                  { title: "Defective Stock Value", value: formatMoney(totalAgentDefectiveValue), icon: CircleX, tone: "red", warning: true },
                  { title: "Missing Stock Value", value: formatMoney(totalAgentMissingValue), icon: AlertTriangle, tone: "amber", warning: true }
                ].map((metric) => {
                  const Icon = metric.icon;
                  return (
                    <article className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm hover:shadow-md transition-shadow" key={metric.title}>
                      <div className="flex items-center justify-between mb-2">
                        <span className={`w-10 h-10 rounded-full flex items-center justify-center ${metric.tone === "blue" ? "bg-blue-50 text-blue-500" : metric.tone === "green" ? "bg-green-50 text-green-500" : metric.tone === "orange" ? "bg-orange-50 text-orange-500" : metric.tone === "purple" ? "bg-purple-50 text-purple-500" : metric.tone === "red" ? "bg-red-50 text-red-500" : "bg-amber-50 text-amber-500"}`}>
                          <Icon className="w-5 h-5" />
                        </span>
                      </div>
                      <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{metric.title}</h2>
                      <strong className={`text-2xl font-bold block my-1 ${metric.tone === "red" ? "text-red-600" : metric.tone === "amber" ? "text-amber-600" : "text-gray-900"}`}>{metric.value}</strong>
                    </article>
                  );
                })}
              </section>

              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm focus-within:ring-2 focus-within:ring-[#1A6FBF] flex-1 max-w-xs min-w-0">
                  <Search className="w-4 h-4 text-gray-400 shrink-0" />
                  <span className="sr-only">Search agents</span>
                  <input className="bg-transparent outline-none text-sm w-full min-w-0" value={agentSearch} onChange={(event) => setAgentSearch(event.target.value)} placeholder="Search by name or phone..." />
                </label>
                <select className="h-9 px-3 border border-gray-200 rounded-md bg-white text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#1A6FBF] transition-colors" aria-label="Agent zone" value={agentZone} onChange={(event) => {
                  setAgentZone(event.target.value as AgentZone);
                  showToast(`Agent zone filter set to ${event.target.value}.`);
                }}>
                  {agentZoneOptions.map((zone) => <option value={zone} key={zone}>{zone === "All Zones" ? "Zone: All" : zone}</option>)}
                </select>
                <select className="h-9 px-3 border border-gray-200 rounded-md bg-white text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#1A6FBF] transition-colors" aria-label="Agent status" value={agentStatus} onChange={(event) => {
                  setAgentStatus(event.target.value as AgentStatus);
                  showToast(`Agent status filter set to ${event.target.value}.`);
                }}>
                  {agentStatuses.map((status) => <option value={status} key={status}>{status === "All Status" ? "Status: All" : status}</option>)}
                </select>
              </div>

              <section className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden" aria-label="Agents table">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200 text-left">
                        {["Agent Details", "Primary Zone", "Status", "Success Rate", "Stock Value", "Actions"].map((h) => (
                          <th key={h} className="px-4 py-3 font-semibold text-gray-500 uppercase text-[10px] tracking-wider">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {filteredAgentRows.length === 0 ? (
                        <tr><td colSpan={6} className="px-4 py-12 text-center text-gray-400 font-medium italic">No agents found</td></tr>
                      ) : (
                        filteredAgentRows.map((row) => (
                          <tr key={row.agent.id} className="hover:bg-gray-50 transition-colors">
                            <td className="px-4 py-4">
                              <div className="flex items-center gap-2">
                                <span className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-bold shrink-0">{userInitials(row.agent.name)}</span>
                                <div>
                                  <div className="font-bold text-gray-900">{row.agent.name}</div>
                                  <div className="text-xs text-gray-500">{row.agent.phone}</div>
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-4 text-gray-700">{row.agent.zone}</td>
                            <td className="px-4 py-4"><span className={`status-pill status-${slugify(row.status)}`}>{row.status}</span></td>
                            <td className="px-4 py-4">
                              <div className="font-semibold text-gray-900">{row.successRate}%</div>
                              <div className="text-xs text-gray-500">{row.deliveries} delivered · {row.pending} pending</div>
                            </td>
                            <td className="px-4 py-4">
                              <div className="font-semibold text-gray-900">{formatMoney(row.stockValue)}</div>
                              <div className="text-xs text-gray-400">Defective {formatMoney(row.defectiveValue)} · Missing {formatMoney(row.missingValue)}</div>
                            </td>
                            <td className="px-4 py-4">
                              <div className="flex items-center gap-1">
                                <button className="w-8 h-8 flex items-center justify-center rounded border border-gray-200 text-gray-500 hover:bg-gray-100 transition-colors" title="Profile" aria-label="Profile" onClick={() => openAgentModal(row.agent, "agentDetails")}><Eye className="w-4 h-4" /></button>
                                <button className="w-8 h-8 flex items-center justify-center rounded border border-gray-200 text-gray-500 hover:bg-gray-100 transition-colors" title="Assign stock" aria-label="Assign stock" onClick={() => openAgentModal(row.agent, "assignAgentStock")}><PackagePlus className="w-4 h-4" /></button>
                                <button className="w-8 h-8 flex items-center justify-center rounded border border-gray-200 text-gray-500 hover:bg-gray-100 transition-colors" title="Reconcile" aria-label="Reconcile" onClick={() => openAgentModal(row.agent, "reconcileAgentStock")}><RefreshCw className="w-4 h-4" /></button>
                                <button className="w-8 h-8 flex items-center justify-center rounded border border-gray-200 text-gray-500 hover:bg-gray-100 transition-colors" title="Edit" aria-label="Edit" onClick={() => openAgentModal(row.agent, "editAgent")}><Pencil className="w-4 h-4" /></button>
                                <button className="w-8 h-8 flex items-center justify-center rounded border border-gray-200 text-red-400 hover:bg-red-50 transition-colors" title="Delete" aria-label="Delete" onClick={() => openAgentModal(row.agent, "deleteAgent")}><Trash2 className="w-4 h-4" /></button>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="px-4 py-3 border-t border-gray-100 text-xs text-gray-500">
                  Showing {filteredAgentRows.length} of {agents.length} agents
                </div>
              </section>
            </div>
          ) : activePage === "Waybill" ? (
            <div className="flex flex-col gap-6 p-6">
              {/* Header */}
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div>
                  <h1 className="text-xl font-bold text-gray-900">Waybill / Stock Transfers</h1>
                  <p className="text-sm text-gray-500 mt-0.5">Track stock shipped between warehouse and state agents, or agent-to-agent.</p>
                </div>
                <button className="inline-flex items-center gap-2 px-4 py-2 bg-[#1A6FBF] text-white rounded-lg text-sm font-bold hover:bg-blue-700 transition-colors" onClick={openCreateWaybill}>+ New Waybill</button>
              </div>

              {/* Summary cards */}
              {(() => {
                const inTransit = waybillRecords.filter((w) => w.status === "In Transit");
                const received = waybillRecords.filter((w) => w.status === "Received");
                const totalFees = waybillRecords.filter((w) => w.status !== "Cancelled").reduce((s, w) => s + w.waybillFee, 0);
                const inTransitUnits = inTransit.reduce((s, w) => s + w.quantity, 0);
                return (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    {[
                      { label: "In Transit", value: inTransit.length, sub: `${inTransitUnits} units`, color: "text-blue-700 bg-blue-50 border-blue-200" },
                      { label: "Received", value: received.length, sub: `${received.reduce((s,w)=>s+w.quantity,0)} units`, color: "text-green-700 bg-green-50 border-green-200" },
                      { label: "Total Waybill Fees", value: `₦${totalFees.toLocaleString()}`, sub: "all time", color: "text-purple-700 bg-purple-50 border-purple-200" },
                      { label: "Total Transfers", value: waybillRecords.length, sub: "all records", color: "text-gray-700 bg-gray-50 border-gray-200" },
                    ].map((card) => (
                      <div key={card.label} className={`rounded-xl border p-4 ${card.color}`}>
                        <p className="text-xs font-bold uppercase tracking-wide opacity-70">{card.label}</p>
                        <p className="text-2xl font-extrabold mt-1">{card.value}</p>
                        <p className="text-xs opacity-60 mt-0.5">{card.sub}</p>
                      </div>
                    ))}
                  </div>
                );
              })()}

              {/* Filters */}
              <div className="flex gap-3 flex-wrap items-center">
                <select className="h-9 px-3 border border-gray-200 rounded-lg bg-white text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#1A6FBF]" value={waybillStatusFilter} onChange={(e) => setWaybillStatusFilter(e.target.value as WaybillStatus | "All")}>
                  <option value="All">All Statuses</option>
                  <option value="In Transit">In Transit</option>
                  <option value="Received">Received</option>
                  <option value="Returned">Returned</option>
                  <option value="Cancelled">Cancelled</option>
                </select>
                <select className="h-9 px-3 border border-gray-200 rounded-lg bg-white text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#1A6FBF]" value={waybillProductFilter} onChange={(e) => setWaybillProductFilter(e.target.value)}>
                  <option value="">All Products</option>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>

              {/* Table */}
              {(() => {
                const filtered = waybillRecords.filter((w) =>
                  (waybillStatusFilter === "All" || w.status === waybillStatusFilter) &&
                  (!waybillProductFilter || w.productId === waybillProductFilter)
                );
                if (filtered.length === 0) {
                  return (
                    <div className="rounded-xl border border-dashed border-gray-200 p-12 text-center">
                      <p className="text-gray-400 font-medium">No waybill records yet.</p>
                      <p className="text-gray-400 text-sm mt-1">Click "New Waybill" to record a stock transfer.</p>
                    </div>
                  );
                }
                const statusColors: Record<WaybillStatus, string> = {
                  "In Transit": "bg-blue-100 text-blue-700",
                  "Received": "bg-green-100 text-green-700",
                  "Returned": "bg-amber-100 text-amber-700",
                  "Cancelled": "bg-gray-100 text-gray-500",
                };
                return (
                  <div className="rounded-xl border border-gray-200 overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 border-b border-gray-200">
                        <tr>
                          {["ID", "Product", "Qty", "Route", "Logistics Partner", "Fee", "Date Sent", "Status", "Actions"].map((h) => (
                            <th key={h} className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {filtered.map((w) => (
                          <tr key={w.id} className="hover:bg-gray-50 transition-colors">
                            <td className="px-4 py-3 font-mono text-xs text-gray-500 whitespace-nowrap">{w.id}</td>
                            <td className="px-4 py-3 font-semibold text-gray-900 whitespace-nowrap">{w.productName}</td>
                            <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{w.quantity} units</td>
                            <td className="px-4 py-3 whitespace-nowrap">
                              <span className="text-gray-600">{w.sendingState}</span>
                              <span className="mx-1 text-gray-400">→</span>
                              <span className="text-gray-900 font-medium">{w.receivingState}</span>
                            </td>
                            <td className="px-4 py-3 text-gray-700">{w.logisticsPartner}</td>
                            <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{w.waybillFee > 0 ? `₦${w.waybillFee.toLocaleString()}` : "—"}</td>
                            <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{w.dateSent}</td>
                            <td className="px-4 py-3 whitespace-nowrap">
                              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${statusColors[w.status]}`}>{w.status}</span>
                              {w.dateReceived && <span className="block text-xs text-gray-400 mt-0.5">{w.dateReceived}</span>}
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap">
                              <div className="flex gap-2 flex-wrap">
                                {w.status === "In Transit" && (
                                  <>
                                    <button className="inline-flex items-center px-2.5 py-1 rounded-md bg-green-600 text-white text-xs font-semibold hover:bg-green-700 transition-colors" onClick={() => markWaybillReceived(w.id)}>Mark Received</button>
                                    <button className="inline-flex items-center px-2.5 py-1 rounded-md border border-gray-200 text-gray-600 text-xs font-semibold hover:bg-gray-100 transition-colors" onClick={() => cancelWaybill(w.id)}>Cancel</button>
                                  </>
                                )}
                                <button className="inline-flex items-center px-2.5 py-1 rounded-md border border-blue-100 text-blue-700 bg-blue-50 text-xs font-semibold hover:bg-blue-100 transition-colors" onClick={() => openEditWaybill(w)}>Edit</button>
                                <button className="inline-flex items-center px-2.5 py-1 rounded-md border border-gray-200 text-gray-600 text-xs font-semibold hover:bg-gray-100 transition-colors" onClick={() => printWaybill(w)}>Print</button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })()}
            </div>
          ) : activePage === "Payroll" ? (
            <div className="space-y-6">
              <header className="flex flex-col gap-1">
                <h1 className="text-2xl font-bold text-[#1A6FBF]">Payroll</h1>
                <p className="text-sm font-medium text-gray-500">Manage pay rates and generate monthly payroll for your team</p>
              </header>

              <nav className="flex items-center gap-1 bg-gray-100 p-1 rounded-lg w-fit" role="tablist" aria-label="Payroll sections">
                {payrollTabs.map((tab) => (
                  <button
                    role="tab"
                    aria-selected={payrollTab === tab}
                    className={`px-4 py-1.5 rounded-md text-sm font-bold transition-all duration-200 whitespace-nowrap ${payrollTab === tab ? "bg-white text-[#1A6FBF] shadow-sm" : "text-gray-500 hover:text-gray-700 hover:bg-gray-200"}`}
                    key={tab}
                    onClick={() => {
                      setPayrollTab(tab);
                    }}
                  >
                    {tab}
                  </button>
                ))}
              </nav>

              {payrollTab === "Pay Rates" ? (
                <section className="space-y-4" aria-label="Pay rates">
                  <p className="text-sm text-gray-600">Set how much each person earns per delivered order. Admins are paid based on total orders delivered by all sales reps.</p>
                  <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-gray-50 border-b border-gray-200 text-left">
                            {["Name", "Role", "Pay Structure", "Last Updated", "Action"].map((h) => (
                              <th key={h} className="px-4 py-3 font-semibold text-gray-500 uppercase text-[10px] tracking-wider">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {users.map((user) => {
                            const structure = payStructures.find((item) => item.userId === user.id);
                            return (
                              <tr key={user.id} className="hover:bg-gray-50 transition-colors">
                                <td className="px-4 py-4">
                                  <div className="font-bold text-gray-900">{user.name}</div>
                                  <div className="text-xs text-gray-500">{user.email}</div>
                                </td>
                                <td className="px-4 py-4"><span className="role-pill">{user.role}</span></td>
                                <td className="px-4 py-4">
                                  <span className={`text-sm font-semibold ${structure ? "text-green-600" : "text-amber-600"}`}>{structure ? payStructureLabelFor(structure) : "Not set"}</span>
                                </td>
                                <td className="px-4 py-4 text-gray-500">{structure?.updatedAt ?? "-"}</td>
                                <td className="px-4 py-4">
                                  <button className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-gray-200 bg-gray-50 text-gray-700 rounded-md hover:bg-gray-100 transition-colors" onClick={() => openPayRateModal(user.id)}>{structure ? "Edit Rate" : "Set Rate"}</button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </section>
              ) : payrollTab === "Run Payroll" ? (
                <section className="space-y-5" aria-label="Run payroll">
                  <div className="flex flex-wrap items-end gap-4">
                    <label className="flex flex-col gap-1">
                      <span className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Payroll Month</span>
                      <div className="flex items-center gap-2 h-9 px-3 border border-gray-200 rounded-md bg-white focus-within:ring-2 focus-within:ring-[#1A6FBF]">
                        <input className="bg-transparent outline-none text-sm text-gray-700 w-32" value={payrollMonth} onChange={(event) => {
                          setPayrollMonth(event.target.value);
                          setPayrollLabel(`${event.target.value || "Monthly"} Payroll`);
                        }} />
                        <CalendarDays className="w-4 h-4 text-gray-400" />
                      </div>
                    </label>
                    <button className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border border-gray-200 bg-white text-gray-700 rounded-md hover:bg-gray-50 transition-colors" onClick={previewPayroll}>
                      <Eye className="w-4 h-4" /> Preview
                    </button>
                  </div>
                  <p className="text-sm text-gray-500">Select a month and click Preview to calculate payroll.</p>
                  <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-gray-50 border-b border-gray-200 text-left">
                            {["Name", "Delivered", "Fixed Salary", "Commission", "Auto-Bonus", "Deductions", "Total"].map((h) => (
                              <th key={h} className="px-4 py-3 font-semibold text-gray-500 uppercase text-[10px] tracking-wider">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {payrollPreviewRows.length === 0 ? (
                            <tr><td colSpan={7} className="px-4 py-12 text-center text-gray-400 font-medium italic">Set pay rates to preview payroll.</td></tr>
                          ) : (
                            payrollPreviewRows.map((row) => (
                              <tr key={row.userId} className="hover:bg-gray-50 transition-colors">
                                <td className="px-4 py-4 font-semibold text-gray-900">{row.name}</td>
                                <td className="px-4 py-4 text-gray-700">{row.delivered}</td>
                                <td className="px-4 py-4 text-gray-700">{formatMoney(row.fixedSalary)}</td>
                                <td className="px-4 py-4 text-gray-700">{formatMoney(row.commission)}</td>
                                <td className="px-4 py-4 text-emerald-700 font-semibold">{formatMoney(row.autoBonus ?? 0)}</td>
                                <td className="px-4 py-4 text-red-600 font-semibold">{(row.deductions ?? 0) > 0 ? `−${formatMoney(row.deductions ?? 0)}` : formatMoney(0)}</td>
                                <td className="px-4 py-4 font-bold text-[#1A6FBF]">{formatMoney(row.total)}</td>
                              </tr>
                            ))
                          )}
                          <tr className="bg-gray-50 font-bold border-t border-gray-200">
                            <td className="px-4 py-4 text-gray-900">Grand Total</td>
                            <td className="px-4 py-4 text-gray-700">{payrollPreviewRows.reduce((sum, row) => sum + row.delivered, 0)}</td>
                            <td className="px-4 py-4 text-gray-700">{formatMoney(payrollPreviewRows.reduce((sum, row) => sum + row.fixedSalary, 0))}</td>
                            <td className="px-4 py-4 text-gray-700">{formatMoney(payrollPreviewRows.reduce((sum, row) => sum + row.commission, 0))}</td>
                            <td className="px-4 py-4 text-emerald-700">{formatMoney(payrollPreviewRows.reduce((sum, row) => sum + (row.autoBonus ?? 0), 0))}</td>
                            <td className="px-4 py-4 text-red-600">−{formatMoney(payrollPreviewRows.reduce((sum, row) => sum + (row.deductions ?? 0), 0))}</td>
                            <td className="px-4 py-4 text-[#1A6FBF]">{formatMoney(payrollGrandTotal)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-sm font-semibold text-gray-800">Penalties this period</h3>
                        <p className="text-xs text-gray-500">Auto-deducted from each rep's total. Add penalties for fake upgrades, missed recoveries, etc.</p>
                      </div>
                      <button className="!min-h-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-semibold hover:bg-red-700" onClick={() => openAddPenalty()}>+ Apply Penalty</button>
                    </div>
                    {(() => {
                      const periodPenalties = repPenalties.filter((pen) => {
                        try {
                          return new Date(pen.date).toLocaleString("en-US", { month: "long", year: "numeric" }) === payrollMonth.trim();
                        } catch { return false; }
                      });
                      if (periodPenalties.length === 0) {
                        return <p className="text-xs text-gray-400 italic">No penalties recorded for {payrollMonth}.</p>;
                      }
                      return (
                        <div className="overflow-x-auto rounded-lg border border-gray-200">
                          <table className="w-full text-xs">
                            <thead className="bg-gray-50 text-gray-500 uppercase tracking-wider text-[10px]">
                              <tr><th className="px-3 py-2 text-left">Date</th><th className="px-3 py-2 text-left">Rep</th><th className="px-3 py-2 text-left">Type</th><th className="px-3 py-2 text-right">Amount</th><th className="px-3 py-2 text-left">Order</th><th className="px-3 py-2 text-left">Reason</th><th className="px-3 py-2"></th></tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                              {periodPenalties.map((pen) => (
                                <tr key={pen.id}>
                                  <td className="px-3 py-2 text-gray-600">{new Date(pen.date).toLocaleDateString()}</td>
                                  <td className="px-3 py-2 font-medium text-gray-800">{pen.repName}</td>
                                  <td className="px-3 py-2 text-gray-700">{pen.type}</td>
                                  <td className="px-3 py-2 text-right text-red-600 font-semibold">−{formatMoney(pen.amount)}</td>
                                  <td className="px-3 py-2 text-gray-500">{pen.orderId ?? "-"}</td>
                                  <td className="px-3 py-2 text-gray-500">{pen.reason || "-"}</td>
                                  <td className="px-3 py-2 text-right"><button className="!min-h-0 text-red-500 hover:text-red-700" onClick={() => removePenalty(pen.id)}>×</button></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      );
                    })()}
                  </div>
                  <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 flex flex-col gap-4">
                    <label className="flex flex-col gap-1">
                      <span className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Payroll Label</span>
                      <input className="h-9 px-3 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#1A6FBF]" value={payrollLabel} onChange={(event) => setPayrollLabel(event.target.value)} />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Notes (optional)</span>
                      <textarea className="px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#1A6FBF] resize-none" rows={3} value={payrollNotes} onChange={(event) => setPayrollNotes(event.target.value)} placeholder="Any notes for this payroll run..." />
                    </label>
                    <button className="self-start inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-[#1A6FBF] text-white rounded-md hover:bg-blue-700 transition-colors" onClick={savePayrollDraft}>Save as Draft</button>
                  </div>
                </section>
              ) : (
                <section className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden" aria-label="Payroll history">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-200 text-left">
                          {["Run", "Month", "People", "Total", "Created", "Notes"].map((h) => (
                            <th key={h} className="px-4 py-3 font-semibold text-gray-500 uppercase text-[10px] tracking-wider">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {payrollRuns.length === 0 ? (
                          <tr><td colSpan={6} className="px-4 py-12 text-center text-gray-400 font-medium italic">No payroll records yet. Use the "Run Payroll" tab to create one.</td></tr>
                        ) : (
                          payrollRuns.map((run) => (
                            <tr key={run.id} className="hover:bg-gray-50 transition-colors">
                              <td className="px-4 py-4">
                                <div className="font-bold text-gray-900">{run.label}</div>
                                <div className="text-xs text-gray-500">{run.id}</div>
                              </td>
                              <td className="px-4 py-4 text-gray-700">{run.month}</td>
                              <td className="px-4 py-4 text-gray-700">{run.rows.length}</td>
                              <td className="px-4 py-4 font-bold text-[#1A6FBF]">{formatMoney(run.total)}</td>
                              <td className="px-4 py-4 text-gray-500">{displayDateFromKey(run.createdAt)}</td>
                              <td className="px-4 py-4 text-gray-500">{run.notes || "-"}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
            </div>
          ) : activePage === "Customers" ? (
            <div className="space-y-6">
              <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
                <div className="flex flex-col gap-1">
                  <h1 className="text-2xl font-bold text-[#1A6FBF]">Customer Directory</h1>
                  <p className="text-sm font-medium text-gray-500">Manage your customer relationships and track lifetime value performance</p>
                </div>
                <button className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border border-gray-200 bg-white text-gray-700 rounded-md hover:bg-gray-50 transition-colors" onClick={exportCustomersCsv}>
                  <Download className="w-4 h-4" /> Export Data
                </button>
              </header>

              <div className="flex flex-wrap items-center gap-3">
                <div className="inline-flex items-center bg-gray-100 p-1 rounded-lg">
                  {periods.map((item) => (
                    <button className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${customerPeriod === item ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-900"}`} onClick={() => handleCustomerPeriodChange(item)} key={item}>
                      {item}
                    </button>
                  ))}
                </div>
                <div className="relative">
                  <button className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border border-gray-200 bg-white text-gray-700 rounded-md hover:bg-gray-50 transition-colors" onClick={() => setShowCustomerDateRange((value) => !value)}>
                    <CalendarDays className="w-4 h-4" /> {customerPeriod === "Custom" ? "Edit date range" : "Pick a date range"}
                  </button>
                  {showCustomerDateRange && renderDateRangeCalendar("customer-date-range-panel", customerDateRange, setCustomerDateRange, applyCustomerDateRange, () => setShowCustomerDateRange(false))}
                </div>
                <select className="h-9 px-3 border border-gray-200 rounded-md bg-white text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#1A6FBF] transition-colors" aria-label="Currency" value={currency} onChange={(event) => {
                  const nextCurrency = event.target.value as CurrencyCode;
                  setCurrency(nextCurrency);
                  showToast(`Currency changed to ${currencies[nextCurrency].label}.`);
                }}>
                  <option value="NGN">₦ Nigerian Naira</option>
                  <option value="USD">$ US Dollar</option>
                  <option value="GBP">£ British Pound</option>
                </select>
              </div>

              <section className="grid grid-cols-2 lg:grid-cols-4 gap-4" aria-label="Customer summary">
                {[
                  { title: "Total Customers", value: String(customerRecords.length), helper: `${filteredCustomers.length} visible`, icon: UserRound, tone: "blue" },
                  { title: "Active Customers", value: String(activeCustomerCount), helper: "At least 1 delivered order", icon: CheckCircle2, tone: "green" },
                  { title: "Returning Rate", value: `${returningRate}%`, helper: "Customers with 2+ orders", icon: RefreshCw, tone: "cyan" },
                  { title: "Avg. Lifetime Value", value: formatMoney(avgLifetimeValue), helper: "Delivered spend/customer", icon: CircleDollarSign, tone: "blue" }
                ].map((metric) => {
                  const Icon = metric.icon;
                  return (
                    <article className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm hover:shadow-md transition-shadow" key={metric.title}>
                      <div className="flex items-center justify-between mb-2">
                        <span className={`w-10 h-10 rounded-full flex items-center justify-center ${metric.tone === "green" ? "bg-green-50 text-green-500" : metric.tone === "cyan" ? "bg-cyan-50 text-cyan-500" : "bg-blue-50 text-blue-500"}`}>
                          <Icon className="w-5 h-5" />
                        </span>
                      </div>
                      <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{metric.title}</h2>
                      <strong className="text-2xl font-bold text-gray-900 block my-1">{metric.value}</strong>
                      <p className="text-[10px] text-gray-400 font-medium">{metric.helper}</p>
                    </article>
                  );
                })}
              </section>

              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm focus-within:ring-2 focus-within:ring-[#1A6FBF] flex-1 max-w-xs min-w-0">
                  <Search className="w-4 h-4 text-gray-400 shrink-0" />
                  <span className="sr-only">Search customers</span>
                  <input className="bg-transparent outline-none text-sm w-full min-w-0" value={customerSearch} onChange={(event) => setCustomerSearch(event.target.value)} placeholder="Search by name, email, or phone..." />
                </label>
                <select className="h-9 px-3 border border-gray-200 rounded-md bg-white text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#1A6FBF] transition-colors" aria-label="Customer source" value={customerSource} onChange={(event) => {
                  setCustomerSource(event.target.value as CustomerSource);
                  showToast(`Customer source filter set to ${event.target.value}.`);
                }}>
                  {customerSources.map((source) => <option key={source}>{source}</option>)}
                </select>
                <button className="w-9 h-9 flex items-center justify-center rounded-md border border-gray-200 bg-gray-50 text-gray-500 hover:bg-gray-100 transition-colors" title="Refresh customers" aria-label="Refresh customers" onClick={() => showToast("Customers refreshed.")}><RefreshCw className="w-4 h-4" /></button>
              </div>

              <section className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden" aria-label="Customers table">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200 text-left">
                        {["Customer", "Contact Details", "Orders", "Source", "Successful", "Cancelled", "Total Spend", "Reliability", "Actions"].map((h) => (
                          <th key={h} className="px-4 py-3 font-semibold text-gray-500 uppercase text-[10px] tracking-wider">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {filteredCustomers.length === 0 ? (
                        <tr><td colSpan={9} className="px-4 py-12 text-center text-gray-400 font-medium italic">No customers found</td></tr>
                      ) : (
                        filteredCustomers.map((customer) => {
                          const reliability = customer.orders === 0 ? 0 : Math.round((customer.successful / customer.orders) * 100);
                          const flagged = isCustomerFlagged(customer.phone);
                          const flagData = customerFlags[normalizePhone(customer.phone)];
                          return (
                            <tr key={customer.id} className={`hover:bg-gray-50 transition-colors ${flagged ? "bg-red-50/40" : ""}`}>
                              <td className="px-4 py-4">
                                <div className="font-bold text-gray-900">{customer.name}</div>
                                {flagged && <span className="inline-flex items-center gap-1 mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-700" title={flagData?.reason || "Flagged"}><AlertTriangle className="w-2.5 h-2.5" /> Flagged</span>}
                              </td>
                              <td className="px-4 py-4">
                                <div className="text-gray-700">{customer.phone}</div>
                                <div className="text-xs text-gray-400">{customer.email}</div>
                              </td>
                              <td className="px-4 py-4 text-gray-700">{customer.orders}</td>
                              <td className="px-4 py-4 text-gray-700">{customer.source}</td>
                              <td className="px-4 py-4 font-semibold text-green-600">{customer.successful}</td>
                              <td className="px-4 py-4 font-semibold text-red-500">{customer.cancelled}</td>
                              <td className="px-4 py-4 font-bold text-[#1A6FBF]">{formatMoney(customer.totalSpend)}</td>
                              <td className="px-4 py-4">
                                <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold ${reliability >= 70 ? "bg-green-100 text-green-700" : reliability >= 40 ? "bg-yellow-100 text-yellow-700" : "bg-red-100 text-red-700"}`}>{reliability}%</span>
                              </td>
                              <td className="px-4 py-4">
                                <div className="flex items-center gap-1.5">
                                  <button className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium border border-gray-200 bg-gray-50 text-gray-700 rounded-md hover:bg-gray-100 transition-colors" onClick={() => { setOrderSearch(customer.phone); setActivePage("Orders"); }}>View Orders</button>
                                  {flagged
                                    ? <button className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium border border-gray-200 bg-white text-gray-500 rounded-md hover:bg-gray-50 transition-colors" onClick={() => unflagCustomer(customer.phone)}>Unflag</button>
                                    : <button className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium border border-red-200 bg-red-50 text-red-600 rounded-md hover:bg-red-100 transition-colors" onClick={() => openFlagCustomer(customer.phone)}><AlertTriangle className="w-3 h-3" /> Flag</button>}
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 text-xs text-gray-500">
                  <span>{filteredCustomers.length} customer{filteredCustomers.length === 1 ? "" : "s"}</span>
                  <div className="flex items-center gap-1">
                    
                    
                  </div>
                </div>
              </section>
            </div>
          ) : activePage === "Expenses" ? (
            <div className="space-y-6">
              <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
                <div className="flex flex-col gap-1">
                  <h1 className="text-2xl font-bold text-[#1A6FBF]">Expense Management</h1>
                  <p className="text-sm font-medium text-gray-500">Monitor and manage your e-commerce operational costs</p>
                </div>
                <div className="flex items-center gap-2">
                  <button className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border border-gray-200 bg-white text-gray-700 rounded-md hover:bg-gray-50 transition-colors" onClick={() => showToast("Expenses refreshed.")}>
                    <RefreshCw className="w-4 h-4" /> Refresh
                  </button>
                  <button className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-[#1A6FBF] text-white rounded-md hover:bg-blue-700 transition-colors" onClick={() => setModal("addExpense")}>
                    <Plus className="w-4 h-4" /> Add Expense
                  </button>
                </div>
              </header>

              <div className="flex flex-wrap items-center gap-3">
                <div className="inline-flex items-center bg-gray-100 p-1 rounded-lg">
                  {periods.map((item) => (
                    <button className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${expensePeriod === item ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-900"}`} onClick={() => handleExpensePeriodChange(item)} key={item}>
                      {item}
                    </button>
                  ))}
                </div>
                <div className="relative">
                  <button className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border border-gray-200 bg-white text-gray-700 rounded-md hover:bg-gray-50 transition-colors" onClick={() => setShowExpenseDateRange((value) => !value)}>
                    <CalendarDays className="w-4 h-4" /> {expensePeriod === "Custom" ? "Edit date range" : "Pick a date range"}
                  </button>
                  {showExpenseDateRange && renderDateRangeCalendar("expense-date-range-panel", expenseDateRange, setExpenseDateRange, applyExpenseDateRange, () => setShowExpenseDateRange(false))}
                </div>
                <select className="h-9 px-3 border border-gray-200 rounded-md bg-white text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#1A6FBF] transition-colors" aria-label="Currency" value={currency} onChange={(event) => {
                  const nextCurrency = event.target.value as CurrencyCode;
                  setCurrency(nextCurrency);
                  showToast(`Currency changed to ${currencies[nextCurrency].label}.`);
                }}>
                  <option value="NGN">₦ Nigerian Naira</option>
                  <option value="USD">$ US Dollar</option>
                  <option value="GBP">£ British Pound</option>
                </select>
              </div>

              <section className="grid grid-cols-2 lg:grid-cols-4 gap-4" aria-label="Expense summary">
                {[
                  { title: "Total Expenses", value: formatMoney(totalExpenses), helper: `${filteredExpenses.length} records`, icon: Archive, tone: "blue" },
                  { title: "Product-Linked", value: formatMoney(productLinkedExpenses), helper: `${totalExpenses === 0 ? 0 : Math.round((productLinkedExpenses / totalExpenses) * 100)}% of total`, icon: EmptyProductsIcon, tone: "purple" },
                  { title: "General Expenses", value: formatMoney(generalExpenses), helper: "Operations & Overhead", icon: History, tone: "orange" },
                  { title: "Daily Burn Rate", value: formatMoney(dailyBurnRate), helper: "Average this period", icon: Flame, tone: "red" }
                ].map((metric) => {
                  const Icon = metric.icon;
                  return (
                    <article className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm hover:shadow-md transition-shadow" key={metric.title}>
                      <div className="flex items-center justify-between mb-2">
                        <span className={`w-10 h-10 rounded-full flex items-center justify-center ${metric.tone === "blue" ? "bg-blue-50 text-blue-500" : metric.tone === "purple" ? "bg-purple-50 text-purple-500" : metric.tone === "orange" ? "bg-orange-50 text-orange-500" : "bg-red-50 text-red-500"}`}>
                          <Icon className="w-5 h-5" />
                        </span>
                      </div>
                      <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{metric.title}</h2>
                      <strong className="text-2xl font-bold text-gray-900 block my-1">{metric.value}</strong>
                      <p className="text-[10px] text-gray-400 font-medium">{metric.helper}</p>
                    </article>
                  );
                })}
              </section>

              <section className="bg-white rounded-xl border border-gray-200 shadow-sm p-5" aria-label="Profit impact report">
                <h2 className="text-sm font-bold text-gray-800 mb-4">Profit Impact Report</h2>
                <div className="flex flex-wrap items-center gap-3 mb-4">
                  {[
                    { label: "Gross Revenue", value: formatMoney(expenseRevenue), color: "text-green-600" },
                    { label: "Cost of Goods", value: formatMoney(expenseCogs), color: "text-red-500", op: "-" },
                    { label: "Total Expenses", value: formatMoney(totalExpenses), color: "text-red-500", op: "-" },
                    { label: "Net Profit", value: formatMoney(expenseNetProfit), color: "text-[#1A6FBF]", op: "=" },
                  ].map(({ label, value, color, op }, idx) => (
                    <div key={label} className="flex items-center gap-3">
                      {op && <span className="text-lg font-bold text-gray-400">{op}</span>}
                      <div className={`bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 flex flex-col gap-1 ${idx === 3 ? "bg-blue-50 border-blue-200" : ""}`}>
                        <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{label}</span>
                        <strong className={`text-lg font-bold ${color}`}>{value}</strong>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap gap-4 text-xs text-gray-500">
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-400 inline-block" /> COGS ({expenseRevenue === 0 ? 0 : Math.round((expenseCogs / expenseRevenue) * 100)}%)</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400 inline-block" /> Operating Expenses ({expenseRevenue === 0 ? 0 : Math.round((totalExpenses / expenseRevenue) * 100)}%)</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-400 inline-block" /> Profit Margin ({expenseMargin}%)</span>
                </div>
              </section>

              {(() => {
                const topProducts = Object.entries(
                  filteredExpenses.filter((e) => e.productId).reduce<Record<string, { name: string; total: number }>>((acc, e) => {
                    const key = e.productId!;
                    acc[key] = { name: e.productName, total: (acc[key]?.total ?? 0) + e.amount };
                    return acc;
                  }, {})
                ).sort((a, b) => b[1].total - a[1].total).slice(0, 5);
                const now = new Date();
                const monthlyData = Array.from({ length: 6 }, (_, i) => {
                  const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1);
                  const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
                  const total = expenses.filter((e) => normalizeDateKey(e.date).startsWith(mk)).reduce((s, e) => s + e.amount, 0);
                  return { label: d.toLocaleString("en-US", { month: "short" }), total, isCurrentMonth: i === 5 };
                });
                const monthMax = Math.max(...monthlyData.map((d) => d.total), 1);
                return (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <article className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
                      <h2 className="text-sm font-bold text-gray-800 mb-3">Top 5 Products by Expense</h2>
                      {topProducts.length === 0 ? (
                        <div className="flex items-center justify-center h-24 text-sm text-gray-400 italic">No product-linked expenses this period</div>
                      ) : (
                        <div className="flex flex-col gap-2">
                          {topProducts.map(([, item], idx) => (
                            <div key={idx} className="flex items-center justify-between text-sm">
                              <span className="text-gray-700 truncate flex-1">{item.name}</span>
                              <strong className="text-gray-900 shrink-0 ml-2">{formatMoney(item.total)}</strong>
                            </div>
                          ))}
                        </div>
                      )}
                    </article>
                    <article className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
                      <div className="flex items-center justify-between mb-3">
                        <h2 className="text-sm font-bold text-gray-800">Monthly Expense Trend</h2>
                        <span className="text-xs text-gray-400">Last 6 months</span>
                      </div>
                      <div className="flex items-end gap-1 h-20">
                        {monthlyData.map((m) => (
                          <div key={m.label} className="flex-1 flex flex-col items-center gap-1">
                            <div className="w-full flex items-end justify-center" style={{ height: "60px" }}>
                              <div
                                className={`w-full rounded-t-sm transition-all ${m.isCurrentMonth ? "bg-[#1A6FBF]" : "bg-blue-200"}`}
                                style={{ height: m.total === 0 ? "2px" : `${Math.max(4, Math.round((m.total / monthMax) * 60))}px` }}
                                title={formatMoney(m.total)}
                              />
                            </div>
                            <span className={`text-[9px] font-medium ${m.isCurrentMonth ? "text-[#1A6FBF] font-bold" : "text-gray-400"}`}>{m.label}</span>
                          </div>
                        ))}
                      </div>
                    </article>
                  </div>
                );
              })()}

              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm focus-within:ring-2 focus-within:ring-[#1A6FBF] flex-1 max-w-xs min-w-0">
                  <Search className="w-4 h-4 text-gray-400 shrink-0" />
                  <span className="sr-only">Search expenses</span>
                  <input className="bg-transparent outline-none text-sm w-full min-w-0" value={expenseSearch} onChange={(event) => setExpenseSearch(event.target.value)} placeholder="Search descriptions or references..." />
                </label>
                <button className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border border-gray-200 bg-white text-gray-700 rounded-md hover:bg-gray-50 transition-colors" onClick={exportExpensesCsv}>
                  <Download className="w-4 h-4" /> Export
                </button>
                <select className="h-9 px-3 border border-gray-200 rounded-md bg-white text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#1A6FBF] transition-colors" aria-label="Expense type filter" value={expenseFilter} onChange={(event) => {
                  setExpenseFilter(event.target.value as ExpenseFilter);
                  showToast(`Expense filter set to ${event.target.value}.`);
                }}>
                  {expenseFilters.map((filter) => <option key={filter}>{filter}</option>)}
                </select>
              </div>

              <section className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden" aria-label="Expenses table">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200 text-left">
                        <th className="px-4 py-3"><input type="checkbox" aria-label="Select all expenses" /></th>
                        {["Date", "Type", "Product / Ref", "Amount", "Description", "Actions"].map((h) => (
                          <th key={h} className="px-4 py-3 font-semibold text-gray-500 uppercase text-[10px] tracking-wider">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {filteredExpenses.length === 0 ? (
                        <tr><td colSpan={7} className="px-4 py-12 text-center text-gray-400 font-medium italic">No expenses found</td></tr>
                      ) : (
                        filteredExpenses.map((expense) => (
                          <tr key={expense.id} className="hover:bg-gray-50 transition-colors">
                            <td className="px-4 py-4"><input type="checkbox" aria-label={`Select ${expense.id}`} /></td>
                            <td className="px-4 py-4 text-gray-600">{displayDateFromKey(expense.date)}</td>
                            <td className="px-4 py-4"><span className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-700">{expense.type}</span></td>
                            <td className="px-4 py-4 text-gray-700">{expense.productName}</td>
                            <td className="px-4 py-4 font-bold text-gray-900">{formatMoney(expense.amount)}</td>
                            <td className="px-4 py-4 text-gray-500 text-xs">{expense.description}</td>
                            <td className="px-4 py-4">
                              <button className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-gray-200 bg-gray-50 text-gray-700 rounded-md hover:bg-gray-100 transition-colors" onClick={() => showToast(`${expense.id} · ${expense.type} · ${formatMoney(expense.amount)} · ${expense.productName} · ${expense.description}`)}>Details</button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 text-xs text-gray-500">
                  <span>{filteredExpenses.length} expense{filteredExpenses.length === 1 ? "" : "s"}</span>
                  <div className="flex items-center gap-1">
                    
                    
                  </div>
                </div>
              </section>
            </div>
          ) : activePage === "Finance & Accounting" ? (
            <div className="space-y-6">
              <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
                <div className="flex flex-col gap-1">
                  <h1 className="text-2xl font-bold text-[#1A6FBF]">Finance &amp; Accounting</h1>
                  <p className="text-sm font-medium text-gray-500">Comprehensive financial analytics and performance tracking</p>
                </div>
                <button className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-[#1A6FBF] text-white rounded-md hover:bg-blue-700 transition-colors" onClick={exportFinancialReport}>
                  <Download className="w-4 h-4" /> {financeTab === "Profit & Loss" ? "Export PDF" : financeTab === "Sales Rep Finance" ? "Payout Report" : financeTab === "Agent Costs" ? "Export CSV" : "Export Report"}
                </button>
              </header>

              <div className="flex flex-wrap items-center gap-3">
                <select className="h-9 px-3 border border-gray-200 rounded-md bg-white text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#1A6FBF] transition-colors" aria-label="Currency" value={currency} onChange={(event) => {
                  const nextCurrency = event.target.value as CurrencyCode;
                  setCurrency(nextCurrency);
                  showToast(`Currency changed to ${currencies[nextCurrency].label}.`);
                }}>
                  <option value="NGN">₦ Nigerian Naira</option>
                  <option value="USD">$ US Dollar</option>
                  <option value="GBP">£ British Pound</option>
                </select>
                <div className="inline-flex items-center bg-gray-100 p-1 rounded-lg">
                  {periods.map((item) => (
                    <button className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${financePeriod === item ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-900"}`} onClick={() => handleFinancePeriodChange(item)} key={item}>
                      {item}
                    </button>
                  ))}
                </div>
                <div className="relative">
                  <button className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border border-gray-200 bg-white text-gray-700 rounded-md hover:bg-gray-50 transition-colors" onClick={() => setShowFinanceDateRange((value) => !value)}>
                    <CalendarDays className="w-4 h-4" /> {financePeriod === "Custom" ? "Edit date range" : "Pick a date range"}
                  </button>
                  {showFinanceDateRange && renderDateRangeCalendar("finance-date-range-panel", financeDateRange, setFinanceDateRange, applyFinanceDateRange, () => setShowFinanceDateRange(false))}
                </div>
              </div>

              <nav className="flex items-center gap-1 bg-gray-100 p-1 rounded-lg w-fit overflow-x-auto no-scrollbar" role="tablist" aria-label="Financial report sections">
                {financeTabs.map((tab) => (
                  <button
                    role="tab"
                    aria-selected={financeTab === tab}
                    className={`px-4 py-1.5 rounded-md text-sm font-bold transition-all duration-200 whitespace-nowrap ${financeTab === tab ? "bg-white text-[#1A6FBF] shadow-sm" : "text-gray-500 hover:text-gray-700 hover:bg-gray-200"}`}
                    onClick={() => {
                      setFinanceTab(tab);
                    }}
                    key={tab}
                  >
                    {tab}
                  </button>
                ))}
              </nav>

              {/* Product filter chips — toggle one or more products to scope every tab's metrics. Empty = all products merged. */}
              <section className="bg-white rounded-xl border border-gray-200 shadow-sm p-4" aria-label="Product filter">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div>
                    <h2 className="text-sm font-bold text-gray-800">Filter by Product</h2>
                    <p className="text-xs text-gray-400 mt-0.5">Each product has its own revenue, COGS, expenses, and delivery rate. Pick one for a clean per-product view, or select multiple to merge them.</p>
                  </div>
                  {productFilterActive && (
                    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full bg-blue-50 text-[#1A6FBF] border border-blue-200 whitespace-nowrap">{financeProductFilter.length} selected · merged view</span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setFinanceProductFilter([])}
                    className={`!min-h-0 px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${!productFilterActive ? "bg-[#1A6FBF] text-white border-[#1A6FBF]" : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"}`}
                  >
                    All Products ({products.length})
                  </button>
                  {products.map((product) => {
                    const selected = financeProductFilter.includes(product.id);
                    return (
                      <button
                        key={product.id}
                        type="button"
                        onClick={() => setFinanceProductFilter((prev) => prev.includes(product.id) ? prev.filter((id) => id !== product.id) : [...prev, product.id])}
                        className={`!min-h-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${selected ? "bg-[#1A6FBF] text-white border-[#1A6FBF]" : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50 hover:border-gray-300"}`}
                      >
                        {selected && <CheckCircle2 className="w-3 h-3" />}
                        {product.name}
                      </button>
                    );
                  })}
                </div>
              </section>

              {financeTab === "Financial Overview" && (
                <div className="space-y-4">
                  <section className="grid grid-cols-2 lg:grid-cols-4 gap-4" aria-label="Financial overview summary">
                    {[
                      { title: "Revenue", value: formatMoney(financeRevenue), helper: `${financeDeliveredCount} delivered orders`, tone: "green" },
                      { title: "Gross Profit", value: formatMoney(financeGrossProfit), helper: `${financeGrossMargin}% gross margin`, tone: "blue" },
                      { title: "Net Profit", value: formatMoney(financeNetProfit), helper: `${financeNetMargin}% net margin`, tone: "blue" },
                      { title: "Total Expenses", value: formatMoney(financeExpenseTotal), helper: `${financeExpenses.length} expense records`, tone: "red" }
                    ].map((metric) => (
                      <article key={metric.title} className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
                        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{metric.title}</h2>
                        <strong className={`text-2xl font-bold block my-1 ${metric.tone === "red" ? "text-red-600" : metric.tone === "green" ? "text-green-600" : "text-gray-900"}`}>{metric.value}</strong>
                        <p className="text-[10px] text-gray-400 font-medium">{metric.helper}</p>
                      </article>
                    ))}
                  </section>

                  {/* Cash Position — POD-specific reconciliation between recognized revenue and cash actually received */}
                  <section className="bg-white rounded-xl border border-gray-200 shadow-sm p-5" aria-label="Cash position">
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <h2 className="text-sm font-bold text-gray-800">Cash Position</h2>
                        <p className="text-xs text-gray-400 mt-0.5">Pay-on-delivery reconciliation: what's been delivered vs. what's actually in your account</p>
                      </div>
                      <button className="!min-h-0 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold border border-gray-200 bg-gray-50 text-gray-700 rounded-md hover:bg-gray-100 transition-colors" onClick={() => setFinanceTab("Remittance")}>
                        Open Remittance <ArrowRight className="w-3 h-3" />
                      </button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 flex flex-col gap-1">
                        <span className="text-[10px] font-bold text-blue-700 uppercase tracking-wider">Recognized Revenue</span>
                        <strong className="text-xl font-bold text-blue-900">{formatMoney(financeRevenue)}</strong>
                        <span className="text-[10px] text-blue-600">Delivered orders · {financeDeliveredCount}</span>
                      </div>
                      <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 flex flex-col gap-1">
                        <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider">Cash Received</span>
                        <strong className="text-xl font-bold text-emerald-900">{formatMoney(totalRemittanceReceived)}</strong>
                        <span className="text-[10px] text-emerald-600">Remitted by partners</span>
                      </div>
                      <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 flex flex-col gap-1">
                        <span className="text-[10px] font-bold text-amber-700 uppercase tracking-wider">Outstanding</span>
                        <strong className="text-xl font-bold text-amber-900">{formatMoney(totalRemittanceOutstanding)}</strong>
                        <span className="text-[10px] text-amber-600">{totalRemittanceExpected === 0 ? "0%" : `${Math.round((totalRemittanceReceived / totalRemittanceExpected) * 100)}% collected`} · Logistics fees: {formatMoney(totalLogisticsCost)}</span>
                      </div>
                    </div>
                  </section>

                  <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h2 className="text-sm font-bold text-gray-800">Revenue vs. Expenses</h2>
                        <p className="text-xs text-gray-400">{financePeriod === "Today" ? "Today's snapshot" : financePeriod === "This Week" ? "Daily breakdown this week" : financePeriod === "This Month" ? "Daily breakdown this month" : financePeriod === "This Year" ? "Monthly breakdown this year" : "Custom range breakdown"}</p>
                      </div>
                      <div className="flex items-center gap-4 text-xs text-gray-500">
                        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-green-400 inline-block" /> Revenue</span>
                        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-red-400 inline-block" /> Expenses</span>
                      </div>
                    </div>
                    {financeChartData.every((d) => d.revenue === 0 && d.expenses === 0) ? (
                      <div className="h-48 flex items-center justify-center text-sm text-gray-400 italic">No data for this period</div>
                    ) : (
                      <div className="flex items-end gap-0.5 h-48 w-full" aria-label="Revenue vs expenses chart">
                        {financeChartData.map((d, i) => {
                          const revH = Math.round((d.revenue / financeChartMax) * 100);
                          const expH = Math.round((d.expenses / financeChartMax) * 100);
                          const showLabel = financeChartData.length <= 14 || i % Math.ceil(financeChartData.length / 14) === 0 || i === financeChartData.length - 1;
                          return (
                            <div key={i} className="flex-1 flex flex-col items-center gap-0.5 min-w-0 group">
                              <div className="w-full flex items-end gap-px" style={{ height: "176px" }}>
                                <div
                                  className="flex-1 bg-green-400 rounded-t-sm transition-all duration-300 group-hover:bg-green-500 min-h-0 relative"
                                  style={{ height: revH > 0 ? `${Math.max(revH, 2)}%` : "0%" }}
                                  title={`Revenue: ${formatMoney(d.revenue)}`}
                                />
                                <div
                                  className="flex-1 bg-red-400 rounded-t-sm transition-all duration-300 group-hover:bg-red-500 min-h-0 relative"
                                  style={{ height: expH > 0 ? `${Math.max(expH, 2)}%` : "0%" }}
                                  title={`Expenses: ${formatMoney(d.expenses)}`}
                                />
                              </div>
                              <span className="text-[9px] text-gray-400 truncate w-full text-center leading-none mt-0.5">
                                {showLabel ? d.label : ""}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100 text-xs text-gray-500">
                      <span>Total Revenue: <strong className="text-green-600">{formatMoney(financeRevenue)}</strong></span>
                      <span>Total Expenses: <strong className="text-red-500">{formatMoney(financeExpenseTotal)}</strong></span>
                      <span>Net: <strong className={financeNetProfit >= 0 ? "text-gray-900" : "text-red-600"}>{formatMoney(financeNetProfit)}</strong></span>
                    </div>
                  </div>
                  <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
                    <h2 className="text-sm font-bold text-gray-800 mb-2">Expense Breakdown</h2>
                    <p className="text-sm text-gray-600">{financeExpenses.length === 0 ? "No expenses recorded for this period" : `${formatMoney(financeProductLinkedExpenses)} product-linked · ${formatMoney(financeGeneralExpenses)} general`}</p>
                  </div>
                </div>
              )}

              {financeTab === "Sales Rep Finance" && (
                <div className="space-y-4">
                  <section className="grid grid-cols-1 lg:grid-cols-3 gap-4" aria-label="Sales rep finance summary">
                    {[
                      { title: "Total Team ROI", value: `${financeRoi}%`, helper: "Net Profit / (COGS + Expenses)", icon: CircleDollarSign, tone: "blue" },
                      { title: "Avg CPA", value: formatMoney(financeAvgCpa), helper: "SUM(Expenses) / Delivered Orders", icon: CircleDollarSign, tone: "gray" },
                      { title: "Top Performer", value: topFinanceRep?.user.name ?? "N/A", helper: `${formatMoney(topFinanceRep?.netProfit ?? 0)} Net Profit`, icon: BadgeCheck, tone: "green" },
                    ].map(({ title, value, helper, icon: Icon, tone }) => (
                      <article key={title} className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
                        <div className="flex items-center justify-between mb-2">
                          <span className={`w-9 h-9 rounded-full flex items-center justify-center ${tone === "blue" ? "bg-blue-50 text-blue-500" : tone === "green" ? "bg-green-50 text-green-500" : "bg-gray-50 text-gray-500"}`}><Icon className="w-4 h-4" /></span>
                        </div>
                        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{title}</h2>
                        <strong className="text-xl font-bold text-gray-900 block my-1">{value}</strong>
                        <p className="text-[10px] text-gray-400">{helper}</p>
                      </article>
                    ))}
                  </section>
                  <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                    <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                      <div>
                        <h2 className="text-sm font-bold text-gray-800">Performance Breakdown</h2>
                        <p className="text-xs text-gray-400">Metrics aligned with orders &amp; expenses</p>
                      </div>
                      <label className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus-within:ring-2 focus-within:ring-[#1A6FBF]">
                        <Search className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                        <input className="bg-transparent outline-none text-xs w-32" value={financeRepSearch} onChange={(event) => setFinanceRepSearch(event.target.value)} placeholder="Search Rep..." />
                      </label>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-gray-50 border-b border-gray-200 text-left">
                            {["Sales Rep Name", "Revenue", "Delivered", "Net Profit", "CPA", "ROI %"].map((h) => (
                              <th key={h} className="px-4 py-3 font-semibold text-gray-500 uppercase text-[10px] tracking-wider">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {filteredFinanceRepRows.length === 0 ? (
                            <tr><td colSpan={6} className="px-4 py-12 text-center text-gray-400 font-medium italic">No sales reps found matching your search.</td></tr>
                          ) : (
                            filteredFinanceRepRows.map((row) => (
                              <tr key={row.user.id} className="hover:bg-gray-50 transition-colors">
                                <td className="px-4 py-4">
                                  <div className="font-bold text-gray-900">{row.user.name}</div>
                                  <div className="text-xs text-gray-400">{row.user.email}</div>
                                </td>
                                <td className="px-4 py-4 font-semibold text-[#1A6FBF]">{formatMoney(row.revenue)}</td>
                                <td className="px-4 py-4 text-gray-700">{row.delivered}</td>
                                <td className="px-4 py-4 font-semibold text-gray-900">{formatMoney(row.netProfit)}</td>
                                <td className="px-4 py-4 text-gray-600">{formatMoney(row.cpa)}</td>
                                <td className="px-4 py-4"><span className="inline-block px-2 py-0.5 rounded-full text-xs font-bold bg-blue-100 text-blue-700">{row.roi}%</span></td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {financeTab === "Agent Costs" && (
                <div className="space-y-4">
                  <section className="grid grid-cols-2 lg:grid-cols-4 gap-4" aria-label="Agent cost summary">
                    {[
                      { title: "Delivery Costs", value: formatMoney(financeExpenses.filter((e) => e.type === "Delivery" || e.type === "Waybill").reduce((s, e) => s + e.amount, 0)), helper: `Delivery & Waybill expenses · ${selectedFinancePeriodLabel}`, tone: "blue", icon: Truck },
                      { title: "Orders Delivered", value: String(financeAgentDeliveredCount), helper: "by agents this period", tone: "green", icon: PackageCheck },
                      { title: "Agent Stock Value", value: formatMoney(totalAgentStockValue), helper: `${agentInventoryUnits} units in hand`, tone: "orange", icon: EmptyProductsIcon },
                      { title: "Stock Loss", value: formatMoney(agentStockIssueLoss), helper: `${agentStockLossRate}% of total value`, tone: "red", icon: AlertTriangle },
                    ].map(({ title, value, helper, tone, icon: Icon }) => (
                      <article key={title} className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
                        <div className="flex items-center justify-between mb-2">
                          <span className={`w-9 h-9 rounded-full flex items-center justify-center ${tone === "blue" ? "bg-blue-50 text-blue-500" : tone === "green" ? "bg-green-50 text-green-500" : tone === "orange" ? "bg-orange-50 text-orange-500" : "bg-red-50 text-red-500"}`}><Icon className="w-4 h-4" /></span>
                        </div>
                        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{title}</h2>
                        <strong className={`text-xl font-bold block my-1 ${tone === "red" ? "text-red-600" : "text-gray-900"}`}>{value}</strong>
                        <p className="text-[10px] text-gray-400">{helper}</p>
                      </article>
                    ))}
                  </section>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
                      <h2 className="text-sm font-bold text-gray-800 mb-1">Top Agents by Deliveries</h2>
                      <p className="text-xs text-gray-400 mb-3">Agents with most completed deliveries</p>
                      <div className="flex flex-col gap-2">{topAgentsByDeliveries.map((row) => <div key={row.agent.id} className="flex items-center justify-between text-sm"><span className="text-gray-700">{row.agent.name}</span><strong className="text-gray-900">{row.deliveries}</strong></div>)}</div>
                    </div>
                    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
                      <h2 className="text-sm font-bold text-gray-800 mb-1">Most Stock Issues</h2>
                      <p className="text-xs text-gray-400 mb-3">Defective and missing stock by agent</p>
                      <div className="flex flex-col gap-2">{topAgentsByIssues.map((row) => <div key={row.agent.id} className="flex items-center justify-between text-sm"><span className="text-gray-700">{row.agent.name}</span><strong className="text-red-600">{formatMoney(row.defectiveValue + row.missingValue)}</strong></div>)}</div>
                    </div>
                  </div>
                  <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                    <div className="px-5 py-4 border-b border-gray-100">
                      <h2 className="text-sm font-bold text-gray-800">Agent Performance &amp; Profitability</h2>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-gray-50 border-b border-gray-200 text-left">
                            {["Agent Name/Location", "Total Deliveries", "Success Rate", "Stock Value", "Profit Contribution", "Actions"].map((h) => (
                              <th key={h} className="px-4 py-3 font-semibold text-gray-500 uppercase text-[10px] tracking-wider">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {financeAgentRows.length === 0 ? (
                            <tr><td colSpan={6} className="px-4 py-12 text-center text-gray-400 font-medium italic">No agent data available for this period.</td></tr>
                          ) : (
                            financeAgentRows.map((row) => (
                              <tr key={row.agent.id} className="hover:bg-gray-50 transition-colors">
                                <td className="px-4 py-4">
                                  <div className="font-bold text-gray-900">{row.agent.name}</div>
                                  <div className="text-xs text-gray-400">{row.agent.zone}</div>
                                </td>
                                <td className="px-4 py-4 text-gray-700">{row.deliveries}</td>
                                <td className="px-4 py-4"><span className="inline-block px-2 py-0.5 rounded-full text-xs font-bold bg-blue-100 text-blue-700">{row.successRate}%</span></td>
                                <td className="px-4 py-4 font-semibold text-gray-900">{formatMoney(row.stockValue)}</td>
                                <td className="px-4 py-4 font-semibold text-[#1A6FBF]">{formatMoney(row.profitContribution)}</td>
                                <td className="px-4 py-4">
                                  <button className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-gray-200 bg-gray-50 text-gray-700 rounded-md hover:bg-gray-100 transition-colors" onClick={() => openAgentModal(row.agent, "agentDetails")}>Details</button>
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {financeTab === "Remittance" && (
                <div className="space-y-4">
                  {/* Top metric cards */}
                  <section className="grid grid-cols-2 lg:grid-cols-4 gap-4" aria-label="Remittance summary">
                    {[
                      { title: "Expected Remittance", value: formatMoney(totalRemittanceExpected), helper: `From ${financeDeliveredCount} delivered orders`, tone: "blue", icon: HandCoins },
                      { title: "Cash Received", value: formatMoney(totalRemittanceReceived), helper: totalRemittanceExpected === 0 ? "—" : `${Math.round((totalRemittanceReceived / totalRemittanceExpected) * 100)}% collected`, tone: "green", icon: BadgeCheck },
                      { title: "Outstanding", value: formatMoney(totalRemittanceOutstanding), helper: `${remittanceRows.filter((r) => r.outstanding > 0).length} partner${remittanceRows.filter((r) => r.outstanding > 0).length === 1 ? "" : "s"} owe you`, tone: "amber", icon: AlertTriangle },
                      { title: "Logistics Fees", value: formatMoney(totalLogisticsCost), helper: "Already deducted by partners", tone: "gray", icon: Truck },
                    ].map(({ title, value, helper, tone, icon: Icon }) => (
                      <article key={title} className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
                        <div className="flex items-center justify-between mb-2">
                          <span className={`w-9 h-9 rounded-full flex items-center justify-center ${tone === "blue" ? "bg-blue-50 text-blue-500" : tone === "green" ? "bg-green-50 text-green-500" : tone === "amber" ? "bg-amber-50 text-amber-500" : "bg-gray-50 text-gray-500"}`}><Icon className="w-4 h-4" /></span>
                        </div>
                        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{title}</h2>
                        <strong className={`text-xl font-bold block my-1 ${tone === "amber" ? "text-amber-700" : tone === "green" ? "text-green-700" : "text-gray-900"}`}>{value}</strong>
                        <p className="text-[10px] text-gray-400">{helper}</p>
                      </article>
                    ))}
                  </section>

                  {/* Overdue alert banner */}
                  {remittanceRows.filter((r) => r.outstanding > 0 && r.oldestUnpaidDays > 7).length > 0 && (
                    <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                      <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
                      <div>
                        <p className="text-sm font-bold text-red-700">Overdue Remittance</p>
                        <p className="text-xs text-red-600 mt-0.5">
                          {remittanceRows.filter((r) => r.outstanding > 0 && r.oldestUnpaidDays > 7).map((r) => `${r.partnerName} (${r.oldestUnpaidDays}d · ${formatMoney(r.outstanding)} owed)`).join(" · ")}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Per-partner table */}
                  <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-4 border-b border-gray-100">
                      <div>
                        <h2 className="text-sm font-bold text-gray-800">Per-Logistics-Partner Reconciliation</h2>
                        <p className="text-xs text-gray-400">{selectedFinancePeriodLabel} · sorted by outstanding balance</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus-within:ring-2 focus-within:ring-[#1A6FBF]">
                          <Search className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                          <input className="bg-transparent outline-none text-xs w-32" value={remittanceSearch} onChange={(e) => setRemittanceSearch(e.target.value)} placeholder="Search partner..." />
                        </label>
                        <select className="!min-h-0 h-9 px-3 border border-gray-200 rounded-md bg-white text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#1A6FBF]" value={remittancePartnerFilter} onChange={(e) => setRemittancePartnerFilter(e.target.value)}>
                          {remittancePartnerOptions.map((p) => <option key={p}>{p}</option>)}
                        </select>
                      </div>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-gray-50 border-b border-gray-200 text-left">
                            {["Logistics Partner", "Orders", "Revenue", "Logistics Fees", "Expected", "Received", "Outstanding", "Aging", "% Paid"].map((h) => <th key={h} className="px-4 py-3 font-semibold text-gray-500 uppercase text-[10px] tracking-wider whitespace-nowrap">{h}</th>)}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {filteredRemittanceRows.length === 0 ? (
                            <tr><td colSpan={9} className="px-4 py-12 text-center text-sm text-gray-400 italic">No delivered orders in this period yet.</td></tr>
                          ) : (
                            filteredRemittanceRows.map((row) => {
                              const pct = row.expected === 0 ? 0 : Math.round((row.remitted / row.expected) * 100);
                              const pctTone = pct >= 100 ? "bg-green-100 text-green-700" : pct >= 50 ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700";
                              return (
                                <tr key={row.partnerName} className="hover:bg-gray-50 transition-colors">
                                  <td className="px-4 py-4">
                                    <div className="font-bold text-gray-900">{row.partnerName}</div>
                                    {row.agentId && <div className="text-xs text-gray-400">{agents.find((a) => a.id === row.agentId)?.zone ?? "—"}</div>}
                                  </td>
                                  <td className="px-4 py-4 text-gray-700">{row.orderCount}</td>
                                  <td className="px-4 py-4 text-gray-700">{formatMoney(row.revenue)}</td>
                                  <td className="px-4 py-4 text-gray-600">{formatMoney(row.logisticsCost)}</td>
                                  <td className="px-4 py-4 font-semibold text-blue-700">{formatMoney(row.expected)}</td>
                                  <td className="px-4 py-4 font-semibold text-green-700">{formatMoney(row.remitted)}</td>
                                  <td className={`px-4 py-4 font-bold ${row.outstanding > 0 ? "text-amber-700" : "text-gray-400"}`}>{formatMoney(row.outstanding)}</td>
                                  <td className="px-4 py-4">
                                    {row.outstanding > 0
                                      ? (() => { const ag = remittanceAgingLabel(row.oldestUnpaidDays); return <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold ${ag.cls}`}>{ag.label}</span>; })()
                                      : <span className="text-gray-300 text-xs">—</span>}
                                  </td>
                                  <td className="px-4 py-4"><span className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold ${pctTone}`}>{pct}%</span></td>
                                </tr>
                              );
                            })
                          )}
                          {filteredRemittanceRows.length > 0 && (
                            <tr className="bg-gray-50 font-bold border-t border-gray-200">
                              <td className="px-4 py-3 text-gray-900">Total</td>
                              <td className="px-4 py-3 text-gray-700">{filteredRemittanceRows.reduce((s, r) => s + r.orderCount, 0)}</td>
                              <td className="px-4 py-3 text-gray-700">{formatMoney(filteredRemittanceRows.reduce((s, r) => s + r.revenue, 0))}</td>
                              <td className="px-4 py-3 text-gray-700">{formatMoney(filteredRemittanceRows.reduce((s, r) => s + r.logisticsCost, 0))}</td>
                              <td className="px-4 py-3 text-blue-700">{formatMoney(filteredRemittanceRows.reduce((s, r) => s + r.expected, 0))}</td>
                              <td className="px-4 py-3 text-green-700">{formatMoney(filteredRemittanceRows.reduce((s, r) => s + r.remitted, 0))}</td>
                              <td className="px-4 py-3 text-amber-700">{formatMoney(filteredRemittanceRows.reduce((s, r) => s + r.outstanding, 0))}</td>
                              <td className="px-4 py-3 text-gray-700">—</td>
                              <td className="px-4 py-3 text-gray-700">—</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Per-order outstanding list */}
                  <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                    <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                      <div>
                        <h2 className="text-sm font-bold text-gray-800">Outstanding Orders</h2>
                        <p className="text-xs text-gray-400">Delivered orders with money still owed by the logistics partner</p>
                      </div>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-gray-50 border-b border-gray-200 text-left">
                            {["Order", "Customer", "Partner", "Amount", "Logistics", "To Remit", "Received", "Status", "Action"].map((h) => <th key={h} className="px-4 py-3 font-semibold text-gray-500 uppercase text-[10px] tracking-wider whitespace-nowrap">{h}</th>)}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {(() => {
                            const outstanding = financeDeliveredRows.filter((o) => orderRemittanceOutstanding(o) > 0 || orderRemittanceStatus(o) !== "Paid").sort((a, b) => orderRemittanceOutstanding(b) - orderRemittanceOutstanding(a));
                            if (outstanding.length === 0) {
                              return <tr><td colSpan={9} className="px-4 py-12 text-center text-sm text-gray-400 italic">All delivered orders are fully remitted. 🎉</td></tr>;
                            }
                            return outstanding.slice(0, 20).map((order) => {
                              const status = orderRemittanceStatus(order);
                              const statusTone = status === "Paid" ? "bg-green-100 text-green-700" : status === "Partial" ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700";
                              return (
                                <tr key={order.id} className="hover:bg-gray-50 transition-colors">
                                  <td className="px-4 py-3 font-bold text-[#1A6FBF]">{order.id}</td>
                                  <td className="px-4 py-3"><div className="font-medium text-gray-900">{order.customer}</div><div className="text-xs text-gray-400">{order.phone}</div></td>
                                  <td className="px-4 py-3 text-gray-700">{agents.find((a) => a.id === order.agentId)?.name ?? "Unassigned"}</td>
                                  <td className="px-4 py-3 text-gray-700">{formatProductMoney(order.amount, order.currency)}</td>
                                  <td className="px-4 py-3 text-gray-600">{formatProductMoney(orderLogisticsCost(order), order.currency)}</td>
                                  <td className="px-4 py-3 font-semibold text-blue-700">{formatProductMoney(orderAmountToRemit(order), order.currency)}</td>
                                  <td className="px-4 py-3 font-semibold text-green-700">{formatProductMoney(orderAmountRemitted(order), order.currency)}</td>
                                  <td className="px-4 py-3"><span className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold ${statusTone}`}>{status}</span></td>
                                  <td className="px-4 py-3"><button className="!min-h-0 inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold border border-[#1A6FBF] text-[#1A6FBF] rounded-md hover:bg-blue-50 transition-colors" onClick={() => openRecordRemittance(order)}><HandCoins className="w-3 h-3" /> Record</button></td>
                                </tr>
                              );
                            });
                          })()}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {financeTab === "Profit & Loss" && (() => {
                const prevRange = explicitPeriodRange(financePeriod, financeDateRange, true);
                const prevDelivered = deliveredOrderRows.filter((o) => isInExplicitRange(orderDeliveredKey(o), prevRange));
                const prevRevenue = prevDelivered.reduce((s, o) => s + o.amount, 0);
                const prevCogs = prevDelivered.reduce((s, o) => s + costForOrder(o), 0);
                const prevLogistics = prevDelivered.reduce((s, o) => s + orderLogisticsCost(o), 0);
                const prevExpenses = expenses.filter((e) => isInExplicitRange(normalizeDateKey(e.date), prevRange)).reduce((s, e) => s + e.amount, 0);
                const prevGross = prevRevenue - prevCogs - prevLogistics;
                const prevNet = prevGross - prevExpenses;
                const trueGrossProfit = financeRevenue - financeCogs - totalLogisticsCost;
                const trueNetProfit = trueGrossProfit - financeExpenseTotal;
                const chg = (cur: number, prev: number) => {
                  const pct = percentChange(cur, prev);
                  const cls = pct >= 0 ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700";
                  return <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold ${cls}`}>{formatTrend(pct)}</span>;
                };
                return (
                <div className="space-y-4">
                  <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-gray-50 border-b border-gray-200 text-left">
                            {["Account Description", "Current Period", "Previous Period", "% Change"].map((h) => (
                              <th key={h} className="px-4 py-3 font-semibold text-gray-500 uppercase text-[10px] tracking-wider">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          <tr className="bg-blue-50"><td className="px-4 py-2 font-bold text-[#1A6FBF] text-xs uppercase tracking-wide" colSpan={4}>Revenue</td></tr>
                          <tr className="hover:bg-gray-50"><td className="px-4 py-3 text-gray-700">Delivered Orders</td><td className="px-4 py-3 font-semibold text-gray-900">{formatMoney(financeRevenue)}</td><td className="px-4 py-3 text-gray-400">{formatMoney(prevRevenue)}</td><td className="px-4 py-3">{chg(financeRevenue, prevRevenue)}</td></tr>
                          <tr className="bg-red-50"><td className="px-4 py-2 font-bold text-red-600 text-xs uppercase tracking-wide" colSpan={4}>Cost of Goods Sold (COGS)</td></tr>
                          <tr className="hover:bg-gray-50"><td className="px-4 py-3 text-red-500">Product Sourcing Costs</td><td className="px-4 py-3 font-semibold text-gray-900">({formatMoney(financeCogs)})</td><td className="px-4 py-3 text-gray-400">({formatMoney(prevCogs)})</td><td className="px-4 py-3">{chg(financeCogs, prevCogs)}</td></tr>
                          <tr className="hover:bg-gray-50"><td className="px-4 py-3 text-red-500">Logistics / Delivery Fees</td><td className="px-4 py-3 font-semibold text-gray-900">({formatMoney(totalLogisticsCost)})</td><td className="px-4 py-3 text-gray-400">({formatMoney(prevLogistics)})</td><td className="px-4 py-3">{chg(totalLogisticsCost, prevLogistics)}</td></tr>
                          <tr className="bg-green-50"><td className="px-4 py-3 font-bold text-green-700">Gross Profit</td><td className="px-4 py-3 font-bold text-green-700">{formatMoney(trueGrossProfit)}</td><td className="px-4 py-3 text-gray-400">{formatMoney(prevGross)}</td><td className="px-4 py-3">{chg(trueGrossProfit, prevGross)}</td></tr>
                          <tr className="bg-red-50"><td className="px-4 py-2 font-bold text-red-600 text-xs uppercase tracking-wide" colSpan={4}>Operating Expenses</td></tr>
                          <tr className="hover:bg-gray-50"><td className="px-4 py-3 text-red-500">Expenses</td><td className="px-4 py-3 font-semibold text-gray-900">({formatMoney(financeExpenseTotal)})</td><td className="px-4 py-3 text-gray-400">({formatMoney(prevExpenses)})</td><td className="px-4 py-3">{chg(financeExpenseTotal, prevExpenses)}</td></tr>
                          <tr className="bg-blue-50"><td className="px-4 py-3 font-bold text-[#1A6FBF]">Net Profit</td><td className="px-4 py-3 font-bold text-[#1A6FBF]">{formatMoney(trueNetProfit)}</td><td className="px-4 py-3 text-gray-400">{formatMoney(prevNet)}</td><td className="px-4 py-3">{chg(trueNetProfit, prevNet)}</td></tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {[
                      { title: "Gross Margin", value: `${financeGrossMargin}%`, helper: "Revenue minus cost of goods sold" },
                      { title: "Net Margin", value: `${financeNetMargin}%`, helper: "Net profit as percentage of revenue" },
                    ].map(({ title, value, helper }) => (
                      <article key={title} className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
                        <h2 className="text-sm font-bold text-gray-800 mb-1">{title}</h2>
                        <strong className="text-3xl font-bold text-[#1A6FBF]">{value}</strong>
                        <p className="text-xs text-gray-400 mt-1">{helper}</p>
                      </article>
                    ))}
                  </div>
                </div>
                );
              })()}

              {financeTab === "Product Profitability" && (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm">
                      <TrendingUp className="w-4 h-4 text-blue-500" />
                      <span className="text-gray-500">Avg Margin:</span>
                      <strong className="text-gray-900">{avgProductMargin}%</strong>
                    </div>
                    <div className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm">
                      <CircleDollarSign className="w-4 h-4 text-green-500" />
                      <span className="text-gray-500">ROAS:</span>
                      <strong className="text-gray-900">{financeRoas}{financeRoas === "Uncapped" || financeRoas === "N/A" ? "" : "x"}</strong>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="flex flex-col gap-1 flex-1 max-w-xs">
                      <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Product for Analysis</span>
                      <select className="h-9 px-3 border border-gray-200 rounded-md bg-white text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#1A6FBF]" aria-label="Product for analysis" value={selectedProductId} onChange={(event) => { const p = products.find((pr) => pr.id === event.target.value); setSelectedProductId(event.target.value); setFinanceProductSearch(p?.name ?? ""); }}>
                        <option value="">All products</option>
                        {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
                      </select>
                    </label>
                    <label className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm focus-within:ring-2 focus-within:ring-[#1A6FBF] flex-1 max-w-xs min-w-0 self-end">
                      <Search className="w-4 h-4 text-gray-400 shrink-0" />
                      <input className="bg-transparent outline-none text-sm w-full min-w-0" value={financeProductSearch} onChange={(event) => setFinanceProductSearch(event.target.value)} placeholder="Search by product name or SKU..." />
                    </label>
                    <span className="self-end text-xs text-gray-400 pb-2">{productProfitabilityRows.length} of {products.length} products</span>
                  </div>
                  <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-gray-50 border-b border-gray-200 text-left">
                            {["Product Name", "Total Orders", "Delivered", "Delivery Rate", "Performance", "Units Sold", "Revenue", "COGS", "Expenses", "Net Profit", "Margin %", "ROI", "ROAS"].map((h) => (
                              <th key={h} className="px-4 py-3 font-semibold text-gray-500 uppercase text-[10px] tracking-wider whitespace-nowrap">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {productProfitabilityRows.length === 0 ? (
                            <tr><td colSpan={13} className="px-4 py-12 text-center text-gray-400 font-medium italic">No products found matching your search</td></tr>
                          ) : (
                            productProfitabilityRows.map((row) => (
                              <tr key={row.product.id} className="hover:bg-gray-50 transition-colors">
                                <td className="px-4 py-4">
                                  <div className="font-bold text-gray-900">{row.product.name}</div>
                                  <div className="text-xs text-gray-400 font-mono">{row.product.sku}</div>
                                </td>
                                <td className="px-4 py-4 text-gray-700">{row.totalOrders}</td>
                                <td className="px-4 py-4 text-green-700 font-semibold">{row.deliveredCount}</td>
                                <td className="px-4 py-4 font-bold text-gray-900">{row.deliveryRate}%</td>
                                <td className="px-4 py-4"><span className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold ${performanceTone(row.tier)}`}>{row.tier}</span></td>
                                <td className="px-4 py-4 text-gray-700">{row.unitsSold}</td>
                                <td className="px-4 py-4 font-semibold text-[#1A6FBF]">{formatMoney(row.revenue)}</td>
                                <td className="px-4 py-4 text-gray-600">{formatMoney(row.cogs)}</td>
                                <td className="px-4 py-4 text-gray-600">{formatMoney(row.expenses)}</td>
                                <td className="px-4 py-4 font-bold text-gray-900">{formatMoney(row.netProfit)}</td>
                                <td className="px-4 py-4"><span className="inline-block px-2 py-0.5 rounded-full text-xs font-bold bg-green-100 text-green-700">{row.margin}%</span></td>
                                <td className="px-4 py-4"><span className="inline-block px-2 py-0.5 rounded-full text-xs font-bold bg-blue-100 text-blue-700">{row.roi}%</span></td>
                                <td className="px-4 py-4 font-semibold text-gray-900">{row.expenses === 0 ? (row.revenue > 0 ? "Uncapped" : "N/A") : `${(row.revenue / row.expenses).toFixed(2)}x`}</td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {financeTab === "State Performance" && (
                <div className="space-y-4">
                  {/* Benchmark legend */}
                  <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex items-center justify-between flex-wrap gap-3">
                    <div>
                      <h2 className="text-sm font-bold text-gray-800">Nigerian POD Benchmark</h2>
                      <p className="text-xs text-gray-400 mt-0.5">A state's delivery rate tells you whether it's worth scaling ads or pulling back</p>
                    </div>
                    <div className="flex items-center gap-3 text-xs flex-wrap">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-50 text-green-700 font-semibold border border-green-200"><span className="w-2 h-2 rounded-full bg-green-500" /> Good · ≥60%</span>
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 font-semibold border border-amber-200"><span className="w-2 h-2 rounded-full bg-amber-500" /> Fair · 50–59%</span>
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-50 text-red-700 font-semibold border border-red-200"><span className="w-2 h-2 rounded-full bg-red-500" /> Bad · &lt;50%</span>
                    </div>
                  </div>

                  {/* Top + Worst side-by-side */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <article className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                      <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
                        <span className="w-8 h-8 rounded-lg bg-green-50 text-green-600 flex items-center justify-center"><BadgeCheck className="w-4 h-4" /></span>
                        <div>
                          <h2 className="text-sm font-bold text-gray-800">Top States</h2>
                          <p className="text-xs text-gray-400">≥60% delivery rate — scale ads here</p>
                        </div>
                      </div>
                      {topStateRows.length === 0 ? (
                        <p className="px-5 py-8 text-sm text-gray-400 italic text-center">No state hit the 60% bar yet in this period.</p>
                      ) : (
                        <div className="divide-y divide-gray-100">
                          {topStateRows.map((s, idx) => (
                            <div key={s.state} className="flex items-center justify-between px-5 py-3">
                              <div className="flex items-center gap-3">
                                <span className={`w-7 h-7 rounded-full text-xs font-bold flex items-center justify-center ${idx === 0 ? "bg-yellow-100 text-yellow-700" : idx === 1 ? "bg-gray-100 text-gray-600" : idx === 2 ? "bg-orange-100 text-orange-700" : "bg-gray-50 text-gray-400"}`}>{idx + 1}</span>
                                <div>
                                  <strong className="text-sm font-bold text-gray-900">{s.state}</strong>
                                  <p className="text-[10px] text-gray-500 m-0">{s.delivered}/{s.total} delivered · {formatMoney(s.revenue)}</p>
                                </div>
                              </div>
                              <span className="inline-block px-2.5 py-1 rounded-full text-xs font-bold bg-green-100 text-green-700">{s.deliveryRate}%</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </article>

                    <article className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                      <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
                        <span className="w-8 h-8 rounded-lg bg-red-50 text-red-600 flex items-center justify-center"><AlertTriangle className="w-4 h-4" /></span>
                        <div>
                          <h2 className="text-sm font-bold text-gray-800">Worst States</h2>
                          <p className="text-xs text-gray-400">&lt;50% delivery rate — pause ads or screen leads harder</p>
                        </div>
                      </div>
                      {worstStateRows.length === 0 ? (
                        <p className="px-5 py-8 text-sm text-gray-400 italic text-center">No underperforming states with enough orders to flag yet.</p>
                      ) : (
                        <div className="divide-y divide-gray-100">
                          {worstStateRows.map((s, idx) => (
                            <div key={s.state} className="flex items-center justify-between px-5 py-3">
                              <div className="flex items-center gap-3">
                                <span className="w-7 h-7 rounded-full text-xs font-bold flex items-center justify-center bg-red-100 text-red-700">{idx + 1}</span>
                                <div>
                                  <strong className="text-sm font-bold text-gray-900">{s.state}</strong>
                                  <p className="text-[10px] text-gray-500 m-0">{s.delivered}/{s.total} delivered · {s.cancelled + s.failed} cancelled/failed</p>
                                </div>
                              </div>
                              <span className="inline-block px-2.5 py-1 rounded-full text-xs font-bold bg-red-100 text-red-700">{s.deliveryRate}%</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </article>
                  </div>

                  {/* Full breakdown table */}
                  <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                    <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                      <div>
                        <h2 className="text-sm font-bold text-gray-800">All States — {selectedFinancePeriodLabel}</h2>
                        <p className="text-xs text-gray-400">{stateRows.length} state{stateRows.length === 1 ? "" : "s"} active{productFilterActive ? ` · filtered to ${financeProductFilter.length} product${financeProductFilter.length === 1 ? "" : "s"}` : ""}</p>
                      </div>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-gray-50 border-b border-gray-200 text-left">
                            {["State", "Total Orders", "Delivered", "Cancelled / Failed", "Pending", "Delivery Rate", "Performance", "Revenue", "Gross Profit"].map((h) => (
                              <th key={h} className="px-4 py-3 font-semibold text-gray-500 uppercase text-[10px] tracking-wider whitespace-nowrap">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {stateRows.length === 0 ? (
                            <tr><td colSpan={9} className="px-4 py-12 text-center text-sm text-gray-400 italic">No orders captured for this period.</td></tr>
                          ) : (
                            stateRows.map((s) => (
                              <tr key={s.state} className="hover:bg-gray-50 transition-colors">
                                <td className="px-4 py-3 font-bold text-gray-900">{s.state}</td>
                                <td className="px-4 py-3 text-gray-700">{s.total}</td>
                                <td className="px-4 py-3 text-green-700 font-semibold">{s.delivered}</td>
                                <td className="px-4 py-3 text-red-600">{s.cancelled + s.failed}</td>
                                <td className="px-4 py-3 text-gray-500">{s.pending}</td>
                                <td className="px-4 py-3 font-bold text-gray-900">{s.deliveryRate}%</td>
                                <td className="px-4 py-3"><span className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold ${performanceTone(s.tier)}`}>{s.tier}</span></td>
                                <td className="px-4 py-3 font-semibold text-[#1A6FBF]">{formatMoney(s.revenue)}</td>
                                <td className="px-4 py-3 text-gray-700">{formatMoney(s.grossProfit)}</td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : activePage === "Ad Tracking" ? (
            <div className="space-y-6">
              <header className="flex flex-col gap-1">
                <h1 className="text-2xl font-bold text-[#1A6FBF]">Ad Tracking</h1>
                <p className="text-sm font-medium text-gray-500">Orders placed via tracked links — grouped by campaign and creative</p>
              </header>
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-5 flex items-start gap-4">
                <span className="w-10 h-10 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center shrink-0"><BookOpen className="w-5 h-5" /></span>
                <div className="flex-1">
                  <h2 className="text-sm font-bold text-blue-900 mb-1">New to ad tracking?</h2>
                  <p className="text-sm text-blue-700">Learn how to tag your ad links so every order gets attributed to the right campaign and creative.</p>
                </div>
                <button className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-[#1A6FBF] text-white rounded-md hover:bg-blue-700 transition-colors shrink-0" onClick={() => showToast("Ad tracking guide opened for this demo.")}>Read the guide</button>
              </div>
              <section className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                  <h2 className="text-sm font-bold text-gray-800">Tracked Orders</h2>
                  <span className="text-xs font-medium text-gray-500 bg-gray-100 px-2 py-1 rounded-full">{trackedOrders.length} attributed</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200 text-left">
                        {["Order", "Customer", "Product", "Package", "Campaign", "Source", "Amount", "Date"].map((h) => (
                          <th key={h} className="px-4 py-3 font-semibold text-gray-500 uppercase text-[10px] tracking-wider">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {trackedOrders.length === 0 ? (
                        <tr><td colSpan={8} className="px-4 py-12 text-center text-gray-400 font-medium italic">No UTM-tracked orders yet. Submit a preview order from Embed Form to test attribution.</td></tr>
                      ) : (
                        trackedOrders.map((order) => (
                          <tr key={order.id} className="hover:bg-gray-50 transition-colors">
                            <td className="px-4 py-4 font-bold text-gray-900">{order.id}</td>
                            <td className="px-4 py-4">
                              <div className="font-semibold text-gray-900">{order.customer}</div>
                              <div className="text-xs text-gray-400">{order.phone}</div>
                            </td>
                            <td className="px-4 py-4 text-gray-700">{order.productName}</td>
                            <td className="px-4 py-4 text-gray-600">{order.packageName}</td>
                            <td className="px-4 py-4"><span className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold bg-purple-100 text-purple-700">{order.utmCampaign}</span></td>
                            <td className="px-4 py-4"><span className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-700">{order.utmSource}</span></td>
                            <td className="px-4 py-4 font-bold text-[#1A6FBF]">{formatProductMoney(order.amount, order.currency)}</td>
                            <td className="px-4 py-4 text-gray-500">{order.date}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          ) : activePage === "User Management" ? (
            <div className="space-y-6">
              <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
                <div className="flex flex-col gap-1">
                  <h1 className="text-2xl font-bold text-[#1A6FBF]">User Management</h1>
                  <p className="text-sm font-medium text-gray-500">Manage company-wide user roles, permissions, and security settings.</p>
                </div>
                <div className="flex items-center gap-2">
                  <button className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border border-gray-200 bg-white text-gray-700 rounded-md hover:bg-gray-50 transition-colors" onClick={exportUserData}>
                    <Upload className="w-4 h-4" /> Export Data
                  </button>
                  <button className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-[#1A6FBF] text-white rounded-md hover:bg-blue-700 transition-colors" onClick={openAddUserModal}>
                    <UserPlus className="w-4 h-4" /> Add User
                  </button>
                </div>
              </header>

              <section className="grid grid-cols-1 lg:grid-cols-3 gap-4" aria-label="User summary">
                {[
                  { title: "Total Users", value: String(users.length), helper: "all roles", icon: UserRound, tone: "blue" },
                  { title: "Active Users", value: String(activeUserCount), helper: `${users.length - activeUserCount} inactive`, icon: CheckCircle2, tone: "green" },
                  { title: "New Users (Month)", value: String(users.length), helper: "joined this month", icon: UserPlus, tone: "purple" },
                ].map(({ title, value, helper, icon: Icon, tone }) => (
                  <article key={title} className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
                    <div className="flex items-center justify-between mb-2">
                      <span className={`w-10 h-10 rounded-full flex items-center justify-center ${tone === "blue" ? "bg-blue-50 text-blue-500" : tone === "green" ? "bg-green-50 text-green-500" : "bg-purple-50 text-purple-500"}`}><Icon className="w-5 h-5" /></span>
                    </div>
                    <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{title}</h2>
                    <strong className="text-2xl font-bold text-gray-900 block my-1">{value}</strong>
                    <p className="text-[10px] text-gray-400 font-medium">{helper}</p>
                  </article>
                ))}
              </section>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
                  <h2 className="text-sm font-bold text-gray-800 mb-1">User Growth</h2>
                  <p className="text-xs text-gray-400 mb-3">Growth trend over the last 6 months</p>
                  <div style={{ height: 120 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={(() => {
                        const now = new Date();
                        return Array.from({ length: 6 }, (_, i) => {
                          const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1);
                          const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
                          const count = users.filter((u) => {
                            const created = new Date(u.created);
                            if (!Number.isNaN(created.getTime())) {
                              return `${created.getFullYear()}-${String(created.getMonth() + 1).padStart(2, "0")}` <= mk;
                            }
                            return true;
                          }).length;
                          return { month: d.toLocaleString("en-US", { month: "short" }), users: count };
                        });
                      })()}>
                        <XAxis dataKey="month" tickLine={false} tick={{ fontSize: 10, fill: "#9ca3af" }} />
                        <YAxis tickLine={false} tick={{ fontSize: 10, fill: "#9ca3af" }} allowDecimals={false} />
                        <Tooltip />
                        <Line type="monotone" dataKey="users" stroke="#1A6FBF" strokeWidth={2} dot={{ r: 3, strokeWidth: 2, fill: "#fff" }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
                  <h2 className="text-sm font-bold text-gray-800 mb-1">Role Distribution</h2>
                  <p className="text-xs text-gray-400 mb-3">Active roles by category</p>
                  <div className="flex items-center gap-6">
                    <div className="w-16 h-16 rounded-full border-4 border-[#1A6FBF] flex items-center justify-center flex-col shrink-0">
                      <strong className="text-lg font-bold text-gray-900">{users.length}</strong>
                      <span className="text-[9px] text-gray-400">Total</span>
                    </div>
                    <div className="flex flex-col gap-1.5 text-xs text-gray-600">
                      <span className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-blue-400 inline-block" /> Sales Reps ({percentText(salesUserCount, users.length)})</span>
                      <span className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-purple-400 inline-block" /> Admins ({percentText(adminUserCount, users.length)})</span>
                      <span className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-red-400 inline-block" /> Inv. Mgr ({percentText(inventoryUserCount, users.length)})</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm focus-within:ring-2 focus-within:ring-[#1A6FBF] flex-1 max-w-xs min-w-0">
                  <Search className="w-4 h-4 text-gray-400 shrink-0" />
                  <span className="sr-only">Search users</span>
                  <input className="bg-transparent outline-none text-sm w-full min-w-0" value={userSearch} onChange={(event) => setUserSearch(event.target.value)} placeholder="Search users by name, email..." />
                </label>
                <select className="h-9 px-3 border border-gray-200 rounded-md bg-white text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#1A6FBF] transition-colors" aria-label="User role" value={userRole} onChange={(event) => { setUserRole(event.target.value as UserRole); showToast(`User role filter set to ${event.target.value}.`); }}>{userRoles.map((role) => <option key={role}>{role}</option>)}</select>
                <select className="h-9 px-3 border border-gray-200 rounded-md bg-white text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#1A6FBF] transition-colors" aria-label="User status" value={userStatus} onChange={(event) => { setUserStatus(event.target.value as UserStatus); showToast(`User status filter set to ${event.target.value}.`); }}>{userStatuses.map((status) => <option key={status}>{status}</option>)}</select>
              </div>

              <section className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden" aria-label="Users table">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200 text-left">
                        <th className="px-4 py-3"><input type="checkbox" aria-label="Select all users" /></th>
                        {["Name & Email", "Role", "Permissions", "Status", "Created", "Actions"].map((h) => (
                          <th key={h} className="px-4 py-3 font-semibold text-gray-500 uppercase text-[10px] tracking-wider">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredUsers.length === 0 ? (
                        <tr><td colSpan={7} className="px-4 py-12 text-center text-gray-400 font-medium italic">No users found</td></tr>
                      ) : (
                        filteredUsers.map((user) => {
                          const userPerms = user.permissions ?? defaultPermsByRole[user.role] ?? [];
                          const isOwner = user.role === "Owner";
                          const isExpanded = expandedPermissionsUserId === user.id;
                          const permGroups = ["Orders", "Inventory", "Operations", "Finance", "Admin"] as const;
                          return (
                            <>
                              <tr key={user.id} className="border-t border-gray-100 hover:bg-gray-50/60 transition-colors">
                                <td className="px-4 py-4"><input type="checkbox" aria-label={`Select ${user.name}`} /></td>
                                <td className="px-4 py-4">
                                  <div className="flex items-center gap-2">
                                    <span className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-bold shrink-0">{userInitials(user.name)}</span>
                                    <div>
                                      <div className="font-bold text-gray-900">{user.name}</div>
                                      <div className="text-xs text-gray-400">{user.email}</div>
                                    </div>
                                  </div>
                                </td>
                                <td className="px-4 py-4"><span className={`role-pill ${isOwner ? "owner-pill" : ""}`}>{user.role}</span></td>
                                <td className="px-4 py-4">
                                  <button
                                    className="!min-h-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-semibold transition-colors hover:bg-blue-50 hover:border-blue-300 hover:text-[#1A6FBF] border-gray-200 text-gray-600 bg-gray-50"
                                    onClick={() => setExpandedPermissionsUserId(isExpanded ? null : user.id)}
                                  >
                                    {isOwner ? "All" : userPerms.length}/{permissionDefs.length}
                                    <ChevronRight className={`w-3 h-3 transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                                  </button>
                                </td>
                                <td className="px-4 py-4">
                                  <button type="button" className="flex items-center gap-2 text-sm" onClick={() => {
                                    setUsers((value) => value.map((item) => item.id === user.id ? { ...item, active: !item.active } : item));
                                    showToast(`${user.name} marked ${user.active ? "inactive" : "active"}.`);
                                  }}>
                                    <span className={`w-8 h-4 rounded-full transition-colors relative ${user.active ? "bg-[#1A6FBF]" : "bg-gray-200"}`}>
                                      <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-all ${user.active ? "left-4" : "left-0.5"}`} />
                                    </span>
                                    <strong className={user.active ? "text-green-600" : "text-gray-400"}>{user.active ? "Active" : "Inactive"}</strong>
                                  </button>
                                </td>
                                <td className="px-4 py-4 text-gray-500">{user.created}</td>
                                <td className="px-4 py-4">
                                  <div className="flex items-center gap-1">
                                    <button className="w-8 h-8 flex items-center justify-center rounded border border-gray-200 text-gray-500 hover:bg-gray-100 transition-colors" title="Edit user" aria-label={`Edit ${user.name}`} onClick={() => openEditUserModal(user)}><Pencil className="w-4 h-4" /></button>
                                    <button className="w-8 h-8 flex items-center justify-center rounded border border-gray-200 text-gray-500 hover:bg-gray-100 transition-colors" title="Reset password" aria-label={`Reset password for ${user.name}`} onClick={() => openResetPasswordModal(user)}><KeyRound className="w-4 h-4" /></button>
                                    <button className="w-8 h-8 flex items-center justify-center rounded border border-gray-200 text-red-400 hover:bg-red-50 transition-colors" title="Delete user" aria-label={`Delete ${user.name}`} onClick={() => openDeleteUserModal(user)}><Trash2 className="w-4 h-4" /></button>
                                  </div>
                                </td>
                              </tr>
                              {isExpanded && (
                                <tr key={`${user.id}-perms`} className="bg-blue-50/30 border-t border-blue-100">
                                  <td colSpan={7} className="px-6 py-4">
                                    <div className="flex items-start justify-between gap-3 mb-3">
                                      <div>
                                        <p className="text-sm font-semibold text-gray-900">{user.name} — Permissions</p>
                                        {isOwner && <p className="text-xs text-gray-500 mt-0.5">Owner always has full access. Permissions cannot be changed.</p>}
                                        {!isOwner && <p className="text-xs text-gray-500 mt-0.5">Toggle individual permissions for this user.</p>}
                                      </div>
                                      {!isOwner && (
                                        <button className="!min-h-0 text-xs text-[#1A6FBF] font-medium hover:underline" onClick={() => setUsers((prev) => prev.map((u) => u.id === user.id ? { ...u, permissions: defaultPermsByRole[u.role] } : u))}>Reset to defaults</button>
                                      )}
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                                      {permGroups.map((group) => {
                                        const groupPerms = permissionDefs.filter((p) => p.group === group);
                                        if (groupPerms.length === 0) return null;
                                        return (
                                          <div key={group}>
                                            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2">{group}</p>
                                            <div className="flex flex-col gap-1.5">
                                              {groupPerms.map((perm) => {
                                                const hasIt = isOwner || userPerms.includes(perm.key);
                                                return (
                                                  <label key={perm.key} className={`flex items-center gap-2.5 cursor-pointer ${isOwner ? "opacity-60 cursor-not-allowed" : ""}`}>
                                                    <button
                                                      type="button"
                                                      className={`!min-h-0 w-8 h-4 rounded-full transition-colors relative shrink-0 ${hasIt ? "bg-[#1A6FBF]" : "bg-gray-200"} ${isOwner ? "pointer-events-none" : ""}`}
                                                      onClick={() => !isOwner && toggleUserPermission(user.id, perm.key)}
                                                    >
                                                      <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-all ${hasIt ? "left-4" : "left-0.5"}`} />
                                                    </button>
                                                    <span className="text-xs text-gray-700">{perm.label}</span>
                                                  </label>
                                                );
                                              })}
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 text-xs text-gray-500">
                  <span>{filteredUsers.length} user{filteredUsers.length === 1 ? "" : "s"}</span>
                  <div className="flex items-center gap-1">
                    
                    <button className="px-3 py-1.5 rounded border border-[#1A6FBF] bg-blue-50 text-[#1A6FBF] font-bold">1</button>
                    
                  </div>
                </div>
              </section>
            </div>
          ) : activePage === "Round-Robin" ? (
            <div className="space-y-6">
              <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
                <div className="flex flex-col gap-1">
                  <h1 className="text-2xl font-bold text-[#1A6FBF]">Round-Robin Management</h1>
                  <p className="text-sm font-medium text-gray-500">Configure the lead distribution sequence for your sales team.</p>
                </div>
                <button className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border border-red-200 bg-red-50 text-red-600 rounded-md hover:bg-red-100 transition-colors" onClick={() => {
                  const reps = users.filter((u) => u.role === "Sales Rep");
                  if (reps.length === 0) { showToast("No sales reps in the sequence."); return; }
                  const first = reps[0];
                  setUsers((prev) => {
                    const nonReps = prev.filter((u) => u.role !== "Sales Rep");
                    const rotated = [...reps.slice(1), first];
                    return [...nonReps, ...rotated];
                  });
                  showToast(`Round-robin advanced — ${reps[1]?.name ?? reps[0].name} is now #1 in the sequence.`);
                }}>
                  <Repeat2 className="w-4 h-4" /> Advance Sequence
                </button>
              </header>

              <div className="flex flex-wrap items-center gap-3">
                <nav className="flex items-center gap-1 bg-gray-100 p-1 rounded-lg" role="tablist" aria-label="Round-robin views">
                  {roundRobinTabs.map((tab) => (
                    <button
                      key={tab}
                      role="tab"
                      aria-selected={roundRobinTab === tab}
                      className={`px-4 py-1.5 rounded-md text-sm font-bold transition-all duration-200 whitespace-nowrap ${roundRobinTab === tab ? "bg-white text-[#1A6FBF] shadow-sm" : "text-gray-500 hover:text-gray-700 hover:bg-gray-200"}`}
                      onClick={() => { setRoundRobinTab(tab); }}
                    >
                      {tab} <span className="ml-1 text-xs opacity-70">({tab === "Active Sequence" ? roundRobinActiveRows.length : roundRobinExcludedRows.length})</span>
                    </button>
                  ))}
                </nav>
                <label className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm focus-within:ring-2 focus-within:ring-[#1A6FBF] flex-1 max-w-xs min-w-0">
                  <Search className="w-4 h-4 text-gray-400 shrink-0" />
                  <span className="sr-only">Search reps</span>
                  <input className="bg-transparent outline-none text-sm w-full min-w-0" value={roundRobinSearch} onChange={(event) => setRoundRobinSearch(event.target.value)} placeholder="Search reps..." />
                </label>
              </div>

              <div>
                <h2 className="text-sm font-bold text-gray-700 mb-3">Assignment Sequence</h2>
                {roundRobinRows.length === 0 ? (
                  <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400 font-medium italic">No sales representatives found</div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {roundRobinRows.map((row, index) => (
                      <article key={row.user.id} className={`bg-white rounded-xl border shadow-sm p-4 flex items-center gap-4 ${index === 0 ? "border-[#1A6FBF] ring-1 ring-[#1A6FBF]/20" : "border-gray-200"}`}>
                        <span className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${index === 0 ? "bg-[#1A6FBF] text-white" : "bg-gray-100 text-gray-500"}`}>#{index + 1}</span>
                        <div className="flex-1 min-w-0">
                          <div className="font-bold text-gray-900">{row.user.name}</div>
                          <div className="text-xs text-gray-400">{row.user.email}</div>
                        </div>
                        <div className="flex items-center gap-4 text-xs text-gray-500 shrink-0">
                          <span><strong className="text-gray-900">{row.openOrders}</strong> open</span>
                          <span><strong className="text-gray-900">{row.delivered}</strong> delivered</span>
                        </div>
                        <button className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-gray-200 bg-gray-50 text-gray-700 rounded-md hover:bg-gray-100 transition-colors shrink-0" onClick={() => openEditUserModal(row.user)}>{row.user.active ? "Exclude" : "Enable"}</button>
                      </article>
                    ))}
                  </div>
                )}
              </div>

              <div className="bg-blue-50 border border-blue-100 rounded-xl p-5 flex items-start gap-3">
                <Info className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" />
                <div>
                  <h3 className="text-sm font-bold text-blue-900 mb-1">How Round-Robin Works</h3>
                  <p className="text-sm text-blue-700">Incoming orders are assigned to the representative at position #1. Once assigned, that rep moves to the end of the active sequence.</p>
                  <p className="text-sm text-blue-700 mt-1">Excluded reps are skipped entirely until re-enabled.</p>
                </div>
              </div>
            </div>
          ) : activePage === "Embed Form" ? (
            <div className="space-y-6">
              <div className="flex items-center gap-2 text-sm font-medium text-gray-500">
                <span>Dashboard</span>
                <ArrowRight className="w-3.5 h-3.5" />
                <strong className="text-gray-900">Embed Form Generator</strong>
              </div>
              <header className="flex flex-col gap-1">
                <h1 className="text-2xl font-bold text-[#1A6FBF]">Embed Form Generator</h1>
                <p className="text-sm font-medium text-gray-500">Customize and embed your order form on any website</p>
              </header>

              <nav className="flex items-center gap-1 bg-gray-100 p-1 rounded-lg w-fit overflow-x-auto no-scrollbar" role="tablist" aria-label="Embed form sections">
                {embedTabs.map((tab) => (
                  <button
                    key={tab}
                    role="tab"
                    aria-selected={embedTab === tab}
                    className={`px-4 py-1.5 rounded-md text-sm font-bold transition-all duration-200 whitespace-nowrap ${embedTab === tab ? "bg-white text-[#1A6FBF] shadow-sm" : "text-gray-500 hover:text-gray-700 hover:bg-gray-200"}`}
                    onClick={() => {
                      const nextHash = tab === "Generate" ? "#/dashboard/admin/embed?tab=generate" : "#/dashboard/admin/embed";
                      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${nextHash}`);
                      setHashRoute(nextHash);
                      setEmbedTab(tab);
                    }}
                  >
                    {tab}
                  </button>
                ))}
              </nav>

              {embedTab === "Create Order Form" ? (
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-5">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                      <h2 className="text-base font-bold text-gray-900">Order Form Builder</h2>
                      <p className="text-sm text-gray-500 mt-0.5">Everything for {previewProduct?.name ?? "this product"}'s order form lives here. Changes save instantly and update the live preview on the right.</p>
                    </div>
                    {previewProduct && (
                      <label className="flex flex-col gap-0.5 text-xs">
                        <span className="font-semibold text-gray-500 uppercase tracking-wider">Editing form for</span>
                        <select className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm font-semibold bg-white" value={previewProduct.id} onChange={(e) => setGeneratedProductId(e.target.value)}>
                          {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                      </label>
                    )}
                  </div>

                  <label className="flex flex-col gap-1.5">
                    <span className="text-sm font-semibold text-gray-700">State field</span>
                    <select className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-200 w-full sm:w-72" value={embedStateField} onChange={(e) => setEmbedStateField(e.target.value)}>
                      <option value="Free-text input">Free-text input</option>
                      <option value="Dropdown">Dropdown (36 Nigerian states)</option>
                    </select>
                    <small className="text-xs text-gray-400">Dropdown only applies when the order form is set to NGN. Other currencies always use free-text.</small>
                  </label>

                  {previewProduct && embedStateField === "Dropdown" && (() => {
                    const selected = previewProduct.availableStates ?? [];
                    const allSelected = selected.length === 0;
                    const activeCount = allSelected ? nigeriaStates.length : selected.filter((s) => s !== "__none__").length;
                    return (
                      <div className="border border-gray-200 rounded-xl p-4 space-y-2">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <div>
                            <p className="text-sm font-semibold text-gray-800">States available on this form</p>
                            <p className="text-xs text-gray-500 mt-0.5">Filters the state dropdown for <strong>{previewProduct.name}</strong>'s order form. Empty = all 36 states.</p>
                          </div>
                          <div className="flex items-center gap-1.5 text-xs">
                            <button className="!min-h-0 px-2 py-1 rounded-lg border border-gray-200 hover:bg-gray-50" onClick={() => updateProductStates(previewProduct.id, [])}>All ({nigeriaStates.length})</button>
                            <button className="!min-h-0 px-2 py-1 rounded-lg border border-gray-200 hover:bg-gray-50" onClick={() => updateProductStates(previewProduct.id, [...nigeriaStates])}>Select all</button>
                            <button className="!min-h-0 px-2 py-1 rounded-lg border border-gray-200 hover:bg-gray-50" onClick={() => updateProductStates(previewProduct.id, ["__none__"])}>Clear</button>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1 max-h-52 overflow-y-auto">
                          {nigeriaStates.map((state) => {
                            const isOn = allSelected || selected.includes(state);
                            return (
                              <label key={state} className={`flex items-center gap-1.5 px-2 py-1 text-[11px] rounded border cursor-pointer ${isOn ? "bg-blue-50 border-blue-200" : "bg-white border-gray-200 hover:bg-gray-50"}`}>
                                <input type="checkbox" checked={isOn} onChange={() => {
                                  if (allSelected) {
                                    updateProductStates(previewProduct.id, nigeriaStates.filter((s) => s !== state));
                                  } else if (selected.includes(state)) {
                                    updateProductStates(previewProduct.id, selected.filter((s) => s !== state));
                                  } else {
                                    updateProductStates(previewProduct.id, [...selected.filter((s) => s !== "__none__"), state]);
                                  }
                                }} />
                                <span>{state}</span>
                              </label>
                            );
                          })}
                        </div>
                        <p className="text-[11px] text-gray-500"><strong>{activeCount}</strong> state{activeCount !== 1 ? "s" : ""} will be shown to customers on this form.</p>
                      </div>
                    );
                  })()}

                  {previewProduct && (
                    <div className="border border-amber-200 bg-amber-50/30 rounded-xl p-4 space-y-3">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div>
                          <p className="text-sm font-semibold text-gray-800 flex items-center gap-1.5"><ShoppingBag className="w-4 h-4 text-amber-600" /> Add-ons offered with this product</p>
                          <p className="text-xs text-gray-500 mt-0.5">Tick any product to offer it as an add-on. Set the bundle price and the states it sells in — that's it.</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-200/70 text-amber-900 font-semibold">{(previewProduct.crossSellProductIds ?? []).length} attached</span>
                          <button className="!min-h-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white border border-amber-300 text-amber-700 text-[11px] font-semibold hover:bg-amber-50" onClick={openAddProductModal}><Plus className="w-3 h-3" /> New product</button>
                        </div>
                      </div>
                      {(() => {
                        const eligibles = products.filter((p) => p.id !== previewProduct.id);
                        const selected = previewProduct.crossSellProductIds ?? [];
                        if (eligibles.length === 0) {
                          return <p className="text-xs text-amber-700 bg-white border border-amber-200 rounded-lg px-3 py-2">No other products yet. Click <strong>New product</strong> above to create one — it'll show here instantly.</p>;
                        }
                        return (
                          <div className="flex flex-col gap-2">
                            {eligibles.map((cp) => {
                              const on = selected.includes(cp.id);
                              const standardPrice = primaryPricing(cp)?.sellingPrice ?? 0;
                              const currency = primaryPricing(cp)?.currency ?? "NGN";
                              const override = previewProduct.crossSellPriceOverrides?.[cp.id];
                              const stateRestriction = previewProduct.crossSellStateRestrictions?.[cp.id] ?? [];
                              const limitedStates = stateRestriction.length > 0;
                              return (
                                <div key={cp.id} className={`rounded-lg border ${on ? "border-amber-300 bg-white" : "border-gray-200 bg-white"}`}>
                                  <label className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer ${on ? "" : "hover:bg-gray-50"}`}>
                                    <input type="checkbox" className="accent-amber-600 w-4 h-4" checked={on} onChange={() => setProducts((prev) => prev.map((p) => p.id !== previewProduct.id ? p : { ...p, crossSellProductIds: on ? selected.filter((id) => id !== cp.id) : [...selected, cp.id] }))} />
                                    <div className="flex-1 min-w-0">
                                      <div className="text-sm font-semibold text-gray-900">{cp.name}</div>
                                      <div className="text-[11px] text-gray-500">Standalone {formatProductMoney(standardPrice, currency)}{cp.role && cp.role !== "Main" ? ` · ${cp.role}` : ""}</div>
                                    </div>
                                    {on && (
                                      <div className="flex items-center gap-1.5">
                                        <span className="text-[11px] text-gray-500 font-medium">Offer at ₦</span>
                                        <input className="w-24 border border-amber-300 rounded-md px-2 py-1 text-xs" inputMode="decimal" placeholder={String(standardPrice)} value={typeof override === "number" ? override : ""} onClick={(e) => e.preventDefault()} onChange={(e) => {
                                          const val = e.target.value.trim();
                                          setProducts((prev) => prev.map((p) => {
                                            if (p.id !== previewProduct.id) return p;
                                            const next = { ...(p.crossSellPriceOverrides ?? {}) };
                                            if (val === "") delete next[cp.id];
                                            else next[cp.id] = Number(val) || 0;
                                            return { ...p, crossSellPriceOverrides: next };
                                          }));
                                        }} />
                                      </div>
                                    )}
                                  </label>
                                  {on && (
                                    <details className="border-t border-amber-100 px-3 py-2">
                                      <summary className="cursor-pointer select-none flex items-center gap-1.5 text-[11px] text-gray-700">
                                        <span>📍 Available states:</span>
                                        <span className={`px-1.5 py-0.5 rounded font-semibold ${limitedStates ? "bg-amber-100 text-amber-900" : "bg-gray-100 text-gray-600"}`}>{limitedStates ? `${stateRestriction.length} of ${nigeriaStates.length}` : "All states"}</span>
                                        <span className="text-gray-400 ml-auto">{limitedStates ? "click to edit" : "click to limit"}</span>
                                      </summary>
                                      <div className="mt-2 space-y-2">
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                          <button className="!min-h-0 px-2 py-0.5 rounded border border-gray-200 text-[10px] hover:bg-gray-50" onClick={() => setProducts((prev) => prev.map((p) => {
                                            if (p.id !== previewProduct.id) return p;
                                            const next = { ...(p.crossSellStateRestrictions ?? {}) };
                                            delete next[cp.id];
                                            return { ...p, crossSellStateRestrictions: next };
                                          }))}>All states</button>
                                          <button className="!min-h-0 px-2 py-0.5 rounded border border-gray-200 text-[10px] hover:bg-gray-50" onClick={() => setProducts((prev) => prev.map((p) => p.id !== previewProduct.id ? p : { ...p, crossSellStateRestrictions: { ...(p.crossSellStateRestrictions ?? {}), [cp.id]: [...nigeriaStates] } }))}>Select all</button>
                                          <button className="!min-h-0 px-2 py-0.5 rounded border border-gray-200 text-[10px] hover:bg-gray-50" onClick={() => setProducts((prev) => prev.map((p) => p.id !== previewProduct.id ? p : { ...p, crossSellStateRestrictions: { ...(p.crossSellStateRestrictions ?? {}), [cp.id]: [] } }))}>Clear</button>
                                        </div>
                                        <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-1 max-h-40 overflow-y-auto">
                                          {nigeriaStates.map((state) => {
                                            const isOn = !limitedStates || stateRestriction.includes(state);
                                            return (
                                              <label key={state} className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] cursor-pointer border ${isOn ? "bg-amber-50 border-amber-200" : "bg-white border-gray-200"}`}>
                                                <input type="checkbox" checked={isOn} onChange={() => setProducts((prev) => prev.map((p) => {
                                                  if (p.id !== previewProduct.id) return p;
                                                  const cur = p.crossSellStateRestrictions?.[cp.id] ?? [];
                                                  const isAllMode = cur.length === 0;
                                                  let nextList: string[];
                                                  if (isAllMode) nextList = nigeriaStates.filter((s) => s !== state);
                                                  else if (cur.includes(state)) nextList = cur.filter((s) => s !== state);
                                                  else nextList = [...cur, state];
                                                  return { ...p, crossSellStateRestrictions: { ...(p.crossSellStateRestrictions ?? {}), [cp.id]: nextList } };
                                                }))} />
                                                <span>{state}</span>
                                              </label>
                                            );
                                          })}
                                        </div>
                                      </div>
                                    </details>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        );
                      })()}
                    </div>
                  )}

                  {previewProduct && (
                    <div className="border border-emerald-200 bg-emerald-50/30 rounded-xl p-4 space-y-3">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div>
                          <p className="text-sm font-semibold text-gray-800 flex items-center gap-1.5"><Sparkles className="w-4 h-4 text-emerald-600" /> Free gifts auto-included</p>
                          <p className="text-xs text-gray-500 mt-0.5">Tick a product to auto-attach it as a free gift. Limit by state if you only ship gifts to certain places.</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-200/70 text-emerald-900 font-semibold">{(previewProduct.freeGiftProductIds ?? []).length} attached</span>
                          <button className="!min-h-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white border border-emerald-300 text-emerald-700 text-[11px] font-semibold hover:bg-emerald-50" onClick={openAddProductModal}><Plus className="w-3 h-3" /> New product</button>
                        </div>
                      </div>
                      {(() => {
                        const eligibles = products.filter((p) => p.id !== previewProduct.id);
                        const selected = previewProduct.freeGiftProductIds ?? [];
                        if (eligibles.length === 0) {
                          return <p className="text-xs text-emerald-700 bg-white border border-emerald-200 rounded-lg px-3 py-2">No other products yet. Click <strong>New product</strong> above to create one — it'll show here instantly.</p>;
                        }
                        return (
                          <div className="flex flex-col gap-2">
                            {eligibles.map((cp) => {
                              const on = selected.includes(cp.id);
                              const stateRestriction = previewProduct.freeGiftStateRestrictions?.[cp.id] ?? [];
                              const limitedStates = stateRestriction.length > 0;
                              return (
                                <div key={cp.id} className="rounded-lg border border-gray-200 bg-white">
                                  <label className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-gray-50">
                                    <input type="checkbox" className="accent-emerald-600 w-4 h-4" checked={on} onChange={() => setProducts((prev) => prev.map((p) => p.id !== previewProduct.id ? p : { ...p, freeGiftProductIds: on ? selected.filter((id) => id !== cp.id) : [...selected, cp.id] }))} />
                                    <div className="flex-1 min-w-0">
                                      <div className="text-sm font-semibold text-gray-900">{cp.name}</div>
                                      <div className="text-[11px] text-gray-500">{cp.role && cp.role !== "Main" ? cp.role : "Auto-attached when ordered"}</div>
                                    </div>
                                  </label>
                                  {on && (
                                    <details className="border-t border-emerald-100 px-3 py-2">
                                      <summary className="cursor-pointer select-none flex items-center gap-1.5 text-[11px] text-gray-700">
                                        <span>📍 Available states:</span>
                                        <span className={`px-1.5 py-0.5 rounded font-semibold ${limitedStates ? "bg-emerald-100 text-emerald-900" : "bg-gray-100 text-gray-600"}`}>{limitedStates ? `${stateRestriction.length} of ${nigeriaStates.length}` : "All states"}</span>
                                      </summary>
                                      <div className="mt-2 space-y-2">
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                          <button className="!min-h-0 px-2 py-0.5 rounded border border-gray-200 text-[10px] hover:bg-gray-50" onClick={() => setProducts((prev) => prev.map((p) => {
                                            if (p.id !== previewProduct.id) return p;
                                            const next = { ...(p.freeGiftStateRestrictions ?? {}) };
                                            delete next[cp.id];
                                            return { ...p, freeGiftStateRestrictions: next };
                                          }))}>All states</button>
                                          <button className="!min-h-0 px-2 py-0.5 rounded border border-gray-200 text-[10px] hover:bg-gray-50" onClick={() => setProducts((prev) => prev.map((p) => p.id !== previewProduct.id ? p : { ...p, freeGiftStateRestrictions: { ...(p.freeGiftStateRestrictions ?? {}), [cp.id]: [...nigeriaStates] } }))}>Select all</button>
                                          <button className="!min-h-0 px-2 py-0.5 rounded border border-gray-200 text-[10px] hover:bg-gray-50" onClick={() => setProducts((prev) => prev.map((p) => p.id !== previewProduct.id ? p : { ...p, freeGiftStateRestrictions: { ...(p.freeGiftStateRestrictions ?? {}), [cp.id]: [] } }))}>Clear</button>
                                        </div>
                                        <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-1 max-h-40 overflow-y-auto">
                                          {nigeriaStates.map((state) => {
                                            const isOn = !limitedStates || stateRestriction.includes(state);
                                            return (
                                              <label key={state} className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] cursor-pointer border ${isOn ? "bg-emerald-50 border-emerald-200" : "bg-white border-gray-200"}`}>
                                                <input type="checkbox" checked={isOn} onChange={() => setProducts((prev) => prev.map((p) => {
                                                  if (p.id !== previewProduct.id) return p;
                                                  const cur = p.freeGiftStateRestrictions?.[cp.id] ?? [];
                                                  const isAllMode = cur.length === 0;
                                                  let nextList: string[];
                                                  if (isAllMode) nextList = nigeriaStates.filter((s) => s !== state);
                                                  else if (cur.includes(state)) nextList = cur.filter((s) => s !== state);
                                                  else nextList = [...cur, state];
                                                  return { ...p, freeGiftStateRestrictions: { ...(p.freeGiftStateRestrictions ?? {}), [cp.id]: nextList } };
                                                }))} />
                                                <span>{state}</span>
                                              </label>
                                            );
                                          })}
                                        </div>
                                      </div>
                                    </details>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        );
                      })()}
                    </div>
                  )}

                  {previewProduct && (
                    <div className="border border-blue-200 bg-blue-50/30 rounded-xl p-4 space-y-2">
                      <div>
                        <p className="text-sm font-semibold text-gray-800 flex items-center gap-1.5"><Pencil className="w-4 h-4 text-blue-600" /> Marketing message on this product's form</p>
                        <p className="text-xs text-gray-500 mt-0.5">Anything you write here shows above the package picker on the order form. Great for benefits, urgency, or guarantees.</p>
                      </div>
                      <textarea className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white" rows={3} placeholder={`e.g. ✨ ${previewProduct.name} — sold out 3 times this month. Limited stock left.`} value={previewProduct.formCustomText ?? ""} onChange={(e) => setProducts((prev) => prev.map((p) => p.id === previewProduct.id ? { ...p, formCustomText: e.target.value } : p))} />
                    </div>
                  )}

                  <details className="border border-gray-200 rounded-xl">
                    <summary className="cursor-pointer select-none px-4 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 rounded-xl flex items-center justify-between">
                      <span>Customize text shown to customers</span>
                      <span className="text-xs text-gray-400">add-on prompt, summary, banners</span>
                    </summary>
                    <div className="border-t border-gray-200 p-4 space-y-3">
                      <div className="flex items-center justify-between gap-3 p-2.5 rounded-lg border border-gray-200 bg-gray-50">
                        <div>
                          <p className="text-sm font-semibold text-gray-800">Show "want to add more?" prompt</p>
                          <p className="text-xs text-gray-500">Off = add-ons appear immediately. On = customer must answer Yes to see them.</p>
                        </div>
                        <button type="button" role="switch" aria-checked={formAddonPromptEnabled} className={`relative w-11 h-6 !min-h-0 p-0 rounded-full transition-colors shrink-0 ${formAddonPromptEnabled ? "bg-[#1A6FBF]" : "bg-gray-300"}`} onClick={() => setFormAddonPromptEnabled((v) => !v)}>
                          <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${formAddonPromptEnabled ? "left-5" : "left-0.5"}`} />
                        </button>
                      </div>
                      <div className="flex items-center justify-between gap-3 p-2.5 rounded-lg border border-gray-200 bg-gray-50">
                        <div>
                          <p className="text-sm font-semibold text-gray-800">Show order summary above submit</p>
                          <p className="text-xs text-gray-500">Off = no summary card. On = customer sees a recap of items + total.</p>
                        </div>
                        <button type="button" role="switch" aria-checked={formOrderSummaryEnabled} className={`relative w-11 h-6 !min-h-0 p-0 rounded-full transition-colors shrink-0 ${formOrderSummaryEnabled ? "bg-[#1A6FBF]" : "bg-gray-300"}`} onClick={() => setFormOrderSummaryEnabled((v) => !v)}>
                          <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${formOrderSummaryEnabled ? "left-5" : "left-0.5"}`} />
                        </button>
                      </div>
                      <label className={`flex flex-col gap-1 ${formAddonPromptEnabled ? "" : "opacity-50"}`}>
                        <span className="text-xs font-semibold text-gray-600">Add-on prompt question</span>
                        <input className="border border-gray-200 rounded-lg px-3 py-2 text-sm disabled:bg-gray-100" disabled={!formAddonPromptEnabled} value={formAddonPromptText} onChange={(e) => setFormAddonPromptText(e.target.value)} placeholder="Would you like to add an additional product?" />
                      </label>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <label className="flex flex-col gap-1">
                          <span className="text-xs font-semibold text-gray-600">"Yes" option label</span>
                          <input className="border border-gray-200 rounded-lg px-3 py-2 text-sm" value={formAddonYesLabel} onChange={(e) => setFormAddonYesLabel(e.target.value)} placeholder="Yes — show me add-ons" />
                        </label>
                        <label className="flex flex-col gap-1">
                          <span className="text-xs font-semibold text-gray-600">"No" option label</span>
                          <input className="border border-gray-200 rounded-lg px-3 py-2 text-sm" value={formAddonNoLabel} onChange={(e) => setFormAddonNoLabel(e.target.value)} placeholder="No, just submit my order" />
                        </label>
                      </div>
                      <label className="flex flex-col gap-1">
                        <span className="text-xs font-semibold text-gray-600">Message shown when customer picks "No"</span>
                        <input className="border border-gray-200 rounded-lg px-3 py-2 text-sm" value={formAddonNoMessage} onChange={(e) => setFormAddonNoMessage(e.target.value)} placeholder="No problem — just hit Order Now below" />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-xs font-semibold text-gray-600">Order Summary heading</span>
                        <input className="border border-gray-200 rounded-lg px-3 py-2 text-sm" value={formOrderSummaryTitle} onChange={(e) => setFormOrderSummaryTitle(e.target.value)} placeholder="Your Order Summary" />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-xs font-semibold text-gray-600">Add-ons section title</span>
                        <input className="border border-gray-200 rounded-lg px-3 py-2 text-sm" value={formCrossSellLabel} onChange={(e) => setFormCrossSellLabel(e.target.value)} placeholder="Optional add-ons" />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-xs font-semibold text-gray-600">Free-gift banner text</span>
                        <input className="border border-gray-200 rounded-lg px-3 py-2 text-sm" value={formFreeGiftLabel} onChange={(e) => setFormFreeGiftLabel(e.target.value)} placeholder="Free gift included:" />
                      </label>
                      {previewProduct && (
                        <button className="!min-h-0 inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-blue-300 text-blue-700 text-xs font-semibold hover:bg-blue-50" onClick={() => openBonusSettings(previewProduct)}><BadgeDollarSign className="w-3.5 h-3.5" /> Open advanced bonus rules</button>
                      )}
                    </div>
                  </details>

                  <div className="space-y-2">
                    {/* Email – standalone row */}
                    <div className="flex items-start gap-4 py-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-800">Show email field</p>
                        <p className="text-xs text-gray-500 mt-0.5">Adds an optional email input to the form.</p>
                      </div>
                      <button type="button" role="switch" aria-checked={showEmailField} className={`relative mt-0.5 w-11 h-6 !min-h-0 p-0 rounded-full transition-colors shrink-0 ${showEmailField ? "bg-[#1A6FBF]" : "bg-gray-200"}`} onClick={() => setShowEmailField((v) => !v)}>
                        <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${showEmailField ? "left-5" : "left-0.5"}`} />
                      </button>
                    </div>

                    {/* WhatsApp group – bordered box */}
                    <div className="border border-gray-200 rounded-xl overflow-hidden">
                      <div className="flex items-start gap-4 px-4 py-3.5">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-800">Show WhatsApp field</p>
                          <p className="text-xs text-gray-500 mt-0.5">When off, the WhatsApp number input is hidden from the form.</p>
                        </div>
                        <button type="button" role="switch" aria-checked={showWhatsappField} className={`relative mt-0.5 w-11 h-6 !min-h-0 p-0 rounded-full transition-colors shrink-0 ${showWhatsappField ? "bg-[#1A6FBF]" : "bg-gray-200"}`} onClick={() => updateShowWhatsappField(!showWhatsappField)}>
                          <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${showWhatsappField ? "left-5" : "left-0.5"}`} />
                        </button>
                      </div>
                      <div className="flex items-start gap-4 px-4 py-3.5 border-t border-gray-100 bg-gray-50">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-700">Required</p>
                          <p className="text-xs text-gray-500 mt-0.5">Off = customers can skip it. On = they must fill it in.</p>
                        </div>
                        <button type="button" role="switch" aria-checked={requireWhatsapp} disabled={!showWhatsappField} aria-disabled={!showWhatsappField} className={`relative mt-0.5 w-11 h-6 !min-h-0 p-0 rounded-full transition-colors shrink-0 ${showWhatsappField ? (requireWhatsapp ? "bg-[#1A6FBF]" : "bg-gray-200") : "bg-gray-200 opacity-40 cursor-not-allowed"}`} onClick={() => setRequireWhatsapp((v) => !v)}>
                          <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${requireWhatsapp ? "left-5" : "left-0.5"}`} />
                        </button>
                      </div>
                    </div>

                    {/* Package name – standalone row */}
                    <div className="flex items-start gap-4 py-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-800">Show package name</p>
                        <p className="text-xs text-gray-500 mt-0.5">Show the package name above the description in the package picker.</p>
                      </div>
                      <button type="button" role="switch" aria-checked={showPackageName} className={`relative mt-0.5 w-11 h-6 !min-h-0 p-0 rounded-full transition-colors shrink-0 ${showPackageName ? "bg-[#1A6FBF]" : "bg-gray-200"}`} onClick={() => setShowPackageName((v) => !v)}>
                        <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${showPackageName ? "left-5" : "left-0.5"}`} />
                      </button>
                    </div>

                    {/* Each of the remaining settings in their own bordered box */}
                    {([
                      { label: `Ask "When would you like it delivered?"`, desc: "Captures the customer’s preferred delivery window on the order form.", checked: showDeliveryQuestion, toggle: () => setShowDeliveryQuestion((v) => !v) },
                      { label: "Require a confirmation checkbox", desc: "Customer must tick this before they can submit the form.", checked: requireConfirmation, toggle: () => setRequireConfirmation((v) => !v) },
                      { label: "Show commitment fee notice", desc: "Displays a notice above the submit button. Customer must respond before submitting, and you can optionally allow \"I disagree\" without blocking the order.", checked: showCommitmentNotice, toggle: () => { setShowCommitmentNotice((v) => !v); if (showCommitmentNotice) setOrderFormCommitmentAccepted(false); } },
                    ] as { label: string; desc: string; checked: boolean; toggle: () => void }[]).map(({ label, desc, checked, toggle }) => (
                      <div key={label} className="border border-gray-200 rounded-xl flex items-start gap-4 px-4 py-3.5">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-800">{label}</p>
                          <p className="text-xs text-gray-500 mt-0.5">{desc}</p>
                        </div>
                        <button type="button" role="switch" aria-checked={checked} className={`relative mt-0.5 w-11 h-6 !min-h-0 p-0 rounded-full transition-colors shrink-0 ${checked ? "bg-[#1A6FBF]" : "bg-gray-200"}`} onClick={toggle}>
                          <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${checked ? "left-5" : "left-0.5"}`} />
                        </button>
                      </div>
                    ))}
                  </div>

                  <div className="flex flex-wrap items-center gap-3 pt-1">
                    <button className="flex items-center gap-2 px-4 py-2 bg-[#1A6FBF] text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors" onClick={() => showToast("Embed form settings saved.")}>Save changes</button>
                    {readyEmbedProducts.length === 0 ? (
                      <span className="text-sm text-gray-400">Preview unavailable — create a product with packages first.</span>
                    ) : (
                      <button className="flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 text-gray-700 text-sm font-semibold hover:bg-gray-50 transition-colors" onClick={() => { setShowOrderPreview((v) => !v); setOrderFormPackageId(previewPackages[0]?.id || ""); setOrderFormConfirmed(false); setOrderFormCommitmentAccepted(false); }}>
                        <ExternalLink className="w-4 h-4" /> {showOrderPreview ? "Hide preview" : "Preview form"}
                      </button>
                    )}
                  </div>

                  {showOrderPreview && previewProduct && (
                    <section className="border border-gray-200 rounded-xl p-5 space-y-4 bg-gray-50" aria-label="Public order form preview">
                      <div>
                        <h3 className="text-base font-bold text-gray-900">{previewProduct.name}</h3>
                        <p className="text-sm text-gray-500 mt-0.5">{previewProduct.packageDescription || "Choose a package and submit a test order."}</p>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {[
                          { label: "Your Name", value: orderFormName, onChange: (v: string) => setOrderFormName(v), placeholder: "Customer name" },
                          { label: "Phone Number", value: orderFormPhone, onChange: (v: string) => setOrderFormPhone(v), placeholder: "+234 801 234 5678" },
                          { label: "Address", value: orderFormAddress, onChange: (v: string) => setOrderFormAddress(v), placeholder: "Delivery address" },
                          { label: "City", value: orderFormCity, onChange: (v: string) => setOrderFormCity(v), placeholder: "City" },
                        ].map(({ label, value, onChange, placeholder }) => (
                          <label key={label} className="flex flex-col gap-1">
                            <span className="text-xs font-semibold text-gray-600">{label}</span>
                            <input className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-200" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
                          </label>
                        ))}
                        {showWhatsappField && (
                          <label className="flex flex-col gap-1">
                            <span className="text-xs font-semibold text-gray-600">WhatsApp Number{requireWhatsapp ? " *" : ""}</span>
                            <input className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-200" value={orderFormWhatsapp} onChange={(e) => setOrderFormWhatsapp(e.target.value)} placeholder="+234 801 234 5678" inputMode="tel" />
                          </label>
                        )}
                        {showEmailField && (
                          <label className="flex flex-col gap-1">
                            <span className="text-xs font-semibold text-gray-600">Email</span>
                            <input className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-200" value={orderFormEmail} onChange={(e) => setOrderFormEmail(e.target.value)} placeholder="customer@example.com" type="email" />
                          </label>
                        )}
                        <label className="flex flex-col gap-1">
                          <span className="text-xs font-semibold text-gray-600">State</span>
                          {shouldUseStateDropdown(previewCurrency) ? (() => {
                            const allowed = previewProduct?.availableStates && previewProduct.availableStates.length > 0
                              ? nigeriaStates.filter((state) => previewProduct.availableStates!.includes(state))
                              : nigeriaStates;
                            return (
                              <select className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-200" value={orderFormState} onChange={(e) => setOrderFormState(e.target.value)}>
                                <option value="">Select state</option>
                                {allowed.map((state) => <option key={state} value={state}>{state}</option>)}
                              </select>
                            );
                          })() : (
                            <input className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-200" value={orderFormState} onChange={(e) => setOrderFormState(e.target.value)} placeholder="State" />
                          )}
                          {previewProduct?.availableStates && previewProduct.availableStates.length > 0 && (
                            <span className="text-[10px] text-gray-500">Available in {previewProduct.availableStates.length} state{previewProduct.availableStates.length !== 1 ? "s" : ""}.</span>
                          )}
                        </label>
                      </div>
                      {previewProduct?.formCustomText?.trim() && (
                        <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900 whitespace-pre-line">{previewProduct.formCustomText}</div>
                      )}
                      <div className="space-y-2">
                        {previewPackages.map((item) => (
                          <label key={item.id} className={`flex items-start gap-3 p-3 rounded-xl border-2 cursor-pointer transition-colors ${orderFormPackageId === item.id ? "border-[#1A6FBF] bg-blue-50" : "border-gray-200 bg-white hover:border-gray-300"}`}>
                            <input type="radio" name="preview-package" className="mt-0.5 accent-[#1A6FBF]" checked={orderFormPackageId === item.id} onChange={() => setOrderFormPackageId(item.id)} />
                            <div>
                              <strong className="text-sm font-bold text-gray-900">{showPackageName ? item.name : `${previewProduct.name} x${item.quantity}`}</strong>
                              <p className="text-xs text-gray-500 mt-0.5">{item.description || "Pay on delivery"} — {formatProductMoney(item.price, item.currency)}</p>
                            </div>
                          </label>
                        ))}
                      </div>
                      {formAddonPromptEnabled && (() => {
                        if (!previewProduct) return null;
                        const allXs = (previewProduct.crossSellProductIds ?? []).map((id) => products.find((p) => p.id === id)).filter(Boolean) as Product[];
                        const xs = allXs.filter((cp) => crossSellVisibleInState(previewProduct, cp, orderFormState));
                        if (allXs.length === 0 || xs.length === 0) return null;
                        return (
                          <div className="rounded-xl border border-gray-300 bg-gray-50 p-3">
                            <label className="block text-xs font-semibold text-gray-700 mb-1.5">{formAddonPromptText}</label>
                            <select className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white" value={orderFormAddonChoice} onChange={(e) => setOrderFormAddonChoice(e.target.value as "" | "yes" | "no")}>
                              <option value="">— choose —</option>
                              <option value="yes">{formAddonYesLabel}</option>
                              <option value="no">{formAddonNoLabel}</option>
                            </select>
                          </div>
                        );
                      })()}
                      {(!formAddonPromptEnabled || orderFormAddonChoice === "yes") && previewProduct && (() => {
                        const allXs = (previewProduct.crossSellProductIds ?? []).map((id) => products.find((p) => p.id === id)).filter(Boolean) as Product[];
                        const xs = allXs.filter((cp) => crossSellVisibleInState(previewProduct, cp, orderFormState));
                        if (xs.length === 0) return null;
                        const hiddenCount = allXs.length - xs.length;
                        return (
                          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                            <strong className="text-sm text-amber-900 block mb-2">{formCrossSellLabel}{hiddenCount > 0 && orderFormState ? ` (${xs.length} of ${allXs.length} in ${orderFormState})` : ""}</strong>
                            <div className="flex flex-col gap-1.5">
                              {xs.map((cp) => {
                                const sel = orderFormCrossSells.find((c) => c.productId === cp.id);
                                const standardPrice = primaryPricing(cp)?.sellingPrice ?? 0;
                                const price = crossSellPriceFor(previewProduct, cp);
                                const currency = primaryPricing(cp)?.currency ?? "NGN";
                                const discounted = price < standardPrice;
                                return (
                                  <label key={cp.id} className="flex items-center gap-2 text-xs text-gray-800">
                                    <input type="checkbox" className="accent-amber-600" checked={Boolean(sel)} onChange={() => toggleOrderFormCrossSell(cp.id)} />
                                    <span className="flex-1">
                                      <strong>{cp.name}</strong> · {formatProductMoney(price, currency)}
                                      {discounted && <span className="ml-1.5 line-through text-gray-400 text-[10px]">{formatProductMoney(standardPrice, currency)}</span>}
                                    </span>
                                    {sel && <input type="number" min={1} className="w-14 border border-amber-300 rounded px-1.5 py-0.5 text-xs" value={sel.quantity} onChange={(e) => setOrderFormCrossSellQuantity(cp.id, Number(e.target.value) || 1)} />}
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })()}
                      {formAddonPromptEnabled && orderFormAddonChoice === "no" && (
                        <div className="rounded-xl border border-gray-300 bg-gray-50 p-3 text-xs text-gray-600">{formAddonNoMessage}</div>
                      )}
                      {(() => {
                        if (!previewProduct) return null;
                        const allGifts = (previewProduct.freeGiftProductIds ?? []).map((id) => products.find((p) => p.id === id)).filter(Boolean) as Product[];
                        const gifts = allGifts.filter((g) => freeGiftVisibleInState(previewProduct, g, orderFormState));
                        if (gifts.length === 0) return null;
                        return (
                          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
                            <strong>🎁 {formFreeGiftLabel}</strong> {gifts.map((g) => g.name).join(", ")}
                          </div>
                        );
                      })()}
                      {showDeliveryQuestion && (
                        <label className="flex flex-col gap-1">
                          <span className="text-xs font-semibold text-gray-600">When would you like it delivered?</span>
                          <input className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-200" value={orderFormDeliveryWindow} onChange={(e) => setOrderFormDeliveryWindow(e.target.value)} placeholder="e.g., Tomorrow afternoon" />
                        </label>
                      )}
                      {showCommitmentNotice && (
                        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3">
                          <div className="flex items-start gap-2">
                            <Banknote className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                            <div>
                              <p className="text-sm font-semibold text-amber-900">Commitment fee notice</p>
                              <p className="text-xs text-amber-700 mt-0.5">A small commitment fee may be required before dispatch.</p>
                            </div>
                          </div>
                          <label className="flex items-center gap-2 text-sm text-amber-900 cursor-pointer">
                            <input type="checkbox" className="w-4 h-4 accent-amber-600" checked={orderFormCommitmentAccepted} onChange={(e) => setOrderFormCommitmentAccepted(e.target.checked)} />
                            I understand that a commitment fee may be requested before delivery.
                          </label>
                        </div>
                      )}
                      {formOrderSummaryEnabled && previewProduct && (() => {
                        const chosenPkg = previewPackages.find((it) => it.id === orderFormPackageId) ?? previewPackages[0];
                        if (!chosenPkg) return null;
                        const xsLines = orderFormCrossSells.map((c) => {
                          const cp = products.find((pp) => pp.id === c.productId);
                          if (!cp) return null;
                          const unit = crossSellPriceFor(previewProduct, cp);
                          return { name: cp.name, qty: c.quantity, total: unit * c.quantity };
                        }).filter(Boolean) as { name: string; qty: number; total: number }[];
                        const giftLines = (previewProduct.freeGiftProductIds ?? []).map((gid) => products.find((p) => p.id === gid)).filter((g) => g && freeGiftVisibleInState(previewProduct, g, orderFormState)) as Product[];
                        const total = chosenPkg.price + xsLines.reduce((s, l) => s + l.total, 0);
                        return (
                          <div className="rounded-xl border border-gray-200 bg-white p-3">
                            <strong className="text-sm block mb-2">{formOrderSummaryTitle}</strong>
                            <div className="flex items-center justify-between text-sm py-1">
                              <span>{previewProduct.name} · {chosenPkg.name}</span>
                              <strong>{formatProductMoney(chosenPkg.price, chosenPkg.currency)}</strong>
                            </div>
                            {xsLines.map((l, i) => (
                              <div key={i} className="flex items-center justify-between text-xs py-0.5 text-amber-700">
                                <span>↳ {l.name} × {l.qty}</span>
                                <span>{formatProductMoney(l.total, chosenPkg.currency)}</span>
                              </div>
                            ))}
                            {giftLines.map((g) => (
                              <div key={g.id} className="flex items-center justify-between text-xs py-0.5 text-emerald-700">
                                <span>🎁 {g.name}</span>
                                <span>FREE</span>
                              </div>
                            ))}
                            <div className="flex items-center justify-between pt-2 mt-2 border-t border-gray-200 font-bold">
                              <span>Total</span>
                              <span className="text-[#1A6FBF]">{formatProductMoney(total, chosenPkg.currency)}</span>
                            </div>
                          </div>
                        );
                      })()}
                      {requireConfirmation && (
                        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                          <input type="checkbox" className="w-4 h-4 accent-[#1A6FBF]" checked={orderFormConfirmed} onChange={(e) => setOrderFormConfirmed(e.target.checked)} />
                          I confirm this order is correct.
                        </label>
                      )}
                      <button className="w-full px-4 py-2.5 bg-[#1A6FBF] text-white rounded-lg text-sm font-bold hover:bg-blue-700 transition-colors" onClick={submitPreviewOrder}>Order Now</button>
                    </section>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-start gap-3 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-sm text-blue-900">
                    <Info className="w-4 h-4 mt-0.5 text-blue-500 shrink-0" />
                    <p><strong className="text-blue-700">How it works:</strong> Only products with active packages can have embed forms. Create packages for your products in the{" "}
                      <button className="underline font-semibold hover:text-blue-700" onClick={() => { setActivePage("Inventory"); setInventoryView("dashboard"); }}>Inventory</button> section first.</p>
                  </div>

                  {readyEmbedProducts.length === 0 ? (
                    <div className="bg-white rounded-xl border border-gray-200 shadow-sm flex flex-col items-center py-16 gap-4">
                      <span className="text-gray-300"><EmptyProductsIcon /></span>
                      <h2 className="text-base font-bold text-gray-700">No Products Found</h2>
                      <p className="text-sm text-gray-400">Create products and packages in the inventory section first</p>
                      <button className="px-4 py-2 bg-[#1A6FBF] text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors" onClick={() => { setActivePage("Inventory"); setInventoryView("dashboard"); }}>Go to Inventory</button>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div>
                        <h2 className="text-base font-bold text-gray-900">
                          Products Ready for Embed{" "}
                          <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-gray-100 text-gray-600 text-xs font-bold ml-1">{readyEmbedProducts.length}</span>
                        </h2>
                        <p className="text-sm text-gray-500 mt-0.5">These products have packages and can generate embed forms</p>
                      </div>

                      {readyEmbedProducts.map((product) => {
                        const packages = activeProductPackages(product);
                        const productGenerated = generatedEmbedProductIds.includes(product.id);
                        const embedUrl = buildEmbedUrl(product);
                        const iframeCode = buildIframeCode(product);
                        const selectedCodeTab = productEmbedCodeTab(product.id);
                        const selectedCurrencyCode = productEmbedCurrency(product);
                        const redirectUrl = productEmbedRedirect(product);
                        return (
                          <article key={product.id} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                            {/* Card header */}
                            <div className="flex flex-wrap items-start gap-3 px-5 py-4 border-b border-gray-100">
                              <span className="w-10 h-10 rounded-xl bg-green-50 text-green-600 flex items-center justify-center shrink-0"><PackageCheck className="w-5 h-5" /></span>
                              <div className="flex-1 min-w-0">
                                <h3 className="text-sm font-bold text-gray-900">{product.name}</h3>
                                <p className="text-xs text-gray-400 mt-0.5">{product.description || "No description"}</p>
                              </div>
                              <div className="flex flex-wrap items-center gap-2 shrink-0">
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-gray-100 text-gray-600 text-xs font-semibold"><PackageCheck className="w-3 h-3" /> {packages.length} {packages.length === 1 ? "package" : "packages"}</span>
                                <button className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-semibold text-gray-700 hover:bg-gray-50 transition-colors" onClick={() => openPackagesView(product)}>Manage Packages</button>
                              </div>
                            </div>

                            {/* Card body */}
                            <div className="px-5 py-5 space-y-4">
                              {!productGenerated ? (
                                <>
                                  <label className="flex flex-col gap-1">
                                    <span className="text-sm font-semibold text-gray-700">Redirect URL <span className="font-normal text-gray-400">(Optional)</span></span>
                                    <input className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-200" value={redirectUrl} onChange={(e) => setEmbedRedirectUrls((v) => ({ ...v, [product.id]: e.target.value }))} placeholder="https://yourwebsite.com/thank-you" />
                                    <span className="text-xs text-gray-400">Optional URL to redirect the user to after a successful order.</span>
                                  </label>
                                  <label className="flex flex-col gap-1">
                                    <span className="text-sm font-semibold text-gray-700">Select Currency</span>
                                    <select className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-200 w-full" value={selectedCurrencyCode} onChange={(e) => setEmbedCurrencyByProduct((v) => ({ ...v, [product.id]: e.target.value as ProductCurrencyCode }))}>
                                      {Object.entries(productCurrencies).map(([code, item]) => <option key={code} value={code}>{item.symbol} - {item.label}</option>)}
                                    </select>
                                  </label>
                                  <button className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-[#1A6FBF] text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors" onClick={() => generateEmbedUrl(product)}>Generate Embed URL</button>
                                </>
                              ) : (
                                <>
                                  {/* Code format tabs */}
                                  <nav className="flex items-center gap-1 bg-gray-100 p-1 rounded-lg w-fit" role="tablist" aria-label={`${product.name} embed code format`}>
                                    {embedCodeTabs.map((tab) => (
                                      <button key={tab} role="tab" aria-selected={selectedCodeTab === tab} className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all duration-200 whitespace-nowrap ${selectedCodeTab === tab ? "bg-white text-[#1A6FBF] shadow-sm" : "text-gray-500 hover:text-gray-700 hover:bg-gray-200"}`} onClick={() => setProductEmbedCodeTab(product.id, tab)}>{tab}</button>
                                    ))}
                                  </nav>

                                  {selectedCodeTab === "Direct Link" ? (
                                    <div className="space-y-2">
                                      <p className="text-sm text-gray-500">Share this direct link to your order form</p>
                                      <div className="flex items-center gap-2">
                                        <input readOnly className="flex-1 min-w-0 border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-600 font-mono focus:outline-none" value={embedUrl} aria-label={`${product.name} direct embed URL`} />
                                        <button className="p-2 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 transition-colors" title="Copy direct link" onClick={() => copyText(embedUrl, `${product.name} direct link`)}><Copy className="w-4 h-4" /></button>
                                        <button className="p-2 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 transition-colors" title="Open form" onClick={() => { window.location.href = embedUrl; }}><ExternalLink className="w-4 h-4" /></button>
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="space-y-3">
                                      <p className="text-sm text-gray-500">{selectedCodeTab === "HTML/Iframe" ? "Copy and paste this code into your HTML page" : "For WordPress with Elementor page builder"}</p>
                                      <div className="relative bg-slate-950 rounded-xl overflow-hidden">
                                        <pre className="p-4 text-xs text-slate-100 overflow-x-auto whitespace-pre-wrap font-mono leading-6 max-h-72">{iframeCode}</pre>
                                        <div className="flex justify-end px-4 py-2 border-t border-slate-800">
                                          <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700 text-xs font-semibold text-slate-300 hover:bg-slate-800 transition-colors" onClick={() => copyText(iframeCode, `${product.name} ${selectedCodeTab}`)}><Copy className="w-3.5 h-3.5" /> Copy</button>
                                        </div>
                                      </div>
                                      {selectedCodeTab === "Elementor" && (
                                        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-2">
                                          <strong className="text-sm font-bold text-blue-800">Elementor Integration Steps:</strong>
                                          <ol className="list-decimal list-inside space-y-1 text-sm text-blue-700">
                                            <li>Open your page in Elementor editor</li>
                                            <li>Drag an HTML widget to your page</li>
                                            <li>Click Copy above and paste the code into the HTML widget</li>
                                          </ol>
                                        </div>
                                      )}
                                    </div>
                                  )}

                                  {/* Re-configure row */}
                                  <div className="flex flex-wrap gap-2 pt-1 border-t border-gray-100">
                                    <label className="flex items-center gap-2 text-xs text-gray-500">
                                      <span className="font-semibold text-gray-600">Currency:</span>
                                      <select className="border border-gray-200 rounded-md px-2 py-1 text-xs bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-200" value={selectedCurrencyCode} onChange={(e) => setEmbedCurrencyByProduct((v) => ({ ...v, [product.id]: e.target.value as ProductCurrencyCode }))}>
                                        {Object.entries(productCurrencies).map(([code, item]) => <option key={code} value={code}>{item.symbol} - {item.label}</option>)}
                                      </select>
                                    </label>
                                    <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-semibold text-gray-600 hover:bg-gray-50 transition-colors" onClick={() => generateEmbedUrl(product)}><RefreshCw className="w-3 h-3" /> Refresh</button>
                                  </div>
                                </>
                              )}
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : activePage === "AI Agent" || activePage === "AI Sandbox" ? (
            <section className="coming-soon-page">
              <div className="coming-soon-background" aria-hidden="true">
                <header>
                  <span />
                  <div />
                </header>
                <section className="coming-soon-soft-banner" />
                <div className="coming-soon-grid">
                  <article />
                  <article />
                  <article />
                </div>
                <section className="coming-soon-wide-panel" />
              </div>
              <article className="coming-soon-card">
                <div className="coming-soon-icon">{activePage === "AI Agent" ? <Sparkles /> : <Bot />}</div>
                <span className="development-pill">In Development</span>
                <h1>{activePage} - Coming Soon</h1>
                <p>
                  {activePage === "AI Agent"
                    ? "Our AI voice agent will automatically call and confirm customer orders, assign deliveries, and follow up - all hands-free. This feature is in final development."
                    : "The AI agent testing sandbox lets you trigger real calls with fake orders so you can fine-tune your AI before going live."}
                </p>
              </article>
            </section>
          ) : activePage === "AI/SMS Tokens" ? (
            <div className="space-y-6">
              <header className="flex flex-col gap-1">
                <h1 className="text-2xl font-bold text-[#1A6FBF]">AI/SMS Tokens</h1>
                <p className="text-sm font-medium text-gray-500">One balance powers both AI agent calls and SMS notifications. Buy once, spend on whichever you need.</p>
              </header>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4" aria-label="Token usage rules">
                <article className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 flex items-start gap-4">
                  <span className="w-10 h-10 rounded-full bg-blue-50 text-blue-500 flex items-center justify-center shrink-0"><Headphones className="w-5 h-5" /></span>
                  <div>
                    <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">AI Agent Calls</h2>
                    <strong className="text-xl font-bold text-gray-900 block my-1">1 token</strong>
                    <p className="text-xs text-gray-400">= 1 minute of AI calling</p>
                  </div>
                </article>
                <article className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 flex items-start gap-4">
                  <span className="w-10 h-10 rounded-full bg-green-50 text-green-500 flex items-center justify-center shrink-0"><Bell className="w-5 h-5" /></span>
                  <div>
                    <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">SMS Notifications</h2>
                    <strong className="text-xl font-bold text-gray-900 block my-1">1 token</strong>
                    <p className="text-xs text-gray-400">= 5 SMS messages</p>
                  </div>
                </article>
              </div>

              <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Current Token Balance</h2>
                  <div className="flex items-baseline gap-1">
                    <strong className="text-3xl font-bold text-gray-900">{tokens}</strong>
                    <span className="text-sm text-gray-500">tokens</span>
                  </div>
                  <p className="flex items-center gap-1.5 text-xs font-medium text-amber-600 mt-2"><AlertTriangle className="w-3.5 h-3.5" /> Low balance — buy more tokens to keep AI calls and SMS running</p>
                </div>
                <span className="w-12 h-12 rounded-full bg-amber-100 text-amber-500 flex items-center justify-center shrink-0"><Zap className="w-6 h-6" /></span>
              </div>

              <div>
                <h2 className="text-base font-bold text-gray-800 mb-4">Buy Token Pack</h2>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4" aria-label="Token packs">
                  <article className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 flex flex-col items-center text-center gap-3">
                    <h3 className="text-sm font-bold text-gray-700">Starter</h3>
                    <div><strong className="text-3xl font-bold text-gray-900">50</strong><span className="text-sm text-gray-500 ml-1">tokens</span></div>
                    <div className="text-xs text-gray-500 leading-relaxed">₦9,000<br />₦180/min<br />or 250 SMS</div>
                    <button className="w-full px-4 py-2 rounded-lg border border-gray-200 text-gray-700 text-sm font-semibold hover:bg-gray-50 transition-colors" data-testid="buy-starter-tokens" onClick={() => buyTokenPack(50, "Starter")}>Buy Now</button>
                  </article>
                  <article className="bg-[#1A6FBF] rounded-xl shadow-md p-5 flex flex-col items-center text-center gap-3 relative">
                    <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 inline-flex items-center px-3 py-0.5 rounded-full text-[10px] font-bold bg-amber-400 text-amber-900 uppercase tracking-wider">Best Value</span>
                    <h3 className="text-sm font-bold text-white">Standard</h3>
                    <div><strong className="text-3xl font-bold text-white">150</strong><span className="text-sm text-blue-200 ml-1">tokens</span></div>
                    <div className="text-xs text-blue-200 leading-relaxed">₦25,000<br />₦167/min<br />or 750 SMS</div>
                    <button className="w-full px-4 py-2 rounded-lg bg-white text-[#1A6FBF] text-sm font-bold hover:bg-blue-50 transition-colors" data-testid="buy-standard-tokens" onClick={() => buyTokenPack(150, "Standard")}>Buy Now</button>
                  </article>
                  <article className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 flex flex-col items-center text-center gap-3">
                    <h3 className="text-sm font-bold text-gray-700">Pro</h3>
                    <div><strong className="text-3xl font-bold text-gray-900">500</strong><span className="text-sm text-gray-500 ml-1">tokens</span></div>
                    <div className="text-xs text-gray-500 leading-relaxed">₦75,000<br />₦150/min<br />or 2500 SMS</div>
                    <button className="w-full px-4 py-2 rounded-lg border border-gray-200 text-gray-700 text-sm font-semibold hover:bg-gray-50 transition-colors" data-testid="buy-pro-tokens" onClick={() => buyTokenPack(500, "Pro")}>Buy Now</button>
                  </article>
                </div>
              </div>

              <div>
                <h2 className="text-base font-bold text-gray-800 mb-3">Token History</h2>
                {tokenHistory.length === 0 ? (
                  <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-5 py-10 text-center text-sm text-gray-400">No token transactions yet. Buy your first pack to get started.</div>
                ) : (
                  <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                    <table className="w-full text-sm">
                      <thead><tr className="bg-gray-50 border-b border-gray-200 text-left">{["Date", "Pack", "Tokens Added"].map((h) => <th key={h} className="px-4 py-3 font-semibold text-gray-500 uppercase text-[10px] tracking-wider">{h}</th>)}</tr></thead>
                      <tbody className="divide-y divide-gray-100">
                        {tokenHistory.map((entry, i) => (
                          <tr key={i} className="hover:bg-gray-50 transition-colors">
                            <td className="px-4 py-3 text-gray-500">{entry.date}</td>
                            <td className="px-4 py-3 font-semibold text-gray-900">{entry.pack}</td>
                            <td className="px-4 py-3 font-bold text-[#1A6FBF]">+{entry.amount}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          ) : activePage === "Notifications" ? (
            <div className="space-y-6">
              <header className="flex flex-col gap-1">
                <h1 className="text-2xl font-bold text-[#1A6FBF]">Notifications</h1>
                <p className="text-sm font-medium text-gray-500">Stay updated on orders, status changes, and important activities</p>
              </header>

              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex items-center justify-between gap-4">
                <nav className="flex items-center gap-1 bg-gray-100 p-1 rounded-lg">
                  {(["All", "Unread"] as NotificationFilter[]).map((filter) => (
                    <button
                      key={filter}
                      data-testid={`notification-filter-${slugify(filter)}`}
                      className={`px-4 py-1.5 rounded-md text-sm font-bold transition-all duration-200 ${notificationFilter === filter ? "bg-white text-[#1A6FBF] shadow-sm" : "text-gray-500 hover:text-gray-700 hover:bg-gray-200"}`}
                      onClick={() => { setNotificationFilter(filter); showToast(`${filter} notifications selected.`); }}
                    >
                      {filter}
                    </button>
                  ))}
                </nav>
                <button className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-gray-200 text-sm font-semibold text-gray-500 hover:bg-gray-50 transition-colors disabled:opacity-40" disabled onClick={() => showToast("No read notifications to delete.")}><Trash2 className="w-4 h-4" /> Delete read</button>
              </div>

              {systemNotifications.length === 0 ? (
                <section className="bg-white rounded-xl border border-gray-200 shadow-sm flex flex-col items-center justify-center py-20 gap-3">
                  <span className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center text-gray-400"><Bell className="w-6 h-6" /></span>
                  <h2 className="text-base font-bold text-gray-700">No notifications yet</h2>
                  <p className="text-sm text-gray-400">Low stock alerts and other system events will appear here.</p>
                </section>
              ) : (
                <section className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                  <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                    <div>
                      <h2 className="text-sm font-bold text-gray-800">System Notifications</h2>
                      <p className="text-xs text-gray-400">{unreadNotificationCount} unread · {systemNotifications.length} total</p>
                    </div>
                    {unreadNotificationCount > 0 && <button className="text-xs font-semibold text-[#1A6FBF] hover:underline" onClick={markAllNotificationsRead}>Mark all read</button>}
                  </div>
                  <ul className="divide-y divide-gray-100">
                    {(notificationFilter === "Unread" ? systemNotifications.filter((n) => !n.read) : systemNotifications).map((n) => (
                      <li key={n.id} className={`flex items-start gap-3 px-5 py-4 ${!n.read ? "bg-blue-50/40" : ""}`}>
                        <span className={`mt-0.5 w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${n.type === "low_stock" ? "bg-amber-100 text-amber-600" : n.type === "remittance_overdue" ? "bg-red-100 text-red-600" : "bg-gray-100 text-gray-500"}`}>
                          {n.type === "low_stock" ? <AlertTriangle className="w-4 h-4" /> : <Bell className="w-4 h-4" />}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm ${!n.read ? "font-semibold text-gray-900" : "text-gray-700"}`}>{n.message}</p>
                          <p className="text-xs text-gray-400 mt-0.5">{new Date(n.createdAt).toLocaleString()}</p>
                        </div>
                        {!n.read && <span className="w-2 h-2 rounded-full bg-[#1A6FBF] mt-2 shrink-0" />}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          ) : activePage === "Settings" ? (
            <div className="space-y-8">
              <div className="flex items-center gap-2 text-sm font-medium text-gray-500">
                <span>Dashboard</span>
                <ArrowRight className="w-3.5 h-3.5" />
                <strong className="text-gray-900">Settings</strong>
              </div>
              <header className="flex flex-col gap-1">
                <h1 className="text-2xl font-bold text-[#1A6FBF]">Settings</h1>
                <p className="text-sm font-medium text-gray-500">Manage your account settings and preferences</p>
              </header>

              <section className="space-y-3">
                <h2 className="text-base font-bold text-gray-800">Progressive Web App</h2>
                <p className="text-sm text-gray-500">Install Protohub as an app and manage notifications</p>
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 space-y-4">
                  <div className="flex items-start gap-3">
                    <span className="w-9 h-9 rounded-full bg-gray-100 text-gray-600 flex items-center justify-center shrink-0"><BellOff className="w-4 h-4" /></span>
                    <div className="flex-1">
                      <h3 className="text-sm font-bold text-gray-900 mb-1">Push Notifications</h3>
                      <p className="text-sm text-gray-500 mb-3">Enable notifications to stay updated on orders</p>
                      <button className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-[#1A6FBF] text-white rounded-md hover:bg-blue-700 transition-colors" onClick={() => showToast("Browser notification permission requested for this demo.")}>Enable Notifications</button>
                    </div>
                  </div>
                  <hr className="border-gray-100" />
                  <div>
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Troubleshooting</p>
                    <div className="flex items-center gap-4">
                      <button className="text-sm text-[#1A6FBF] font-medium hover:underline" onClick={() => showToast("Service worker update requested.")}>Update Service Worker</button>
                      <button className="text-sm text-[#1A6FBF] font-medium hover:underline" onClick={() => showToast("Push re-subscribe requested.")}>Force Re-subscribe</button>
                    </div>
                  </div>
                </div>
              </section>

              <section className="space-y-3">
                <h2 className="text-base font-bold text-gray-800">Abandoned cart notifications</h2>
                <p className="text-sm text-gray-500">Choose who gets pinged when a new abandoned cart is captured.</p>
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 flex items-start gap-4">
                  <span className="w-9 h-9 rounded-full bg-blue-50 text-blue-500 flex items-center justify-center shrink-0"><Bell className="w-4 h-4" /></span>
                  <div className="flex-1">
                    <h3 className="text-sm font-bold text-gray-900 mb-1">Notify admins on new abandoned carts</h3>
                    <p className="text-sm text-gray-500">The assigned sales rep is always notified. Turn this on to also send a push and in-app notification to every admin in your org.</p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={adminCartNotifications}
                    data-testid="settings-cart-notifications"
                    className={`relative w-11 h-6 !min-h-0 p-0 rounded-full transition-colors shrink-0 ${adminCartNotifications ? "bg-[#1A6FBF]" : "bg-gray-200"}`}
                    onClick={() => {
                      setAdminCartNotifications((v) => !v);
                      showToast(`Admin abandoned cart notifications ${adminCartNotifications ? "disabled" : "enabled"}.`);
                    }}
                  >
                    <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${adminCartNotifications ? "left-5" : "left-0.5"}`} />
                  </button>
                </div>
              </section>

              <section className="space-y-3">
                <h2 className="text-base font-bold text-gray-800">Account Information</h2>
                <p className="text-sm text-gray-500">Your account details</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {(() => {
                    const ownerUser = users.find((u) => u.role === "Owner") ?? users[0];
                    return [
                      { label: "Name", value: ownerUser?.name ?? "—" },
                      { label: "Email", value: ownerUser?.email ?? "—" },
                      { label: "Role", value: ownerUser?.role ?? "—" },
                    ];
                  })().map(({ label, value }) => (
                    <div key={label} className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
                      <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{label}</span>
                      <strong className="block text-sm font-bold text-gray-900 mt-1">{value}</strong>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          ) : activePage === "Inventory" ? (
            inventoryView === "history" ? (
              <div className="space-y-6">
                <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
                  <div className="flex flex-col gap-1">
                    <button className="flex items-center gap-1 text-sm text-[#1A6FBF] font-medium hover:underline w-fit" onClick={() => setInventoryView("dashboard")}><ArrowRight className="w-4 h-4 rotate-180" /> Back to Inventory</button>
                    <h1 className="text-2xl font-bold text-[#1A6FBF]">Stock Movement History</h1>
                    <p className="text-sm font-medium text-gray-500">Review additions, corrections, deliveries, and agent stock movements.</p>
                  </div>
                </header>
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex flex-wrap gap-3">
                  <select className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-200" value={historyProductFilter} onChange={(event) => setHistoryProductFilter(event.target.value)}>
                    <option>All Products</option>
                    {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
                  </select>
                  <select className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-200" value={historyTypeFilter} onChange={(event) => setHistoryTypeFilter(event.target.value as "All Types" | StockMovementType)}>
                    {stockMovementTypes.map((type) => <option key={type}>{type}</option>)}
                  </select>
                  <input type="date" className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-200" value={historyStartDate} onChange={(event) => setHistoryStartDate(event.target.value)} aria-label="Start date" />
                  <input type="date" className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-200" value={historyEndDate} onChange={(event) => setHistoryEndDate(event.target.value)} aria-label="End date" />
                  <button className="px-4 py-2 rounded-lg border border-[#1A6FBF] text-[#1A6FBF] text-sm font-semibold hover:bg-blue-50 transition-colors" onClick={() => showToast(`${filteredStockMovements.length} movement${filteredStockMovements.length === 1 ? "" : "s"} found.`)}>Apply</button>
                  <button className="px-4 py-2 rounded-lg border border-gray-200 text-gray-600 text-sm font-semibold hover:bg-gray-50 transition-colors" onClick={() => { setHistoryProductFilter("All Products"); setHistoryTypeFilter("All Types"); setHistoryStartDate(""); setHistoryEndDate(""); }}>Clear</button>
                </div>
                <section className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-200 text-left">
                          {["Date","Product","Type","Qty","Balance After","Agent","Order","By","Note"].map((h) => (
                            <th key={h} className="px-4 py-3 font-semibold text-gray-500 uppercase text-[10px] tracking-wider whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {filteredStockMovements.length === 0 ? (
                          <tr><td colSpan={9} className="px-4 py-10 text-center text-gray-400 text-sm">No stock movements found</td></tr>
                        ) : (
                          filteredStockMovements.map((movement) => (
                            <tr key={movement.id} className="hover:bg-gray-50 transition-colors">
                              <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{new Date(movement.date).toLocaleString()}</td>
                              <td className="px-4 py-3 font-medium text-gray-900">{movement.productName}</td>
                              <td className="px-4 py-3">
                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap ${movement.type === "Stock Added" ? "bg-green-100 text-green-700" : movement.type === "Distributed to Agent" ? "bg-blue-100 text-blue-700" : movement.type === "Order Fulfilled" ? "bg-purple-100 text-purple-700" : movement.type === "Return" ? "bg-amber-100 text-amber-700" : movement.type === "Correction" ? "bg-orange-100 text-orange-700" : movement.type === "Waybill Out" ? "bg-rose-100 text-rose-700" : movement.type === "Waybill In" ? "bg-teal-100 text-teal-700" : "bg-gray-100 text-gray-600"}`}>{movement.type}</span>
                              </td>
                              <td className={`px-4 py-3 font-bold ${movement.qty < 0 ? "text-red-600" : "text-green-600"}`}>{movement.qty}</td>
                              <td className="px-4 py-3 text-gray-700">{movement.balanceAfter}</td>
                              <td className="px-4 py-3 text-gray-600">{movement.agent || "-"}</td>
                              <td className="px-4 py-3 text-gray-600">{movement.order || "-"}</td>
                              <td className="px-4 py-3 text-gray-600">{movement.by}</td>
                              <td className="px-4 py-3 text-gray-400 italic">{movement.note || "-"}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>
              </div>
            ) : inventoryView === "pricing" && selectedProduct ? (
              <div className="space-y-6">
                <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
                  <div className="flex flex-col gap-1">
                    <button className="flex items-center gap-1 text-sm text-[#1A6FBF] font-medium hover:underline w-fit" onClick={() => setInventoryView("dashboard")}><ArrowRight className="w-4 h-4 rotate-180" /> Back to Inventory</button>
                    <h1 className="text-2xl font-bold text-[#1A6FBF]">{selectedProduct.name} Pricing</h1>
                    <p className="text-sm font-medium text-gray-500">Manage multi-currency pricing and costs.</p>
                  </div>
                  <button className="flex items-center gap-2 px-4 py-2 bg-[#1A6FBF] text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors" onClick={openAddPricing}><Plus className="w-4 h-4" /> Add Currency</button>
                </header>
                <section className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-200 text-left">
                          {["Currency","Selling Price","Base Cost","Landed Cost","Margin","Actions"].map((h) => (
                            <th key={h} className="px-4 py-3 font-semibold text-gray-500 uppercase text-[10px] tracking-wider">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {selectedProduct.pricings.map((pricing) => {
                          const margin = pricing.sellingPrice === 0 ? 0 : Math.round(((pricing.sellingPrice - pricing.unitCost) / pricing.sellingPrice) * 100);
                          return (
                            <tr key={pricing.currency} className="hover:bg-gray-50 transition-colors">
                              <td className="px-4 py-4">
                                <div className="flex items-center gap-2">
                                  <span className="font-bold text-gray-900">{productCurrencies[pricing.currency].symbol} {productCurrencies[pricing.currency].label}</span>
                                  {pricing.primary && <span className="role-pill owner-pill">Primary</span>}
                                </div>
                              </td>
                              <td className="px-4 py-4 text-gray-700">{formatProductMoney(pricing.sellingPrice, pricing.currency)}</td>
                              <td className="px-4 py-4 text-gray-700">{formatProductMoney(pricing.unitCost, pricing.currency)}</td>
                              <td className="px-4 py-4 text-gray-700">{formatProductMoney(pricing.unitCost, pricing.currency)}</td>
                              <td className={`px-4 py-4 font-bold ${margin >= 0 ? "text-green-600" : "text-red-600"}`}>{margin}%</td>
                              <td className="px-4 py-4">
                                <div className="flex items-center gap-1">
                                  <button className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-gray-900 transition-colors" title="Edit pricing" onClick={() => openEditPricing(pricing)}><Pencil className="w-4 h-4" /></button>
                                  <button className="p-1.5 rounded hover:bg-red-50 text-gray-400 hover:text-red-600 transition-colors disabled:opacity-30" title="Delete pricing" disabled={pricing.primary} onClick={() => deletePricing(pricing.currency)}><Trash2 className="w-4 h-4" /></button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </section>
              </div>
            ) : inventoryView === "packages" && selectedProduct ? (
              <div className="space-y-6">
                <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
                  <div className="flex flex-col gap-1">
                    <button className="flex items-center gap-1 text-sm text-[#1A6FBF] font-medium hover:underline w-fit" onClick={() => setInventoryView("dashboard")}><ArrowRight className="w-4 h-4 rotate-180" /> Back to Inventory</button>
                    <h1 className="text-2xl font-bold text-[#1A6FBF]">Manage Packages</h1>
                    <p className="text-sm font-medium text-gray-500">{selectedProduct.name} — configure public order packages and bundle pricing.</p>
                  </div>
                  <button className="flex items-center gap-2 px-4 py-2 bg-[#1A6FBF] text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors" onClick={openAddPackage}><PackagePlus className="w-4 h-4" /> Create Package</button>
                </header>
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 flex flex-col gap-3">
                  <label className="flex flex-col gap-1.5">
                    <span className="text-sm font-semibold text-gray-700">General Package Description</span>
                    <textarea className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 resize-y min-h-[80px] focus:outline-none focus:ring-2 focus:ring-blue-200" value={packageDescriptionDraft} onChange={(event) => setPackageDescriptionDraft(event.target.value)} placeholder="Describe these package options for customers..." />
                  </label>
                  <button className="self-start px-4 py-2 rounded-lg border border-gray-200 text-gray-700 text-sm font-semibold hover:bg-gray-50 transition-colors" onClick={savePackageDescription}>Save Description</button>
                </div>
                <section className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                  <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-100">
                    <Boxes className="w-4 h-4 text-[#1A6FBF]" />
                    <h2 className="text-sm font-bold text-gray-900">Product Packages</h2>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-200 text-left">
                          {["Package","Description","Main Qty","Price","Order","Status","Actions"].map((h) => (
                            <th key={h} className="px-4 py-3 font-semibold text-gray-500 uppercase text-[10px] tracking-wider">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {selectedProduct.packages.length === 0 ? (
                          <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-400 text-sm">No packages found. Create a package before generating an embed form.</td></tr>
                        ) : (
                          selectedProduct.packages.map((item) => (
                            <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                              <td className="px-4 py-4 font-bold text-gray-900">{item.name}</td>
                              <td className="px-4 py-4 text-gray-600">{item.description || "-"}</td>
                              <td className="px-4 py-4 text-gray-700">{item.quantity}</td>
                              <td className="px-4 py-4 text-gray-700">{formatProductMoney(item.price, item.currency)}</td>
                              <td className="px-4 py-4 text-gray-600">{item.displayOrder}</td>
                              <td className="px-4 py-4">
                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${item.active ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-500"}`}>{item.active ? "Active" : "Inactive"}</span>
                              </td>
                              <td className="px-4 py-4">
                                <div className="flex items-center gap-1">
                                  <button className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-gray-900 transition-colors" title="Edit package" onClick={() => openEditPackage(item)}><Pencil className="w-4 h-4" /></button>
                                  <button className="p-1.5 rounded hover:bg-red-50 text-gray-400 hover:text-red-600 transition-colors" title="Delete package" onClick={() => openDeletePackage(item)}><Trash2 className="w-4 h-4" /></button>
                                </div>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>
              </div>
            ) : inventoryView === "stockcount" ? (
              <div className="space-y-6">
                <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
                  <div className="flex flex-col gap-1">
                    <button className="flex items-center gap-1 text-sm text-[#1A6FBF] font-medium hover:underline w-fit" onClick={() => setInventoryView("dashboard")}><ArrowRight className="w-4 h-4 rotate-180" /> Back to Inventory</button>
                    <h1 className="text-2xl font-bold text-[#1A6FBF]">Stock Count</h1>
                    <p className="text-sm font-medium text-gray-500">Reconcile agent physical stock against system records. Both sides must confirm the same number to mark as Verified.</p>
                  </div>
                  <button className="flex items-center gap-2 px-4 py-2 bg-[#1A6FBF] text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors" onClick={openNewStockCount}><Plus className="w-4 h-4" /> New Stock Count</button>
                </header>

                {stockCounts.length === 0 ? (
                  <div className="bg-white rounded-xl border border-gray-200 shadow-sm flex flex-col items-center justify-center py-16 gap-3">
                    <ClipboardCheck className="w-10 h-10 text-gray-300" />
                    <p className="text-gray-500 font-medium text-sm">No stock count sessions yet.</p>
                    <button className="px-4 py-2 bg-[#1A6FBF] text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors" onClick={openNewStockCount}>Start a Stock Count</button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {stockCounts.map((session) => {
                      const isActive = activeStockCountId === session.id;
                      const total = session.entries.length;
                      const verified = session.entries.filter((e) => e.status === "Verified").length;
                      const discrepancies = session.entries.filter((e) => e.status === "Discrepancy").length;
                      const pending = session.entries.filter((e) => e.status === "Pending").length;
                      return (
                        <div key={session.id} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 gap-3">
                            <div className="flex flex-col gap-0.5">
                              <div className="flex items-center gap-2">
                                <h2 className="text-sm font-bold text-gray-900">{session.title}</h2>
                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${session.status === "Open" ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-500"}`}>{session.status}</span>
                              </div>
                              <p className="text-xs text-gray-400">Created {new Date(session.createdAt).toLocaleDateString("en-NG", { day: "2-digit", month: "short", year: "numeric" })} by {session.createdBy}</p>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="text-xs text-gray-500">{verified}/{total} verified</span>
                              {discrepancies > 0 && <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-700">{discrepancies} discrepanc{discrepancies === 1 ? "y" : "ies"}</span>}
                              <button className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-semibold text-gray-700 hover:bg-gray-50 transition-colors" onClick={() => setActiveStockCountId(isActive ? null : session.id)}>{isActive ? "Collapse" : "View"}</button>
                              {session.status === "Open" && <button className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-semibold text-gray-500 hover:bg-gray-50 transition-colors" onClick={() => closeStockCountSession(session.id)}>Close Session</button>}
                            </div>
                          </div>

                          {isActive && (
                            <div>
                              {session.entries.length === 0 ? (
                                <p className="px-5 py-8 text-sm text-gray-400 text-center">No agent stock found for selected agents.</p>
                              ) : (
                                <>
                                  <div className="flex items-center gap-4 px-5 py-3 bg-gray-50 border-b border-gray-100 text-xs text-gray-500">
                                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-400 inline-block" />{verified} Verified</span>
                                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400 inline-block" />{discrepancies} Discrepancy</span>
                                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-gray-300 inline-block" />{pending} Pending</span>
                                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />{total - verified - discrepancies - pending} Partial</span>
                                  </div>
                                  <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                      <thead>
                                        <tr className="bg-gray-50 border-b border-gray-200 text-left">
                                          {["Agent","Product","System Qty","Agent Count","Admin Count","Variance","Status",""].map((h) => (
                                            <th key={h} className="px-4 py-3 font-semibold text-gray-500 uppercase text-[10px] tracking-wider whitespace-nowrap">{h}</th>
                                          ))}
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-gray-100">
                                        {session.entries.map((entry) => {
                                          const statusCls = entry.status === "Verified" ? "bg-green-100 text-green-700" : entry.status === "Discrepancy" ? "bg-red-100 text-red-700" : entry.status === "Pending" ? "bg-gray-100 text-gray-500" : "bg-amber-100 text-amber-700";
                                          return (
                                            <tr key={entry.id} className="hover:bg-gray-50 transition-colors">
                                              <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">{entry.agentName}</td>
                                              <td className="px-4 py-3 text-gray-700">{entry.productName}</td>
                                              <td className="px-4 py-3 text-gray-600">{entry.systemQty}</td>
                                              <td className="px-4 py-3">{entry.agentCount !== undefined ? <span className="font-semibold text-gray-900">{entry.agentCount}</span> : <span className="text-gray-400 italic">—</span>}</td>
                                              <td className="px-4 py-3">{entry.adminCount !== undefined ? <span className="font-semibold text-gray-900">{entry.adminCount}</span> : <span className="text-gray-400 italic">—</span>}</td>
                                              <td className="px-4 py-3">
                                                {entry.variance !== undefined ? (
                                                  <span className={`font-bold ${entry.variance === 0 ? "text-green-600" : "text-red-600"}`}>{entry.variance > 0 ? "+" : ""}{entry.variance}</span>
                                                ) : <span className="text-gray-400">—</span>}
                                              </td>
                                              <td className="px-4 py-3">
                                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${statusCls}`}>{entry.status}</span>
                                              </td>
                                              <td className="px-4 py-3">
                                                <div className="flex items-center gap-1">
                                                  {session.status === "Open" && (
                                                    <button className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-blue-600 transition-colors" title="Enter counts" onClick={() => openStockCountEntry(entry.id)}><Pencil className="w-3.5 h-3.5" /></button>
                                                  )}
                                                  {entry.status === "Discrepancy" && session.status === "Open" && (
                                                    <button className="px-2 py-1 rounded text-[10px] font-bold bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors whitespace-nowrap" title="Adjust system stock to match agent count" onClick={() => openAdjustStockFromCount(entry)}>Adjust Stock</button>
                                                  )}
                                                </div>
                                              </td>
                                            </tr>
                                          );
                                        })}
                                      </tbody>
                                    </table>
                                  </div>
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-6">
                <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
                  <div className="flex flex-col gap-1">
                    <h1 className="text-2xl font-bold text-[#1A6FBF]">Inventory Dashboard</h1>
                    <p className="text-sm font-medium text-gray-500">Centralized management for global balance and localized agent distribution.</p>
                  </div>
                  <select aria-label="Currency" className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-200" value={currency} onChange={(event) => {
                    const nextCurrency = event.target.value as CurrencyCode;
                    setCurrency(nextCurrency);
                    showToast(`Currency changed to ${currencies[nextCurrency].label}.`);
                  }}>
                    <option value="NGN">₦ Nigerian Naira</option>
                    <option value="USD">$ US Dollar</option>
                    <option value="GBP">£ British Pound</option>
                  </select>
                </header>

                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                  <label className="flex items-center gap-2 flex-1 min-w-0 bg-white border border-gray-200 rounded-lg px-3 py-2 shadow-sm focus-within:ring-2 focus-within:ring-blue-200">
                    <Search className="w-4 h-4 text-gray-400 shrink-0" />
                    <span className="sr-only">Search inventory</span>
                    <input className="flex-1 min-w-0 bg-transparent text-sm text-gray-700 outline-none placeholder:text-gray-400" value={inventorySearch} onChange={(event) => setInventorySearch(event.target.value)} placeholder="Search SKU or Product..." />
                  </label>
                  <div className="flex items-center gap-2 shrink-0">
                    <button className="flex items-center gap-2 px-4 py-2 bg-[#1A6FBF] text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors" onClick={openAddProductModal}><Plus className="w-4 h-4" /> Add Product</button>
                    <button className="flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 text-gray-700 text-sm font-semibold hover:bg-gray-50 transition-colors" onClick={() => setInventoryView("history")}><History className="w-4 h-4" /> Stock History</button>
                    <button className="flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 text-gray-700 text-sm font-semibold hover:bg-gray-50 transition-colors" onClick={() => { setStockProductId(products[0]?.id || ""); setStockChange("0"); setModal("updateStock"); }}><RefreshCw className="w-4 h-4" /> Update Stock</button>
                    <button className="flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 text-gray-700 text-sm font-semibold hover:bg-gray-50 transition-colors" onClick={() => { setActiveStockCountId(stockCounts.find((s) => s.status === "Open")?.id ?? null); setInventoryView("stockcount"); }}><ClipboardCheck className="w-4 h-4" /> Stock Count</button>
                  </div>
                </div>

                <section className="grid grid-cols-2 lg:grid-cols-4 gap-4" aria-label="Inventory summary">
                  <article className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm hover:shadow-md transition-shadow">
                    <span className="w-10 h-10 rounded-full flex items-center justify-center bg-blue-50 text-blue-500 mb-3"><CircleDollarSign className="w-5 h-5" /></span>
                    <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Total Inventory Value</h2>
                    <strong className="text-2xl font-bold text-gray-900 block my-1">{formatMoney(inventoryValue)}</strong>
                    <p className="text-[10px] text-gray-400 font-medium">Warehouse + Agent stock</p>
                  </article>
                  <article className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm hover:shadow-md transition-shadow">
                    <span className="w-10 h-10 rounded-full flex items-center justify-center bg-blue-50 text-blue-500 mb-3"><Boxes className="w-5 h-5" /></span>
                    <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Total Units in Stock</h2>
                    <strong className="text-2xl font-bold text-gray-900 block my-1">{totalInventoryUnits}</strong>
                    <p className="text-[10px] text-gray-400 font-medium">Warehouse + Agent stock</p>
                  </article>
                  <article className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm hover:shadow-md transition-shadow">
                    <span className="w-10 h-10 rounded-full flex items-center justify-center bg-blue-50 text-blue-500 mb-3"><Users className="w-5 h-5" /></span>
                    <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Active Agents</h2>
                    <strong className="text-2xl font-bold text-gray-900 block my-1">{activeAgents.length}</strong>
                    <p className="text-[10px] text-gray-400 font-medium">Currently active</p>
                  </article>
                  <article className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm hover:shadow-md transition-shadow">
                    <span className="w-10 h-10 rounded-full flex items-center justify-center bg-blue-50 text-blue-500 mb-3"><Archive className="w-5 h-5" /></span>
                    <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Distribution Rate</h2>
                    <strong className="text-2xl font-bold text-gray-900 block my-1">{distributionRate}%</strong>
                    <p className="text-[10px] text-gray-400 font-medium">Of inventory with agents</p>
                  </article>
                </section>

                <div className={`flex items-start gap-4 rounded-xl border p-4 shadow-sm ${lowStockProducts.length === 0 ? "bg-green-50 border-green-200" : "bg-amber-50 border-amber-200"}`} aria-label="Low stock alerts">
                  <span className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${lowStockProducts.length === 0 ? "bg-green-100 text-green-600" : "bg-amber-100 text-amber-600"}`}><AlertTriangle className="w-4 h-4" /></span>
                  <div className="flex-1 min-w-0">
                    <h2 className={`text-sm font-bold ${lowStockProducts.length === 0 ? "text-green-800" : "text-amber-800"}`}>Low stock alerts</h2>
                    <p className={`text-xs mt-0.5 ${lowStockProducts.length === 0 ? "text-green-600" : "text-amber-600"}`}>{lowStockProducts.length === 0 ? "All products are currently above reorder point." : `${lowStockProducts.length} product${lowStockProducts.length === 1 ? "" : "s"} at or below reorder point.`}</p>
                    {lowStockProducts.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-2">
                        {lowStockProducts.map((product) => (
                          <span key={product.id} className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">{product.name}: {product.warehouseStock}/{product.reorderPoint}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <section className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                  <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                    <div className="flex items-center gap-2">
                      <EmptyProductsIcon />
                      <h2 className="text-sm font-bold text-gray-900">Global Inventory</h2>
                    </div>
                    <button className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors" title="Export inventory CSV" aria-label="Export inventory" onClick={exportInventoryCsv}><Download className="w-4 h-4" /></button>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-200 text-left">
                          {["Product Details","SKU","Unit Cost","Selling Price","Global Balance","Agent Balance","Units Sold","Actions"].map((h) => (
                            <th key={h} className="px-4 py-3 font-semibold text-gray-500 uppercase text-[10px] tracking-wider whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {visibleProducts.length === 0 ? (
                          <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400 text-sm">No products found</td></tr>
                        ) : (
                          visibleProducts.map((product) => {
                            const pricing = primaryPricing(product);
                            const lowStock = product.warehouseStock <= product.reorderPoint;
                            return (
                              <tr key={product.id} className="hover:bg-gray-50 transition-colors">
                                <td className="px-4 py-4">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="font-bold text-gray-900">{product.name}</span>
                                    {lowStock && <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-700 uppercase tracking-wider">Low stock</span>}
                                  </div>
                                  <p className="text-xs text-gray-400 mt-0.5">{product.description || "No description"}</p>
                                </td>
                                <td className="px-4 py-4 text-gray-600 font-mono text-xs">{product.sku}</td>
                                <td className="px-4 py-4 text-gray-700">{formatProductMoney(pricing?.unitCost ?? 0, pricing?.currency ?? "NGN")}</td>
                                <td className="px-4 py-4 text-gray-700">{formatProductMoney(pricing?.sellingPrice ?? 0, pricing?.currency ?? "NGN")}</td>
                                <td className="px-4 py-4 font-semibold text-gray-900">{product.warehouseStock}</td>
                                <td className="px-4 py-4 text-gray-600">{product.agentStock}</td>
                                <td className="px-4 py-4 text-gray-600">{product.unitsSold}</td>
                                <td className="px-4 py-4">
                                  <div className="flex items-center gap-1">
                                    <button className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-gray-900 transition-colors" title="Details" onClick={() => openProductDetails(product)}><Eye className="w-4 h-4" /></button>
                                    <button className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-blue-600 transition-colors" title="Edit name & SKU" onClick={() => openEditProduct(product)}><Pencil className="w-4 h-4" /></button>
                                    <button className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-blue-600 transition-colors" title="Pricing" onClick={() => openPricingView(product)}><CircleDollarSign className="w-4 h-4" /></button>
                                    <button className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-blue-600 transition-colors" title="Packages" onClick={() => openPackagesView(product)}><PackageCheck className="w-4 h-4" /></button>
                                    <button className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-blue-600 transition-colors" title="Preview order form" onClick={() => previewProductForm(product)}><Globe className="w-4 h-4" /></button>
                                    <button className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-blue-600 transition-colors" title="Duplicate (clones pricing, packages, bonus, states)" onClick={() => duplicateProduct(product)}><Copy className="w-4 h-4" /></button>
                                    <button className={`p-1.5 rounded transition-colors ${product.active ? "text-emerald-600 hover:bg-emerald-50" : "text-gray-400 hover:bg-gray-100"}`} title={product.active ? "Active — click to deactivate" : "Inactive — click to activate"} onClick={() => toggleProductActive(product)}>{product.active ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}</button>
                                    <button className="p-1.5 rounded hover:bg-red-50 text-gray-400 hover:text-red-600 transition-colors" title="Delete product" onClick={() => openDeleteProduct(product)}><Trash2 className="w-4 h-4" /></button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>

                <section>
                  <div className="flex items-center gap-2 mb-4">
                    <Archive className="w-4 h-4 text-[#1A6FBF]" />
                    <h2 className="text-sm font-bold text-gray-900">Agent Inventory Breakdown</h2>
                  </div>
                  {agentRows.length === 0 ? (
                    <p className="text-sm text-gray-400 text-center py-8">No delivery agents yet.</p>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                      {agentRows.map((row) => {
                        const stocks = agentStock.filter((stock) => stock.agentId === row.agent.id);
                        const units = stocks.reduce((sum, stock) => sum + stock.quantity, 0);
                        const capacity = totalInventoryUnits === 0 ? 0 : Math.round((units / totalInventoryUnits) * 100);
                        return (
                          <article className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 flex flex-col gap-3" key={row.agent.id}>
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <h3 className="font-bold text-gray-900 text-sm">{row.agent.name}</h3>
                                <p className="text-xs text-gray-500 mt-0.5">{row.agent.zone}</p>
                              </div>
                              <span className={`status-pill status-${slugify(row.status)}`}>{row.status}</span>
                            </div>
                            <div>
                              <div className="flex items-center justify-between text-xs mb-1">
                                <span className="text-gray-500">Stock Capacity</span>
                                <strong className="text-gray-900">{capacity}%</strong>
                              </div>
                              <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                <div className="h-full bg-[#1A6FBF] rounded-full transition-all" style={{ width: `${Math.min(100, capacity)}%` }} />
                              </div>
                            </div>
                            <div className="flex items-center gap-3 text-xs text-gray-500">
                              <span>{units} units</span>
                              <span className="text-gray-300">·</span>
                              <span>{stocks.length} product{stocks.length === 1 ? "" : "s"}</span>
                              <span className="text-gray-300">·</span>
                              <span className="font-semibold text-gray-700">{formatMoney(row.stockValue)}</span>
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {stocks.length === 0 ? (
                                <span className="text-xs text-gray-400 italic">No assigned stock</span>
                              ) : (
                                stocks.slice(0, 3).map((stock) => (
                                  <span key={`${row.agent.id}-${stock.productId}`} className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-50 text-blue-700">
                                    {products.find((product) => product.id === stock.productId)?.name ?? stock.productId}: {stock.quantity}
                                  </span>
                                ))
                              )}
                            </div>
                            <div className="flex items-center gap-2 pt-1 border-t border-gray-100">
                              <button className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-semibold text-gray-700 hover:bg-gray-50 transition-colors" onClick={() => openAgentModal(row.agent, "assignAgentStock")}><PackagePlus className="w-3.5 h-3.5" /> Assign Stock</button>
                              <button className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-semibold text-gray-700 hover:bg-gray-50 transition-colors" onClick={() => openAgentModal(row.agent, "agentDetails")}><Eye className="w-3.5 h-3.5" /> View Details</button>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  )}
                </section>
              </div>
            )
          ) : null}

          {toast && (
            <div className="toast" role="status" aria-live="polite">
              <CheckCircle2 />
              <span>{toast}</span>
              <button aria-label="Dismiss message" onClick={() => setToast("")}><X /></button>
            </div>
          )}
          </div>
        </main>
      </div>

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 overflow-y-auto">
          <section className={`relative my-auto bg-white rounded-2xl shadow-2xl w-full flex flex-col max-h-[90vh] overflow-y-auto ${modal === "bonusSettings" || modal === "stateAvailability" ? "max-w-4xl" : modal === "orderWorkflow" ? "max-w-3xl" : modal === "createOrder" || modal === "editOrderItems" || modal === "editOrderCustomer" || modal === "changeOrderStatus" || modal === "orderDetails" || modal === "productDetails" || modal === "agentDetails" || modal === "salesRepDetails" || modal === "carts" ? "max-w-2xl" : "max-w-lg"}`} role="dialog" aria-modal="true" aria-labelledby="modal-title">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
              <h2 id="modal-title" className="text-base font-semibold text-gray-900">
                {modal === "createTeam" && "Create New Team"}
                {modal === "tokens" && "AI/SMS Tokens"}
                {modal === "notifications" && "Notifications"}
                {modal === "help" && "Dashboard Help"}
                {modal === "signout" && "Sign Out"}
                {modal === "carts" && "Abandoned Carts"}
                {modal === "addProduct" && "Add New Product"}
                {modal === "updateStock" && "Update Stock"}
                {modal === "addSalesRep" && "Add New Sales Representative"}
                {modal === "addAgent" && "Add New Agent"}
                {modal === "setRate" && "Set Pay Structure"}
                {modal === "addExpense" && "Add New Expense"}
                {modal === "addUser" && "Add New User"}
                {modal === "editUser" && "Edit User"}
                {modal === "resetUserPassword" && "Reset Password"}
                {modal === "deleteUser" && "Delete User"}
                {modal === "productDetails" && "Product Details"}
                {modal === "deleteProduct" && "Delete Product"}
                {modal === "addPricing" && "Add Currency Pricing"}
                {modal === "editPricing" && "Edit Pricing"}
                {modal === "addPackage" && "Create Package"}
                {modal === "editPackage" && "Edit Package"}
	                {modal === "deletePackage" && "Delete Package"}
	                {modal === "createOrder" && "Create New Order"}
	                {modal === "orderDetails" && selectedOrder && `Order Details - ${selectedOrder.id}`}
	                {modal === "orderWorkflow" && "Order Workflow"}
	                {modal === "changeOrderStatus" && "Change Order Status"}
	                {modal === "editOrderCustomer" && "Edit Order"}
	                {modal === "deleteOrder" && "Delete Order"}
	                {modal === "reassignOrder" && "Reassign Sales Rep"}
	                {modal === "sendToAgent" && "Send to Agent"}
	                {modal === "scheduleOrder" && "Schedule Delivery"}
	                {modal === "cartDetails" && "Cart Details"}
	                {modal === "convertCart" && "Convert Cart"}
	                {modal === "assignCart" && "Assign Cart"}
	                {modal === "agentDetails" && "Agent Profile"}
	                {modal === "assignAgentStock" && "Assign Stock"}
	                {modal === "reconcileAgentStock" && "Reconcile Stock"}
	                {modal === "editAgent" && "Edit Agent"}
	                {modal === "deleteAgent" && "Delete Agent"}
	                {modal === "salesRepDetails" && "Sales Rep Profile"}
	                {modal === "editSalesRep" && "Edit Sales Rep"}
	                {modal === "recordRemittance" && remittanceTargetOrder && `Record Remittance — ${remittanceTargetOrder.id}`}
	                {modal === "bonusSettings" && "Bonus Settings"}
	                {modal === "stateAvailability" && "State Availability"}
	                {modal === "addCrossSell" && "Add Cross-sell"}
	                {modal === "addFreeGift" && "Add Free Gift"}
	                {modal === "manualBonus" && "Manual Bonus Adjustment"}
	                {modal === "addPenalty" && "Apply Penalty"}
	                {modal === "editProduct" && selectedProduct && `Edit ${selectedProduct.name}`}
	                {modal === "createWaybill" && "New Waybill"}
                {modal === "editWaybill" && "Edit Waybill"}
                {modal === "flagCustomer" && "Flag Customer"}
                {modal === "newStockCount" && "New Stock Count Session"}
                {modal === "stockCountEntry" && "Enter Stock Counts"}
                {modal === "adjustStockCount" && "Adjust Stock — Write-off Reason"}
	              </h2>
              <button className="!min-h-0 p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors" aria-label="Close dialog" onClick={closeModal}><X className="w-5 h-5" /></button>
            </div>

            {modal === "createTeam" && (
              <div className="modal-form">
                <label><span>Team Name *</span><input value={newTeamName} onChange={(e) => setNewTeamName(e.target.value)} placeholder="e.g. Lagos Closers" /></label>
                <label><span>Team Lead</span><select value={newTeamLeadId} onChange={(e) => setNewTeamLeadId(e.target.value)}><option value="">No lead assigned</option>{salesRepUsers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
                <p className="text-xs text-gray-400">Product scope can be configured after the team is created.</p>
                <div className="flex items-center justify-end gap-3 pt-2">
                  <button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors" onClick={closeModal}>Cancel</button>
                  <button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#1A6FBF] text-white text-sm font-medium hover:bg-[#1560a8] transition-colors" onClick={createTeam}>Create Team</button>
                </div>
              </div>
            )}

            {modal === "tokens" && (
              <div className="px-6 py-5 flex flex-col gap-4">
                <p className="text-sm text-gray-600">Current token balance: <strong className="font-semibold text-gray-900">{tokens}</strong></p>
                <div className="flex items-center justify-end gap-3">
                  <button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#1A6FBF] text-white text-sm font-medium hover:bg-[#1560a8] transition-colors" onClick={addTokens}>Add 100 Tokens</button>
                  <button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors" onClick={closeModal}>Close</button>
                </div>
              </div>
            )}

            {modal === "notifications" && (
              <div className="px-6 py-5 flex flex-col gap-4">
                <div className="flex flex-col gap-1 max-h-72 overflow-y-auto">
                  {systemNotifications.filter((n) => !n.read).length === 0 ? (
                    <p className="text-sm text-gray-400 italic">No unread notifications.</p>
                  ) : (
                    systemNotifications.filter((n) => !n.read).map((n) => (
                      <div key={n.id} className="flex items-start gap-2 py-2 border-b border-gray-100 last:border-0">
                        <span className={`mt-0.5 shrink-0 ${n.type === "low_stock" ? "text-amber-500" : "text-gray-400"}`}>
                          {n.type === "low_stock" ? <AlertTriangle className="w-4 h-4" /> : <Bell className="w-4 h-4" />}
                        </span>
                        <p className="text-sm text-gray-700">{n.message}</p>
                      </div>
                    ))
                  )}
                </div>
                <div className="flex items-center justify-end gap-3">
                  {systemNotifications.filter((n) => !n.read).length > 0 && (
                    <button
                      className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#1A6FBF] text-white text-sm font-medium hover:bg-[#1560a8] transition-colors"
                      onClick={() => { markAllNotificationsRead(); setModal(null); }}
                    >
                      Mark All Read
                    </button>
                  )}
                  <button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors" onClick={closeModal}>Close</button>
                </div>
              </div>
            )}

            {modal === "help" && (
              <div className="px-6 py-5 flex flex-col gap-4">
                <p className="text-sm text-gray-600">Dashboard controls are connected for this starter. Additional pages can be added as separate modules later.</p>
                <div className="flex items-center justify-end gap-3">
                  <button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#1A6FBF] text-white text-sm font-medium hover:bg-[#1560a8] transition-colors" onClick={closeModal}>Got It</button>
                </div>
              </div>
            )}

            {modal === "signout" && (
              <div className="px-6 py-5 flex flex-col gap-4">
                <p className="text-sm text-gray-600">You will be signed out of this session. Any unsynced changes will remain in local storage until you sign back in.</p>
                <div className="flex items-center justify-end gap-3">
                  <button
                    className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 transition-colors"
                    onClick={() => {
                      setModal(null);
                      auth.clear();
                      onLogout?.();
                    }}
                  >
                    <LogOut className="w-4 h-4" /> Sign Out
                  </button>
                  <button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors" onClick={closeModal}>Stay Signed In</button>
                </div>
              </div>
            )}

	            {modal === "scheduleOrder" && selectedOrder && (
	              <div className="modal-form">
	                <p className="text-sm text-gray-600">Choose a delivery window for <strong>{selectedOrder.id}</strong> — {selectedOrder.customer}.</p>
	                <div className="flex flex-wrap gap-2">
	                  {scheduleRanges.map((range) => (
	                    <button key={range} className={`!min-h-0 flex-1 px-4 py-2.5 rounded-lg text-sm font-semibold border transition-colors ${normalizeDateKey(selectedOrder.scheduledDate) === scheduleDateForRange(range) ? "border-[#1A6FBF] bg-blue-50 text-[#1A6FBF]" : "border-gray-200 text-gray-700 hover:bg-gray-50"}`} onClick={() => { scheduleOrder(selectedOrder.id, range); closeModal(); }}>
	                      {range} <span className="block text-[10px] font-medium opacity-70">{displayDateFromKey(scheduleDateForRange(range))}</span>
	                    </button>
	                  ))}
	                </div>
	                <div className="flex items-center justify-end gap-3 pt-2">
	                  <button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors" onClick={closeModal}>Cancel</button>
	                </div>
	              </div>
	            )}

	            {modal === "carts" && (
	              <>
	                <p>{demoCarts === 0 ? "There are no abandoned carts in this dashboard period." : `${demoCarts} abandoned cart${demoCarts === 1 ? "" : "s"} in this dashboard period.`}</p>
	                <div className="flex items-center justify-end gap-3 pt-2">
	                  <button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors" onClick={closeModal}>Close</button>
	                </div>
	              </>
	            )}

	            {modal === "createOrder" && (
	              <div className="modal-form">
	                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {isCustomerFlagged(createOrderPhone) && (() => { const f = customerFlags[normalizePhone(createOrderPhone)]; return <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5"><AlertTriangle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" /><div><p className="text-sm font-bold text-red-700">High-risk customer</p>{f?.reason && <p className="text-xs text-red-600 mt-0.5">{f.reason}</p>}</div></div>; })()}
	                  <label><span>Customer Name</span><input value={createOrderCustomer} onChange={(event) => setCreateOrderCustomer(event.target.value)} placeholder="Customer name" /></label>
	                  <label><span>Phone</span><input value={createOrderPhone} onChange={(event) => setCreateOrderPhone(event.target.value)} inputMode="tel" /></label>
	                  <label><span>WhatsApp</span><input value={createOrderWhatsapp} onChange={(event) => setCreateOrderWhatsapp(event.target.value)} inputMode="tel" /></label>
	                  <label><span>Email (Optional)</span><input value={createOrderEmail} onChange={(event) => setCreateOrderEmail(event.target.value)} type="email" placeholder="customer@example.com" /></label>
	                  <label><span>Source</span><select value={createOrderSource} onChange={(event) => setCreateOrderSource(event.target.value as Exclude<OrderSource, "All Sources">)}>{orderSources.filter((source) => source !== "All Sources").map((source) => <option key={source}>{source}</option>)}</select></label>
	                  <label><span>City</span><input value={createOrderCity} onChange={(event) => setCreateOrderCity(event.target.value)} /></label>
	                  <label><span>State</span><input value={createOrderState} onChange={(event) => setCreateOrderState(event.target.value)} /></label>
	                </div>
	                <label><span>Delivery Address</span><textarea value={createOrderAddress} onChange={(event) => setCreateOrderAddress(event.target.value)} /></label>
	                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
	                  <label><span>Product</span><select value={createOrderProductId} onChange={(event) => { const product = products.find((item) => item.id === event.target.value); const offer = product ? activeProductPackages(product)[0] : undefined; setCreateOrderProductId(event.target.value); setCreateOrderPackageId(offer?.id ?? ""); setCreateOrderQuantity(String(offer?.quantity ?? 1)); }}><option value="">Choose product</option>{products.filter((product) => product.active).map((product) => <option key={product.id} value={product.id}>{product.name} · warehouse {product.warehouseStock} · agents {product.agentStock}</option>)}</select></label>
	                  <label><span>Package</span><select value={createOrderPackageId} onChange={(event) => { const product = products.find((item) => item.id === createOrderProductId); const offer = product?.packages.find((item) => item.id === event.target.value); setCreateOrderPackageId(event.target.value); if (offer) setCreateOrderQuantity(String(offer.quantity)); }}><option value="">Manual quantity</option>{products.find((item) => item.id === createOrderProductId)?.packages.map((item) => <option key={item.id} value={item.id}>{item.name} · {formatProductMoney(item.price, item.currency)}</option>)}</select></label>
	                  <label><span>Quantity</span><input value={createOrderQuantity} onChange={(event) => setCreateOrderQuantity(event.target.value)} inputMode="numeric" /></label>
	                  {createOrderContext === "admin" ? <label><span>Sales Rep</span><select value={createOrderRepId} onChange={(event) => setCreateOrderRepId(event.target.value)}><option value="auto">Auto round-robin</option>{salesRepUsers.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label> : <div className="flex flex-col gap-1"><span className="text-xs text-gray-400 font-semibold uppercase tracking-wide">Sales Rep</span><strong className="text-sm font-semibold text-gray-900">{selectedRepUser?.name ?? activeSalesRepUsers[0]?.name ?? "Round-robin"}</strong></div>}
	                  <div className="flex flex-col gap-1"><span className="text-xs text-gray-400 font-semibold uppercase tracking-wide">Total</span><strong className="text-sm font-semibold text-gray-900">{(() => { const product = products.find((item) => item.id === createOrderProductId); const offer = product?.packages.find((item) => item.id === createOrderPackageId); const pricing = product ? primaryPricing(product) : undefined; const total = offer?.price ?? (Number(createOrderQuantity) || 1) * (pricing?.sellingPrice ?? 0); return formatProductMoney(total, offer?.currency ?? pricing?.currency ?? "NGN"); })()}</strong></div>
	                </div>
	                <div className="flex items-center justify-end gap-3 pt-2"><button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors" onClick={closeModal}>Cancel</button><button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#1A6FBF] text-white text-sm font-medium hover:bg-[#1560a8] transition-colors" onClick={createManualOrder}>Create Order</button></div>
	              </div>
	            )}

	            {modal === "orderDetails" && selectedOrder && (
	              <div className="px-6 py-5 flex flex-col gap-6">
	                {/* Owner/admin always has full permissions — Reassign + Change Status always visible */}
	                <div className="flex items-center justify-between gap-2 flex-wrap">
	                  <div className="flex items-center gap-2 flex-wrap">
	                    <span className="text-xs text-gray-400 font-medium">Quick Actions:</span>
	                    {allOrderStatuses.filter((s) => s !== (selectedOrder.status ?? "New")).map((s) => {
	                      const isReverting = (selectedOrder.status ?? "New") === "Delivered" && !["Cancelled", "Failed"].includes(s);
	                      return (
	                        <button key={s} title={isReverting ? "Warning: re-opening a delivered order will not automatically restore stock" : undefined} className={`!min-h-0 px-2.5 py-1 text-xs font-medium rounded-full border transition-colors ${isReverting ? "border-amber-300 text-amber-700 hover:bg-amber-50" : "border-gray-200 text-gray-600 hover:bg-gray-100"}`} onClick={() => { updateOrderStatus(selectedOrder.id, s); showToast(`Status changed to ${s}.${isReverting ? " Note: stock was not auto-restored." : ""}`); closeModal(); }}>→ {s}</button>
	                      );
	                    })}
	                  </div>
	                  <button className="!min-h-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-blue-600 text-blue-600 text-sm font-medium hover:bg-blue-50 transition-colors shrink-0" onClick={() => setModal("reassignOrder")}>
	                    <UserPlus className="w-4 h-4" /> Reassign Sales Rep
	                  </button>
	                </div>
	
	                {/* Section 1: Customer Information */}
	                <section>
	                  <h3 className="font-semibold text-base border-b border-gray-100 pb-2 mb-3">Customer Information</h3>
	                  <div className="grid grid-cols-2 gap-4">
	                    <div>
	                      <p className="text-xs font-medium uppercase tracking-wide text-gray-400 m-0">Name</p>
	                      <p className="text-sm font-semibold text-gray-900 m-0 mt-0.5">{selectedOrder.customer}</p>
	                    </div>
	                    <div>
	                      <p className="text-xs font-medium uppercase tracking-wide text-gray-400 m-0">Phone</p>
	                      <p className="text-sm font-semibold text-gray-900 m-0 mt-0.5">{selectedOrder.phone}</p>
	                    </div>
	                    {selectedOrder.whatsapp && (
	                      <div>
	                        <p className="text-xs font-medium uppercase tracking-wide text-gray-400 m-0">WhatsApp</p>
	                        <p className="text-sm font-semibold text-gray-900 m-0 mt-0.5">{selectedOrder.whatsapp}</p>
	                      </div>
	                    )}
	                  </div>
	                </section>
	
	                {/* Section 2: Order Information */}
	                <section>
	                  <h3 className="font-semibold text-base border-b border-gray-100 pb-2 mb-3">Order Information</h3>
	                  <div className="grid grid-cols-2 gap-4">
	                    <div>
	                      <p className="text-xs font-medium uppercase tracking-wide text-gray-400 m-0">Status</p>
	                      <div className="mt-0.5">
	                        <span className={`inline-flex items-center justify-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${statusBadgeClasses(selectedOrder.status ?? "New")}`}>{selectedOrder.status ?? "New"}</span>
	                      </div>
	                    </div>
	                    <div>
	                      <p className="text-xs font-medium uppercase tracking-wide text-gray-400 m-0">Source</p>
	                      <div className="flex items-center gap-1.5 mt-0.5">
	                        {(() => {
	                          const src = selectedOrder.source ?? orderSourceFromUtm(selectedOrder.utmSource);
	                          if (src === "WhatsApp") return <MessageCircle className="w-4 h-4 shrink-0 text-[#25D366]" />;
	                          if (src === "TikTok") return <Music2 className="w-4 h-4 shrink-0 text-gray-900" />;
	                          if (src === "Facebook") return <span className="w-4 h-4 shrink-0 rounded-full bg-[#1877F2] text-white text-[10px] font-bold flex items-center justify-center">f</span>;
	                          if (src === "Website") return <Globe className="w-4 h-4 shrink-0 text-gray-500" />;
	                          return <Tag className="w-4 h-4 shrink-0 text-gray-500" />;
	                        })()}
	                        <span className="text-sm font-semibold text-gray-900">{selectedOrder.source ?? orderSourceFromUtm(selectedOrder.utmSource)}</span>
	                      </div>
	                    </div>
	                    <div>
	                      <p className="text-xs font-medium uppercase tracking-wide text-gray-400 m-0">Location</p>
	                      <p className="text-sm font-semibold text-gray-900 m-0 mt-0.5">{selectedOrder.location ?? orderLocationFromFields(selectedOrder.city ?? "", selectedOrder.state ?? "")}</p>
	                    </div>
	                    <div>
	                      <p className="text-xs font-medium uppercase tracking-wide text-gray-400 m-0">Order Date</p>
	                      <p className="text-sm font-semibold text-gray-900 m-0 mt-0.5">{displayDateFromKey(selectedOrder.createdAt ?? selectedOrder.date)}</p>
	                    </div>
	                    <div>
	                      <p className="text-xs font-medium uppercase tracking-wide text-gray-400 m-0">Assigned To</p>
	                      <p className="text-sm font-semibold text-gray-900 m-0 mt-0.5">{users.find((u) => u.id === selectedOrder.assignedRepId)?.name ?? "Unassigned"}</p>
	                    </div>
	                    <div>
	                      <p className="text-xs font-medium uppercase tracking-wide text-gray-400 m-0">Agent</p>
	                      {agentNameForOrder(selectedOrder) === "Unassigned"
	                        ? <p className="text-sm font-semibold italic text-red-500 m-0 mt-0.5">Unassigned</p>
	                        : <p className="text-sm font-semibold text-gray-900 m-0 mt-0.5">{agentNameForOrder(selectedOrder)}</p>
	                      }
	                    </div>
	                  </div>
	                </section>
	
	                {/* Section 3: Delivery Address */}
	                <section>
	                  <h3 className="font-semibold text-base border-b border-gray-100 pb-2 mb-3">Delivery Address</h3>
	                  <div className="border border-gray-200 rounded-lg p-3 text-sm text-gray-700 bg-gray-50/50">
	                    {selectedOrder.address || "No address provided"}{(selectedOrder.city || selectedOrder.state) ? `, ${[selectedOrder.city, selectedOrder.state].filter(Boolean).join(", ")}` : ""}
	                  </div>
	                </section>
	
	                {/* Section 4: Order Items */}
	                <section>
	                  <h3 className="font-semibold text-base border-b border-gray-100 pb-2 mb-3">Order Items</h3>
	                  <div className="overflow-x-auto rounded-lg border border-gray-200">
	                    <table className="w-full text-sm">
	                      <thead>
	                        <tr className="border-b border-gray-100 bg-gray-50/60">
	                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-400">Product</th>
	                          <th className="px-4 py-2 text-center text-xs font-medium text-gray-400">Qty</th>
	                          <th className="px-4 py-2 text-right text-xs font-medium text-gray-400">Price</th>
	                          <th className="px-4 py-2 text-right text-xs font-medium text-gray-400">Total</th>
	                        </tr>
	                      </thead>
	                      <tbody>
	                        <tr>
	                          <td className="px-4 py-2.5 text-gray-800">{selectedOrder.productName} · {selectedOrder.packageName}</td>
	                          <td className="px-4 py-2.5 text-center text-gray-700">{quantityForOrder(selectedOrder)}</td>
	                          <td className="px-4 py-2.5 text-right text-gray-700">{formatProductMoney(Math.round(selectedOrder.amount / quantityForOrder(selectedOrder)), selectedOrder.currency)}</td>
	                          <td className="px-4 py-2.5 text-right font-semibold text-gray-900">{formatProductMoney(selectedOrder.amount, selectedOrder.currency)}</td>
	                        </tr>
	                        {(selectedOrder.crossSellLines ?? []).map((line) => (
	                          <tr key={line.id} className="bg-amber-50/40">
	                            <td className="px-4 py-2 text-gray-800 text-xs">↳ Cross-sell · {line.productName}</td>
	                            <td className="px-4 py-2 text-center text-gray-700 text-xs">{line.quantity}</td>
	                            <td className="px-4 py-2 text-right text-gray-700 text-xs">{formatProductMoney(Math.round(line.amount / Math.max(1, line.quantity)), selectedOrder.currency)}</td>
	                            <td className="px-4 py-2 text-right text-xs">
	                              <span className="font-semibold text-gray-900">{formatProductMoney(line.amount, selectedOrder.currency)}</span>
	                              <button className="!min-h-0 ml-2 text-red-500 hover:text-red-700" onClick={() => removeCrossSell(selectedOrder.id, line.id)}>×</button>
	                            </td>
	                          </tr>
	                        ))}
	                        {(selectedOrder.freeGiftLines ?? []).map((line) => (
	                          <tr key={line.id} className="bg-emerald-50/40">
	                            <td className="px-4 py-2 text-gray-800 text-xs">🎁 Free Gift · {line.productName}</td>
	                            <td className="px-4 py-2 text-center text-gray-700 text-xs">{line.quantity}</td>
	                            <td className="px-4 py-2 text-right text-gray-700 text-xs italic">FREE</td>
	                            <td className="px-4 py-2 text-right text-xs">
	                              <span className="text-gray-500">—</span>
	                              <button className="!min-h-0 ml-2 text-red-500 hover:text-red-700" onClick={() => removeFreeGift(selectedOrder.id, line.id)}>×</button>
	                            </td>
	                          </tr>
	                        ))}
	                      </tbody>
	                      <tfoot>
	                        <tr className="border-t border-gray-200">
	                          <td colSpan={3} className="px-4 py-2.5 text-sm font-semibold text-gray-700">Grand Total</td>
	                          <td className="px-4 py-2.5 text-right font-semibold text-[#1A6FBF]">{formatProductMoney(selectedOrder.amount, selectedOrder.currency)}</td>
	                        </tr>
	                      </tfoot>
	                    </table>
	                  </div>
	                  <div className="flex items-center gap-2 mt-2 flex-wrap">
	                    <button className="!min-h-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-amber-300 text-amber-700 text-xs font-semibold hover:bg-amber-50" onClick={() => openCrossSellModal(selectedOrder)}>+ Cross-sell / Upsell Item</button>
	                    <button className="!min-h-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-emerald-300 text-emerald-700 text-xs font-semibold hover:bg-emerald-50" onClick={() => openFreeGiftModal(selectedOrder)}>+ Free Gift</button>
	                  </div>
	                </section>

	                {/* Section 4b: Upsell tracking + Bonus */}
	                <section>
	                  <h3 className="font-semibold text-base border-b border-gray-100 pb-2 mb-3">Bonus &amp; Upsell Tracking</h3>
	                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
	                    <label className="flex flex-col gap-1">
	                      <span className="text-xs font-medium uppercase tracking-wide text-gray-500">Upsell from</span>
	                      <input className="border border-gray-200 rounded-lg px-3 py-2 text-sm" inputMode="numeric" placeholder="e.g. 3" value={selectedOrder.upsellFromQty ?? ""} onChange={(e) => {
	                        const v = e.target.value === "" ? undefined : Number(e.target.value);
	                        setTrackedOrders((prev) => prev.map((o) => o.id === selectedOrder.id ? { ...o, upsellFromQty: v } : o));
	                      }} />
	                    </label>
	                    <label className="flex flex-col gap-1">
	                      <span className="text-xs font-medium uppercase tracking-wide text-gray-500">Upsell to</span>
	                      <input className="border border-gray-200 rounded-lg px-3 py-2 text-sm" inputMode="numeric" placeholder="e.g. 5" value={selectedOrder.upsellToQty ?? ""} onChange={(e) => {
	                        const v = e.target.value === "" ? undefined : Number(e.target.value);
	                        setTrackedOrders((prev) => prev.map((o) => o.id === selectedOrder.id ? { ...o, upsellToQty: v } : o));
	                      }} />
	                    </label>
	                    <label className="flex flex-col gap-1">
	                      <span className="text-xs font-medium uppercase tracking-wide text-gray-500">Note</span>
	                      <input className="border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder="e.g. Yes/Upgraded" value={selectedOrder.upsellNote ?? ""} onChange={(e) => {
	                        const v = e.target.value;
	                        setTrackedOrders((prev) => prev.map((o) => o.id === selectedOrder.id ? { ...o, upsellNote: v } : o));
	                      }} />
	                    </label>
	                  </div>
	                  {(() => {
	                    const isDeliveredSO = selectedOrder.status === "Delivered";
	                    const earnedSO = isDeliveredSO ? computeOrderBonus(selectedOrder, 100, 0, 0) : null;
	                    const projectedSO = projectedOrderBonus(selectedOrder);
	                    const displaySO = isDeliveredSO ? earnedSO! : projectedSO;
	                    return (
	                      <div className={`mt-3 p-3 border rounded-lg flex flex-col gap-1.5 ${isDeliveredSO ? "bg-emerald-50 border-emerald-200" : "bg-gray-50 border-gray-200"}`}>
	                        <div className="flex items-center justify-between">
	                          <div>
	                            <strong className="text-sm text-gray-900">{isDeliveredSO ? "Earned Bonus" : "Projected Bonus"}</strong>
	                            {!isDeliveredSO && <p className="text-xs text-gray-400">Estimated if order is delivered</p>}
	                          </div>
	                          <span className={`text-lg font-extrabold ${isDeliveredSO ? "text-emerald-700" : "text-gray-500"}`}>{formatProductMoney(displaySO.total, selectedOrder.currency)}</span>
	                        </div>
	                        {displaySO.components.length > 0 && (
	                          <ul className="text-xs text-gray-600 list-disc pl-5">
	                            {displaySO.components.map((c, i) => <li key={i}>{c.label}: <span className="font-semibold">{formatProductMoney(c.amount, selectedOrder.currency)}</span></li>)}
	                          </ul>
	                        )}
	                        {displaySO.components.length === 0 && (
	                          <p className="text-xs text-gray-400">No bonus rules matched — check product bonus settings.</p>
	                        )}
	                        {selectedOrder.bonusManuallyAdjusted && (
	                          <p className="text-xs text-amber-700">Manual override active: {formatProductMoney(selectedOrder.manualBonusOverride ?? 0, selectedOrder.currency)}{selectedOrder.manualBonusReason ? ` — ${selectedOrder.manualBonusReason}` : ""}</p>
	                        )}
	                        <div className="flex items-center gap-2 pt-1">
	                          <button className="!min-h-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-blue-300 text-blue-700 text-xs font-semibold hover:bg-blue-50" onClick={() => openManualBonusModal(selectedOrder)}>{selectedOrder.bonusManuallyAdjusted ? "Edit Manual Bonus" : "Manual Adjust"}</button>
	                          <button className="!min-h-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-red-300 text-red-700 text-xs font-semibold hover:bg-red-50" onClick={() => openAddPenalty(selectedOrder.assignedRepId, selectedOrder.id)}>Apply Penalty</button>
	                        </div>
	                      </div>
	                    );
	                  })()}
	                </section>
	
	                {/* Section 5: Order Timeline */}
	                <section>
	                  <h3 className="font-semibold text-base border-b border-gray-100 pb-2 mb-4">Order Timeline</h3>
	                  {(() => {
	                    const s = selectedOrder.status ?? "New";
	                    const isCancelled = s === "Cancelled";
	                    const statusStepMap: Record<string, number> = { "New": 0, "Confirmed": 1, "In Process": 1, "Postponed": 1, "Failed": 1, "Dispatched": 2, "Delivered": 3 };
	                    const currentStep = isCancelled ? 0 : (statusStepMap[s] ?? 0);
	                    const steps: { label: string; Icon: React.ElementType }[] = [
	                      { label: "Order Placed", Icon: ShoppingBag },
	                      { label: "Confirmed", Icon: CheckCircle2 },
	                      { label: "Dispatched", Icon: Truck },
	                      { label: "Delivered", Icon: CheckCircle2 },
	                    ];
	                    return (
	                      <div className="flex flex-col">
	                        {steps.map((step, idx) => {
	                          const isDone = idx < currentStep;
	                          const isActive = idx === currentStep && !isCancelled;
	                          const filled = isDone || isActive;
	                          const isLast = idx === steps.length - 1 && !isCancelled;
	                          return (
	                            <div key={step.label} className="relative flex gap-4 pb-6 last:pb-0">
	                              {!isLast && <div className="absolute left-4 top-8 bottom-0 w-0.5 bg-gray-200" />}
	                              <div className={`relative z-10 flex size-8 items-center justify-center rounded-full border-2 shrink-0 ${filled ? "bg-[#1A6FBF] border-[#1A6FBF]" : "bg-white border-gray-300"}`}>
	                                <step.Icon className={`w-4 h-4 ${filled ? "text-white" : "text-gray-400"}`} />
	                              </div>
	                              <div className="flex-1 pt-1">
	                                <p className="text-sm font-medium text-gray-900 m-0">{step.label}</p>
	                                {isActive && <span className="inline-flex items-center border border-gray-200 rounded-full px-2 py-0.5 text-xs font-medium text-gray-500 mt-1">Current Status</span>}
	                              </div>
	                            </div>
	                          );
	                        })}
	                        {isCancelled && (
	                          <div className="relative flex gap-4">
	                            <div className="relative z-10 flex size-8 items-center justify-center rounded-full border-2 shrink-0 bg-white border-red-500">
	                              <CircleX className="w-4 h-4 text-red-500" />
	                            </div>
	                            <div className="flex-1 pt-1">
	                              <p className="text-sm font-medium text-red-600 m-0">Cancelled</p>
	                              <span className="inline-flex items-center border border-red-200 rounded-full px-2 py-0.5 text-xs font-medium text-red-500 mt-1">Current Status</span>
	                            </div>
	                          </div>
	                        )}
	                      </div>
	                    );
	                  })()}
	                </section>
	
	                {/* Section 6: Notes — only when notes exist */}
	                {(selectedOrder.notes ?? []).length > 0 && (
	                  <section>
	                    <h3 className="font-semibold text-base border-b border-gray-100 pb-2 mb-3">Notes</h3>
	                    <div className="flex flex-col gap-3">
	                      {(selectedOrder.notes ?? []).map((note) => (
	                        <div key={note.id} className="border border-gray-200 rounded-lg p-3 bg-gray-50/50 space-y-1">
	                          <div className="flex items-center gap-1.5 text-xs text-gray-400">
	                            <Clock className="w-3.5 h-3.5" />
	                            <span>{note.by} · {displayDateFromKey(note.date)}</span>
	                          </div>
	                          <p className="text-sm text-gray-700 m-0">{note.text}{note.followUpDate ? ` · Follow-up: ${displayDateFromKey(note.followUpDate)}` : ""}</p>
	                        </div>
	                      ))}
	                    </div>
	                  </section>
	                )}
	
	                	
	                {/* Status Audit Timeline */}
	                {orderAuditLog.length > 0 && (
	                  <section>
	                    <h3 className="font-semibold text-base border-b border-gray-100 pb-2 mb-3">Status History</h3>
	                    <div className="flex flex-col gap-2 max-h-40 overflow-y-auto">
	                      {orderAuditLog.map((entry) => (
	                        <div key={entry.id} className="flex items-start gap-2 text-xs text-gray-600">
	                          <span className="mt-0.5 w-2 h-2 rounded-full bg-[#1A6FBF] shrink-0" />
	                          <div>
	                            <span className="font-semibold text-gray-900">{entry.from_status ?? "New"} → {entry.to_status}</span>
	                            {entry.note && <span className="text-gray-500"> · {entry.note}</span>}
	                            <div className="text-gray-400 mt-0.5">{new Date(entry.created_at).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" })}</div>
	                          </div>
	                        </div>
	                      ))}
	                    </div>
	                  </section>
	                )}
	
	                {/* Footer */}
	                <div className="flex justify-end pt-2 border-t border-gray-100">
	                  <button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#1A6FBF] text-white text-sm font-medium hover:bg-[#1560a8] transition-colors" onClick={closeModal}>Close</button>
	                </div>
	              </div>
	            )}

	            {modal === "orderWorkflow" && selectedOrder && (
	              <div className="px-6 py-5 flex flex-col gap-4">
	                <section className="flex items-start justify-between gap-3 bg-gray-50 rounded-xl p-4">
	                  <div>
	                    <span>{selectedOrder.id}</span>
	                    <h3 className="text-base font-bold text-gray-900 mt-0.5">{selectedOrder.customer}</h3>
	                    <p>{selectedOrder.phone} · {selectedOrder.location ?? orderLocationFromFields(selectedOrder.city ?? "", selectedOrder.state ?? "")}</p>
	                  </div>
	                  <strong className={`status-pill status-${slugify(selectedOrder.status ?? "New")}`}>{selectedOrder.status ?? "New"}</strong>
	                </section>

	                <section className="grid grid-cols-2 sm:grid-cols-4 gap-2" aria-label="Order actions">
	                  <button className="!min-h-0 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-red-50 text-red-600 text-sm font-medium hover:bg-red-100 transition-colors" onClick={() => setModal("deleteOrder")}><Trash2 /> Delete Order</button>
	                  <button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors" onClick={() => showToast("Choose a new status in the Status Workflow block.")}><Repeat2 /> Change Status</button>
	                  <button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors" onClick={() => printInvoiceForOrder(selectedOrder)}><BookOpen /> Print Invoice</button>
	                  <button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors" onClick={() => downloadInvoiceForOrder(selectedOrder)}><Download /> Download Invoice</button>
	                  <button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors" onClick={() => setModal("sendToAgent")}><Truck /> Send to Agent</button>
	                  <button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors" onClick={() => setModal("reassignOrder")}><UserPlus /> Reassign Rep</button>
	                  <button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors" onClick={openEditSelectedOrder}><Pencil /> Edit Order</button>
	                </section>

	                <section className="bg-gray-50 rounded-xl p-4 flex flex-col gap-3">
	                  <div><h3 className="text-sm font-semibold text-gray-900">Status Workflow</h3><p>{selectedOrder.response ?? "Awaiting confirmation"}</p></div>
	                  <div className="flex flex-wrap gap-2">
	                    {(["New", "Confirmed", "In Process", "Dispatched", "Delivered", "Postponed", "Failed", "Cancelled"] as Exclude<OrderStatus, "All Orders">[]).map((status) => (
	                      <button key={status} className={`!min-h-0 px-3 py-1.5 rounded-lg text-sm border transition-colors ${selectedOrder.status === status ? "bg-[#1A6FBF] text-white border-[#1A6FBF]" : "border-gray-200 text-gray-700 hover:bg-gray-100"}`} onClick={() => updateOrderStatus(selectedOrder.id, status)}>{status}</button>
	                    ))}
	                  </div>
	                </section>

	                <section className="bg-gray-50 rounded-xl p-4 flex flex-col gap-3">
	                  <div><h3 className="text-sm font-semibold text-gray-900">Fulfillment Assignment</h3><p>{agentNameForOrder(selectedOrder)}</p></div>
	                  <div className="flex items-center gap-2">
	                    <select value={createOrderAgentId} onChange={(event) => setCreateOrderAgentId(event.target.value)} aria-label="Delivery agent">
	                      <option value="">Unassigned</option>
	                      {activeAgents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name} · {agent.zone}</option>)}
	                    </select>
	                    <button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#1A6FBF] text-white text-sm font-medium hover:bg-[#1560a8] transition-colors" onClick={saveOrderAgent}>Send to Agent</button>
	                  </div>
	                </section>

	                <section className="bg-gray-50 rounded-xl p-4 flex flex-col gap-3">
	                  <div><h3 className="text-sm font-semibold text-gray-900">Schedule Delivery</h3><p>{selectedOrder.scheduledDate ? displayDateFromKey(selectedOrder.scheduledDate) : "Not scheduled"}</p></div>
	                  <div className="flex flex-wrap gap-2">
	                    {scheduleRanges.map((range) => <button key={range} className="!min-h-0 px-3 py-1.5 rounded-lg text-sm border border-gray-200 text-gray-700 hover:bg-gray-100 transition-colors" onClick={() => scheduleOrder(selectedOrder.id, range)}>{range}</button>)}
	                  </div>
	                </section>

	                <section className="bg-gray-50 rounded-xl p-4 flex flex-col gap-3">
	                  <div><h3 className="text-sm font-semibold text-gray-900">Communication Timeline</h3><p>{(selectedOrder.notes ?? []).length} note{(selectedOrder.notes ?? []).length === 1 ? "" : "s"}</p></div>
	                  <div className="flex flex-col gap-2 max-h-44 overflow-y-auto">{(selectedOrder.notes ?? []).map((note) => <p key={note.id}><strong>{note.by}</strong> · {displayDateFromKey(note.date)}<br />{note.text}{note.followUpDate ? ` · Follow-up ${displayDateFromKey(note.followUpDate)}` : ""}</p>)}</div>
	                  <label><span>Note</span><textarea value={orderNoteDraft} onChange={(event) => setOrderNoteDraft(event.target.value)} /></label>
	                  <label><span>Follow-up Date</span><input value={orderFollowUpDate} onChange={(event) => setOrderFollowUpDate(event.target.value)} placeholder="YYYY-MM-DD" /></label>
	                  <button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors" onClick={addOrderNote}>Add Note</button>
	                </section>

	                <section className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-gray-100">
	                  <button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors" onClick={() => updateOrderStatus(selectedOrder.id, "Postponed")}>Postpone Order</button>
	                  <button className="!min-h-0 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-red-50 text-red-600 text-sm font-medium hover:bg-red-100 transition-colors" onClick={() => updateOrderStatus(selectedOrder.id, "Cancelled")}>Cancel Order</button>
	                  <button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#1A6FBF] text-white text-sm font-medium hover:bg-[#1560a8] transition-colors" onClick={() => updateOrderStatus(selectedOrder.id, "Confirmed")}>Confirm Order</button>
	                </section>
	              </div>
	            )}

	            {modal === "changeOrderStatus" && selectedOrder && (
	              <div className="modal-form">
	                <label><span>Current Status</span><input value={selectedOrder.status ?? "New"} readOnly /></label>
	                <label><span>New Status *</span><select value={statusChangeDraft} onChange={(event) => setStatusChangeDraft(event.target.value as Exclude<OrderStatus, "All Orders">)}>{repChangeStatuses.map((status) => <option key={status}>{status}</option>)}</select></label>
	                <label><span>Call Outcome</span><select value={callOutcomeDraft} onChange={(e) => setCallOutcomeDraft(e.target.value as CallOutcome | "")}><option value="">— Not recorded —</option>{(["Confirmed","No Answer","Wrong Number","Refused","Scheduled Callback","Not Reached"] as CallOutcome[]).map((o) => <option key={o} value={o}>{o}</option>)}</select></label>
	                <label><span>Reason for Status Change *</span><textarea value={statusChangeReason} onChange={(event) => setStatusChangeReason(event.target.value)} placeholder="Customer confirmed after call, no answer, requested later delivery..." /></label>
	                <div className="flex items-center justify-end gap-3 pt-2"><button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors" onClick={closeModal}>Cancel</button><button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#1A6FBF] text-white text-sm font-medium hover:bg-[#1560a8] transition-colors" onClick={submitRepStatusChange}>Change Status</button></div>
	              </div>
	            )}

	            {modal === "editOrderCustomer" && selectedOrder && (
	              <div className="modal-form">
	                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
	                  <label><span>Customer Name</span><input value={createOrderCustomer} onChange={(event) => setCreateOrderCustomer(event.target.value)} /></label>
	                  <label><span>Phone Number</span><input value={createOrderPhone} onChange={(event) => setCreateOrderPhone(event.target.value)} inputMode="tel" /></label>
	                  <label><span>WhatsApp Number</span><input value={createOrderWhatsapp} onChange={(event) => setCreateOrderWhatsapp(event.target.value)} inputMode="tel" /></label>
	                  <label><span>Email (Optional)</span><input value={createOrderEmail} onChange={(event) => setCreateOrderEmail(event.target.value)} type="email" placeholder="customer@example.com" /></label>
	                  <label><span>City</span><input value={createOrderCity} onChange={(event) => setCreateOrderCity(event.target.value)} /></label>
	                  <label><span>State</span><input value={createOrderState} onChange={(event) => setCreateOrderState(event.target.value)} /></label>
	                </div>
	                <label><span>Delivery Address</span><textarea value={createOrderAddress} onChange={(event) => setCreateOrderAddress(event.target.value)} /></label>
	                <div className="flex items-center justify-end gap-3 pt-2"><button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors" onClick={closeModal}>Cancel</button><button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#1A6FBF] text-white text-sm font-medium hover:bg-[#1560a8] transition-colors" onClick={saveOrderCustomerEdit}>Save Changes</button></div>
	              </div>
	            )}

	            {modal === "editOrderItems" && selectedOrder && (
	              <div className="modal-form">
	                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
	                  <label><span>Customer Name</span><input value={createOrderCustomer} onChange={(event) => setCreateOrderCustomer(event.target.value)} /></label>
	                  <label><span>Phone</span><input value={createOrderPhone} onChange={(event) => setCreateOrderPhone(event.target.value)} inputMode="tel" /></label>
	                  <label><span>WhatsApp</span><input value={createOrderWhatsapp} onChange={(event) => setCreateOrderWhatsapp(event.target.value)} inputMode="tel" /></label>
	                  <label><span>Source</span><select value={createOrderSource} onChange={(event) => setCreateOrderSource(event.target.value as Exclude<OrderSource, "All Sources">)}>{orderSources.filter((source) => source !== "All Sources").map((source) => <option key={source}>{source}</option>)}</select></label>
	                  <label><span>City</span><input value={createOrderCity} onChange={(event) => setCreateOrderCity(event.target.value)} /></label>
	                  <label><span>State</span><input value={createOrderState} onChange={(event) => setCreateOrderState(event.target.value)} /></label>
	                </div>
	                <label><span>Delivery Address</span><textarea value={createOrderAddress} onChange={(event) => setCreateOrderAddress(event.target.value)} /></label>
	                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
	                  <label><span>Product</span><select value={createOrderProductId} onChange={(event) => { const product = products.find((item) => item.id === event.target.value); const offer = product ? activeProductPackages(product)[0] : undefined; setCreateOrderProductId(event.target.value); setCreateOrderPackageId(offer?.id ?? ""); setCreateOrderQuantity(String(offer?.quantity ?? 1)); }}><option value="">Choose product</option>{products.filter((product) => product.active).map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label>
	                  <label><span>Package</span><select value={createOrderPackageId} onChange={(event) => { const product = products.find((item) => item.id === createOrderProductId); const offer = product?.packages.find((item) => item.id === event.target.value); setCreateOrderPackageId(event.target.value); if (offer) setCreateOrderQuantity(String(offer.quantity)); }}><option value="">Manual quantity</option>{products.find((item) => item.id === createOrderProductId)?.packages.map((item) => <option key={item.id} value={item.id}>{item.name} · {formatProductMoney(item.price, item.currency)}</option>)}</select></label>
	                  <label><span>Quantity</span><input value={createOrderQuantity} onChange={(event) => setCreateOrderQuantity(event.target.value)} inputMode="numeric" /></label>
	                  <label><span>Sales Rep</span><select value={createOrderRepId} onChange={(event) => setCreateOrderRepId(event.target.value)}><option value="auto">Keep current</option>{salesRepUsers.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label>
	                  <label><span>Delivery Agent</span><select value={createOrderAgentId} onChange={(event) => setCreateOrderAgentId(event.target.value)}><option value="">Unassigned</option>{activeAgents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name} · {agent.zone}</option>)}</select></label>
	                </div>
	                <div className="flex items-center justify-end gap-3 pt-2"><button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors" onClick={() => setModal("orderWorkflow")}>Back</button><button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#1A6FBF] text-white text-sm font-medium hover:bg-[#1560a8] transition-colors" onClick={saveSelectedOrderEdit}>Save Order</button></div>
	              </div>
	            )}

	            {modal === "reassignOrder" && selectedOrder && (
	              <div className="modal-form">{activeSalesRepUsers.length === 0 ? <p className="text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">No active sales reps available. Activate a sales rep first.</p> : <><label><span>New Sales Rep</span><select value={reassignRepId} onChange={(event) => setReassignRepId(event.target.value)}>{activeSalesRepUsers.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label><label><span>Handover Reason</span><textarea value={handoverReason} onChange={(event) => setHandoverReason(event.target.value)} /></label></>}<div className="flex items-center justify-end gap-3 pt-2"><button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors" onClick={closeModal}>Cancel</button>{activeSalesRepUsers.length > 0 && <button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#1A6FBF] text-white text-sm font-medium hover:bg-[#1560a8] transition-colors" onClick={reassignSelectedOrder}>Reassign</button>}</div></div>
	            )}

	            {modal === "sendToAgent" && selectedOrder && (
	              <div className="modal-form"><label><span>Delivery Agent</span><select value={createOrderAgentId} onChange={(event) => setCreateOrderAgentId(event.target.value)}><option value="">Unassigned</option>{activeAgents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name} · {agent.zone}</option>)}</select></label><div className="flex items-center justify-end gap-3 pt-2"><button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors" onClick={closeModal}>Cancel</button><button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#1A6FBF] text-white text-sm font-medium hover:bg-[#1560a8] transition-colors" onClick={saveOrderAgent}>Send to Agent</button></div></div>
	            )}

	            {modal === "deleteOrder" && selectedOrder && (
	              <div className="px-6 py-5 flex flex-col gap-4"><p>Delete <strong>{selectedOrder.id}</strong> for {selectedOrder.customer}?</p><div className="flex items-center justify-end gap-3 pt-2"><button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors" onClick={closeModal}>Cancel</button><button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 transition-colors" onClick={deleteSelectedOrder}>Delete Order</button></div></div>
	            )}

	            {modal === "cartDetails" && selectedCart && (
	              <div className="px-6 py-5 flex flex-col gap-4"><div className="grid grid-cols-2 sm:grid-cols-3 gap-3"><article className="bg-gray-50 rounded-xl p-3 flex flex-col gap-0.5"><span className="text-xs text-gray-400 font-semibold uppercase tracking-wide">Cart</span><strong className="text-sm font-semibold text-gray-900">{selectedCart.id}</strong></article><article className="bg-gray-50 rounded-xl p-3 flex flex-col gap-0.5"><span className="text-xs text-gray-400 font-semibold uppercase tracking-wide">Status</span><strong className="text-sm font-semibold text-gray-900">{selectedCart.status}</strong></article><article className="bg-gray-50 rounded-xl p-3 flex flex-col gap-0.5"><span className="text-xs text-gray-400 font-semibold uppercase tracking-wide">Customer</span><strong className="text-sm font-semibold text-gray-900">{selectedCart.customer}</strong></article><article className="bg-gray-50 rounded-xl p-3 flex flex-col gap-0.5"><span className="text-xs text-gray-400 font-semibold uppercase tracking-wide">Product</span><strong className="text-sm font-semibold text-gray-900">{selectedCart.productName}</strong></article><article className="bg-gray-50 rounded-xl p-3 flex flex-col gap-0.5"><span className="text-xs text-gray-400 font-semibold uppercase tracking-wide">Amount</span><strong className="text-sm font-semibold text-gray-900">{formatProductMoney(selectedCart.amount, selectedCart.currency)}</strong></article><article className="bg-gray-50 rounded-xl p-3 flex flex-col gap-0.5"><span className="text-xs text-gray-400 font-semibold uppercase tracking-wide">Rep</span><strong className="text-sm font-semibold text-gray-900">{users.find((user) => user.id === selectedCart.assignedRepId)?.name ?? "Unassigned"}</strong></article></div><div className="flex items-center justify-end gap-3 pt-2"><button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors" onClick={() => setModal("assignCart")}>Assign</button><button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#1A6FBF] text-white text-sm font-medium hover:bg-[#1560a8] transition-colors" onClick={() => setModal("convertCart")}>Convert to Order</button></div></div>
	            )}

	            {modal === "assignCart" && selectedCart && (
	              <div className="modal-form">{salesRepUsers.length === 0 ? <p className="text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">No sales reps available. Add a sales rep first.</p> : <label><span>Sales Rep</span><select value={reassignRepId} onChange={(event) => setReassignRepId(event.target.value)}>{salesRepUsers.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label>}<div className="flex items-center justify-end gap-3 pt-2"><button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors" onClick={closeModal}>Cancel</button>{salesRepUsers.length > 0 && <button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#1A6FBF] text-white text-sm font-medium hover:bg-[#1560a8] transition-colors" onClick={assignSelectedCart}>Assign Cart</button>}</div></div>
	            )}

	            {modal === "convertCart" && selectedCart && (
	              <div className="px-6 py-5 flex flex-col gap-4"><p>Convert <strong>{selectedCart.id}</strong> into a new order for {selectedCart.customer}?</p><div className="flex items-center justify-end gap-3 pt-2"><button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors" onClick={closeModal}>Cancel</button><button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#1A6FBF] text-white text-sm font-medium hover:bg-[#1560a8] transition-colors" onClick={convertSelectedCart}>Convert</button></div></div>
	            )}

            {modal === "addProduct" && (
              <div className="modal-form">
                <p>Fill in the product details below. All fields marked with * are required.</p>
                <label><span>Product Name *</span><input value={productName} onChange={(event) => setProductName(event.target.value)} placeholder="e.g., Premium Headphones" /></label>
                <label><span>Description</span><textarea value={productDescription} onChange={(event) => setProductDescription(event.target.value)} placeholder="Product description..." /></label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <label><span>SKU</span><input value={productSku} onChange={(event) => setProductSku(event.target.value)} placeholder="Auto-generated from name" /></label>
                  <label><span>Currency *</span><select value={currency} onChange={(event) => setCurrency(event.target.value as CurrencyCode)}><option value="NGN">₦ - Nigerian Naira</option><option value="USD">$ - US Dollar</option><option value="GBP">£ - British Pound</option></select></label>
                  <div className="flex items-center justify-between py-1">
                  <div>
                  <span className="text-xs text-gray-400">Make product available for orders</span>
                    <span className="text-sm font-medium text-gray-700">Active Status</span>
                  </div>
                  <button type="button" role="switch" aria-checked={productActive}
                    className={`relative w-11 h-6 !min-h-0 p-0 rounded-full transition-colors shrink-0 ${productActive ? "bg-[#1A6FBF]" : "bg-gray-200"}`}
                    onClick={() => setProductActive(!productActive)}>
                    <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${productActive ? "left-5" : "left-0.5"}`} />
                  </button>
                </div>
                  <label><span>Unit Cost *</span><input value={unitCost} onChange={(event) => setUnitCost(event.target.value)} inputMode="decimal" /></label>
                  <label><span>Selling Price *</span><input value={sellingPrice} onChange={(event) => setSellingPrice(event.target.value)} inputMode="decimal" /></label>
                  <label><span>Opening Stock</span><input value={openingStock} onChange={(event) => setOpeningStock(event.target.value)} inputMode="numeric" /></label>
                  <label><span>Reorder Point</span><input value={reorderPoint} onChange={(event) => setReorderPoint(event.target.value)} inputMode="numeric" /></label>
                </div>
                <div className="flex items-center justify-end gap-3 pt-2">
                  <button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors" onClick={closeModal}>Cancel</button>
                  <button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#1A6FBF] text-white text-sm font-medium hover:bg-[#1560a8] transition-colors" onClick={createProduct}>Create Product</button>
                </div>
              </div>
            )}

            {modal === "updateStock" && (
              <div className="modal-form">
                <p>Add or remove stock from a product. Use positive numbers to add stock, negative numbers to remove stock.</p>
                <label><span>Select Product *</span><select aria-label="Select product" value={stockProductId} onChange={(event) => setStockProductId(event.target.value)}><option value="">Choose a product...</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name} - {product.warehouseStock} in stock</option>)}</select></label>
                <label><span>Quantity Change *</span><input value={stockChange} onChange={(event) => setStockChange(event.target.value)} inputMode="numeric" /></label>
                <p>Positive numbers add stock, negative numbers remove stock</p>
                <div className="flex items-center justify-end gap-3 pt-2">
                  <button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors" onClick={closeModal}>Cancel</button>
                  <button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#1A6FBF] text-white text-sm font-medium hover:bg-[#1560a8] transition-colors" onClick={submitStockUpdate}>Update Stock</button>
                </div>
              </div>
            )}

            {modal === "productDetails" && selectedProduct && (
              <div className="px-6 py-5 flex flex-col gap-5">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <article className="bg-gray-50 rounded-xl p-3 flex flex-col gap-0.5"><span className="text-xs text-gray-400 font-semibold uppercase tracking-wide">Product Name</span><strong className="text-sm font-semibold text-gray-900">{selectedProduct.name}</strong></article>
                  <article className="bg-gray-50 rounded-xl p-3 flex flex-col gap-0.5"><span className="text-xs text-gray-400 font-semibold uppercase tracking-wide">SKU</span><strong className="text-sm font-semibold text-gray-900">{selectedProduct.sku}</strong></article>
                  <article className="bg-gray-50 rounded-xl p-3 flex flex-col gap-0.5"><span className="text-xs text-gray-400 font-semibold uppercase tracking-wide">Unit Cost</span><strong className="text-sm font-semibold text-gray-900">{formatProductMoney(primaryPricing(selectedProduct)?.unitCost ?? 0, primaryPricing(selectedProduct)?.currency ?? "NGN")}</strong></article>
                  <article className="bg-gray-50 rounded-xl p-3 flex flex-col gap-0.5"><span className="text-xs text-gray-400 font-semibold uppercase tracking-wide">Selling Price</span><strong className="text-sm font-semibold text-gray-900">{formatProductMoney(primaryPricing(selectedProduct)?.sellingPrice ?? 0, primaryPricing(selectedProduct)?.currency ?? "NGN")}</strong></article>
                  <article className="bg-gray-50 rounded-xl p-3 flex flex-col gap-0.5"><span className="text-xs text-gray-400 font-semibold uppercase tracking-wide">Warehouse Stock</span><strong className="text-sm font-semibold text-gray-900">{selectedProduct.warehouseStock}</strong></article>
                  <article className="bg-gray-50 rounded-xl p-3 flex flex-col gap-0.5"><span className="text-xs text-gray-400 font-semibold uppercase tracking-wide">Reorder Point</span><strong className="text-sm font-semibold text-gray-900">{selectedProduct.reorderPoint}</strong></article>
                </div>
                <section className="flex flex-col gap-3">
                  <h3 className="text-sm font-semibold text-gray-700">Agent Distribution</h3>
                  {agentStock.filter((stock) => stock.productId === selectedProduct.id).length === 0 ? (
                    <p className="text-sm text-gray-400 italic py-2">No agent distribution yet.</p>
                  ) : (
                    <div className="overflow-x-auto rounded-xl border border-gray-200">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50 text-xs text-gray-500 uppercase"><tr><th className="px-3 py-2 text-left">Agent</th><th className="px-3 py-2 text-left">Zone</th><th className="px-3 py-2 text-left">Available</th><th className="px-3 py-2 text-left">Defective</th><th className="px-3 py-2 text-left">Missing</th><th className="px-3 py-2 text-left">Stock Value</th></tr></thead>
                        <tbody>
                          {agentStock.filter((stock) => stock.productId === selectedProduct.id).map((stock) => {
                            const agent = agents.find((item) => item.id === stock.agentId);
                            const pricing = primaryPricing(selectedProduct);
                            return (
                              <tr key={`${stock.agentId}-${stock.productId}`}>
                                <td>{agent?.name ?? "Unknown agent"}</td>
                                <td>{agent?.zone ?? "-"}</td>
                                <td>{stock.quantity}</td>
                                <td>{stock.defective}</td>
                                <td>{stock.missing}</td>
                                <td>{formatProductMoney(stock.quantity * (pricing?.sellingPrice ?? 0), pricing?.currency ?? "NGN")}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
                <section className="flex flex-col gap-2 border border-blue-100 bg-blue-50 rounded-xl p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-blue-900">Order Form Configuration</h3>
                      <p className="text-xs text-blue-700">Per-product bonuses and state availability that drive payroll and the order form.</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <article className="bg-white rounded-lg p-3 flex flex-col gap-1 border border-blue-100">
                      <span className="text-[10px] uppercase font-semibold text-gray-500">Role</span>
                      <strong className="text-sm text-gray-800">{selectedProduct.role ?? "Main"}</strong>
                    </article>
                    <article className="bg-white rounded-lg p-3 flex flex-col gap-1 border border-blue-100">
                      <span className="text-[10px] uppercase font-semibold text-gray-500">States Available</span>
                      <strong className="text-sm text-gray-800">{selectedProduct.availableStates && selectedProduct.availableStates.length > 0 ? `${selectedProduct.availableStates.length} of ${nigeriaStates.length}` : `All ${nigeriaStates.length}`}</strong>
                    </article>
                    <article className="bg-white rounded-lg p-3 flex flex-col gap-1 border border-blue-100">
                      <span className="text-[10px] uppercase font-semibold text-gray-500">Cross-sell %</span>
                      <strong className="text-sm text-gray-800">{productBonusConfig(selectedProduct).crossSellPercent}%</strong>
                    </article>
                  </div>
                  <div className="flex items-center gap-2 pt-1 flex-wrap">
                    <button className="!min-h-0 inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 transition-colors" onClick={() => openBonusSettings(selectedProduct)}>Edit Bonus Settings</button>
                    <button className="!min-h-0 inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-white border border-blue-300 text-blue-700 text-xs font-semibold hover:bg-blue-100 transition-colors" onClick={() => previewProductForm(selectedProduct)}>Configure Order Form</button>
                  </div>
                  <p className="text-[11px] text-gray-500 italic">State availability and form labels are now configured on the <strong>Embed Form</strong> page so the same settings live next to the form preview.</p>
                </section>
                <div className="flex items-center justify-between gap-3 pt-2 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <button className="!min-h-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 text-gray-700 text-xs font-semibold hover:bg-gray-50 transition-colors" onClick={() => { openEditProduct(selectedProduct); }}><Pencil className="w-3.5 h-3.5" /> Edit Details</button>
                    <button className="!min-h-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-blue-300 text-blue-700 text-xs font-semibold hover:bg-blue-50 transition-colors" onClick={() => { previewProductForm(selectedProduct); }}><Globe className="w-3.5 h-3.5" /> Preview Form</button>
                    <button className="!min-h-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-blue-300 text-blue-700 text-xs font-semibold hover:bg-blue-50 transition-colors" onClick={() => { closeModal(); duplicateProduct(selectedProduct); }}><Copy className="w-3.5 h-3.5" /> Duplicate</button>
                    <button className={`!min-h-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-semibold transition-colors ${selectedProduct.active ? "border-amber-300 text-amber-700 hover:bg-amber-50" : "border-emerald-300 text-emerald-700 hover:bg-emerald-50"}`} onClick={() => toggleProductActive(selectedProduct)}>{selectedProduct.active ? <><ToggleRight className="w-3.5 h-3.5" /> Deactivate</> : <><ToggleLeft className="w-3.5 h-3.5" /> Activate</>}</button>
                    <button className="!min-h-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-red-300 text-red-700 text-xs font-semibold hover:bg-red-50 transition-colors" onClick={() => { closeModal(); openDeleteProduct(selectedProduct); }}><Trash2 className="w-3.5 h-3.5" /> Delete</button>
                  </div>
                  <div className="flex items-center gap-3">
                    <button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors" onClick={closeModal}>Close</button>
                    <button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#1A6FBF] text-white text-sm font-medium hover:bg-[#1560a8] transition-colors" onClick={() => { closeModal(); openPackagesView(selectedProduct); }}>Manage Packages</button>
                  </div>
                </div>
              </div>
            )}

            {modal === "deleteProduct" && selectedProduct && (() => {
              const activeStatuses: TrackedOrder["status"][] = ["New", "Confirmed", "In Process", "Dispatched"];
              const activeOrders = trackedOrders.filter((o) => o.productId === selectedProduct.id && activeStatuses.includes(o.status));
              const historicalOrders = trackedOrders.filter((o) => o.productId === selectedProduct.id && !activeStatuses.includes(o.status));
              const crossRefProducts = products.filter((p) => p.id !== selectedProduct.id && ((p.crossSellProductIds ?? []).includes(selectedProduct.id) || (p.freeGiftProductIds ?? []).includes(selectedProduct.id)));
              const agentUnits = agentStock.filter((s) => s.productId === selectedProduct.id).reduce((sum, s) => sum + s.quantity, 0);
              const blocked = activeOrders.length > 0;
              return (
                <div className="px-6 py-5 flex flex-col gap-4">
                  <div>
                    <p className="font-semibold text-gray-900">Delete <strong>{selectedProduct.name}</strong>?</p>
                    <p className="text-sm text-gray-500 mt-1">This cannot be undone. Review the impact below.</p>
                  </div>
                  <div className="rounded-lg border border-gray-200 divide-y divide-gray-100 text-sm overflow-hidden">
                    <div className={`flex items-start gap-3 px-4 py-3 ${blocked ? "bg-red-50" : "bg-gray-50"}`}>
                      <span className={`mt-0.5 font-bold text-base ${blocked ? "text-red-500" : "text-gray-400"}`}>◈</span>
                      <div>
                        <p className={`font-semibold ${blocked ? "text-red-800" : "text-gray-600"}`}>
                          {blocked ? `${activeOrders.length} active order${activeOrders.length !== 1 ? "s" : ""} still open` : "No active orders"}
                        </p>
                        {blocked && <p className="text-red-700 text-xs mt-0.5">Complete or cancel these before deleting.</p>}
                      </div>
                    </div>
                    {historicalOrders.length > 0 && (
                      <div className="flex items-start gap-3 px-4 py-3 bg-gray-50">
                        <span className="mt-0.5 font-bold text-base text-gray-400">○</span>
                        <p className="text-gray-600 font-medium">{historicalOrders.length} historical order{historicalOrders.length !== 1 ? "s" : ""} — kept, product name already saved on each</p>
                      </div>
                    )}
                    {agentUnits > 0 && (
                      <div className="flex items-start gap-3 px-4 py-3 bg-amber-50">
                        <span className="mt-0.5 font-bold text-base text-amber-500">⬡</span>
                        <p className="text-amber-800 font-medium">{agentUnits} unit{agentUnits !== 1 ? "s" : ""} with agents will be removed from stock tracking</p>
                      </div>
                    )}
                    {crossRefProducts.length > 0 && (
                      <div className="flex items-start gap-3 px-4 py-3 bg-amber-50">
                        <span className="mt-0.5 font-bold text-base text-amber-500">↗</span>
                        <p className="text-amber-800 font-medium">Removed as add-on from: {crossRefProducts.map((p) => p.name).join(", ")}</p>
                      </div>
                    )}
                  </div>
                  {blocked && <p className="text-sm font-semibold text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">Cannot delete — {activeOrders.length} active order{activeOrders.length !== 1 ? "s" : ""} must be completed or cancelled first.</p>}
                  <div className="flex items-center justify-end gap-3 pt-1">
                    <button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors" onClick={closeModal}>Cancel</button>
                    <button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed" disabled={blocked} onClick={deleteSelectedProduct}>Delete Product</button>
                  </div>
                </div>
              );
            })()}

            {(modal === "addPricing" || modal === "editPricing") && selectedProduct && (
              <div className="modal-form">
                <p>{selectedProduct.name}</p>
                {modal === "addPricing" ? (
                  <label><span>Currency</span><select value={pricingCurrency} onChange={(event) => setPricingCurrency(event.target.value as ProductCurrencyCode)}>{Object.entries(productCurrencies).filter(([code]) => !selectedProduct.pricings.some((pricing) => pricing.currency === code)).map(([code, item]) => <option key={code} value={code}>{item.symbol} - {item.label}</option>)}</select></label>
                ) : (
                  <p>Currency: <strong>{selectedPricing ? productCurrencies[selectedPricing.currency].label : productCurrencies[selectedPricingCurrency].label}</strong></p>
                )}
                <label><span>Selling Price</span><input value={pricingSellingPrice} onChange={(event) => setPricingSellingPrice(event.target.value)} inputMode="decimal" /></label>
                <label><span>Cost per Unit</span><input value={pricingCost} onChange={(event) => setPricingCost(event.target.value)} inputMode="decimal" /></label>
                <p>Margin: <strong>{Number(pricingSellingPrice) > 0 ? Math.round(((Number(pricingSellingPrice) - Number(pricingCost)) / Number(pricingSellingPrice)) * 100) : 0}%</strong></p>
                <div className="flex items-center justify-end gap-3 pt-2"><button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors" onClick={closeModal}>Cancel</button><button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#1A6FBF] text-white text-sm font-medium hover:bg-[#1560a8] transition-colors" onClick={savePricing}>Save Pricing</button></div>
              </div>
            )}

            {(modal === "addPackage" || modal === "editPackage") && selectedProduct && (
              <div className="modal-form">
                <p>{selectedProduct.name}</p>
                <label><span>Package Name *</span><input value={packageName} onChange={(event) => setPackageName(event.target.value)} placeholder="Starter package" /></label>
                <label><span>Description</span><textarea value={packageDescription} onChange={(event) => setPackageDescription(event.target.value)} placeholder="Package description..." /></label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <label><span>Main Product Quantity</span><input value={packageQuantity} onChange={(event) => setPackageQuantity(event.target.value)} inputMode="numeric" /></label>
                  <label><span>Price</span><input value={packagePrice} onChange={(event) => setPackagePrice(event.target.value)} inputMode="decimal" /></label>
                  <label><span>Currency</span><select value={packageCurrency} onChange={(event) => setPackageCurrency(event.target.value as ProductCurrencyCode)}>{Object.entries(productCurrencies).map(([code, item]) => <option key={code} value={code}>{item.symbol} - {item.label}</option>)}</select></label>
                  <label><span>Display Order</span><input value={packageDisplayOrder} onChange={(event) => setPackageDisplayOrder(event.target.value)} inputMode="numeric" /></label>
                </div>
                <section className="text-sm text-gray-400 italic py-2">Companion products can be added after more inventory items exist.</section>
                <div className="flex items-center justify-end gap-3 pt-2"><button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors" onClick={closeModal}>Cancel</button><button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#1A6FBF] text-white text-sm font-medium hover:bg-[#1560a8] transition-colors" onClick={savePackage}>{modal === "addPackage" ? "Create Package" : "Save Package"}</button></div>
              </div>
            )}

            {modal === "deletePackage" && selectedPackage && (() => {
              const ordersUsingPackage = trackedOrders.filter((o) => o.packageId === selectedPackage.id);
              const activeStatuses: TrackedOrder["status"][] = ["New", "Confirmed", "In Process", "Dispatched"];
              const activeUsingPackage = ordersUsingPackage.filter((o) => activeStatuses.includes(o.status));
              const blocked = activeUsingPackage.length > 0;
              return (
                <div className="px-6 py-5 flex flex-col gap-4">
                  <div>
                    <p className="font-semibold text-gray-900">Delete package <strong>{selectedPackage.name}</strong>?</p>
                    <p className="text-sm text-gray-500 mt-1">Package name is already saved on existing orders — history is preserved.</p>
                  </div>
                  {(activeUsingPackage.length > 0 || ordersUsingPackage.length > 0) && (
                    <div className="rounded-lg border border-gray-200 divide-y divide-gray-100 text-sm overflow-hidden">
                      {activeUsingPackage.length > 0 && (
                        <div className="flex items-start gap-3 px-4 py-3 bg-red-50">
                          <span className="mt-0.5 font-bold text-base text-red-500">◈</span>
                          <p className="text-red-800 font-medium">{activeUsingPackage.length} active order{activeUsingPackage.length !== 1 ? "s" : ""} still using this package — complete or cancel them first</p>
                        </div>
                      )}
                      {ordersUsingPackage.length - activeUsingPackage.length > 0 && (
                        <div className="flex items-start gap-3 px-4 py-3 bg-gray-50">
                          <span className="mt-0.5 font-bold text-base text-gray-400">○</span>
                          <p className="text-gray-600 font-medium">{ordersUsingPackage.length - activeUsingPackage.length} historical order{ordersUsingPackage.length - activeUsingPackage.length !== 1 ? "s" : ""} — unaffected, name already saved</p>
                        </div>
                      )}
                    </div>
                  )}
                  {blocked && <p className="text-sm font-semibold text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">Cannot delete — {activeUsingPackage.length} active order{activeUsingPackage.length !== 1 ? "s" : ""} must be completed or cancelled first.</p>}
                  <div className="flex items-center justify-end gap-3 pt-1">
                    <button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors" onClick={closeModal}>Cancel</button>
                    <button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed" disabled={blocked} onClick={deleteSelectedPackage}>Delete Package</button>
                  </div>
                </div>
              );
            })()}

            {modal === "addSalesRep" && (
              <div className="modal-form">
                <p>Fill in the details below. All fields marked with * are required.</p>
                <label><span>Full Name *</span><input value={salesRepName} onChange={(event) => setSalesRepName(event.target.value)} placeholder="John Doe" required /></label>
                <label><span>Email *</span><input value={salesRepEmail} onChange={(event) => setSalesRepEmail(event.target.value)} placeholder="john@example.com" type="email" required /></label>
                <label>
                  <span>Password *</span>
                  <div className="password-shell">
                    <input value={salesRepPassword} onChange={(event) => setSalesRepPassword(event.target.value)} placeholder="••••••••" type={showPasswordFields["repPwd"] ? "text" : "password"} />
                    <button type="button" className="!min-h-0 p-0" aria-label="Toggle password visibility" onClick={() => toggleShowPassword("repPwd")}><Eye className="w-4 h-4" /></button>
                  </div>
                </label>
                <label><span>Role</span><select value={salesRepRole} onChange={(event) => setSalesRepRole(event.target.value as EditableUserRole)}><option value="Sales Rep">Sales Representative</option><option value="Admin">Administrator</option><option value="Inventory Manager">Inventory Manager</option></select></label>
                <div className="flex items-center justify-between py-1">
                  <div>
                  <span className="text-xs text-gray-400">User can log in and be assigned orders</span>
                    <span className="text-sm font-medium text-gray-700">Active Status</span>
                  </div>
                  <button type="button" role="switch" aria-checked={salesRepActive}
                    className={`relative w-11 h-6 !min-h-0 p-0 rounded-full transition-colors shrink-0 ${salesRepActive ? "bg-[#1A6FBF]" : "bg-gray-200"}`}
                    onClick={() => setSalesRepActive(!salesRepActive)}>
                    <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${salesRepActive ? "left-5" : "left-0.5"}`} />
                  </button>
                </div>
                <p className="text-xs text-gray-400">Permissions for this role are set automatically. You can customize them per user in User Management after creation.</p>
                <div className="flex items-center justify-end gap-3 pt-2">
                  <button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors" onClick={closeModal}>Cancel</button>
                  <button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#1A6FBF] text-white text-sm font-medium hover:bg-[#1560a8] transition-colors" onClick={createSalesRep}>Create Sales Rep</button>
                </div>
              </div>
            )}

	            {modal === "addAgent" && (
	              <div className="modal-form">
                <p>Fill in the details below. All fields marked with * are required.</p>
                <label><span>Full Name *</span><input value={agentName} onChange={(event) => setAgentName(event.target.value)} placeholder="John Doe" required /></label>
                <label><span>Phone Number *</span><input value={agentPhone} onChange={(event) => setAgentPhone(event.target.value)} placeholder="0801234567" inputMode="tel" required /></label>
                <label><span>Primary Zone *</span><input value={agentZoneInput} onChange={(event) => setAgentZoneInput(event.target.value)} placeholder="Lagos Island" required /></label>
                <label><span>Address (Optional)</span><textarea value={agentAddress} onChange={(event) => setAgentAddress(event.target.value)} placeholder="Full address..." /></label>
                <div className="flex items-center justify-between py-1">
                  <div>
                    <span className="text-sm font-medium text-gray-700">Active Status</span>
                  </div>
                  <button type="button" role="switch" aria-checked={agentActive}
                    className={`relative w-11 h-6 !min-h-0 p-0 rounded-full transition-colors shrink-0 ${agentActive ? "bg-[#1A6FBF]" : "bg-gray-200"}`}
                    onClick={() => setAgentActive(!agentActive)}>
                    <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${agentActive ? "left-5" : "left-0.5"}`} />
                  </button>
                </div>
                <div className="flex items-center justify-end gap-3 pt-2">
                  <button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors" onClick={closeModal}>Cancel</button>
                  <button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#1A6FBF] text-white text-sm font-medium hover:bg-[#1560a8] transition-colors" onClick={createAgent}>Create Agent</button>
                </div>
	              </div>
	            )}

	            {modal === "agentDetails" && selectedAgent && (
	              <div className="px-6 py-5 flex flex-col gap-4">
	                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
	                  <article className="bg-gray-50 rounded-xl p-3 flex flex-col gap-0.5"><span className="text-xs text-gray-400 font-semibold uppercase tracking-wide">Name</span><strong className="text-sm font-semibold text-gray-900">{selectedAgent.name}</strong></article><article className="bg-gray-50 rounded-xl p-3 flex flex-col gap-0.5"><span className="text-xs text-gray-400 font-semibold uppercase tracking-wide">Phone</span><strong className="text-sm font-semibold text-gray-900">{selectedAgent.phone}</strong></article><article className="bg-gray-50 rounded-xl p-3 flex flex-col gap-0.5"><span className="text-xs text-gray-400 font-semibold uppercase tracking-wide">Zone</span><strong className="text-sm font-semibold text-gray-900">{selectedAgent.zone}</strong></article><article className="bg-gray-50 rounded-xl p-3 flex flex-col gap-0.5"><span className="text-xs text-gray-400 font-semibold uppercase tracking-wide">Status</span><strong className="text-sm font-semibold text-gray-900">{selectedAgent.active ? "Active" : "Inactive"}</strong></article><article className="bg-gray-50 rounded-xl p-3 flex flex-col gap-0.5"><span className="text-xs text-gray-400 font-semibold uppercase tracking-wide">Stock Value</span><strong className="text-sm font-semibold text-gray-900">{formatMoney(agentStockValueFor(selectedAgent.id))}</strong></article><article className="bg-gray-50 rounded-xl p-3 flex flex-col gap-0.5"><span className="text-xs text-gray-400 font-semibold uppercase tracking-wide">Pending</span><strong className="text-sm font-semibold text-gray-900">{trackedOrders.filter((order) => order.agentId === selectedAgent.id && !["Delivered", "Cancelled", "Failed"].includes(order.status ?? "New")).length}</strong></article>
	                </div>
	                <section className="flex flex-col gap-2 max-h-44 overflow-y-auto">
	                  {agentStock.filter((stock) => stock.agentId === selectedAgent.id).map((stock) => {
	                    const product = products.find((item) => item.id === stock.productId);
	                    const pricing = product ? primaryPricing(product) : undefined;
	                    const stockValue = stock.quantity * (pricing?.sellingPrice ?? 0);
	                    return <p key={`${stock.agentId}-${stock.productId}`}><strong>{product?.name ?? "Unknown product"}</strong><br />Available {stock.quantity} · Defective {stock.defective} · Missing {stock.missing} · Value {pricing ? formatProductMoney(stockValue, pricing.currency) : "—"}</p>;
	                  })}
	                </section>
	                <div className="flex items-center justify-end gap-3 pt-2"><button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors" onClick={() => setModal("assignAgentStock")}>Assign Stock</button><button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors" onClick={() => setModal("reconcileAgentStock")}>Reconcile</button><button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#1A6FBF] text-white text-sm font-medium hover:bg-[#1560a8] transition-colors" onClick={closeModal}>Close</button></div>
	              </div>
	            )}

	            {modal === "assignAgentStock" && selectedAgent && (
	              <div className="modal-form">
	                <p><strong>{selectedAgent.name}</strong></p>
	                <label><span>Product</span><select value={assignStockProductId} onChange={(event) => setAssignStockProductId(event.target.value)}>{products.map((product) => <option key={product.id} value={product.id}>{product.name} · warehouse {product.warehouseStock}</option>)}</select></label>
	                <label><span>Quantity</span><input value={assignStockQty} onChange={(event) => setAssignStockQty(event.target.value)} inputMode="numeric" /></label>
	                <div className="flex items-center justify-end gap-3 pt-2"><button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors" onClick={closeModal}>Cancel</button><button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#1A6FBF] text-white text-sm font-medium hover:bg-[#1560a8] transition-colors" onClick={assignStockToSelectedAgent}>Assign Stock</button></div>
	              </div>
	            )}

	            {modal === "reconcileAgentStock" && selectedAgent && (() => {
	              const agentStockRows = agentStock.filter((s) => s.agentId === selectedAgent.id);
	              if (agentStockRows.length === 0) {
	                return (
	                  <div className="modal-form">
	                    <p className="text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">This agent has no assigned stock to reconcile. Assign stock first from the Agent directory.</p>
	                    <div className="flex items-center justify-end pt-2"><button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors" onClick={closeModal}>Close</button></div>
	                  </div>
	                );
	              }
	              const currentRow = agentStockRows.find((s) => s.productId === reconcileProductId);
	              const currentQuantity = currentRow?.quantity ?? 0;
	              const runningDefective = currentRow?.defective ?? 0;
	              const runningMissing = currentRow?.missing ?? 0;
	              const returnedNum = Math.max(0, Number(reconcileReturned) || 0);
	              const defectiveNum = Math.max(0, Number(reconcileDefective) || 0);
	              const missingNum = Math.max(0, Number(reconcileMissing) || 0);
	              const totalRemoved = returnedNum + defectiveNum + missingNum;
	              const afterQuantity = Math.max(0, currentQuantity - totalRemoved);
	              const overReconciled = totalRemoved > currentQuantity;
	              const productName = products.find((p) => p.id === reconcileProductId)?.name ?? "\u2014";
	              const inputClass = "w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-300";
	              const recentHistory = stockMovements
	                .filter((m) => m.agent === selectedAgent.name && m.productId === reconcileProductId)
	                .slice(0, 5);
	              return (
	                <div className="px-6 py-5 space-y-5">
	                  {/* Summary card */}
	                  <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 grid grid-cols-2 gap-x-6 gap-y-4">
	                    <div>
	                      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Agent</p>
	                      <p className="text-sm font-bold text-gray-900 mt-0.5">{selectedAgent.name}</p>
	                    </div>
	                    <div>
	                      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Product</p>
	                      {agentStockRows.length > 1 ? (
	                        <select className="mt-0.5 w-full rounded-md border border-gray-200 bg-white px-2 py-1 text-sm font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-200" value={reconcileProductId} onChange={(event) => { setReconcileProductId(event.target.value); setReconcileReturned("0"); setReconcileDefective("0"); setReconcileMissing("0"); }}>
	                          {agentStockRows.map((stock) => <option key={stock.productId} value={stock.productId}>{products.find((product) => product.id === stock.productId)?.name ?? stock.productId}</option>)}
	                        </select>
	                      ) : (
	                        <p className="text-sm font-bold text-gray-900 mt-0.5">{productName}</p>
	                      )}
	                    </div>
	                    <div>
	                      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Current Stock</p>
	                      <p className="text-2xl font-extrabold text-gray-900 mt-0.5">{currentQuantity}</p>
	                    </div>
	                    <div>
	                      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">After Reconciliation</p>
	                      <p className={`text-2xl font-extrabold mt-0.5 ${overReconciled ? "text-red-600" : totalRemoved > 0 ? "text-[#1A6FBF]" : "text-gray-900"}`}>{afterQuantity}</p>
	                    </div>
	                    {(runningDefective > 0 || runningMissing > 0) && (
	                      <div className="col-span-2 flex gap-3 flex-wrap pt-1 border-t border-gray-200 mt-1">
	                        {runningDefective > 0 && (
	                          <span className="inline-flex items-center text-xs font-semibold text-orange-700 bg-orange-50 border border-orange-200 rounded-full px-2.5 py-0.5">
	                            {runningDefective} defective total
	                          </span>
	                        )}
	                        {runningMissing > 0 && (
	                          <span className="inline-flex items-center text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded-full px-2.5 py-0.5">
	                            {runningMissing} missing total
	                          </span>
	                        )}
	                      </div>
	                    )}
	                  </div>

	                  {/* Three category inputs */}
	                  <div className="grid grid-cols-3 gap-3">
	                    <div className="rounded-lg border border-green-200 bg-green-50 p-3">
	                      <label className="block text-xs font-bold text-green-800 mb-1.5 uppercase tracking-wide">Returned</label>
	                      <input type="number" min={0} className="w-full rounded-md border border-green-200 bg-white px-2.5 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-green-300" value={reconcileReturned} onChange={(event) => setReconcileReturned(event.target.value)} />
	                      <p className="text-xs text-green-700 mt-1.5">Good stock back to warehouse</p>
	                    </div>
	                    <div className="rounded-lg border border-orange-200 bg-orange-50 p-3">
	                      <label className="block text-xs font-bold text-orange-800 mb-1.5 uppercase tracking-wide">Defective</label>
	                      <input type="number" min={0} className="w-full rounded-md border border-orange-200 bg-white px-2.5 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-300" value={reconcileDefective} onChange={(event) => setReconcileDefective(event.target.value)} />
	                      <p className="text-xs text-orange-700 mt-1.5">Damaged / written off</p>
	                    </div>
	                    <div className="rounded-lg border border-red-200 bg-red-50 p-3">
	                      <label className="block text-xs font-bold text-red-800 mb-1.5 uppercase tracking-wide">Missing</label>
	                      <input type="number" min={0} className="w-full rounded-md border border-red-200 bg-white px-2.5 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-300" value={reconcileMissing} onChange={(event) => setReconcileMissing(event.target.value)} />
	                      <p className="text-xs text-red-700 mt-1.5">Lost / unaccounted</p>
	                    </div>
	                  </div>

	                  <div>
	                    <label className="block text-sm font-bold text-gray-900 mb-1.5">Notes <span className="font-normal text-gray-400">(optional)</span></label>
	                    <textarea rows={2} className={`${inputClass} resize-none`} placeholder="Reason, context, or extra details\u2026" value={reconcileNotes} onChange={(event) => setReconcileNotes(event.target.value)} />
	                  </div>

	                  {overReconciled && (
	                    <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
	                      Total to reconcile ({totalRemoved}) exceeds current stock ({currentQuantity}).
	                    </p>
	                  )}

	                  {/* Recent history */}
	                  {recentHistory.length > 0 && (
	                    <div>
	                      <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Recent History</p>
	                      <div className="rounded-lg border border-gray-200 overflow-hidden divide-y divide-gray-100">
	                        {recentHistory.map((m) => {
	                          const isReturn = m.type === "Return" || m.type === "Waybill In";
	                          const isCorrection = m.type === "Correction";
	                          return (
	                            <div key={m.id} className="flex items-start gap-3 px-3 py-2.5 bg-white text-xs">
	                              <span className={`mt-0.5 shrink-0 inline-flex items-center rounded-full px-2 py-0.5 font-semibold ${isReturn ? "bg-green-100 text-green-700" : isCorrection ? "bg-orange-100 text-orange-700" : "bg-gray-100 text-gray-600"}`}>
	                                {m.qty > 0 ? `+${m.qty}` : m.qty}
	                              </span>
	                              <div className="flex-1 min-w-0">
	                                <p className="text-gray-800 font-medium truncate">{m.note || m.type}</p>
	                                <p className="text-gray-400 mt-0.5">{new Date(m.date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })} \u00b7 {m.by}</p>
	                              </div>
	                              <span className="text-gray-400 shrink-0 mt-0.5">bal {m.balanceAfter}</span>
	                            </div>
	                          );
	                        })}
	                      </div>
	                    </div>
	                  )}

	                  <div className="flex items-center justify-between gap-3 pt-2">
	                    <button className="!min-h-0 inline-flex items-center justify-center px-6 py-2.5 rounded-lg border border-gray-200 text-gray-900 text-sm font-bold hover:bg-gray-50 transition-colors" onClick={closeModal}>Cancel</button>
	                    <button className="!min-h-0 inline-flex items-center justify-center px-6 py-2.5 rounded-lg bg-[#1A6FBF] text-white text-sm font-bold hover:bg-[#1560a8] transition-colors disabled:opacity-50 disabled:cursor-not-allowed" disabled={overReconciled || totalRemoved === 0} onClick={reconcileSelectedAgentStock}>Reconcile Stock</button>
	                  </div>
	                </div>
	              );
	            })()}

	            {modal === "editAgent" && selectedAgent && (
	              <div className="modal-form">
	                <label><span>Full Name</span><input value={agentName} onChange={(event) => setAgentName(event.target.value)} /></label><label><span>Phone Number</span><input value={agentPhone} onChange={(event) => setAgentPhone(event.target.value)} /></label><label><span>Primary Zone</span><input value={agentZoneInput} onChange={(event) => setAgentZoneInput(event.target.value)} /></label><label><span>Address</span><textarea value={agentAddress} onChange={(event) => setAgentAddress(event.target.value)} /></label><div className="flex items-center justify-between py-1">
                  <div>
                    <span className="text-sm font-medium text-gray-700">Active Status</span>
                  </div>
                  <button type="button" role="switch" aria-checked={agentActive}
                    className={`relative w-11 h-6 !min-h-0 p-0 rounded-full transition-colors shrink-0 ${agentActive ? "bg-[#1A6FBF]" : "bg-gray-200"}`}
                    onClick={() => setAgentActive(!agentActive)}>
                    <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${agentActive ? "left-5" : "left-0.5"}`} />
                  </button>
                </div>
	                <div className="flex items-center justify-end gap-3 pt-2"><button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors" onClick={closeModal}>Cancel</button><button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#1A6FBF] text-white text-sm font-medium hover:bg-[#1560a8] transition-colors" onClick={updateSelectedAgent}>Save Agent</button></div>
	              </div>
	            )}

	            {modal === "deleteAgent" && selectedAgent && (() => {
	              const agentStockRows = agentStock.filter((s) => s.agentId === selectedAgent.id);
	              const totalStockUnits = agentStockRows.reduce((sum, s) => sum + s.quantity, 0);
	              const activeStatuses: TrackedOrder["status"][] = ["New", "Confirmed", "In Process", "Dispatched"];
	              const activeOrders = trackedOrders.filter((o) => o.agentId === selectedAgent.id && activeStatuses.includes(o.status));
	              const pastOrders = trackedOrders.filter((o) => o.agentId === selectedAgent.id && !activeStatuses.includes(o.status));
	              const blocked = activeOrders.length > 0;
	              return (
	                <div className="px-6 py-5 flex flex-col gap-4">
	                  <div>
	                    <p className="font-semibold text-gray-900">Delete <strong>{selectedAgent.name}</strong>?</p>
	                    <p className="text-sm text-gray-500 mt-1">This action cannot be undone. Review the impact below before proceeding.</p>
	                  </div>

	                  <div className="rounded-lg border border-gray-200 divide-y divide-gray-100 text-sm overflow-hidden">
	                    {/* Stock impact */}
	                    <div className={`flex items-start gap-3 px-4 py-3 ${totalStockUnits > 0 ? "bg-amber-50" : "bg-gray-50"}`}>
	                      <span className={`mt-0.5 font-bold text-lg leading-none ${totalStockUnits > 0 ? "text-amber-500" : "text-gray-400"}`}>⬡</span>
	                      <div>
	                        <p className={`font-semibold ${totalStockUnits > 0 ? "text-amber-800" : "text-gray-600"}`}>
	                          {totalStockUnits > 0 ? `${totalStockUnits} unit${totalStockUnits !== 1 ? "s" : ""} held by this agent` : "No stock held"}
	                        </p>
	                        {totalStockUnits > 0 && (
	                          <p className="text-amber-700 text-xs mt-0.5">
	                            {agentStockRows.map((s) => {
	                              const name = products.find((p) => p.id === s.productId)?.name ?? s.productId;
	                              return `${s.quantity} × ${name}`;
	                            }).join(" · ")} — will be returned to warehouse automatically.
	                          </p>
	                        )}
	                      </div>
	                    </div>

	                    {/* Active orders — blocker */}
	                    <div className={`flex items-start gap-3 px-4 py-3 ${blocked ? "bg-red-50" : "bg-gray-50"}`}>
	                      <span className={`mt-0.5 font-bold text-lg leading-none ${blocked ? "text-red-500" : "text-gray-400"}`}>◈</span>
	                      <div>
	                        <p className={`font-semibold ${blocked ? "text-red-800" : "text-gray-600"}`}>
	                          {blocked
	                            ? `${activeOrders.length} active order${activeOrders.length !== 1 ? "s" : ""} still assigned`
	                            : "No active orders assigned"}
	                        </p>
	                        {blocked && (
	                          <p className="text-red-700 text-xs mt-0.5">
	                            Statuses: {Array.from(new Set(activeOrders.map((o) => o.status))).join(", ")}. Reassign or complete these orders first.
	                          </p>
	                        )}
	                      </div>
	                    </div>

	                    {/* Past orders */}
	                    {pastOrders.length > 0 && (
	                      <div className="flex items-start gap-3 px-4 py-3 bg-gray-50">
	                        <span className="mt-0.5 font-bold text-lg leading-none text-gray-400">○</span>
	                        <div>
	                          <p className="font-semibold text-gray-600">{pastOrders.length} historical order{pastOrders.length !== 1 ? "s" : ""}</p>
	                          <p className="text-gray-500 text-xs mt-0.5">Will be unlinked from this agent but kept in the system.</p>
	                        </div>
	                      </div>
	                    )}
	                  </div>

	                  {blocked && (
	                    <p className="text-sm font-semibold text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
	                      Cannot delete — reassign the {activeOrders.length} active order{activeOrders.length !== 1 ? "s" : ""} first.
	                    </p>
	                  )}

	                  <div className="flex items-center justify-end gap-3 pt-1">
	                    <button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors" onClick={closeModal}>Cancel</button>
	                    <button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed" disabled={blocked} onClick={deleteSelectedAgent}>Delete Agent</button>
	                  </div>
	                </div>
	              );
	            })()}

	            {modal === "salesRepDetails" && selectedSalesRep && (
	              <div className="px-6 py-5 flex flex-col gap-4"><div className="grid grid-cols-2 sm:grid-cols-3 gap-3"><article className="bg-gray-50 rounded-xl p-3 flex flex-col gap-0.5"><span className="text-xs text-gray-400 font-semibold uppercase tracking-wide">Name</span><strong className="text-sm font-semibold text-gray-900">{selectedSalesRep.name}</strong></article><article className="bg-gray-50 rounded-xl p-3 flex flex-col gap-0.5"><span className="text-xs text-gray-400 font-semibold uppercase tracking-wide">Email</span><strong className="text-sm font-semibold text-gray-900">{selectedSalesRep.email}</strong></article><article className="bg-gray-50 rounded-xl p-3 flex flex-col gap-0.5"><span className="text-xs text-gray-400 font-semibold uppercase tracking-wide">Status</span><strong className="text-sm font-semibold text-gray-900">{selectedSalesRep.active ? "Active" : "Inactive"}</strong></article><article className="bg-gray-50 rounded-xl p-3 flex flex-col gap-0.5"><span className="text-xs text-gray-400 font-semibold uppercase tracking-wide">Joined</span><strong className="text-sm font-semibold text-gray-900">{selectedSalesRep.created}</strong></article><article className="bg-gray-50 rounded-xl p-3 flex flex-col gap-0.5"><span className="text-xs text-gray-400 font-semibold uppercase tracking-wide">Orders</span><strong className="text-sm font-semibold text-gray-900">{trackedOrders.filter((order) => order.assignedRepId === selectedSalesRep.id).length}</strong></article><article className="bg-gray-50 rounded-xl p-3 flex flex-col gap-0.5"><span className="text-xs text-gray-400 font-semibold uppercase tracking-wide">Revenue</span><strong className="text-sm font-semibold text-gray-900">{formatMoney(trackedOrders.filter((order) => order.assignedRepId === selectedSalesRep.id && (order.status ?? "New") === "Delivered").reduce((sum, order) => sum + order.amount, 0))}</strong></article></div><section className="flex flex-col gap-2 max-h-44 overflow-y-auto">{trackedOrders.filter((order) => order.assignedRepId === selectedSalesRep.id).slice(0, 5).map((order) => <p key={order.id}><strong>{order.id}</strong> · {order.customer} · {order.status ?? "New"} · {order.source ?? orderSourceFromUtm(order.utmSource)}</p>)}</section><div className="flex items-center justify-end gap-3 pt-2"><button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors" onClick={() => { setSalesRepName(selectedSalesRep.name); setSalesRepEmail(selectedSalesRep.email); setSalesRepActive(selectedSalesRep.active); setModal("editSalesRep"); }}>Edit Profile</button><button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#1A6FBF] text-white text-sm font-medium hover:bg-[#1560a8] transition-colors" onClick={() => {
                        const repOrders = trackedOrders.filter((o) => o.assignedRepId === selectedSalesRep.id);
                        const rows = [
                          [`Sales Rep Report — ${selectedSalesRep.name}`],
                          ["Email", selectedSalesRep.email],
                          ["Total Orders", String(repOrders.length)],
                          ["Delivered", String(repOrders.filter((o) => (o.status ?? "New") === "Delivered").length)],
                          [],
                          ["Order ID", "Customer", "Phone", "Product", "Status", "Amount", "Date"],
                          ...repOrders.map((o) => [o.id, o.customer, o.phone, o.productName, o.status ?? "New", formatProductMoney(o.amount, o.currency), o.date])
                        ];
                        const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
                        const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
                        const a = document.createElement("a"); a.href = url; a.download = `rep-${slugify(selectedSalesRep.name)}-${new Date().toISOString().slice(0,10)}.csv`;
                        document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
                        showToast(`${selectedSalesRep.name}'s orders exported.`);
                      }}>Export Report</button></div></div>
	            )}

	            {modal === "editSalesRep" && selectedSalesRep && (
	              <div className="modal-form"><label><span>Full Name</span><input value={salesRepName} onChange={(event) => setSalesRepName(event.target.value)} /></label><label><span>Email</span><input value={salesRepEmail} onChange={(event) => setSalesRepEmail(event.target.value)} type="email" /></label><div className="flex items-center justify-between py-1">
                  <div>
                    <span className="text-sm font-medium text-gray-700">Active Status</span>
                  </div>
                  <button type="button" role="switch" aria-checked={salesRepActive}
                    className={`relative w-11 h-6 !min-h-0 p-0 rounded-full transition-colors shrink-0 ${salesRepActive ? "bg-[#1A6FBF]" : "bg-gray-200"}`}
                    onClick={() => setSalesRepActive(!salesRepActive)}>
                    <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${salesRepActive ? "left-5" : "left-0.5"}`} />
                  </button>
                </div><div className="flex items-center justify-end gap-3 pt-2"><button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors" onClick={closeModal}>Cancel</button><button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#1A6FBF] text-white text-sm font-medium hover:bg-[#1560a8] transition-colors" onClick={() => { if (!salesRepName.trim() || !salesRepEmail.trim()) { showToast("Name and email are required."); return; } if (users.some((u) => u.id !== selectedSalesRep.id && u.email.toLowerCase() === salesRepEmail.trim().toLowerCase())) { showToast("Another user already uses this email."); return; } setUsers((value) => value.map((user) => user.id === selectedSalesRep.id ? { ...user, name: salesRepName.trim(), email: salesRepEmail.trim(), active: salesRepActive } : user)); setModal(null); showToast(`${salesRepName.trim()} updated.`); }}>Save Rep</button></div></div>
	            )}

	            {modal === "setRate" && (
              <div className="modal-form">
                <p><strong>{selectedPayUser?.name ?? "Team member"}</strong> · {selectedPayUser?.role ?? "User"}</p>
                <label><span>Payment Type</span></label>
                <div className="flex flex-col sm:flex-row gap-2">
                  {payStructureTypes.map((item) => (
                    <button
                      type="button"
                      className={`!min-h-0 flex flex-col gap-1 p-3 rounded-xl border text-left flex-1 transition-colors ${payStructureType === item.value ? "border-[#1A6FBF] bg-blue-50" : "border-gray-200 hover:border-gray-300"}`}
                      onClick={() => setPayStructureType(item.value)}
                      key={item.value}
                    >
                      <strong>{item.value}</strong>
                      <span>{item.helper}</span>
                    </button>
                  ))}
                </div>
                {payStructureType !== "Commission" && (
                  <label><span>Fixed Salary (₦)</span><input value={fixedSalary} onChange={(event) => setFixedSalary(event.target.value)} inputMode="decimal" placeholder="e.g. 50000" /></label>
                )}
                {payStructureType !== "Fixed Salary" && (
                  <label><span>Rate per delivered order (₦)</span><input value={commissionRate} onChange={(event) => setCommissionRate(event.target.value)} inputMode="decimal" placeholder="e.g. 2000" /></label>
                )}
                <div className="flex items-center justify-end gap-3 pt-2">
                  <button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors" onClick={closeModal}>Cancel</button>
                  <button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#1A6FBF] text-white text-sm font-medium hover:bg-[#1560a8] transition-colors" onClick={savePayRate}>Save</button>
                </div>
              </div>
            )}

            {modal === "addExpense" && (
              <div className="modal-form">
                <label><span>Expense Type</span><select value={expenseType} onChange={(event) => setExpenseType(event.target.value as ExpenseType)}>{expenseTypes.map((type) => <option key={type}>{type}</option>)}</select></label>
                <label><span>Amount ({currencies[expenseCurrency]?.currency ?? expenseCurrency})</span><input value={expenseAmount} onChange={(event) => setExpenseAmount(event.target.value)} inputMode="decimal" /></label>
                <label><span>Currency</span><select value={expenseCurrency} onChange={(event) => setExpenseCurrency(event.target.value as CurrencyCode)}><option value="NGN">₦ - Nigerian Naira</option><option value="USD">$ - US Dollar</option><option value="GBP">£ - British Pound</option></select></label>
                <label><span>Date</span><input type="date" className="h-9 px-3 border border-gray-200 rounded-lg text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#1A6FBF]" value={expenseDate} onChange={(event) => setExpenseDate(event.target.value)} /></label>
                <label><span>Product (Optional)</span><select value={expenseProduct} onChange={(event) => setExpenseProduct(event.target.value)}><option>General Expense</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label>
                <p>Link this expense to a specific product</p>
                <label><span>Description (Optional)</span><textarea value={expenseDescription} onChange={(event) => setExpenseDescription(event.target.value)} placeholder="Enter expense details..." /></label>
                <div className="flex items-center justify-end gap-3 pt-2">
                  <button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors" onClick={closeModal}>Cancel</button>
                  <button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#1A6FBF] text-white text-sm font-medium hover:bg-[#1560a8] transition-colors" onClick={createExpense}>Create Expense</button>
                </div>
              </div>
            )}

            {modal === "addUser" && (
              <div className="modal-form">
                <p>Fill in the user details below. All fields marked with * are required.</p>
                <label><span>Full Name *</span><input value={userFullName} onChange={(event) => setUserFullName(event.target.value)} placeholder="John Doe" required /></label>
                <label><span>Email *</span><input value={userEmail} onChange={(event) => setUserEmail(event.target.value)} placeholder="john@example.com" type="email" required /></label>
                <label>
                  <span>Password *</span>
                  <div className="password-shell">
                    <input value={userPassword} onChange={(event) => setUserPassword(event.target.value)} placeholder="••••••••" type={showPasswordFields["addUserPwd"] ? "text" : "password"} />
                    <button type="button" className="!min-h-0 p-0" aria-label="Toggle password visibility" onClick={() => toggleShowPassword("addUserPwd")}><Eye className="w-4 h-4" /></button>
                  </div>
                </label>
                <label><span>Role</span><select value={newUserRole} onChange={(event) => setNewUserRole(event.target.value as EditableUserRole)}>{editableUserRoles.filter((role) => role !== "Owner").map((role) => <option key={role}>{role}</option>)}</select></label>
                <div className="flex items-center justify-between py-1">
                  <div>
                  <span className="text-xs text-gray-400">User can log in and be assigned orders</span>
                    <span className="text-sm font-medium text-gray-700">Active Status</span>
                  </div>
                  <button type="button" role="switch" aria-checked={newUserActive}
                    className={`relative w-11 h-6 !min-h-0 p-0 rounded-full transition-colors shrink-0 ${newUserActive ? "bg-[#1A6FBF]" : "bg-gray-200"}`}
                    onClick={() => setNewUserActive(!newUserActive)}>
                    <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${newUserActive ? "left-5" : "left-0.5"}`} />
                  </button>
                </div>
                <div className="flex items-center justify-end gap-3 pt-2">
                  <button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors" onClick={closeModal}>Cancel</button>
                  <button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#1A6FBF] text-white text-sm font-medium hover:bg-[#1560a8] transition-colors" onClick={createUser}>Create User</button>
                </div>
              </div>
            )}

            {modal === "editUser" && selectedUser && (
              <div className="modal-form">
                <label><span>Full Name</span><input value={userFullName} onChange={(event) => setUserFullName(event.target.value)} placeholder="John Doe" /></label>
                <label><span>Email</span><input value={userEmail} onChange={(event) => setUserEmail(event.target.value)} placeholder="john@example.com" type="email" /></label>
                <label>
                  <span>Password</span>
                  <div className="password-shell">
                    <input value={userPassword} onChange={(event) => setUserPassword(event.target.value)} placeholder="••••••••" type={showPasswordFields["editUserPwd"] ? "text" : "password"} />
                    <button type="button" className="!min-h-0 p-0" aria-label="Toggle password visibility" onClick={() => toggleShowPassword("editUserPwd")}><Eye className="w-4 h-4" /></button>
                  </div>
                  <small>Leave blank to keep current password</small>
                </label>
                <label><span>Role</span><select value={newUserRole} onChange={(event) => setNewUserRole(event.target.value as EditableUserRole)}>{editableUserRoles.filter((role) => role !== "Owner" || selectedUser?.role === "Owner").map((role) => <option key={role}>{role}</option>)}</select></label>
                <div className="flex items-center justify-between py-1">
                  <div>
                    <span className="text-sm font-medium text-gray-700">Active Status</span>
                  </div>
                  <button type="button" role="switch" aria-checked={newUserActive}
                    className={`relative w-11 h-6 !min-h-0 p-0 rounded-full transition-colors shrink-0 ${newUserActive ? "bg-[#1A6FBF]" : "bg-gray-200"}`}
                    onClick={() => setNewUserActive(!newUserActive)}>
                    <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${newUserActive ? "left-5" : "left-0.5"}`} />
                  </button>
                </div>
                <div className="flex items-center justify-end gap-3 pt-2">
                  <button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors" onClick={closeModal}>Cancel</button>
                  <button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#1A6FBF] text-white text-sm font-medium hover:bg-[#1560a8] transition-colors" onClick={updateUser}>Update User</button>
                </div>
              </div>
            )}

            {modal === "resetUserPassword" && selectedUser && (
              <div className="modal-form">
                <p>Set a temporary password for <strong>{selectedUser.name}</strong>.</p>
                <label>
                  <span>New Password</span>
                  <div className="password-shell">
                    <input value={userPassword} onChange={(event) => setUserPassword(event.target.value)} placeholder="Minimum 6 characters" type={showPasswordFields["resetPwd"] ? "text" : "password"} />
                    <button type="button" className="!min-h-0 p-0" aria-label="Toggle password visibility" onClick={() => toggleShowPassword("resetPwd")}><Eye className="w-4 h-4" /></button>
                  </div>
                </label>
                <div className="flex items-center justify-end gap-3 pt-2">
                  <button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors" onClick={closeModal}>Cancel</button>
                  <button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#1A6FBF] text-white text-sm font-medium hover:bg-[#1560a8] transition-colors" onClick={resetUserPassword}>Reset Password</button>
                </div>
              </div>
            )}

            {modal === "deleteUser" && selectedUser && (() => {
              const activeStatuses: TrackedOrder["status"][] = ["New", "Confirmed", "In Process", "Dispatched"];
              const activeOrders = trackedOrders.filter((o) => o.assignedRepId === selectedUser.id && activeStatuses.includes(o.status));
              const historicalOrders = trackedOrders.filter((o) => o.assignedRepId === selectedUser.id && !activeStatuses.includes(o.status));
              const blocked = activeOrders.length > 0 || selectedUser.role === "Owner";
              return (
                <div className="px-6 py-5 flex flex-col gap-4">
                  <div>
                    <p className="font-semibold text-gray-900">Delete <strong>{selectedUser.name}</strong>?</p>
                    <p className="text-sm text-gray-500 mt-1">This cannot be undone. Review the impact below.</p>
                  </div>
                  <div className="rounded-lg border border-gray-200 divide-y divide-gray-100 text-sm overflow-hidden">
                    <div className={`flex items-start gap-3 px-4 py-3 ${activeOrders.length > 0 ? "bg-red-50" : "bg-gray-50"}`}>
                      <span className={`mt-0.5 font-bold text-base ${activeOrders.length > 0 ? "text-red-500" : "text-gray-400"}`}>◈</span>
                      <div>
                        <p className={`font-semibold ${activeOrders.length > 0 ? "text-red-800" : "text-gray-600"}`}>
                          {activeOrders.length > 0 ? `${activeOrders.length} active order${activeOrders.length !== 1 ? "s" : ""} still assigned` : "No active orders assigned"}
                        </p>
                        {activeOrders.length > 0 && <p className="text-red-700 text-xs mt-0.5">Reassign these orders first.</p>}
                      </div>
                    </div>
                    {historicalOrders.length > 0 && (
                      <div className="flex items-start gap-3 px-4 py-3 bg-gray-50">
                        <span className="mt-0.5 font-bold text-base text-gray-400">○</span>
                        <p className="text-gray-600 font-medium">{historicalOrders.length} historical order{historicalOrders.length !== 1 ? "s" : ""} — kept, rep assignment will be cleared</p>
                      </div>
                    )}
                    {selectedUser.role === "Owner" && (
                      <div className="flex items-start gap-3 px-4 py-3 bg-red-50">
                        <span className="mt-0.5 font-bold text-base text-red-500">✕</span>
                        <p className="text-red-800 font-medium">Owner account cannot be deleted</p>
                      </div>
                    )}
                  </div>
                  {blocked && <p className="text-sm font-semibold text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{selectedUser.role === "Owner" ? "Owner account cannot be deleted." : `Reassign ${activeOrders.length} active order${activeOrders.length !== 1 ? "s" : ""} first.`}</p>}
                  <div className="flex items-center justify-end gap-3 pt-1">
                    <button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors" onClick={closeModal}>Cancel</button>
                    <button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed" disabled={blocked} onClick={deleteSelectedUser}>Delete User</button>
                  </div>
                </div>
              );
            })()}

            {modal === "recordRemittance" && remittanceTargetOrder && (
              <div className="modal-form">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <article className="bg-gray-50 rounded-xl p-3 flex flex-col gap-0.5"><span className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide">Customer</span><strong className="text-sm font-semibold text-gray-900">{remittanceTargetOrder.customer}</strong></article>
                  <article className="bg-gray-50 rounded-xl p-3 flex flex-col gap-0.5"><span className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide">Order Amount</span><strong className="text-sm font-semibold text-gray-900">{formatProductMoney(remittanceTargetOrder.amount, remittanceTargetOrder.currency)}</strong></article>
                  <article className="bg-gray-50 rounded-xl p-3 flex flex-col gap-0.5"><span className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide">Partner</span><strong className="text-sm font-semibold text-gray-900">{agents.find((a) => a.id === remittanceTargetOrder.agentId)?.name ?? "Unassigned"}</strong></article>
                </div>
                <label>
                  <span>Logistics Cost (paid to partner)</span>
                  <input value={remittanceLogisticsCost} onChange={(e) => setRemittanceLogisticsCost(e.target.value)} inputMode="decimal" placeholder="e.g. 4000" />
                </label>
                <label>
                  <span>Amount Remitted (cash actually received from partner)</span>
                  <input value={remittanceAmount} onChange={(e) => setRemittanceAmount(e.target.value)} inputMode="decimal" placeholder="e.g. 61500" />
                </label>
                <p className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                  <strong>Expected to receive:</strong> {formatProductMoney(Math.max(0, remittanceTargetOrder.amount - (Number(remittanceLogisticsCost) || 0)), remittanceTargetOrder.currency)} (Order amount − logistics cost)<br />
                  <strong>Outstanding after this:</strong> {formatProductMoney(Math.max(0, (remittanceTargetOrder.amount - (Number(remittanceLogisticsCost) || 0)) - (Number(remittanceAmount) || 0)), remittanceTargetOrder.currency)}
                </p>
                <div className="flex items-center justify-end gap-3 pt-2">
                  <button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors" onClick={closeModal}>Cancel</button>
                  <button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#1A6FBF] text-white text-sm font-medium hover:bg-[#1560a8] transition-colors" onClick={recordRemittance}>Save Remittance</button>
                </div>
              </div>
            )}

            {modal === "bonusSettings" && (() => {
              const product = products.find((p) => p.id === bonusSettingsProductId);
              if (!product) return null;
              const cfg = productBonusConfig(product);
              const moneyCode = primaryPricing(product)?.currency ?? "NGN";
              return (
                <div className="px-6 py-5 flex flex-col gap-5">
                  <header className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h3 className="text-base font-semibold text-gray-900">{product.name}</h3>
                      <p className="text-xs text-gray-500">All amounts in {moneyCode}. Edit, add, or delete any rule. Changes save immediately.</p>
                    </div>
                    <div className="flex flex-col gap-1.5 text-xs bg-gray-50 border border-gray-200 rounded-lg p-2.5 min-w-[240px]">
                      <span className="text-[10px] uppercase font-semibold text-gray-500 tracking-wider">This product can be:</span>
                      <label className="flex items-center gap-2">
                        <span className="text-gray-700 font-semibold w-24">Primary role</span>
                        <select className="flex-1 border border-gray-200 rounded-md px-2 py-1 text-xs" value={product.role ?? "Main"} onChange={(e) => updateProductRole(product.id, e.target.value as ProductRole)}>
                          <option value="Main">Main (sold standalone)</option>
                          <option value="Cross-sell">Cross-sell add-on</option>
                          <option value="Free Gift">Free gift</option>
                        </select>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={Boolean(product.canBeCrossSell)} onChange={(e) => setProducts((prev) => prev.map((p) => p.id === product.id ? { ...p, canBeCrossSell: e.target.checked } : p))} />
                        <span className="text-gray-700">Also available as cross-sell on other products</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={Boolean(product.canBeFreeGift)} onChange={(e) => setProducts((prev) => prev.map((p) => p.id === product.id ? { ...p, canBeFreeGift: e.target.checked } : p))} />
                        <span className="text-gray-700">Also available as free gift on other products</span>
                      </label>
                      <p className="text-[10px] text-gray-500 italic mt-1">A Main product can be ticked here too — it can be sold on its own AND offered as an add-on on another product's form.</p>
                    </div>
                  </header>

                  <section className="bg-gray-50 border border-gray-200 rounded-xl p-3 flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <strong className="text-sm">1. Base Order Bonus (Delivered)</strong>
                      <button className="!min-h-0 text-xs px-2 py-1 rounded-lg bg-blue-600 text-white hover:bg-blue-700" onClick={() => updateProductBonusConfig(product.id, (c) => ({ ...c, baseDelivered: [...c.baseDelivered, { id: makeBonusRuleId(), quantity: 0, amount: 0 }] }))}>+ Add</button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {cfg.baseDelivered.map((rule) => (
                        <div key={rule.id} className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-2 py-1.5 text-xs">
                          <span className="text-gray-500">Qty</span>
                          <input className="w-16 border border-gray-200 rounded px-2 py-1" inputMode="numeric" value={rule.quantity} onChange={(e) => updateProductBonusConfig(product.id, (c) => ({ ...c, baseDelivered: c.baseDelivered.map((r) => r.id === rule.id ? { ...r, quantity: Number(e.target.value) || 0 } : r) }))} />
                          <span className="text-gray-500">→ ₦</span>
                          <input className="w-24 border border-gray-200 rounded px-2 py-1" inputMode="decimal" value={rule.amount} onChange={(e) => updateProductBonusConfig(product.id, (c) => ({ ...c, baseDelivered: c.baseDelivered.map((r) => r.id === rule.id ? { ...r, amount: Number(e.target.value) || 0 } : r) }))} />
                          <button className="!min-h-0 ml-auto text-red-500 hover:text-red-700 text-xs" onClick={() => updateProductBonusConfig(product.id, (c) => ({ ...c, baseDelivered: c.baseDelivered.filter((r) => r.id !== rule.id) }))}>Delete</button>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className="bg-gray-50 border border-gray-200 rounded-xl p-3 flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <strong className="text-sm">2. Upgrade Bonus</strong>
                        <p className="text-[11px] text-gray-500">Paid only when rep upgrades the order AND meets the delivery-rate gate.</p>
                      </div>
                      <button className="!min-h-0 text-xs px-2 py-1 rounded-lg bg-blue-600 text-white hover:bg-blue-700" onClick={() => updateProductBonusConfig(product.id, (c) => ({ ...c, upgradeBonuses: [...c.upgradeBonuses, { id: makeBonusRuleId(), fromQty: 3, toQty: 5, amount: 1000 }] }))}>+ Add</button>
                    </div>
                    <label className="text-xs flex items-center gap-2">
                      <span className="text-gray-600">Min weekly delivery rate to qualify (%)</span>
                      <input className="w-16 border border-gray-200 rounded px-2 py-1" inputMode="numeric" value={cfg.upgradeRequiresMinDeliveryRate} onChange={(e) => updateProductBonusConfig(product.id, (c) => ({ ...c, upgradeRequiresMinDeliveryRate: Number(e.target.value) || 0 }))} />
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {cfg.upgradeBonuses.map((rule) => (
                        <div key={rule.id} className="flex items-center gap-1 bg-white border border-gray-200 rounded-lg px-2 py-1.5 text-xs">
                          <span className="text-gray-500">From</span>
                          <input className="w-12 border border-gray-200 rounded px-1.5 py-1" inputMode="numeric" value={rule.fromQty} onChange={(e) => updateProductBonusConfig(product.id, (c) => ({ ...c, upgradeBonuses: c.upgradeBonuses.map((r) => r.id === rule.id ? { ...r, fromQty: Number(e.target.value) || 0 } : r) }))} />
                          <span className="text-gray-500">→</span>
                          <input className="w-12 border border-gray-200 rounded px-1.5 py-1" inputMode="numeric" value={rule.toQty} onChange={(e) => updateProductBonusConfig(product.id, (c) => ({ ...c, upgradeBonuses: c.upgradeBonuses.map((r) => r.id === rule.id ? { ...r, toQty: Number(e.target.value) || 0 } : r) }))} />
                          <span className="text-gray-500">= ₦</span>
                          <input className="w-20 border border-gray-200 rounded px-1.5 py-1" inputMode="decimal" value={rule.amount} onChange={(e) => updateProductBonusConfig(product.id, (c) => ({ ...c, upgradeBonuses: c.upgradeBonuses.map((r) => r.id === rule.id ? { ...r, amount: Number(e.target.value) || 0 } : r) }))} />
                          <button className="!min-h-0 ml-auto text-red-500 hover:text-red-700" onClick={() => updateProductBonusConfig(product.id, (c) => ({ ...c, upgradeBonuses: c.upgradeBonuses.filter((r) => r.id !== rule.id) }))}>×</button>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className="bg-gray-50 border border-gray-200 rounded-xl p-3 flex flex-col gap-2">
                    <div>
                      <strong className="text-sm">Cross-sell items on this product's order form</strong>
                      <p className="text-[11px] text-gray-500">Customers see these as optional add-ons when ordering {product.name}. Mark a product's role as "Cross-sell" to make it eligible.</p>
                    </div>
                    {(() => {
                      const eligibles = products.filter((p) => p.id !== product.id && (p.role === "Cross-sell" || p.canBeCrossSell));
                      const selected = product.crossSellProductIds ?? [];
                      if (eligibles.length === 0) {
                        return <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">No cross-sell items yet. Open another product (a Main product is fine), tick <strong>Available as cross-sell</strong> in its Bonus Settings, then come back here.</p>;
                      }
                      return (
                        <div className="flex flex-col gap-1.5">
                          {eligibles.map((cp) => {
                            const on = selected.includes(cp.id);
                            const standardPrice = primaryPricing(cp)?.sellingPrice ?? 0;
                            const currency = primaryPricing(cp)?.currency ?? "NGN";
                            const override = product.crossSellPriceOverrides?.[cp.id];
                            const effectivePrice = typeof override === "number" ? override : standardPrice;
                            const discounted = on && typeof override === "number" && override < standardPrice;
                            const stateRestriction = product.crossSellStateRestrictions?.[cp.id] ?? [];
                            const limitedStates = stateRestriction.length > 0;
                            return (
                              <div key={cp.id} className={`flex flex-col gap-2 px-2.5 py-2 text-xs rounded-lg border ${on ? "bg-amber-50 border-amber-300" : "bg-white border-gray-200 hover:bg-gray-50"}`}>
                                <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                                  <label className="flex items-center gap-2 flex-1 cursor-pointer">
                                    <input type="checkbox" checked={on} onChange={() => setProducts((prev) => prev.map((p) => p.id !== product.id ? p : { ...p, crossSellProductIds: on ? selected.filter((id) => id !== cp.id) : [...selected, cp.id] }))} />
                                    <span className="font-medium">{cp.name}</span>
                                    <span className="text-gray-500">· standalone {formatProductMoney(standardPrice, currency)}</span>
                                  </label>
                                  {on && (
                                    <div className="flex items-center gap-1.5 text-[11px]">
                                      <span className="text-gray-600 font-semibold">Bundle price</span>
                                      <input className="w-24 border border-amber-300 rounded px-2 py-1 text-xs" inputMode="decimal" value={typeof override === "number" ? override : ""} placeholder={String(standardPrice)} onChange={(e) => {
                                        const val = e.target.value.trim();
                                        setProducts((prev) => prev.map((p) => {
                                          if (p.id !== product.id) return p;
                                          const next = { ...(p.crossSellPriceOverrides ?? {}) };
                                          if (val === "") {
                                            delete next[cp.id];
                                          } else {
                                            next[cp.id] = Number(val) || 0;
                                          }
                                          return { ...p, crossSellPriceOverrides: next };
                                        }));
                                      }} />
                                      {discounted && <span className="text-emerald-700 font-semibold">−{Math.round(((standardPrice - effectivePrice) / standardPrice) * 100)}%</span>}
                                      {typeof override === "number" && (
                                        <button className="!min-h-0 text-gray-400 hover:text-gray-700" title="Clear override (use standalone price)" onClick={() => setProducts((prev) => prev.map((p) => {
                                          if (p.id !== product.id) return p;
                                          const next = { ...(p.crossSellPriceOverrides ?? {}) };
                                          delete next[cp.id];
                                          return { ...p, crossSellPriceOverrides: next };
                                        }))}>×</button>
                                      )}
                                    </div>
                                  )}
                                </div>
                                {on && (
                                  <details className="text-[11px]">
                                    <summary className="cursor-pointer select-none flex items-center gap-1.5 text-gray-700 hover:text-gray-900">
                                      <span className="font-semibold">States this add-on is available in:</span>
                                      <span className={`px-1.5 py-0.5 rounded ${limitedStates ? "bg-amber-200 text-amber-900" : "bg-gray-100 text-gray-600"}`}>{limitedStates ? `${stateRestriction.length} state${stateRestriction.length !== 1 ? "s" : ""}` : "All states"}</span>
                                      <span className="text-gray-400 ml-auto">{limitedStates ? "click to edit" : "click to limit"}</span>
                                    </summary>
                                    <div className="mt-2 p-2 border border-amber-200 rounded-lg bg-white">
                                      <div className="flex items-center gap-1.5 mb-2">
                                        <button className="!min-h-0 px-2 py-0.5 rounded border border-gray-200 text-[10px] hover:bg-gray-50" onClick={() => setProducts((prev) => prev.map((p) => {
                                          if (p.id !== product.id) return p;
                                          const next = { ...(p.crossSellStateRestrictions ?? {}) };
                                          delete next[cp.id];
                                          return { ...p, crossSellStateRestrictions: next };
                                        }))}>All states</button>
                                        <button className="!min-h-0 px-2 py-0.5 rounded border border-gray-200 text-[10px] hover:bg-gray-50" onClick={() => setProducts((prev) => prev.map((p) => p.id !== product.id ? p : { ...p, crossSellStateRestrictions: { ...(p.crossSellStateRestrictions ?? {}), [cp.id]: [...nigeriaStates] } }))}>Select all</button>
                                        <button className="!min-h-0 px-2 py-0.5 rounded border border-gray-200 text-[10px] hover:bg-gray-50" onClick={() => setProducts((prev) => prev.map((p) => p.id !== product.id ? p : { ...p, crossSellStateRestrictions: { ...(p.crossSellStateRestrictions ?? {}), [cp.id]: [] } }))}>Clear</button>
                                      </div>
                                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-1 max-h-44 overflow-y-auto">
                                        {nigeriaStates.map((state) => {
                                          const isOn = !limitedStates || stateRestriction.includes(state);
                                          return (
                                            <label key={state} className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] cursor-pointer border ${isOn ? "bg-amber-50 border-amber-200" : "bg-white border-gray-200 hover:bg-gray-50"}`}>
                                              <input type="checkbox" checked={isOn} onChange={() => setProducts((prev) => prev.map((p) => {
                                                if (p.id !== product.id) return p;
                                                const cur = p.crossSellStateRestrictions?.[cp.id] ?? [];
                                                const isAllMode = cur.length === 0;
                                                let nextList: string[];
                                                if (isAllMode) {
                                                  nextList = nigeriaStates.filter((s) => s !== state);
                                                } else if (cur.includes(state)) {
                                                  nextList = cur.filter((s) => s !== state);
                                                } else {
                                                  nextList = [...cur, state];
                                                }
                                                return { ...p, crossSellStateRestrictions: { ...(p.crossSellStateRestrictions ?? {}), [cp.id]: nextList } };
                                              }))} />
                                              <span>{state}</span>
                                            </label>
                                          );
                                        })}
                                      </div>
                                      <p className="text-[10px] text-gray-500 italic mt-2">When the customer picks a state outside this list, this add-on is hidden — but the main product is still sold.</p>
                                    </div>
                                  </details>
                                )}
                              </div>
                            );
                          })}
                          <p className="text-[10px] text-gray-500 italic">Leave bundle price empty to use the standalone price. Set state restrictions per add-on so each can be limited independently.</p>
                        </div>
                      );
                    })()}
                    <div className="pt-2">
                      <strong className="text-sm">Free gifts on this product's order form</strong>
                      <p className="text-[11px] text-gray-500">Auto-given when the order ships. Mark a product's role as "Free Gift" to make it eligible.</p>
                    </div>
                    {(() => {
                      const eligibles = products.filter((p) => p.id !== product.id && (p.role === "Free Gift" || p.canBeFreeGift));
                      const selected = product.freeGiftProductIds ?? [];
                      if (eligibles.length === 0) {
                        return <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">No free-gift items yet. Open another product, tick <strong>Available as free gift</strong> in its Bonus Settings, then come back here.</p>;
                      }
                      return (
                        <div className="flex flex-col gap-1.5">
                          {eligibles.map((cp) => {
                            const on = selected.includes(cp.id);
                            const stateRestriction = product.freeGiftStateRestrictions?.[cp.id] ?? [];
                            const limitedStates = stateRestriction.length > 0;
                            return (
                              <div key={cp.id} className={`flex flex-col gap-2 px-2.5 py-2 text-xs rounded-lg border ${on ? "bg-emerald-50 border-emerald-300" : "bg-white border-gray-200 hover:bg-gray-50"}`}>
                                <label className="flex items-center gap-2 cursor-pointer">
                                  <input type="checkbox" checked={on} onChange={() => setProducts((prev) => prev.map((p) => p.id !== product.id ? p : { ...p, freeGiftProductIds: on ? selected.filter((id) => id !== cp.id) : [...selected, cp.id] }))} />
                                  <span className="font-medium">{cp.name}</span>
                                </label>
                                {on && (
                                  <details className="text-[11px]">
                                    <summary className="cursor-pointer select-none flex items-center gap-1.5 text-gray-700 hover:text-gray-900">
                                      <span className="font-semibold">States this gift is available in:</span>
                                      <span className={`px-1.5 py-0.5 rounded ${limitedStates ? "bg-emerald-200 text-emerald-900" : "bg-gray-100 text-gray-600"}`}>{limitedStates ? `${stateRestriction.length} state${stateRestriction.length !== 1 ? "s" : ""}` : "All states"}</span>
                                      <span className="text-gray-400 ml-auto">{limitedStates ? "click to edit" : "click to limit"}</span>
                                    </summary>
                                    <div className="mt-2 p-2 border border-emerald-200 rounded-lg bg-white">
                                      <div className="flex items-center gap-1.5 mb-2">
                                        <button className="!min-h-0 px-2 py-0.5 rounded border border-gray-200 text-[10px] hover:bg-gray-50" onClick={() => setProducts((prev) => prev.map((p) => {
                                          if (p.id !== product.id) return p;
                                          const next = { ...(p.freeGiftStateRestrictions ?? {}) };
                                          delete next[cp.id];
                                          return { ...p, freeGiftStateRestrictions: next };
                                        }))}>All states</button>
                                        <button className="!min-h-0 px-2 py-0.5 rounded border border-gray-200 text-[10px] hover:bg-gray-50" onClick={() => setProducts((prev) => prev.map((p) => p.id !== product.id ? p : { ...p, freeGiftStateRestrictions: { ...(p.freeGiftStateRestrictions ?? {}), [cp.id]: [...nigeriaStates] } }))}>Select all</button>
                                        <button className="!min-h-0 px-2 py-0.5 rounded border border-gray-200 text-[10px] hover:bg-gray-50" onClick={() => setProducts((prev) => prev.map((p) => p.id !== product.id ? p : { ...p, freeGiftStateRestrictions: { ...(p.freeGiftStateRestrictions ?? {}), [cp.id]: [] } }))}>Clear</button>
                                      </div>
                                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-1 max-h-44 overflow-y-auto">
                                        {nigeriaStates.map((state) => {
                                          const isOn = !limitedStates || stateRestriction.includes(state);
                                          return (
                                            <label key={state} className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] cursor-pointer border ${isOn ? "bg-emerald-50 border-emerald-200" : "bg-white border-gray-200 hover:bg-gray-50"}`}>
                                              <input type="checkbox" checked={isOn} onChange={() => setProducts((prev) => prev.map((p) => {
                                                if (p.id !== product.id) return p;
                                                const cur = p.freeGiftStateRestrictions?.[cp.id] ?? [];
                                                const isAllMode = cur.length === 0;
                                                let nextList: string[];
                                                if (isAllMode) {
                                                  nextList = nigeriaStates.filter((s) => s !== state);
                                                } else if (cur.includes(state)) {
                                                  nextList = cur.filter((s) => s !== state);
                                                } else {
                                                  nextList = [...cur, state];
                                                }
                                                return { ...p, freeGiftStateRestrictions: { ...(p.freeGiftStateRestrictions ?? {}), [cp.id]: nextList } };
                                              }))} />
                                              <span>{state}</span>
                                            </label>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  </details>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}
                  </section>

                  <section className="bg-gray-50 border border-gray-200 rounded-xl p-3 flex flex-col gap-2">
                    <strong className="text-sm">3. Cross-sell &amp; Free Gift Bonus</strong>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <label className="text-xs flex flex-col gap-1">
                        <span className="text-gray-600 font-semibold">Cross-sell %</span>
                        <input className="border border-gray-200 rounded-lg px-2 py-1.5" inputMode="decimal" value={cfg.crossSellPercent} onChange={(e) => updateProductBonusConfig(product.id, (c) => ({ ...c, crossSellPercent: Number(e.target.value) || 0 }))} />
                      </label>
                      <label className="text-xs flex flex-col gap-1">
                        <span className="text-gray-600 font-semibold">Cross-sell fixed ₦ per line</span>
                        <input className="border border-gray-200 rounded-lg px-2 py-1.5" inputMode="decimal" value={cfg.crossSellFixed} onChange={(e) => updateProductBonusConfig(product.id, (c) => ({ ...c, crossSellFixed: Number(e.target.value) || 0 }))} />
                      </label>
                      <label className="text-xs flex flex-col gap-1">
                        <span className="text-gray-600 font-semibold">Free-gift ₦ per gift</span>
                        <input className="border border-gray-200 rounded-lg px-2 py-1.5" inputMode="decimal" value={cfg.freeGiftBonus} onChange={(e) => updateProductBonusConfig(product.id, (c) => ({ ...c, freeGiftBonus: Number(e.target.value) || 0 }))} />
                      </label>
                    </div>
                  </section>

                  <section className="bg-gray-50 border border-gray-200 rounded-xl p-3 flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <strong className="text-sm">4. Weekly AOV Bonus</strong>
                        <p className="text-[11px] text-gray-500">Average order value tiers — one-time weekly payout when threshold reached.</p>
                      </div>
                      <button className="!min-h-0 text-xs px-2 py-1 rounded-lg bg-blue-600 text-white hover:bg-blue-700" onClick={() => updateProductBonusConfig(product.id, (c) => ({ ...c, aovBonuses: [...c.aovBonuses, { id: makeBonusRuleId(), threshold: 0, amount: 0 }] }))}>+ Add</button>
                    </div>
                    <label className="text-xs flex items-center gap-2">
                      <span className="text-gray-600">Min weekly delivery rate to qualify (%)</span>
                      <input className="w-16 border border-gray-200 rounded px-2 py-1" inputMode="numeric" value={cfg.aovRequiresMinDeliveryRate} onChange={(e) => updateProductBonusConfig(product.id, (c) => ({ ...c, aovRequiresMinDeliveryRate: Number(e.target.value) || 0 }))} />
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {cfg.aovBonuses.map((rule) => (
                        <div key={rule.id} className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-2 py-1.5 text-xs">
                          <span className="text-gray-500">AOV ≥ ₦</span>
                          <input className="w-24 border border-gray-200 rounded px-2 py-1" inputMode="decimal" value={rule.threshold} onChange={(e) => updateProductBonusConfig(product.id, (c) => ({ ...c, aovBonuses: c.aovBonuses.map((r) => r.id === rule.id ? { ...r, threshold: Number(e.target.value) || 0 } : r) }))} />
                          <span className="text-gray-500">→ ₦</span>
                          <input className="w-24 border border-gray-200 rounded px-2 py-1" inputMode="decimal" value={rule.amount} onChange={(e) => updateProductBonusConfig(product.id, (c) => ({ ...c, aovBonuses: c.aovBonuses.map((r) => r.id === rule.id ? { ...r, amount: Number(e.target.value) || 0 } : r) }))} />
                          <button className="!min-h-0 ml-auto text-red-500 hover:text-red-700 text-xs" onClick={() => updateProductBonusConfig(product.id, (c) => ({ ...c, aovBonuses: c.aovBonuses.filter((r) => r.id !== rule.id) }))}>Delete</button>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className="bg-gray-50 border border-gray-200 rounded-xl p-3 flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <strong className="text-sm">5. Weekly Delivery Rate Bonus</strong>
                        <p className="text-[11px] text-gray-500">Unlock with min order count below.</p>
                      </div>
                      <button className="!min-h-0 text-xs px-2 py-1 rounded-lg bg-blue-600 text-white hover:bg-blue-700" onClick={() => updateProductBonusConfig(product.id, (c) => ({ ...c, deliveryRateBonuses: [...c.deliveryRateBonuses, { id: makeBonusRuleId(), ratePercent: 60, amount: 0 }] }))}>+ Add</button>
                    </div>
                    <label className="text-xs flex items-center gap-2">
                      <span className="text-gray-600">Minimum orders to unlock</span>
                      <input className="w-16 border border-gray-200 rounded px-2 py-1" inputMode="numeric" value={cfg.deliveryRateMinOrders} onChange={(e) => updateProductBonusConfig(product.id, (c) => ({ ...c, deliveryRateMinOrders: Number(e.target.value) || 0 }))} />
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {cfg.deliveryRateBonuses.map((rule) => (
                        <div key={rule.id} className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-2 py-1.5 text-xs">
                          <span className="text-gray-500">≥</span>
                          <input className="w-16 border border-gray-200 rounded px-2 py-1" inputMode="decimal" value={rule.ratePercent} onChange={(e) => updateProductBonusConfig(product.id, (c) => ({ ...c, deliveryRateBonuses: c.deliveryRateBonuses.map((r) => r.id === rule.id ? { ...r, ratePercent: Number(e.target.value) || 0 } : r) }))} />
                          <span className="text-gray-500">% → ₦</span>
                          <input className="w-24 border border-gray-200 rounded px-2 py-1" inputMode="decimal" value={rule.amount} onChange={(e) => updateProductBonusConfig(product.id, (c) => ({ ...c, deliveryRateBonuses: c.deliveryRateBonuses.map((r) => r.id === rule.id ? { ...r, amount: Number(e.target.value) || 0 } : r) }))} />
                          <button className="!min-h-0 ml-auto text-red-500 hover:text-red-700 text-xs" onClick={() => updateProductBonusConfig(product.id, (c) => ({ ...c, deliveryRateBonuses: c.deliveryRateBonuses.filter((r) => r.id !== rule.id) }))}>Delete</button>
                        </div>
                      ))}
                    </div>
                    <label className="text-xs flex items-center gap-2 pt-1">
                      <span className="text-gray-600">Poor delivery rate threshold (%) — only base bonus paid below this</span>
                      <input className="w-16 border border-gray-200 rounded px-2 py-1" inputMode="numeric" value={cfg.poorDeliveryRatePercent} onChange={(e) => updateProductBonusConfig(product.id, (c) => ({ ...c, poorDeliveryRatePercent: Number(e.target.value) || 0 }))} />
                    </label>
                  </section>

                  <section className="bg-gray-50 border border-gray-200 rounded-xl p-3 flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <strong className="text-sm">6. Manual Order Bonus</strong>
                        <p className="text-[11px] text-gray-500">For orders not from the website (WhatsApp / phone-in).</p>
                      </div>
                      <button className="!min-h-0 text-xs px-2 py-1 rounded-lg bg-blue-600 text-white hover:bg-blue-700" onClick={() => updateProductBonusConfig(product.id, (c) => ({ ...c, manualOrderBonuses: [...c.manualOrderBonuses, { id: makeBonusRuleId(), quantity: 0, amount: 0 }] }))}>+ Add</button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {cfg.manualOrderBonuses.map((rule) => (
                        <div key={rule.id} className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-2 py-1.5 text-xs">
                          <span className="text-gray-500">Qty</span>
                          <input className="w-16 border border-gray-200 rounded px-2 py-1" inputMode="numeric" value={rule.quantity} onChange={(e) => updateProductBonusConfig(product.id, (c) => ({ ...c, manualOrderBonuses: c.manualOrderBonuses.map((r) => r.id === rule.id ? { ...r, quantity: Number(e.target.value) || 0 } : r) }))} />
                          <span className="text-gray-500">→ ₦</span>
                          <input className="w-24 border border-gray-200 rounded px-2 py-1" inputMode="decimal" value={rule.amount} onChange={(e) => updateProductBonusConfig(product.id, (c) => ({ ...c, manualOrderBonuses: c.manualOrderBonuses.map((r) => r.id === rule.id ? { ...r, amount: Number(e.target.value) || 0 } : r) }))} />
                          <button className="!min-h-0 ml-auto text-red-500 hover:text-red-700 text-xs" onClick={() => updateProductBonusConfig(product.id, (c) => ({ ...c, manualOrderBonuses: c.manualOrderBonuses.filter((r) => r.id !== rule.id) }))}>Delete</button>
                        </div>
                      ))}
                    </div>
                  </section>

                  <div className="flex items-center justify-between pt-2">
                    <button className="!min-h-0 inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-amber-300 text-amber-700 text-xs font-semibold hover:bg-amber-50" onClick={() => { if (window.confirm("Reset bonus config to defaults?")) { updateProductBonusConfig(product.id, () => defaultBonusConfig()); showToast("Reset to defaults"); } }}>Reset to Defaults</button>
                    <button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#1A6FBF] text-white text-sm font-medium hover:bg-[#1560a8]" onClick={closeModal}>Done</button>
                  </div>
                </div>
              );
            })()}

            {modal === "stateAvailability" && (() => {
              const product = products.find((p) => p.id === stateAvailabilityProductId);
              if (!product) return null;
              const selected = product.availableStates ?? [];
              const allSelected = selected.length === 0;
              return (
                <div className="px-6 py-5 flex flex-col gap-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-base font-semibold text-gray-900">{product.name}</h3>
                      <p className="text-xs text-gray-500">Pick the states this product is stocked in. The order form will only show those states. Empty = available everywhere.</p>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <button className="!min-h-0 px-2.5 py-1 rounded-lg border border-gray-200 hover:bg-gray-50" onClick={() => updateProductStates(product.id, [])}>All states ({nigeriaStates.length})</button>
                      <button className="!min-h-0 px-2.5 py-1 rounded-lg border border-gray-200 hover:bg-gray-50" onClick={() => updateProductStates(product.id, [...nigeriaStates])}>Select all</button>
                      <button className="!min-h-0 px-2.5 py-1 rounded-lg border border-gray-200 hover:bg-gray-50" onClick={() => updateProductStates(product.id, ["__none__"])}>Clear</button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-1.5 max-h-[50vh] overflow-y-auto">
                    {nigeriaStates.map((state) => {
                      const isOn = allSelected || selected.includes(state);
                      return (
                        <label key={state} className={`flex items-center gap-2 px-2.5 py-1.5 text-xs rounded-lg border cursor-pointer ${isOn ? "bg-blue-50 border-blue-200" : "bg-white border-gray-200 hover:bg-gray-50"}`}>
                          <input type="checkbox" checked={isOn} onChange={() => {
                            if (allSelected) {
                              updateProductStates(product.id, nigeriaStates.filter((s) => s !== state));
                            } else if (selected.includes(state)) {
                              updateProductStates(product.id, selected.filter((s) => s !== state));
                            } else {
                              updateProductStates(product.id, [...selected.filter((s) => s !== "__none__"), state]);
                            }
                          }} />
                          <span>{state}</span>
                        </label>
                      );
                    })}
                  </div>
                  <p className="text-xs text-gray-500"><strong>{allSelected ? `${nigeriaStates.length} (all)` : selected.filter((s) => s !== "__none__").length}</strong> states will be shown on the order form.</p>
                  <div className="flex items-center justify-end gap-3 pt-2">
                    <button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#1A6FBF] text-white text-sm font-medium hover:bg-[#1560a8]" onClick={closeModal}>Done</button>
                  </div>
                </div>
              );
            })()}

            {modal === "addCrossSell" && (() => {
              const order = trackedOrders.find((o) => o.id === crossSellTargetOrderId);
              if (!order) return null;
              const crossSellOptions = products.filter((p) => p.id !== order.productId);
              const chosen = products.find((p) => p.id === crossSellProductId);
              const suggested = chosen ? (primaryPricing(chosen)?.sellingPrice ?? 0) * (Number(crossSellQuantity) || 1) : 0;
              return (
                <div className="modal-form">
                  <p className="text-xs text-gray-500">Add an upsell/cross-sell item to <strong>{order.id}</strong>.</p>
                  <label><span>Product</span>
                    <select value={crossSellProductId} onChange={(e) => setCrossSellProductId(e.target.value)}>
                      <option value="">Select a product</option>
                      {crossSellOptions.map((p) => <option key={p.id} value={p.id}>{p.name} — {formatProductMoney(primaryPricing(p)?.sellingPrice ?? 0, primaryPricing(p)?.currency ?? "NGN")} {p.role && p.role !== "Main" ? `(${p.role})` : ""}</option>)}
                    </select>
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <label><span>Quantity</span><input value={crossSellQuantity} onChange={(e) => setCrossSellQuantity(e.target.value)} inputMode="numeric" /></label>
                    <label><span>Amount (defaults to {chosen ? formatProductMoney(suggested, primaryPricing(chosen)?.currency ?? "NGN") : "auto"})</span><input value={crossSellAmount} onChange={(e) => setCrossSellAmount(e.target.value)} inputMode="decimal" placeholder={String(suggested)} /></label>
                  </div>
                  <p className="text-[11px] text-gray-500">This adds the item to the order total and marks it for inventory deduction. Bonus is applied automatically based on this product's cross-sell %.</p>
                  <div className="flex items-center justify-end gap-3 pt-2">
                    <button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 text-gray-700 text-sm font-medium hover:bg-gray-50" onClick={closeModal}>Cancel</button>
                    <button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#1A6FBF] text-white text-sm font-medium hover:bg-[#1560a8]" onClick={saveCrossSell}>Add Cross-sell</button>
                  </div>
                </div>
              );
            })()}

            {modal === "addFreeGift" && (() => {
              const order = trackedOrders.find((o) => o.id === freeGiftTargetOrderId);
              if (!order) return null;
              return (
                <div className="modal-form">
                  <p className="text-xs text-gray-500">Add a free gift to <strong>{order.id}</strong>. Gifts are tracked in inventory but don't add to the order amount.</p>
                  <label><span>Gift Product</span>
                    <select value={freeGiftProductId} onChange={(e) => setFreeGiftProductId(e.target.value)}>
                      <option value="">Select a product</option>
                      {products.map((p) => <option key={p.id} value={p.id}>{p.name} {p.role && p.role !== "Main" ? `(${p.role})` : ""}</option>)}
                    </select>
                  </label>
                  <label><span>Quantity</span><input value={freeGiftQuantity} onChange={(e) => setFreeGiftQuantity(e.target.value)} inputMode="numeric" /></label>
                  <div className="flex items-center justify-end gap-3 pt-2">
                    <button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 text-gray-700 text-sm font-medium hover:bg-gray-50" onClick={closeModal}>Cancel</button>
                    <button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#1A6FBF] text-white text-sm font-medium hover:bg-[#1560a8]" onClick={saveFreeGift}>Add Free Gift</button>
                  </div>
                </div>
              );
            })()}

            {modal === "manualBonus" && (() => {
              const order = trackedOrders.find((o) => o.id === manualBonusTargetOrderId);
              if (!order) return null;
              return (
                <div className="modal-form">
                  <p className="text-xs text-gray-500">Override the computed bonus for <strong>{order.id}</strong>. Use this when the auto rules don't capture the correct amount.</p>
                  <label><span>Manual bonus amount (₦)</span><input value={manualBonusAmount} onChange={(e) => setManualBonusAmount(e.target.value)} inputMode="decimal" placeholder="e.g. 1500" /></label>
                  <label><span>Reason</span><textarea value={manualBonusReasonText} onChange={(e) => setManualBonusReasonText(e.target.value)} placeholder="Why are you overriding the bonus?" /></label>
                  <div className="flex items-center justify-between pt-2">
                    <button className="!min-h-0 inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-amber-300 text-amber-700 text-xs font-semibold hover:bg-amber-50" onClick={() => { clearManualBonus(order.id); closeModal(); }}>Clear Override</button>
                    <div className="flex items-center gap-3">
                      <button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 text-gray-700 text-sm font-medium hover:bg-gray-50" onClick={closeModal}>Cancel</button>
                      <button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#1A6FBF] text-white text-sm font-medium hover:bg-[#1560a8]" onClick={saveManualBonus}>Save Override</button>
                    </div>
                  </div>
                </div>
              );
            })()}

            {modal === "editProduct" && selectedProduct && (
              <div className="modal-form">
                <label><span>Product Name *</span><input value={productName} onChange={(e) => setProductName(e.target.value)} placeholder="Edge Brusher Max" /></label>
                <label><span>Description</span><textarea value={productDescription} onChange={(e) => setProductDescription(e.target.value)} placeholder="Short product description..." /></label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label><span>SKU</span><input value={productSku} onChange={(e) => setProductSku(e.target.value)} placeholder="EDGE-BRUSHER-001" /></label>
                  <label><span>Reorder Point</span><input value={reorderPoint} onChange={(e) => setReorderPoint(e.target.value)} inputMode="numeric" /></label>
                </div>
                <div className="flex items-center justify-between py-1">
                  <div>
                    <span className="text-sm font-medium text-gray-700 block">Active Status</span>
                    <span className="text-xs text-gray-400">Inactive products are hidden from order forms and rep workspace.</span>
                  </div>
                  <button type="button" role="switch" aria-checked={productActive}
                    className={`relative w-11 h-6 !min-h-0 p-0 rounded-full transition-colors shrink-0 ${productActive ? "bg-[#1A6FBF]" : "bg-gray-200"}`}
                    onClick={() => setProductActive(!productActive)}>
                    <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${productActive ? "left-5" : "left-0.5"}`} />
                  </button>
                </div>
                <p className="text-[11px] text-gray-500">Pricing, packages, bonus settings, and state availability are managed in their own sections from the product details page.</p>
                <div className="flex items-center justify-end gap-3 pt-2">
                  <button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 text-gray-700 text-sm font-medium hover:bg-gray-50" onClick={closeModal}>Cancel</button>
                  <button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#1A6FBF] text-white text-sm font-medium hover:bg-[#1560a8]" onClick={saveEditProduct}>Save Changes</button>
                </div>
              </div>
            )}

            {modal === "addPenalty" && (
              <div className="modal-form">
                <label><span>Sales Rep</span>
                  <select value={penaltyTargetRepId} onChange={(e) => setPenaltyTargetRepId(e.target.value)}>
                    <option value="">Select rep</option>
                    {users.filter((u) => u.role === "Sales Rep").map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                </label>
                <label><span>Penalty Type</span>
                  <select value={penaltyType} onChange={(e) => {
                    const next = e.target.value as RepPenaltyType;
                    setPenaltyType(next);
                    const defaults: Record<RepPenaltyType, { amount: number; removeAll: boolean }> = {
                      "Fake Upgrade": { amount: 2000, removeAll: true },
                      "Wrong Data Entry": { amount: 500, removeAll: false },
                      "Missed Recovery": { amount: 500, removeAll: false },
                      "Poor Delivery Rate": { amount: 0, removeAll: true },
                      "Order Source Manipulation": { amount: 1000, removeAll: false },
                      "Unprofessional Conduct": { amount: 1500, removeAll: false },
                      "Negligence": { amount: 500, removeAll: false },
                      "Other": { amount: 0, removeAll: false }
                    };
                    setPenaltyAmount(String(defaults[next].amount));
                    setPenaltyRemoveAllBonuses(defaults[next].removeAll);
                  }}>
                    {(["Fake Upgrade", "Wrong Data Entry", "Missed Recovery", "Poor Delivery Rate", "Order Source Manipulation", "Unprofessional Conduct", "Negligence", "Other"] as RepPenaltyType[]).map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </label>
                <label><span>Deduction Amount (₦)</span><input value={penaltyAmount} onChange={(e) => setPenaltyAmount(e.target.value)} inputMode="decimal" /></label>
                <label className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={penaltyRemoveAllBonuses} onChange={(e) => setPenaltyRemoveAllBonuses(e.target.checked)} />
                  <span>Also remove all bonuses for the related order/week</span>
                </label>
                <label><span>Order ID (optional)</span><input value={penaltyOrderId} onChange={(e) => setPenaltyOrderId(e.target.value)} placeholder="ORD-XXXX" /></label>
                <label><span>Reason / Notes</span><textarea value={penaltyReason} onChange={(e) => setPenaltyReason(e.target.value)} placeholder="What happened?" /></label>
                <div className="flex items-center justify-end gap-3 pt-2">
                  <button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 text-gray-700 text-sm font-medium hover:bg-gray-50" onClick={closeModal}>Cancel</button>
                  <button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700" onClick={savePenalty}>Apply Penalty</button>
                </div>
              </div>
            )}

            {modal === "createWaybill" && (() => {
              const wbProduct = products.find((p) => p.id === waybillProductId);
              const warehouseBalance = wbProduct?.warehouseStock ?? null;
              const fromAgentBalance = waybillFromType === "Agent" && waybillFromAgentId && waybillProductId
                ? (agentStock.find((s) => s.agentId === waybillFromAgentId && s.productId === waybillProductId)?.quantity ?? 0)
                : null;
              const toAgentBalance = waybillToAgentId && waybillProductId
                ? (agentStock.find((s) => s.agentId === waybillToAgentId && s.productId === waybillProductId)?.quantity ?? 0)
                : null;
              const senderBalance = waybillFromType === "Warehouse" ? warehouseBalance : fromAgentBalance;
              const qty = Number(waybillQty) || 0;
              const senderAfter = senderBalance !== null ? senderBalance - qty : null;
              const e = waybillErrors;
              const fieldCls = (key: string) => `w-full rounded-lg border px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 ${e[key] ? "border-red-400 bg-red-50 focus:ring-red-200" : "border-gray-200 bg-white focus:ring-blue-200"}`;
              const Req = () => <span className="text-red-500 ml-0.5">*</span>;
              const ErrMsg = ({ k }: { k: string }) => e[k] ? <p className="mt-1 text-xs text-red-600 font-medium">{e[k]}</p> : null;
              return (
                <div className="px-6 py-5 flex flex-col gap-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="col-span-2">
                      <label className="block text-sm font-bold text-gray-900 mb-1.5">Product<Req /></label>
                      <select className={fieldCls("product")} value={waybillProductId} onChange={(e) => { setWaybillProductId(e.target.value); setWaybillErrors((prev) => ({ ...prev, product: "" })); }}>
                        <option value="">Select product</option>
                        {products.filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                      <ErrMsg k="product" />
                      {wbProduct && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-100">
                            Warehouse: <strong>{wbProduct.warehouseStock} units</strong>
                          </span>
                          {agents.filter((a) => a.active).map((a) => {
                            const bal = agentStock.find((s) => s.agentId === a.id && s.productId === waybillProductId)?.quantity ?? 0;
                            return bal > 0 ? (
                              <span key={a.id} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-gray-50 text-gray-600 border border-gray-200">
                                {a.name}: <strong>{bal}</strong>
                              </span>
                            ) : null;
                          })}
                        </div>
                      )}
                    </div>
                    <div>
                      <label className="block text-sm font-bold text-gray-900 mb-1.5">Quantity<Req /></label>
                      <input type="number" min={1} className={fieldCls("qty")} value={waybillQty} onChange={(ev) => { setWaybillQty(ev.target.value); setWaybillErrors((prev) => ({ ...prev, qty: "" })); }} />
                      <ErrMsg k="qty" />
                    </div>
                    <div>
                      <label className="block text-sm font-bold text-gray-900 mb-1.5">Waybill Fee (₦) <span className="font-normal text-gray-400">(optional)</span></label>
                      <input type="number" min={0} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-200" value={waybillFee} onChange={(e) => setWaybillFee(e.target.value)} />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-sm font-bold text-gray-900 mb-1.5">Logistics Partner / Carrier<Req /></label>
                      <input type="text" className={fieldCls("partner")} placeholder="e.g. RNR Log., Korrect, MR B/BSTAR" value={waybillPartner} onChange={(ev) => { setWaybillPartner(ev.target.value); setWaybillErrors((prev) => ({ ...prev, partner: "" })); }} />
                      <ErrMsg k="partner" />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-sm font-bold text-gray-900 mb-1.5">Sending From<Req /></label>
                      <div className="flex gap-2 mb-2">
                        <button type="button" className={`px-3 py-1.5 rounded-lg text-sm font-semibold border transition-colors ${waybillFromType === "Warehouse" ? "bg-[#1A6FBF] text-white border-[#1A6FBF]" : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50"}`} onClick={() => setWaybillFromType("Warehouse")}>Warehouse (Lagos)</button>
                        <button type="button" className={`px-3 py-1.5 rounded-lg text-sm font-semibold border transition-colors ${waybillFromType === "Agent" ? "bg-[#1A6FBF] text-white border-[#1A6FBF]" : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50"}`} onClick={() => setWaybillFromType("Agent")}>State Agent</button>
                      </div>
                      {waybillFromType === "Warehouse" && warehouseBalance !== null && (
                        <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium ${warehouseBalance === 0 ? "bg-red-50 text-red-700 border border-red-200" : senderAfter !== null && senderAfter < 0 ? "bg-orange-50 text-orange-700 border border-orange-200" : "bg-blue-50 text-blue-700 border border-blue-100"}`}>
                          <span>Warehouse stock: <strong>{warehouseBalance} units</strong></span>
                          {qty > 0 && senderAfter !== null && <span className="ml-auto text-xs opacity-75">After: {senderAfter} units</span>}
                        </div>
                      )}
                      {waybillFromType === "Agent" && (
                        <>
                          <select className={fieldCls("fromAgent")} value={waybillFromAgentId} onChange={(ev) => { setWaybillFromAgentId(ev.target.value); setWaybillErrors((prev) => ({ ...prev, fromAgent: "" })); }}>
                            <option value="">Select sending agent</option>
                            {agents.filter((a) => a.active).map((a) => {
                              const bal = agentStock.find((s) => s.agentId === a.id && s.productId === waybillProductId)?.quantity ?? 0;
                              return <option key={a.id} value={a.id}>{a.name} · {a.zone} · stock: {bal}</option>;
                            })}
                          </select>
                          <ErrMsg k="fromAgent" />
                          {waybillFromAgentId && fromAgentBalance !== null && (
                            <div className={`mt-2 flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium ${fromAgentBalance === 0 ? "bg-red-50 text-red-700 border border-red-200" : senderAfter !== null && senderAfter < 0 ? "bg-orange-50 text-orange-700 border border-orange-200" : "bg-blue-50 text-blue-700 border border-blue-100"}`}>
                              <span>Agent stock: <strong>{fromAgentBalance} units</strong></span>
                              {qty > 0 && senderAfter !== null && <span className="ml-auto text-xs opacity-75">After: {senderAfter} units</span>}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                    <div className="col-span-2">
                      <label className="block text-sm font-bold text-gray-900 mb-1.5">Sending To (Receiving Agent) <span className="font-normal text-gray-400">(optional)</span></label>
                      <select className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-200 mb-2" value={waybillToAgentId} onChange={(ev) => { setWaybillToAgentId(ev.target.value); if (ev.target.value) { const a = agents.find((ag) => ag.id === ev.target.value); setWaybillToState(a?.zone ?? ""); setWaybillErrors((prev) => ({ ...prev, toState: "" })); } }}>
                        <option value="">No specific agent (enter state below)</option>
                        {agents.filter((a) => a.active && a.id !== waybillFromAgentId).map((a) => {
                          const bal = agentStock.find((s) => s.agentId === a.id && s.productId === waybillProductId)?.quantity ?? 0;
                          return <option key={a.id} value={a.id}>{a.name} · {a.zone} · stock: {bal}</option>;
                        })}
                      </select>
                      {waybillToAgentId && toAgentBalance !== null && (
                        <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-teal-50 text-teal-700 border border-teal-100 mb-2">
                          <span>Receiver current stock: <strong>{toAgentBalance} units</strong></span>
                          {qty > 0 && <span className="ml-auto text-xs opacity-75">After receipt: {toAgentBalance + qty} units</span>}
                        </div>
                      )}
                      <label className="block text-xs font-bold text-gray-600 mb-1 mt-1">Receiving State<Req /></label>
                      <input type="text" className={fieldCls("toState")} placeholder="e.g. Bayelsa" value={waybillToState} onChange={(ev) => { setWaybillToState(ev.target.value); setWaybillErrors((prev) => ({ ...prev, toState: "" })); }} />
                      <ErrMsg k="toState" />
                    </div>
                    <div>
                      <label className="block text-sm font-bold text-gray-900 mb-1.5">Date Sent<Req /></label>
                      <input type="date" className={fieldCls("dateSent")} value={waybillDateSent} onChange={(ev) => { setWaybillDateSent(ev.target.value); setWaybillErrors((prev) => ({ ...prev, dateSent: "" })); }} />
                      <ErrMsg k="dateSent" />
                    </div>
                    <div>
                      <label className="block text-sm font-bold text-gray-900 mb-1.5">Note <span className="font-normal text-gray-400">(optional)</span></label>
                      <input type="text" className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-200" placeholder="e.g. Restock, Urgent transfer" value={waybillNote} onChange={(e) => setWaybillNote(e.target.value)} />
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-3 pt-2">
                    <button className="!min-h-0 inline-flex items-center justify-center px-6 py-2.5 rounded-lg border border-gray-200 text-gray-900 text-sm font-bold hover:bg-gray-50 transition-colors" onClick={closeModal}>Cancel</button>
                    <button className="!min-h-0 inline-flex items-center justify-center px-6 py-2.5 rounded-lg bg-[#1A6FBF] text-white text-sm font-bold hover:bg-[#1560a8] transition-colors" onClick={createWaybill}>Create Waybill</button>
                  </div>
                </div>
              );
            })()}

            {modal === "editWaybill" && (() => {
              const editRecord = waybillRecords.find((w) => w.id === waybillEditId);
              const wbProduct = products.find((p) => p.id === editRecord?.productId);
              const toAgentBalance = waybillToAgentId && editRecord?.productId
                ? (agentStock.find((s) => s.agentId === waybillToAgentId && s.productId === editRecord.productId)?.quantity ?? 0)
                : null;
              const ee = waybillErrors;
              const efieldCls = (key: string) => `w-full rounded-lg border px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 ${ee[key] ? "border-red-400 bg-red-50 focus:ring-red-200" : "border-gray-200 bg-white focus:ring-blue-200"}`;
              const EReq = () => <span className="text-red-500 ml-0.5">*</span>;
              const EErr = ({ k }: { k: string }) => ee[k] ? <p className="mt-1 text-xs text-red-600 font-medium">{ee[k]}</p> : null;
              return (
                <div className="px-6 py-5 flex flex-col gap-4">
                  {/* Read-only summary */}
                  {editRecord && (
                    <div className="rounded-lg bg-gray-50 border border-gray-200 px-4 py-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
                      <span className="text-gray-500">Product: <strong className="text-gray-900">{editRecord.productName}</strong></span>
                      <span className="text-gray-500">Qty: <strong className="text-gray-900">{editRecord.quantity} units</strong></span>
                      <span className="text-gray-500">From: <strong className="text-gray-900">{editRecord.sendingState}</strong></span>
                      <span className="text-gray-500">Status: <strong className="text-gray-900">{editRecord.status}</strong></span>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-bold text-gray-900 mb-1.5">Waybill Fee (₦) <span className="font-normal text-gray-400">(optional)</span></label>
                      <input type="number" min={0} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-200" value={waybillFee} onChange={(e) => setWaybillFee(e.target.value)} />
                    </div>
                    <div>
                      <label className="block text-sm font-bold text-gray-900 mb-1.5">Date Sent<EReq /></label>
                      <input type="date" className={efieldCls("dateSent")} value={waybillDateSent} onChange={(ev) => { setWaybillDateSent(ev.target.value); setWaybillErrors((prev) => ({ ...prev, dateSent: "" })); }} />
                      <EErr k="dateSent" />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-sm font-bold text-gray-900 mb-1.5">Logistics Partner / Carrier<EReq /></label>
                      <input type="text" className={efieldCls("partner")} value={waybillPartner} onChange={(ev) => { setWaybillPartner(ev.target.value); setWaybillErrors((prev) => ({ ...prev, partner: "" })); }} />
                      <EErr k="partner" />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-sm font-bold text-gray-900 mb-1.5">Receiving Agent <span className="font-normal text-gray-400">(optional)</span></label>
                      <select className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-200 mb-2" value={waybillToAgentId} onChange={(ev) => { setWaybillToAgentId(ev.target.value); if (ev.target.value) { const a = agents.find((ag) => ag.id === ev.target.value); setWaybillToState(a?.zone ?? ""); setWaybillErrors((prev) => ({ ...prev, toState: "" })); } }}>
                        <option value="">No specific agent</option>
                        {agents.filter((a) => a.active).map((a) => {
                          const bal = wbProduct ? (agentStock.find((s) => s.agentId === a.id && s.productId === wbProduct.id)?.quantity ?? 0) : 0;
                          return <option key={a.id} value={a.id}>{a.name} · {a.zone} · stock: {bal}</option>;
                        })}
                      </select>
                      {waybillToAgentId && toAgentBalance !== null && (
                        <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-teal-50 text-teal-700 border border-teal-100 mb-2">
                          <span>Current stock: <strong>{toAgentBalance} units</strong></span>
                          {editRecord && <span className="ml-auto text-xs opacity-75">After receipt: {toAgentBalance + editRecord.quantity} units</span>}
                        </div>
                      )}
                      <label className="block text-xs font-bold text-gray-600 mb-1 mt-1">Receiving State<EReq /></label>
                      <input type="text" className={efieldCls("toState")} placeholder="e.g. Bayelsa" value={waybillToState} onChange={(ev) => { setWaybillToState(ev.target.value); setWaybillErrors((prev) => ({ ...prev, toState: "" })); }} />
                      <EErr k="toState" />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-sm font-bold text-gray-900 mb-1.5">Note <span className="font-normal text-gray-400">(optional)</span></label>
                      <input type="text" className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-200" placeholder="e.g. Restock, Urgent transfer" value={waybillNote} onChange={(e) => setWaybillNote(e.target.value)} />
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-3 pt-2">
                    <button className="!min-h-0 inline-flex items-center justify-center px-6 py-2.5 rounded-lg border border-gray-200 text-gray-900 text-sm font-bold hover:bg-gray-50 transition-colors" onClick={closeModal}>Cancel</button>
                    <button className="!min-h-0 inline-flex items-center justify-center px-6 py-2.5 rounded-lg bg-[#1A6FBF] text-white text-sm font-bold hover:bg-[#1560a8] transition-colors" onClick={saveEditWaybill}>Save Changes</button>
                  </div>
                </div>
              );
            })()}
            {modal === "flagCustomer" && (
              <div className="modal-form">
                <p className="text-sm text-gray-600">This customer will be marked as high-risk. A warning will appear when creating orders for this phone number.</p>
                <label><span>Reason for flagging *</span><textarea value={flagReasonDraft} onChange={(e) => setFlagReasonDraft(e.target.value)} placeholder="e.g., Refused delivery 3 times, RTS x2, wrong number repeatedly..." rows={3} /></label>
                <div className="flex items-center justify-end gap-3 pt-2">
                  <button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors" onClick={closeModal}>Cancel</button>
                  <button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 transition-colors" onClick={saveFlagCustomer}><AlertTriangle className="w-4 h-4" /> Flag Customer</button>
                </div>
              </div>
            )}
            {modal === "newStockCount" && (
              <div className="modal-form">
                <p className="text-sm text-gray-600">This creates a snapshot of current agent stock quantities. You'll then enter what each agent physically reports to reconcile.</p>
                <label>
                  <span>Session Title</span>
                  <input type="text" value={stockCountTitleDraft} onChange={(e) => setStockCountTitleDraft(e.target.value)} placeholder="e.g., End of Month Count — May 2026" />
                </label>
                <div className="flex flex-col gap-2">
                  <span className="text-sm font-semibold text-gray-700">Include Agents</span>
                  <p className="text-xs text-gray-500">Only agents with assigned stock will have entries generated.</p>
                  <div className="flex flex-col gap-2 max-h-48 overflow-y-auto border border-gray-200 rounded-lg p-3">
                    {agents.length === 0 ? (
                      <p className="text-sm text-gray-400 italic">No agents found.</p>
                    ) : (
                      agents.map((agent) => (
                        <label key={agent.id} className="flex items-center gap-2 cursor-pointer text-sm text-gray-700">
                          <input
                            type="checkbox"
                            className="accent-blue-600"
                            checked={stockCountAgentIdsDraft.includes(agent.id)}
                            onChange={(e) => setStockCountAgentIdsDraft((prev) => e.target.checked ? [...prev, agent.id] : prev.filter((id) => id !== agent.id))}
                          />
                          <span className="font-medium">{agent.name}</span>
                          <span className="text-gray-400 text-xs">— {agent.zone}</span>
                        </label>
                      ))
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-end gap-3 pt-2">
                  <button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors" onClick={closeModal}>Cancel</button>
                  <button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#1A6FBF] text-white text-sm font-medium hover:bg-blue-700 transition-colors" disabled={stockCountAgentIdsDraft.length === 0} onClick={createStockCountSession}><ClipboardCheck className="w-4 h-4" /> Create Session</button>
                </div>
              </div>
            )}
            {modal === "stockCountEntry" && (() => {
              const entry = activeStockCount?.entries.find((e) => e.id === stockCountEntryId) ?? stockCounts.flatMap((s) => s.entries).find((e) => e.id === stockCountEntryId);
              if (!entry) return null;
              const bothFilled = agentCountDraft !== "" && adminCountDraft !== "";
              const wouldVerify = bothFilled && parseInt(agentCountDraft, 10) === parseInt(adminCountDraft, 10);
              const wouldDiscrepancy = bothFilled && parseInt(agentCountDraft, 10) !== parseInt(adminCountDraft, 10);
              return (
                <div className="modal-form">
                  <div className="grid grid-cols-3 gap-3 text-center mb-2">
                    <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">System Qty</p>
                      <strong className="text-xl font-bold text-gray-900">{entry.systemQty}</strong>
                      <p className="text-[10px] text-gray-400 mt-0.5">Expected on hand</p>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Agent</p>
                      <strong className="text-base font-bold text-gray-700">{entry.agentName}</strong>
                      <p className="text-[10px] text-gray-400 mt-0.5">{entry.productName}</p>
                    </div>
                    <div className={`rounded-lg p-3 border ${wouldVerify ? "bg-green-50 border-green-200" : wouldDiscrepancy ? "bg-red-50 border-red-200" : "bg-gray-50 border-gray-200"}`}>
                      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Variance</p>
                      <strong className={`text-xl font-bold ${wouldVerify ? "text-green-600" : wouldDiscrepancy ? "text-red-600" : "text-gray-400"}`}>
                        {bothFilled ? (() => { const v = parseInt(agentCountDraft, 10) - parseInt(adminCountDraft, 10); return (v > 0 ? "+" : "") + v; })() : "—"}
                      </strong>
                      <p className={`text-[10px] mt-0.5 ${wouldVerify ? "text-green-600 font-semibold" : wouldDiscrepancy ? "text-red-500 font-semibold" : "text-gray-400"}`}>{wouldVerify ? "Will verify" : wouldDiscrepancy ? "Discrepancy" : "Pending"}</p>
                    </div>
                  </div>
                  <label>
                    <span>Agent Reported Count <span className="text-gray-400 font-normal text-xs">(what agent told you physically)</span></span>
                    <input type="number" min="0" value={agentCountDraft} onChange={(e) => setAgentCountDraft(e.target.value)} placeholder="e.g. 10" />
                  </label>
                  <label>
                    <span>Admin Confirmed Count <span className="text-gray-400 font-normal text-xs">(your own verification / system agreement)</span></span>
                    <input type="number" min="0" value={adminCountDraft} onChange={(e) => setAdminCountDraft(e.target.value)} placeholder="e.g. 10" />
                  </label>
                  <label>
                    <span>Notes <span className="text-gray-400 font-normal">(optional)</span></span>
                    <input type="text" value={stockCountNotesDraft} onChange={(e) => setStockCountNotesDraft(e.target.value)} placeholder="e.g., 2 units found damaged and set aside" />
                  </label>
                  <div className="flex items-center justify-end gap-3 pt-2">
                    <button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors" onClick={closeModal}>Cancel</button>
                    <button className={`!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg text-white text-sm font-medium transition-colors ${wouldVerify ? "bg-green-600 hover:bg-green-700" : wouldDiscrepancy ? "bg-red-600 hover:bg-red-700" : "bg-[#1A6FBF] hover:bg-blue-700"}`} onClick={saveStockCountEntry}><ClipboardCheck className="w-4 h-4" /> Save Count</button>
                  </div>
                </div>
              );
            })()}
            {modal === "adjustStockCount" && (() => {
              const entry = stockCounts.flatMap((s) => s.entries).find((e) => e.id === adjustStockEntryId);
              if (!entry || entry.agentCount === undefined) return null;
              const delta = entry.agentCount - entry.systemQty;
              const writeOffQty = Math.abs(delta);
              return (
                <div className="modal-form">
                  <div className="rounded-xl border border-red-200 bg-red-50 p-4 flex flex-col gap-2">
                    <p className="text-sm font-bold text-red-800">{writeOffQty} unit{writeOffQty === 1 ? "" : "s"} will be written off for {entry.agentName} — {entry.productName}</p>
                    <div className="flex items-center gap-6 text-sm text-red-700">
                      <span>System: <strong>{entry.systemQty}</strong></span>
                      <span>→</span>
                      <span>Adjusted: <strong>{entry.agentCount}</strong></span>
                      <span className="font-bold">(−{writeOffQty})</span>
                    </div>
                  </div>
                  <label>
                    <span>Write-off Reason <span className="text-red-500">*</span></span>
                    <select value={writeOffReason} onChange={(e) => { setWriteOffReason(e.target.value as WriteOffReason | ""); setWriteOffCustomReason(""); }}>
                      <option value="">— Select a reason —</option>
                      {(["Damaged", "Theft", "Unreported Sale", "Return to Warehouse", "Other"] as WriteOffReason[]).map((r) => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                  </label>
                  {writeOffReason === "Other" && (
                    <label>
                      <span>Describe the reason <span className="text-red-500">*</span></span>
                      <input type="text" value={writeOffCustomReason} onChange={(e) => setWriteOffCustomReason(e.target.value)} placeholder="e.g., Expired product, Water damage, Given as samples..." autoFocus />
                    </label>
                  )}
                  <p className="text-xs text-gray-500">This reason will appear in the Stock History as a Correction movement. It cannot be changed after saving.</p>
                  <div className="flex items-center justify-end gap-3 pt-2">
                    <button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors" onClick={closeModal}>Cancel</button>
                    <button className="!min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 transition-colors disabled:opacity-40" disabled={!writeOffReason || (writeOffReason === "Other" && !writeOffCustomReason.trim())} onClick={confirmAdjustStockFromCount}><ClipboardCheck className="w-4 h-4" /> Confirm Write-off</button>
                  </div>
                </div>
              );
            })()}
          </section>
        </div>
      )}
    </div>
  );
}
