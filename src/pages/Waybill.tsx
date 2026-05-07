import React, { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Truck, 
  Plus, 
  Filter, 
  Search, 
  ArrowRight, 
  Clock, 
  CheckCircle2, 
  XCircle, 
  Printer, 
  Edit3, 
  RotateCcw,
  Navigation,
  Package,
  CreditCard,
  History,
  LayoutGrid,
  ChevronRight,
  TrendingUp,
  MapPin,
  FileText
} from 'lucide-react';
import { 
  WaybillRecord, 
  WaybillStatus, 
  Product, 
  ActivePage
} from '../types';

interface WaybillProps {
  waybillRecords: WaybillRecord[];
  waybillStatusFilter: WaybillStatus | "All";
  setWaybillStatusFilter: (status: WaybillStatus | "All") => void;
  waybillProductFilter: string;
  setWaybillProductFilter: (productId: string) => void;
  products: Product[];
  openCreateWaybill: () => void;
  markWaybillReceived: (id: string) => void;
  cancelWaybill: (id: string) => void;
  openEditWaybill: (w: WaybillRecord) => void;
  printWaybill: (w: WaybillRecord) => void;
  formatMoney: (amount: number) => string;
}

export const Waybill: React.FC<WaybillProps> = ({
  waybillRecords,
  waybillStatusFilter,
  setWaybillStatusFilter,
  waybillProductFilter,
  setWaybillProductFilter,
  products,
  openCreateWaybill,
  markWaybillReceived,
  cancelWaybill,
  openEditWaybill,
  printWaybill,
  formatMoney
}) => {
  const filteredWaybills = useMemo(() => {
    return waybillRecords.filter((w) =>
      (waybillStatusFilter === "All" || w.status === waybillStatusFilter) &&
      (!waybillProductFilter || w.productId === waybillProductFilter)
    );
  }, [waybillRecords, waybillStatusFilter, waybillProductFilter]);

  const stats = useMemo(() => {
    const inTransit = waybillRecords.filter((w) => w.status === "In Transit");
    const received = waybillRecords.filter((w) => w.status === "Received");
    const totalFees = waybillRecords.filter((w) => w.status !== "Cancelled").reduce((s, w) => s + w.waybillFee, 0);
    const inTransitUnits = inTransit.reduce((s, w) => s + w.quantity, 0);

    return [
      { label: "In Transit", value: inTransit.length, sub: `${inTransitUnits} units`, icon: Navigation, color: "text-blue-500", bg: "bg-blue-500/10" },
      { label: "Received", value: received.length, sub: `${received.reduce((s,w)=>s+w.quantity,0)} units`, icon: CheckCircle2, color: "text-emerald-500", bg: "bg-emerald-500/10" },
      { label: "Transfer Fees", value: formatMoney(totalFees), sub: "Total network spend", icon: CreditCard, color: "text-purple-500", bg: "bg-purple-500/10" },
      { label: "Total Transfers", value: waybillRecords.length, sub: "All time records", icon: History, color: "text-amber-500", bg: "bg-amber-500/10" },
    ];
  }, [waybillRecords, formatMoney]);

  const statusColors: Record<WaybillStatus, string> = {
    "In Transit": "bg-blue-50 text-blue-600 border-blue-100",
    "Received": "bg-emerald-50 text-emerald-600 border-emerald-100",
    "Returned": "bg-amber-50 text-amber-600 border-amber-100",
    "Cancelled": "bg-rose-50 text-rose-600 border-rose-100",
    "Defective": "bg-orange-50 text-orange-600 border-orange-100",
    "Missing": "bg-red-50 text-red-600 border-red-100",
  };

  return (
    <div className="space-y-8 pb-12">
      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="space-y-1">
          <h1 className="text-4xl font-black tracking-tight bg-gradient-to-r from-gray-900 to-gray-600 bg-clip-text text-transparent">
            Waybill Management
          </h1>
          <p className="text-muted-foreground font-medium">
            Track inter-state stock transfers and regional distribution logs.
          </p>
        </div>

        <button 
          onClick={openCreateWaybill}
          className="flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-2xl text-sm font-black shadow-lg shadow-primary/20 hover:scale-105 active:scale-95 transition-all"
        >
          <Plus className="w-4 h-4" />
          NEW WAYBILL
        </button>
      </header>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map((stat, idx) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.1 }}
            className="group p-6 bg-white/40 backdrop-blur-xl border border-white/40 rounded-[2.5rem] shadow-sm hover:shadow-xl hover:shadow-primary/5 transition-all"
          >
            <div className="flex items-center justify-between mb-4">
              <div className={`p-3 rounded-2xl ${stat.bg} ${stat.color} transition-transform group-hover:scale-110 duration-500`}>
                <stat.icon className="w-6 h-6" />
              </div>
            </div>
            <div className="space-y-1">
              <h3 className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">{stat.label}</h3>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-black tracking-tight text-gray-900">{stat.value}</span>
              </div>
              <p className="text-[10px] font-bold text-muted-foreground italic uppercase tracking-wider">{stat.sub}</p>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative group">
            <Filter className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
            <select 
              className="pl-11 pr-4 py-2.5 bg-white border border-gray-100 rounded-2xl text-xs font-bold focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all shadow-sm appearance-none"
              value={waybillStatusFilter} 
              onChange={(e) => setWaybillStatusFilter(e.target.value as WaybillStatus | "All")}
            >
              <option value="All">All Statuses</option>
              <option value="In Transit">In Transit</option>
              <option value="Received">Received</option>
              <option value="Returned">Returned</option>
              <option value="Cancelled">Cancelled</option>
              <option value="Defective">Defective</option>
              <option value="Missing">Missing</option>
            </select>
          </div>

          <div className="relative group">
            <Package className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
            <select 
              className="pl-11 pr-4 py-2.5 bg-white border border-gray-100 rounded-2xl text-xs font-bold focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all shadow-sm appearance-none min-w-[180px]"
              value={waybillProductFilter} 
              onChange={(e) => setWaybillProductFilter(e.target.value)}
            >
              <option value="">All Products</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Waybills Table */}
      <section className="bg-white/40 backdrop-blur-xl border border-white/40 rounded-[2.5rem] shadow-sm overflow-hidden">
        <div className="px-8 py-6 border-b border-white/40 flex items-center justify-between bg-white/20">
          <h2 className="text-xl font-black text-gray-900 flex items-center gap-3">
            <LayoutGrid className="w-5 h-5 text-primary" />
            Transfer Ledger
          </h2>
          <span className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.2em]">
            {filteredWaybills.length} Records Found
          </span>
        </div>

        <div className="overflow-x-auto overflow-y-visible">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50/50">
                <th className="px-8 py-4 text-xs font-black text-muted-foreground uppercase tracking-widest">Entity & Route</th>
                <th className="px-8 py-4 text-xs font-black text-muted-foreground uppercase tracking-widest">Quantity</th>
                <th className="px-8 py-4 text-xs font-black text-muted-foreground uppercase tracking-widest">Logistics Details</th>
                <th className="px-8 py-4 text-xs font-black text-muted-foreground uppercase tracking-widest">Fee / Status</th>
                <th className="px-8 py-4 text-xs font-black text-muted-foreground uppercase tracking-widest text-right">Operations</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/40">
              <AnimatePresence mode="popLayout">
                {filteredWaybills.length === 0 ? (
                  <motion.tr
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                  >
                    <td colSpan={5} className="px-8 py-20 text-center">
                      <div className="flex flex-col items-center gap-4 opacity-50">
                        <FileText className="w-12 h-12 text-muted-foreground" />
                        <p className="text-sm font-bold text-muted-foreground italic max-w-xs mx-auto">
                          No waybill records matched your current filters.
                        </p>
                      </div>
                    </td>
                  </motion.tr>
                ) : (
                  filteredWaybills.map((w, idx) => (
                    <motion.tr
                      key={w.id}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 20 }}
                      transition={{ delay: idx * 0.02 }}
                      className="group hover:bg-white/60 transition-all duration-300"
                    >
                      <td className="px-8 py-5">
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-black text-muted-foreground font-mono bg-gray-50 px-1.5 py-0.5 rounded border border-gray-100 uppercase tracking-tighter">
                              {w.id.slice(-8)}
                            </span>
                            <div className="font-bold text-gray-900 group-hover:text-primary transition-colors">
                              {w.productName}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                            <MapPin className="w-3 h-3" />
                            <span>{w.sendingState}</span>
                            <ArrowRight className="w-2.5 h-2.5 text-primary" />
                            <span className="text-gray-900">{w.receivingState}</span>
                          </div>
                        </div>
                      </td>
                      <td className="px-8 py-5">
                        <div className="flex flex-col">
                          <span className="text-sm font-black text-gray-900">{w.quantity} Units</span>
                          <span className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">{w.dateSent}</span>
                        </div>
                      </td>
                      <td className="px-8 py-5">
                        <div className="space-y-1">
                          <div className="text-xs font-bold text-gray-700 uppercase tracking-wide">
                            {w.logisticsPartner}
                          </div>
                          <div className="flex items-center gap-1.5 text-[9px] font-black text-muted-foreground uppercase tracking-widest">
                            <Clock className="w-2.5 h-2.5" />
                            {w.status === "In Transit" ? "Awaiting Arrival" : `Arrived ${w.dateReceived ?? ''}`}
                          </div>
                        </div>
                      </td>
                      <td className="px-8 py-5">
                        <div className="space-y-2">
                          <span className={`px-2 py-1 rounded-md text-[9px] font-black uppercase tracking-widest border ${statusColors[w.status]}`}>
                            {w.status}
                          </span>
                          <div className="text-sm font-black text-primary">
                            {w.waybillFee > 0 ? formatMoney(w.waybillFee) : "FREE"}
                          </div>
                        </div>
                      </td>
                      <td className="px-8 py-5 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {w.status === "In Transit" && (
                            <>
                              <button 
                                onClick={() => markWaybillReceived(w.id)}
                                title="Mark Received"
                                className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-100 text-emerald-600 hover:bg-emerald-600 hover:text-white hover:shadow-lg transition-all active:scale-95 group/btn"
                              >
                                <CheckCircle2 className="w-4 h-4" />
                              </button>
                              <button 
                                onClick={() => cancelWaybill(w.id)}
                                title="Cancel"
                                className="p-2.5 rounded-xl bg-rose-50 border border-rose-100 text-rose-600 hover:bg-rose-600 hover:text-white hover:shadow-lg transition-all active:scale-95 group/btn"
                              >
                                <XCircle className="w-4 h-4" />
                              </button>
                            </>
                          )}
                          <button 
                            onClick={() => openEditWaybill(w)}
                            title="Edit"
                            className="p-2.5 rounded-xl bg-white border border-gray-100 text-gray-400 hover:text-primary hover:border-primary/20 hover:shadow-lg transition-all active:scale-95"
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>
                          <button 
                            onClick={() => printWaybill(w)}
                            title="Print"
                            className="p-2.5 rounded-xl bg-white border border-gray-100 text-gray-400 hover:text-gray-900 hover:border-gray-300 hover:shadow-lg transition-all active:scale-95"
                          >
                            <Printer className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </motion.tr>
                  ))
                )}
              </AnimatePresence>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
