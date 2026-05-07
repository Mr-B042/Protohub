import React, { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Truck, 
  Plus, 
  Search, 
  Filter, 
  MapPin, 
  PackageCheck, 
  AlertTriangle, 
  CheckCircle2, 
  Download, 
  UserRound, 
  CircleX, 
  Eye, 
  PackagePlus, 
  RefreshCw, 
  Pencil, 
  Trash2,
  TrendingUp,
  BarChart3,
  ShieldCheck,
  ShieldAlert,
  ChevronRight,
  LayoutGrid
} from 'lucide-react';
import { 
  DeliveryAgentRecord, 
  AgentZone, 
  AgentStatus, 
  CurrencyCode, 
  ModalType,
  ActivePage
} from '../types';

interface AgentRow {
  agent: DeliveryAgentRecord;
  status: string;
  successRate: number;
  deliveries: number;
  pending: number;
  stockValue: number;
  defectiveValue: number;
  missingValue: number;
}

interface AgentsProps {
  agents: DeliveryAgentRecord[];
  filteredAgentRows: AgentRow[];
  totalAgentStockValue: number;
  pendingAgentDeliveries: number;
  totalAgentDefectiveValue: number;
  totalAgentMissingValue: number;
  agentSearch: string;
  setAgentSearch: (search: string) => void;
  agentZone: AgentZone;
  setAgentZone: (zone: AgentZone) => void;
  agentZoneOptions: readonly AgentZone[];
  agentStatus: AgentStatus;
  setAgentStatus: (status: AgentStatus) => void;
  agentStatuses: readonly AgentStatus[];
  currency: CurrencyCode;
  setCurrency: (currency: CurrencyCode) => void;
  currencies: Record<CurrencyCode, { label: string; locale: string; currency: string }>;
  selectedCurrency: { label: string; locale: string; currency: string };
  formatMoney: (amount: number) => string;
  setModal: (modal: ModalType) => void;
  openAgentModal: (agent: DeliveryAgentRecord, modal: ModalType) => void;
  userInitials: (name: string) => string;
  slugify: (text: string) => string;
  showToast: (msg: string) => void;
  exportAgentsCsv: () => void;
}

