import React, { useMemo, useState } from "react";
import { 
  Download, 
  Plus, 
  Search, 
  Filter, 
  MoreHorizontal, 
  Eye, 
  Pencil, 
  Trash2, 
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  CircleDollarSign,
  Package,
  Clock,
  CheckCircle2,
  XCircle,
  Truck,
  BookOpen
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  TrackedOrder, 
  Period, 
  CurrencyCode, 
  DateRange, 
  OrderStatus, 
  OrderSource, 
  OrderLocation,
  ManagedUser,
  ActivePage,
  ModalType,
  ProductCurrencyCode
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

interface OrdersProps {
  trackedOrders: TrackedOrder[];
  users: ManagedUser[];
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
  exportOrdersCsv: () => void;
  openCreateOrderModal: () => void;
}

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.05
    }
  }
};

const item = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0 }
};

export const Orders: React.FC<OrdersProps> = ({
  trackedOrders,
  users,
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
  exportOrdersCsv,
  openCreateOrderModal
}) => {
  const [orderSearch, setOrderSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<OrderStatus>("All Orders");
  const [sourceFilter, setSourceFilter] = useState<OrderSource>("All Sources");
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;

  // Filter logic
  const filteredOrders = useMemo(() => {
    return trackedOrders.filter(order => {
      const matchesSearch = 
        order.id.toLowerCase().includes(orderSearch.toLowerCase()) ||
        order.customer.toLowerCase().includes(orderSearch.toLowerCase()) ||
        order.phone.includes(orderSearch);
      
      const matchesStatus = statusFilter === "All Orders" || order.status === statusFilter;
      const matchesSource = sourceFilter === "All Sources" || order.source === sourceFilter;
      const matchesPeriod = isInPeriod(order.createdAt || order.date, period, dateRange);

      return matchesSearch && matchesStatus && matchesSource && matchesPeriod;
    });
  }, [trackedOrders, orderSearch, statusFilter, sourceFilter, period, dateRange]);

  const pagedOrders = filteredOrders.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const totalPages = Math.ceil(filteredOrders.length / pageSize);

  // Stats for the current filtered period
  const totalRevenue = filteredOrders
    .filter(o => o.status === "Delivered")
    .reduce((sum, o) => sum + (o.currency === currency ? o.amount : 0), 0);
  
  const deliveryRate = filteredOrders.length === 0 
    ? 0 
    : Math.round((filteredOrders.filter(o => o.status === "Delivered").length / filteredOrders.length) * 100);

  const stats = [
    { label: "Total Orders", value: filteredOrders.length, icon: Package, color: "text-blue-500", bg: "bg-blue-500/10" },
    { label: "Revenue", value: formatMoney(totalRevenue, currency, currencies), icon: CircleDollarSign, color: "text-emerald-500", bg: "bg-emerald-500/10" },
    { label: "Delivery Rate", value: `${deliveryRate}%`, icon: TrendingUp, color: "text-purple-500", bg: "bg-purple-500/10" },
    { label: "Pending", value: filteredOrders.filter(o => o.status === "In Process" || o.status === "Confirmed").length, icon: Clock, color: "text-orange-500", bg: "bg-orange-500/10" },
  ];

  return (
    <motion.div 
      variants={container}
      initial="hidden"
      animate="show"
      className="space-y-8"
    >
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Orders Management</h1>
          <p className="text-muted-foreground mt-1 font-medium">
            Manage, track and fulfill customer orders in real-time.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={exportOrdersCsv}
            className="flex items-center gap-2 px-5 py-2.5 bg-black/5 text-foreground rounded-2xl font-bold hover:bg-black/10 transition-all"
          >
            <Download className="w-5 h-5" />
            Export CSV
          </button>
          <button 
            onClick={openCreateOrderModal}
            className="flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground rounded-2xl font-bold shadow-lg shadow-primary/20 hover:scale-105 active:scale-95 transition-all"
          >
            <Plus className="w-5 h-5" />
            Create Order
          </button>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => (
          <motion.div 
            key={stat.label}
            variants={item}
            className="glass rounded-3xl p-5 border-white/40 shadow-sm"
          >
            <div className="flex items-center gap-4">
              <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center", stat.bg)}>
                <stat.icon className={cn("w-5 h-5", stat.color)} />
              </div>
              <div>
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">{stat.label}</p>
                <p className="text-xl font-black">{stat.value}</p>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Filters Toolbar */}
      <div className="glass rounded-[2.5rem] p-4 border-white/40 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[300px]">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input 
              type="text"
              placeholder="Search by ID, customer name or phone..."
              value={orderSearch}
              onChange={(e) => setOrderSearch(e.target.value)}
              className="w-full pl-11 pr-4 py-2.5 bg-black/5 border-none rounded-2xl text-sm font-medium focus:ring-2 focus:ring-primary/20 transition-all outline-none"
            />
          </div>
          
          <div className="flex items-center gap-2">
            <select 
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as OrderStatus)}
              className="bg-black/5 border-none rounded-2xl px-4 py-2.5 text-sm font-bold focus:ring-2 focus:ring-primary/20 outline-none cursor-pointer"
            >
              <option value="All Orders">All Statuses</option>
              {["New", "Confirmed", "In Process", "Dispatched", "Delivered", "Cancelled", "Postponed", "Failed"].map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>

            <select 
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value as OrderSource)}
              className="bg-black/5 border-none rounded-2xl px-4 py-2.5 text-sm font-bold focus:ring-2 focus:ring-primary/20 outline-none cursor-pointer"
            >
              <option value="All Sources">All Sources</option>
              {["TikTok", "Facebook", "Instagram", "WhatsApp", "Website"].map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-black/5 pt-4">
          <div className="flex items-center gap-2">
            <CalendarDays className="w-4 h-4 text-muted-foreground" />
            <div className="flex items-center gap-1">
              {["Today", "This Week", "This Month", "This Year"].map((p) => (
                <button
                  key={p}
                  onClick={() => setPeriod(p as Period)}
                  className={cn(
                    "px-3 py-1.5 rounded-xl text-xs font-bold transition-all",
                    period === p ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-black/5"
                  )}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
          
          <p className="text-xs font-bold text-muted-foreground">
            Showing {filteredOrders.length} orders
          </p>
        </div>
      </div>

      {/* Orders Table */}
      <div className="glass rounded-[2.5rem] border-white/40 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-[10px] font-black uppercase tracking-widest text-muted-foreground border-b border-black/5">
                <th className="px-8 py-5">Order Details</th>
                <th className="px-8 py-5">Customer</th>
                <th className="px-8 py-5">Product & Package</th>
                <th className="px-8 py-5">Source</th>
                <th className="px-8 py-5">Status</th>
                <th className="px-8 py-5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5">
              <AnimatePresence mode="popLayout">
                {pagedOrders.map((order) => (
                  <motion.tr 
                    layout
                    key={order.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="group hover:bg-black/[0.01] transition-colors"
                  >
                    <td className="px-8 py-5">
                      <div className="flex flex-col">
                        <span className="font-black text-primary text-xs tracking-tighter">#{order.id.slice(0, 12)}</span>
                        <span className="text-[10px] font-bold text-muted-foreground">{displayDateFromKey(order.createdAt || order.date)}</span>
                      </div>
                    </td>
                    <td className="px-8 py-5">
                      <div className="flex flex-col">
                        <span className="font-bold text-sm">{order.customer}</span>
                        <span className="text-xs text-muted-foreground font-medium">{order.phone}</span>
                      </div>
                    </td>
                    <td className="px-8 py-5">
                      <div className="flex flex-col">
                        <span className="font-bold text-sm truncate max-w-[200px]">{order.productName}</span>
                        <span className="text-[10px] text-muted-foreground font-bold uppercase">{order.packageName} · {formatProductMoney(order.amount, order.currency, productCurrencies)}</span>
                      </div>
                    </td>
                    <td className="px-8 py-5">
                      <span className="px-2.5 py-1 bg-black/5 rounded-lg text-[10px] font-black uppercase tracking-tight text-muted-foreground">
                        {order.source || "Website"}
                      </span>
                    </td>
                    <td className="px-8 py-5">
                      <span className={cn(
                        "px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider",
                        statusBadgeClasses(order.status || "New")
                      )}>
                        {order.status || "New"}
                      </span>
                    </td>
                    <td className="px-8 py-5 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button 
                          onClick={() => { setSelectedOrderId(order.id); setModal("orderDetails"); }}
                          className="p-2 rounded-xl hover:bg-primary/10 text-primary transition-colors"
                        >
                          <Eye className="w-5 h-5" />
                        </button>
                        <button className="p-2 rounded-xl hover:bg-black/5 text-muted-foreground hover:text-foreground transition-colors">
                          <MoreHorizontal className="w-5 h-5" />
                        </button>
                      </div>
                    </td>
                  </motion.tr>
                ))}
              </AnimatePresence>
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-8 py-5 bg-black/[0.01] border-t border-black/5 flex items-center justify-between">
            <button 
              disabled={currentPage === 1}
              onClick={() => setCurrentPage(prev => prev - 1)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-xs hover:bg-black/5 disabled:opacity-30 disabled:pointer-events-none transition-all"
            >
              <ChevronLeft className="w-4 h-4" /> Previous
            </button>
            <div className="flex items-center gap-2">
              {Array.from({ length: totalPages }).map((_, i) => (
                <button
                  key={i}
                  onClick={() => setCurrentPage(i + 1)}
                  className={cn(
                    "w-8 h-8 rounded-lg text-xs font-black transition-all",
                    currentPage === i + 1 ? "bg-primary text-primary-foreground shadow-sm" : "hover:bg-black/5 text-muted-foreground"
                  )}
                >
                  {i + 1}
                </button>
              ))}
            </div>
            <button 
              disabled={currentPage === totalPages}
              onClick={() => setCurrentPage(prev => prev + 1)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-xs hover:bg-black/5 disabled:opacity-30 disabled:pointer-events-none transition-all"
            >
              Next <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </motion.div>
  );
};
