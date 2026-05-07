import React, { useMemo } from "react";
import { 
  PackageCheck, 
  CircleDollarSign, 
  Clock, 
  TrendingUp, 
  Search, 
  CalendarDays,
  Filter,
  Eye,
  ChevronRight,
  Package,
  User,
  MapPin
} from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "../lib/utils";
import type { TrackedOrder, Period, DateRange, CurrencyCode, ProductCurrencyCode } from "../types";

interface DeliveriesProps {
  trackedOrders: TrackedOrder[];
  agents: { id: string; name: string }[];
  period: Period;
  setPeriod: (period: Period) => void;
  dateRange: DateRange;
  setDateRange: (range: DateRange) => void;
  currency: CurrencyCode;
  setCurrency: (currency: CurrencyCode) => void;
  currencies: any;
  productCurrencies: any;
  setActivePage: (page: string) => void;
  setModal: (modal: any) => void;
  setSelectedOrderId: (id: string | null) => void;
  deliverySearch: string;
  setDeliverySearch: (search: string) => void;
  deliveryAgent: string;
  setDeliveryAgent: (agent: string) => void;
}

const statusBadgeClasses = (status: string): string => {
  const map: Record<string, string> = {
    "New": "bg-blue-500/10 text-blue-500 border-blue-500/20",
    "Confirmed": "bg-amber-500/10 text-amber-500 border-amber-500/20",
    "In Process": "bg-amber-500/10 text-amber-500 border-amber-500/20",
    "Dispatched": "bg-purple-500/10 text-purple-500 border-purple-500/20",
    "Delivered": "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
    "Cancelled": "bg-rose-500/10 text-rose-500 border-rose-500/20",
    "Postponed": "bg-slate-500/10 text-slate-500 border-slate-500/20",
    "Failed": "bg-orange-500/10 text-orange-500 border-orange-500/20",
  };
  return map[status] ?? "bg-slate-500/10 text-slate-500 border-slate-500/20";
};