export const Agents: React.FC<AgentsProps> = ({
  agents,
  filteredAgentRows,
  totalAgentStockValue,
  pendingAgentDeliveries,
  totalAgentDefectiveValue,
  totalAgentMissingValue,
  agentSearch,
  setAgentSearch,
  agentZone,
  setAgentZone,
  agentZoneOptions,
  agentStatus,
  setAgentStatus,
  agentStatuses,
  currency,
  setCurrency,
  currencies,
  selectedCurrency,
  formatMoney,
  setModal,
  openAgentModal,
  userInitials,
  slugify,
  showToast,
  exportAgentsCsv
}) => {
  const stats = [
    { title: "Total Agents", value: agents.length, icon: UserRound, color: "text-blue-500", bg: "bg-blue-500/10" },
    { title: "Active Duty", value: agents.filter(a => a.active).length, icon: CheckCircle2, color: "text-emerald-500", bg: "bg-emerald-500/10" },
    { title: "Field Stock", value: formatMoney(totalAgentStockValue), icon: PackageCheck, color: "text-orange-500", bg: "bg-orange-500/10" },
    { title: "Pending", value: pendingAgentDeliveries, icon: Truck, color: "text-indigo-500", bg: "bg-indigo-500/10" },
    { title: "Defective Value", value: formatMoney(totalAgentDefectiveValue), icon: CircleX, color: "text-rose-500", bg: "bg-rose-500/10", warning: true },
    { title: "Missing Value", value: formatMoney(totalAgentMissingValue), icon: AlertTriangle, color: "text-amber-500", bg: "bg-amber-500/10", warning: true },
  ];

  return (
    <div className="space-y-8 pb-12">
      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="space-y-1">
          <h1 className="text-4xl font-black tracking-tight bg-gradient-to-r from-gray-900 to-gray-600 bg-clip-text text-transparent">
            Logistics Network
          </h1>
          <p className="text-muted-foreground font-medium">
            Manage delivery agents, regional stock, and fulfillment performance.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button 
            onClick={exportAgentsCsv}
            className="flex items-center gap-2 px-6 py-3 bg-white border border-gray-100 text-gray-900 rounded-2xl text-sm font-black shadow-sm hover:shadow-xl hover:border-primary/20 transition-all active:scale-95"
          >
            <Download className="w-4 h-4 text-primary" />
            EXPORT CSV
          </button>
          <button 
            onClick={() => setModal("addAgent")}
            className="flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-2xl text-sm font-black shadow-lg shadow-primary/20 hover:scale-105 active:scale-95 transition-all"
          >
            <Plus className="w-4 h-4" />
            ADD AGENT
          </button>
        </div>
      </header>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <select 
            className="px-4 py-2.5 bg-white/50 backdrop-blur-xl border border-white/40 rounded-xl text-xs font-bold focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all shadow-sm"
            value={currency} 
            onChange={(e) => {
              const next = e.target.value as CurrencyCode;
              setCurrency(next);
              showToast(`Currency changed to ${currencies[next].label}.`);
            }}
          >
            {Object.keys(currencies).map(c => (
              <option key={c} value={c}>{currencies[c as CurrencyCode].label}</option>
            ))}
          </select>
          <span className="text-[10px] font-black text-muted-foreground uppercase tracking-widest px-4 py-2.5 bg-gray-50 rounded-xl border border-gray-100">
            Base: {selectedCurrency.label}
          </span>
        </div>

        <div className="flex items-center gap-3 flex-1 max-w-2xl">
          <div className="relative flex-1 group">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground transition-colors group-focus-within:text-primary" />
            <input 
              type="text" 
              value={agentSearch}
              onChange={(e) => setAgentSearch(e.target.value)}
              placeholder="Search name, phone..."
              className="w-full pl-11 pr-4 py-2.5 bg-white border border-gray-100 rounded-2xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all shadow-sm"
            />
          </div>
          <select 
            className="px-4 py-2.5 bg-white border border-gray-100 rounded-2xl text-xs font-bold focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all shadow-sm"
            value={agentZone} 
            onChange={(e) => setAgentZone(e.target.value as AgentZone)}
          >
            {agentZoneOptions.map(z => <option key={z} value={z}>{z}</option>)}
          </select>
          <select 
            className="px-4 py-2.5 bg-white border border-gray-100 rounded-2xl text-xs font-bold focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all shadow-sm"
            value={agentStatus} 
            onChange={(e) => setAgentStatus(e.target.value as AgentStatus)}
          >
            {agentStatuses.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-6">
        {stats.map((stat, idx) => (
          <motion.div
            key={stat.title}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.05 }}
            className={`group p-6 bg-white/40 backdrop-blur-xl border border-white/40 rounded-[2.5rem] shadow-sm hover:shadow-xl hover:shadow-primary/5 transition-all ${
              stat.warning ? 'hover:border-rose-200' : ''
            }`}
          >
            <div className="flex items-center justify-between mb-4">
              <div className={`p-3 rounded-2xl ${stat.bg} ${stat.color} transition-transform group-hover:scale-110 duration-500`}>
                <stat.icon className="w-5 h-5" />
              </div>
            </div>
            <div className="space-y-1">
              <h3 className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">{stat.title}</h3>
              <span className={`text-xl font-black tracking-tight ${stat.warning ? 'text-rose-600' : 'text-gray-900'}`}>
                {stat.value}
              </span>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Agent Performance Table */}
      <section className="bg-white/40 backdrop-blur-xl border border-white/40 rounded-[2.5rem] shadow-sm overflow-hidden">
        <div className="px-8 py-6 border-b border-white/40 flex items-center justify-between bg-white/20">
          <h2 className="text-xl font-black text-gray-900 flex items-center gap-3">
            <LayoutGrid className="w-5 h-5 text-primary" />
            Network Performance
          </h2>
          <span className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.2em]">
            {filteredAgentRows.length} Agents Active
          </span>
        </div>

        <div className="overflow-x-auto overflow-y-visible">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50/50">
                <th className="px-8 py-4 text-xs font-black text-muted-foreground uppercase tracking-widest">Agent Identity</th>
                <th className="px-8 py-4 text-xs font-black text-muted-foreground uppercase tracking-widest">Zone / Status</th>
                <th className="px-8 py-4 text-xs font-black text-muted-foreground uppercase tracking-widest">Delivery Performance</th>
                <th className="px-8 py-4 text-xs font-black text-muted-foreground uppercase tracking-widest">Field Inventory</th>
                <th className="px-8 py-4 text-xs font-black text-muted-foreground uppercase tracking-widest text-right">Operations</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/40">
              <AnimatePresence mode="popLayout">
                {filteredAgentRows.length === 0 ? (
                  <motion.tr
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                  >
                    <td colSpan={5} className="px-8 py-20 text-center">
                      <div className="flex flex-col items-center gap-4 opacity-50">
                        <Truck className="w-12 h-12 text-muted-foreground" />
                        <p className="text-sm font-bold text-muted-foreground italic max-w-xs mx-auto">
                          No logistics agents found in this selection.
                        </p>
                      </div>
                    </td>
                  </motion.tr>
                ) : (
                  filteredAgentRows.map((row, idx) => (
                    <motion.tr
                      key={row.agent.id}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 20 }}
                      transition={{ delay: idx * 0.02 }}
                      className="group hover:bg-white/60 transition-all duration-300"
                    >
                      <td className="px-8 py-5">
                        <div className="flex items-center gap-4">
                          <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center text-sm font-black text-primary shadow-inner group-hover:scale-105 transition-transform">
                            {userInitials(row.agent.name)}
                          </div>
                          <div className="space-y-1">
                            <div className="font-bold text-gray-900 group-hover:text-primary transition-colors">
                              {row.agent.name}
                            </div>
                            <div className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">
                              {row.agent.phone}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-8 py-5">
                        <div className="space-y-2">
                          <div className="flex items-center gap-1.5 text-xs font-bold text-gray-700">
                            <MapPin className="w-3.5 h-3.5 text-primary" />
                            {row.agent.zone}
                          </div>
                          <span className={`px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-widest border ${
                            row.status === 'Active' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-gray-50 text-gray-500 border-gray-200'
                          }`}>
                            {row.status}
                          </span>
                        </div>
                      </td>
                      <td className="px-8 py-5">
                        <div className="space-y-2">
                          <div className="flex items-center justify-between text-[10px] font-black text-muted-foreground uppercase tracking-widest">
                            <span>Success Rate</span>
                            <span className={row.successRate >= 80 ? 'text-emerald-600' : 'text-amber-600'}>{row.successRate}%</span>
                          </div>
                          <div className="w-32 h-1.5 bg-gray-100 rounded-full overflow-hidden border border-gray-200/50">
                            <motion.div 
                              initial={{ width: 0 }}
                              animate={{ width: `${row.successRate}%` }}
                              className={`h-full rounded-full ${
                                row.successRate >= 80 ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]' : 
                                row.successRate >= 50 ? 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.4)]' : 
                                'bg-rose-500'
                              }`}
                            />
                          </div>
                          <div className="text-[9px] font-black text-muted-foreground uppercase tracking-[0.1em]">
                            {row.deliveries} Delivered · {row.pending} Pending
                          </div>
                        </div>
                      </td>
                      <td className="px-8 py-5">
                        <div className="space-y-1.5">
                          <div className="text-sm font-black text-gray-900">{formatMoney(row.stockValue)}</div>
                          <div className="flex flex-col gap-0.5">
                            <div className="text-[9px] font-black text-rose-500 uppercase tracking-widest flex items-center gap-1">
                              <ShieldAlert className="w-2.5 h-2.5" />
                              Defective: {formatMoney(row.defectiveValue)}
                            </div>
                            <div className="text-[9px] font-black text-amber-500 uppercase tracking-widest flex items-center gap-1">
                              <AlertTriangle className="w-2.5 h-2.5" />
                              Missing: {formatMoney(row.missingValue)}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-8 py-5 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {[
                            { icon: Eye, title: "Profile", action: () => openAgentModal(row.agent, "agentDetails") },
                            { icon: PackagePlus, title: "Assign Stock", action: () => openAgentModal(row.agent, "assignAgentStock") },
                            { icon: RefreshCw, title: "Reconcile", action: () => openAgentModal(row.agent, "reconcileAgentStock") },
                            { icon: Pencil, title: "Edit", action: () => openAgentModal(row.agent, "editAgent") },
                          ].map((btn, bidx) => (
                            <button
                              key={bidx}
                              onClick={btn.action}
                              title={btn.title}
                              className="p-2.5 rounded-xl bg-white border border-gray-100 text-gray-400 hover:text-primary hover:border-primary/20 hover:shadow-lg hover:scale-110 transition-all active:scale-95"
                            >
                              <btn.icon className="w-4 h-4" />
                            </button>
                          ))}
                          <button
                            onClick={() => openAgentModal(row.agent, "deleteAgent")}
                            title="Delete"
                            className="p-2.5 rounded-xl bg-white border border-rose-100 text-rose-400 hover:bg-rose-50 hover:border-rose-200 hover:text-rose-600 hover:scale-110 transition-all active:scale-95"
                          >
                            <Trash2 className="w-4 h-4" />
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
