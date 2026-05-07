import React, { useMemo, useState } from "react";
import { 
  Download, 
  CalendarDays, 
  TrendingUp, 
  BadgeDollarSign, 
  Banknote, 
  ShoppingBag, 
  PackageCheck,
  ShoppingCart,
  HandCoins,
  MessageCircle,
  Bell,
  ArrowRight,
  Zap,
  ChevronRight,
  Eye,
  Plus,
  Clock,
  Sparkles
} from "lucide-react";
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  Tooltip, 
  ResponsiveContainer,
  AreaChart,
  Area
} from "recharts";
import { motion } from "framer-motion";
import { 
  Period, 
  CurrencyCode, 
  DateRange, 
  Product, 
  TrackedOrder, 
  AbandonedCartRecord,
  ExpenseRecord,
  ActivePage,
  ModalType
} from "../types";
import { 
  isInPeriod, 
  formatMoney, 
  formatProductMoney,
  statusBadgeClasses,
  displayDateFromKey,
  normalizeDateKey
} from "../lib/dashboard-utils";
import { cn } from "../lib/utils";

interface DashboardProps {
  products: Product[];
  trackedOrders: TrackedOrder[];
  abandonedCarts: AbandonedCartRecord[];
  expenses: ExpenseRecord[];
  period: Period;
  setPeriod: (p: Period) => void;
  dateRange: DateRange;
  setDateRange: (dr: DateRange) => void;
  currency: CurrencyCode;
  setCurrency: (c: CurrencyCode) => void;
  currencies: any;
  productCurrencies: any;
  setActivePage: (p: ActivePage) => void;
  setModal: (m: ModalType) => void;
  setSelectedOrderId: (id: string) => void;
  exportReport: () => void;
}

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1
    }
  }
};

const item = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0 }
};