export const Deliveries: React.FC<DeliveriesProps> = ({
  trackedOrders,
  agents,
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
  deliverySearch,
  setDeliverySearch,
  deliveryAgent,
  setDeliveryAgent,
}) => {
  const deliveryAgentOptions = ["All Agents", "Unassigned", ...agents.map((agent) => agent.name)];

  const formatProductMoney = (amount: number, code: ProductCurrencyCode) =>
    new Intl.NumberFormat(productCurrencies[code]?.locale || "en-NG", {
      style: "currency",
      currency: productCurrencies[code]?.currency || "NGN",
      maximumFractionDigits: 0
    }).format(amount || 0);

  const normalizeDateKey = (value?: string) => {
    if (!value) return new Date().toISOString().split("T")[0];
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? new Date().toISOString().split("T")[0] : parsed.toISOString().split("T")[0];
  };

  const isInPeriod = (dateKey: string | undefined, activePeriod: Period, range: DateRange) => {
    const value = normalizeDateKey(dateKey);
    const now = new Date();
    const today = now.toISOString().split("T")[0];
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay());
    const weekStartKey = weekStart.toISOString().split("T")[0];

    if (activePeriod === "Custom") {
      return Boolean(range.start && range.end && value >= range.start && value <= range.end);
    }
    if (activePeriod === "Today") {
      return value === today;
    }
    if (activePeriod === "This Week") {
      return value >= weekStartKey && value <= today;
    }
    if (activePeriod === "This Month") {
      return value.slice(0, 7) === today.slice(0, 7);
    }
    return value.slice(0, 4) === today.slice(0, 4);
  };

  const deliveredInPeriodRows = useMemo(() => 
    trackedOrders.filter((order) => 
      order.status === "Delivered" && isInPeriod(order.deliveredDate || order.date, period, dateRange)
    ), [trackedOrders, period, dateRange]);

  const filteredDeliveryRows = useMemo(() => {
    return deliveredInPeriodRows.filter((order) => {
      const matchesSearch = 
        order.customer.toLowerCase().includes(deliverySearch.toLowerCase()) || 
        order.id.toLowerCase().includes(deliverySearch.toLowerCase());
      
      const agentName = agents.find(a => a.id === order.agentId)?.name || "Unassigned";
      const matchesAgent = deliveryAgent === "All Agents" || agentName === deliveryAgent;
      
      return matchesSearch && matchesAgent;
    });
  }, [deliveredInPeriodRows, deliverySearch, deliveryAgent, agents]);

  const deliveredRevenueInPeriod = useMemo(() => 
    deliveredInPeriodRows.reduce((sum, order) => sum + (order.amount || 0), 0)
  , [deliveredInPeriodRows]);

  const averageFulfillmentDays = useMemo(() => {
    if (deliveredInPeriodRows.length === 0) return 0;
    const totalDays = deliveredInPeriodRows.reduce((sum, order) => {
      const created = new Date(order.date).getTime();
      const delivered = new Date(order.deliveredDate || order.date).getTime();
      return sum + Math.max(0, (delivered - created) / 86400000);
    }, 0);
    return totalDays / deliveredInPeriodRows.length;
  }, [deliveredInPeriodRows]);

  const avgDeliveredPerDay = useMemo(() => {
    const days = period === "Today" ? 1 : period === "This Week" ? 7 : period === "This Month" ? 30 : 365;
    return deliveredInPeriodRows.length / days;
  }, [deliveredInPeriodRows, period]);

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="space-y-1">
          <h1 className="text-4xl font-black tracking-tight bg-gradient-to-br from-foreground to-foreground/70 bg-clip-text text-transparent">
            Deliveries
          </h1>
          <p className="text-muted-foreground font-medium">
            Track and analyze your successful fulfillments
          </p>
        </div>
        
        <div className="flex items-center gap-3 bg-white/50 backdrop-blur-md p-1.5 rounded-2xl border border-white/40 shadow-sm">
          {(["Today", "This Week", "This Month", "This Year"] as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={cn(
                "px-4 py-2 text-sm font-bold rounded-xl transition-all",
                period === p 
                  ? "bg-primary text-primary-foreground shadow-lg shadow-primary/20 scale-105" 
                  : "text-muted-foreground hover:bg-black/5"
              )}
            >
              {p}
            </button>
          ))}
        </div>
      </header>

      {/* Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {[
          { title: "Delivered", value: deliveredInPeriodRows.length, icon: PackageCheck, color: "text-emerald-500", bg: "bg-emerald-500/10" },
          { title: "Revenue", value: formatProductMoney(deliveredRevenueInPeriod, "NGN"), icon: CircleDollarSign, color: "text-blue-500", bg: "bg-blue-500/10" },
          { title: "Avg. Time", value: `${averageFulfillmentDays.toFixed(1)} Days`, icon: Clock, color: "text-amber-500", bg: "bg-amber-500/10" },
          { title: "Daily Rate", value: `${avgDeliveredPerDay.toFixed(1)} / day`, icon: TrendingUp, color: "text-indigo-500", bg: "bg-indigo-500/10" },
        ].map((metric, idx) => (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.1 }}
            key={metric.title}
            className="glass rounded-3xl p-6 border border-white/40 shadow-xl shadow-black/5 hover:scale-[1.02] transition-transform"
          >
            <div className={cn("w-12 h-12 rounded-2xl flex items-center justify-center mb-4", metric.bg, metric.color)}>
              <metric.icon className="w-6 h-6" />
            </div>
            <p className="text-sm font-bold text-muted-foreground uppercase tracking-wider">{metric.title}</p>
            <p className="text-3xl font-black mt-1 tracking-tight">{metric.value}</p>
          </motion.div>
        ))}
      </div>

      {/* Table Section */}
      <div className="glass rounded-[2.5rem] border border-white/40 shadow-2xl shadow-black/5 overflow-hidden">
        <div className="p-6 border-b border-black/5 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white/30">
          <div className="flex items-center gap-4 flex-1 max-w-2xl">
            <div className="relative flex-1">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
              <input
                type="text"
                value={deliverySearch}
                onChange={(e) => setDeliverySearch(e.target.value)}
                placeholder="Search customer, order ID..."
                className="w-full pl-12 pr-4 py-3 bg-white/50 backdrop-blur-sm border border-black/5 rounded-2xl focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all font-medium"
              />
            </div>
            <div className="relative">
              <Filter className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
              <select
                value={deliveryAgent}
                onChange={(e) => setDeliveryAgent(e.target.value)}
                className="pl-12 pr-10 py-3 bg-white/50 backdrop-blur-sm border border-black/5 rounded-2xl focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all font-bold appearance-none cursor-pointer"
              >
                {deliveryAgentOptions.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            </div>
          </div>
          
          <div className="flex items-center gap-2 text-sm font-bold text-muted-foreground bg-black/5 px-4 py-2 rounded-xl">
            <span className="w-2 h-2 bg-primary rounded-full animate-pulse" />
            {filteredDeliveryRows.length} Successes
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-left bg-black/[0.02]">
                <th className="px-8 py-5 text-xs font-black uppercase tracking-widest text-muted-foreground">Order Info</th>
                <th className="px-8 py-5 text-xs font-black uppercase tracking-widest text-muted-foreground">Customer</th>
                <th className="px-8 py-5 text-xs font-black uppercase tracking-widest text-muted-foreground">Logistics</th>
                <th className="px-8 py-5 text-xs font-black uppercase tracking-widest text-muted-foreground">Status</th>
                <th className="px-8 py-5 text-xs font-black uppercase tracking-widest text-muted-foreground text-right">Revenue</th>
                <th className="px-8 py-5 text-xs font-black uppercase tracking-widest text-muted-foreground text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5">
              {filteredDeliveryRows.length > 0 ? (
                filteredDeliveryRows.map((order) => (
                  <tr key={order.id} className="group hover:bg-primary/5 transition-colors">
                    <td className="px-8 py-6">
                      <div className="space-y-1">
                        <p className="font-black text-primary group-hover:underline cursor-pointer" onClick={() => { setSelectedOrderId(order.id); setModal("orderDetails"); }}>
                          {order.id}
                        </p>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground font-bold">
                          <Package className="w-3 h-3" />
                          {order.productName}
                        </div>
                      </div>
                    </td>
                    <td className="px-8 py-6">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-black/5 flex items-center justify-center text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary transition-colors font-bold text-xs uppercase">
                          {order.customer.charAt(0)}
                        </div>
                        <div>
                          <p className="font-black">{order.customer}</p>
                          <p className="text-xs text-muted-foreground font-medium">{order.phone}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-8 py-6">
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2 text-sm font-bold">
                          <User className="w-4 h-4 text-muted-foreground" />
                          {agents.find(a => a.id === order.agentId)?.name || "Unassigned"}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground font-medium">
                          <MapPin className="w-3 h-3" />
                          {order.location || "Lagos"}
                        </div>
                      </div>
                    </td>
                    <td className="px-8 py-6">
                      <span className={cn(
                        "px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider border",
                        statusBadgeClasses(order.status || "New")
                      )}>
                        {order.status}
                      </span>
                    </td>
                    <td className="px-8 py-6 text-right">
                      <p className="font-black text-lg tracking-tight">
                        {formatProductMoney(order.amount, order.currency)}
                      </p>
                      <p className="text-[10px] text-muted-foreground font-bold uppercase">
                        {new Date(order.deliveredDate || order.date).toLocaleDateString()}
                      </p>
                    </td>
                    <td className="px-8 py-6 text-right">
                      <button 
                        onClick={() => { setSelectedOrderId(order.id); setModal("orderDetails"); }}
                        className="p-2.5 rounded-xl border border-black/5 hover:bg-primary hover:text-primary-foreground hover:border-primary transition-all shadow-sm active:scale-95"
                      >
                        <Eye className="w-5 h-5" />
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="px-8 py-20 text-center">
                    <div className="flex flex-col items-center justify-center space-y-4">
                      <div className="w-20 h-20 rounded-[2rem] bg-black/5 flex items-center justify-center text-muted-foreground border border-black/5">
                        <Search className="w-10 h-10 opacity-20" />
                      </div>
                      <div className="space-y-1">
                        <p className="text-xl font-black">No deliveries found</p>
                        <p className="text-muted-foreground font-medium">Try adjusting your filters or date range</p>
                      </div>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        
        {filteredDeliveryRows.length > 0 && (
          <div className="p-8 bg-black/[0.02] border-t border-black/5 flex items-center justify-between">
            <p className="text-sm font-bold text-muted-foreground">
              Showing <span className="text-foreground">{filteredDeliveryRows.length}</span> delivered orders
            </p>
            <div className="flex items-center gap-2">
              <button className="px-6 py-2.5 rounded-xl bg-white border border-black/5 font-black text-sm hover:bg-black/5 transition-colors shadow-sm active:scale-95">
                Export CSV
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
