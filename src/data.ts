import {
  ArrowLeftRight,
  BadgeDollarSign,
  Banknote,
  Bell,
  Bot,
  Box,
  CalendarClock,
  Code2,
  CreditCard,
  HandCoins,
  Headphones,
  LayoutDashboard,
  Megaphone,
  MessageCircle,
  Package,
  PackageCheck,
  ReceiptText,
  Repeat2,
  Settings,
  ShoppingBag,
  ShoppingCart,
  TrendingUp,
  Truck,
  Users,
  WalletCards
} from "lucide-react";

export const navItems = [
  { label: "Dashboard", icon: LayoutDashboard, active: true },
  { label: "Orders", icon: ShoppingBag },
  { label: "Abandoned Carts", icon: ShoppingCart },
  { label: "Scheduled Deliveries", icon: CalendarClock },
  { label: "Deliveries", icon: PackageCheck },
  { label: "Inventory", icon: Box },
  { label: "Sales Reps", icon: Users },
  { label: "Sales Teams", icon: Users },
  { label: "Agents", icon: Truck },
  { label: "Waybill", icon: ArrowLeftRight },
  { label: "Payroll", icon: Banknote },
  { label: "Customers", icon: ReceiptText },
  { label: "Expenses", icon: CreditCard },
  { label: "Finance & Accounting", icon: WalletCards },
  { label: "Ad Tracking", icon: Megaphone },
  { label: "User Management", icon: Users },
  { label: "Round-Robin", icon: Repeat2 },
  { label: "Embed Form", icon: Code2 },
  { label: "AI Agent", icon: Headphones },
  { label: "AI Sandbox", icon: Bot },
  { label: "AI/SMS Tokens", icon: MessageCircle },
  { label: "Notifications", icon: Bell },
  { label: "Call Rep Console", icon: Headphones },
  { label: "Settings", icon: Settings }
];

export const summaryCards = [
  {
    label: "Total Revenue",
    value: "₦0",
    helper: "vs. previous period",
    trend: "+0.0%",
    icon: TrendingUp,
    tone: "blue"
  },
  {
    label: "Gross Profit",
    value: "₦0",
    helper: "Revenue - COGS",
    trend: "+0.0%",
    icon: BadgeDollarSign,
    tone: "emerald"
  },
  {
    label: "Net Profit",
    value: "₦0",
    helper: "After costs & expenses",
    trend: "+0.0%",
    icon: Banknote,
    tone: "violet"
  },
  {
    label: "Total Orders",
    value: "0",
    helper: "vs. previous period",
    trend: "+0.0%",
    icon: ShoppingBag,
    tone: "orange"
  },
  {
    label: "Fulfillment Rate",
    value: "0%",
    helper: "0% cancelled",
    icon: PackageCheck,
    tone: "teal"
  }
];

export const cartStats = [
  { label: "Total", value: "0", icon: ShoppingCart, tone: "blue" },
  { label: "Active", value: "0", icon: HandCoins, tone: "orange" },
  { label: "Contacted", value: "0", icon: MessageCircle, tone: "emerald" },
  { label: "Needs attention", value: "0", icon: Bell, tone: "rose" }
];

export const revenueData = Array.from({ length: 23 }, (_, index) => ({
  hour: String(index + 1).padStart(2, "0") + ":",
  current: 0,
  previous: 0
}));

export const emptyProductsIcon = Package;