export const Dashboard: React.FC<DashboardProps> = ({
  products,
  trackedOrders,
  abandonedCarts,
  expenses,
  period,
  setPeriod,
  dateRange,
  setDateRange,
  currency,
  setCurrency,
  currencies,
  productCurrencies,
  setActivePage,
  setModal,
  setSelectedOrderId,
  exportReport
}) => {
  const [conversion, setConversion] = useState(0);

  // Filter data based on period
  const periodOrders = useMemo(() => 
    trackedOrders.filter(o => isInPeriod(o.createdAt || o.date, period, dateRange)),
  [trackedOrders, period, dateRange]);

  const periodExpenses = useMemo(() => 
    expenses.filter(e => isInPeriod(e.date, period, dateRange)),
  [expenses, period, dateRange]);

  // Calculations
  const deliveredOrders = periodOrders.filter(o => o.status === "Delivered");
  const revenue = deliveredOrders.reduce((sum, o) => sum + (o.currency === currency ? o.amount : 0), 0); // Simplified currency check
  const orderCount = periodOrders.length;
  const deliveryRate = orderCount === 0 ? 0 : Math.round((deliveredOrders.length / orderCount) * 100);

  const stats = [
    { label: "Total Revenue", value: formatMoney(revenue, currency, currencies), trend: "+12.5%", icon: TrendingUp, color: "text-blue-500", bg: "bg-blue-500/10" },
    { label: "Total Orders", value: orderCount.toString(), trend: "+8.2%", icon: ShoppingBag, color: "text-orange-500", bg: "bg-orange-500/10" },
    { label: "Delivered", value: deliveredOrders.length.toString(), trend: "+5.1%", icon: PackageCheck, color: "text-emerald-500", bg: "bg-emerald-500/10" },
    { label: "Delivery Rate", value: `${deliveryRate}%`, trend: "+2.4%", icon: Zap, color: "text-purple-500", bg: "bg-purple-500/10" },
  ];

  return (
    <motion.div 
      variants={container}
      initial="hidden"
      animate="show"
      className="space-y-8"
    >
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight flex items-center gap-2">
            Overview <Sparkles className="w-6 h-6 text-primary animate-pulse" />
          </h1>
          <p className="text-muted-foreground mt-1 font-medium">
            Welcome back! Here's what's happening with your business today.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={exportReport}
            className="flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground rounded-2xl font-bold shadow-lg shadow-primary/20 hover:scale-105 active:scale-95 transition-all"
          >
            <Download className="w-5 h-5" />
            Export Report
          </button>
        </div>
      </div>

      {/* Filters & Controls */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="p-1.5 bg-black/5 rounded-2xl flex items-center gap-1 border border-black/5">
          {["Today", "This Week", "This Month", "This Year"].map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p as Period)}
              className={cn(
                "px-5 py-2 rounded-xl text-sm font-bold transition-all",
                period === p ? "bg-white text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {p}
            </button>
          ))}
        </div>

        <select
          value={currency}
          onChange={(e) => setCurrency(e.target.value as CurrencyCode)}
          className="bg-black/5 border border-black/5 rounded-2xl px-5 py-2.5 text-sm font-bold focus:ring-2 focus:ring-primary/20 outline-none appearance-none cursor-pointer hover:bg-white transition-all"
        >
          {Object.entries(currencies).map(([code, def]: [any, any]) => (
            <option key={code} value={code}>{def.label}</option>
          ))}
        </select>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map((stat, idx) => (
          <motion.div 
            key={stat.label}
            variants={item}
            whileHover={{ y: -5 }}
            className="glass rounded-[2rem] p-6 shadow-sm border-white/40"
          >
            <div className="flex items-center justify-between mb-4">
              <div className={cn("w-12 h-12 rounded-2xl flex items-center justify-center shadow-inner", stat.bg)}>
                <stat.icon className={cn("w-6 h-6", stat.color)} />
              </div>
              <span className="text-[10px] font-bold px-2 py-1 bg-emerald-500/10 text-emerald-600 rounded-lg uppercase tracking-wider">
                {stat.trend}
              </span>
            </div>
            <div className="space-y-1">
              <p className="text-sm font-semibold text-muted-foreground uppercase tracking-widest">{stat.label}</p>
              <h3 className="text-3xl font-black tracking-tight">{stat.value}</h3>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Main Charts & Data */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Revenue Chart */}
        <motion.div variants={item} className="lg:col-span-2 glass rounded-[2.5rem] p-8 border-white/40 shadow-sm overflow-hidden relative">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h3 className="text-xl font-bold">Revenue Performance</h3>
              <p className="text-sm text-muted-foreground">Tracking revenue growth over time</p>
            </div>
            <div className="flex items-center gap-4 text-xs font-bold">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-primary" />
                <span>Current</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-primary/30" />
                <span>Target</span>
              </div>
            </div>
          </div>
          
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={revenueData}>
                <defs>
                  <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <XAxis 
                  dataKey="hour" 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fontSize: 12, fontWeight: 600, fill: "hsl(var(--muted-foreground))" }}
                />
                <YAxis hide />
                <Tooltip 
                  contentStyle={{ 
                    borderRadius: "20px", 
                    border: "none", 
                    boxShadow: "0 10px 30px rgba(0,0,0,0.1)",
                    padding: "15px"
                  }} 
                />
                <Area 
                  type="monotone" 
                  dataKey="current" 
                  stroke="hsl(var(--primary))" 
                  strokeWidth={4}
                  fillOpacity={1} 
                  fill="url(#colorRevenue)" 
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </motion.div>

        {/* Top Products */}
        <motion.div variants={item} className="glass rounded-[2.5rem] p-8 border-white/40 shadow-sm flex flex-col">
          <h3 className="text-xl font-bold mb-6">Top Products</h3>
          <div className="space-y-6 flex-1 overflow-y-auto no-scrollbar">
            {products.slice(0, 5).map((product, idx) => (
              <div key={product.id} className="flex items-center gap-4 group cursor-pointer">
                <div className="w-12 h-12 rounded-2xl bg-black/5 flex items-center justify-center font-bold text-lg transition-transform group-hover:scale-110">
                  {idx + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="font-bold truncate text-sm">{product.name}</h4>
                  <p className="text-xs text-muted-foreground">{product.unitsSold} units sold</p>
                </div>
                <div className="text-right">
                  <p className="font-bold text-sm text-primary">{formatProductMoney(productInventoryValue(product) / totalProductStock(product), "NGN", productCurrencies)}</p>
                </div>
              </div>
            ))}
          </div>
          <button 
            onClick={() => setActivePage("Inventory")}
            className="mt-8 w-full py-3 bg-black/5 rounded-2xl font-bold text-sm hover:bg-black/10 transition-colors flex items-center justify-center gap-2"
          >
            View Inventory <ArrowRight className="w-4 h-4" />
          </button>
        </motion.div>
      </div>

      {/* Recent Orders Table */}
      <motion.div variants={item} className="glass rounded-[2.5rem] border-white/40 shadow-sm overflow-hidden">
        <div className="p-8 border-b border-black/5 flex items-center justify-between">
          <h3 className="text-xl font-bold">Recent Transactions</h3>
          <button 
            onClick={() => setActivePage("Orders")}
            className="text-sm font-bold text-primary hover:underline"
          >
            See all orders
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-[10px] font-black uppercase tracking-widest text-muted-foreground border-b border-black/5">
                <th className="px-8 py-4">Order ID</th>
                <th className="px-8 py-4">Customer</th>
                <th className="px-8 py-4">Date</th>
                <th className="px-8 py-4">Amount</th>
                <th className="px-8 py-4">Status</th>
                <th className="px-8 py-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5">
              {trackedOrders.slice(0, 5).map((order) => (
                <tr key={order.id} className="group hover:bg-black/[0.02] transition-colors">
                  <td className="px-8 py-5 font-bold text-xs text-muted-foreground">#{order.id.slice(0, 8)}</td>
                  <td className="px-8 py-5">
                    <p className="font-bold text-sm">{order.customer}</p>
                    <p className="text-[10px] text-muted-foreground">{order.phone}</p>
                  </td>
                  <td className="px-8 py-5 text-sm font-medium text-muted-foreground">
                    {displayDateFromKey(order.createdAt || order.date)}
                  </td>
                  <td className="px-8 py-5 font-black text-sm">
                    {formatProductMoney(order.amount, order.currency, productCurrencies)}
                  </td>
                  <td className="px-8 py-5">
                    <span className={cn(
                      "px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider",
                      statusBadgeClasses(order.status || "New")
                    )}>
                      {order.status || "New"}
                    </span>
                  </td>
                  <td className="px-8 py-5 text-right">
                    <button 
                      onClick={() => { setSelectedOrderId(order.id); setModal("orderDetails"); }}
                      className="p-2 rounded-xl hover:bg-primary/10 text-primary transition-colors"
                    >
                      <Eye className="w-5 h-5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </motion.div>
    </motion.div>
  );
};

// Mock data for the chart if revenueData is not passed properly or needs local mapping
const revenueData = [
  { hour: "00:00", current: 400 },
  { hour: "04:00", current: 300 },
  { hour: "08:00", current: 900 },
  { hour: "12:00", current: 1500 },
  { hour: "16:00", current: 1200 },
  { hour: "20:00", current: 1800 },
  { hour: "23:59", current: 2100 },
];

const totalProductStock = (product: Product) => product.warehouseStock + product.agentStock;
const productInventoryValue = (product: Product) => totalProductStock(product) * (product.pricings[0]?.sellingPrice || 0);
