import React, { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Users, 
  Plus, 
  Search, 
  Filter, 
  Calendar, 
  TrendingUp, 
  BarChart3, 
  Target, 
  Award,
  ChevronRight,
  Phone,
  Mail,
  UserCheck,
  UserX,
  CreditCard,
  LayoutGrid,
  Zap,
  Star,
  Trophy
} from 'lucide-react';
import { 
  ManagedUser, 
  Period, 
  DateRange, 
  CurrencyCode, 
  RepStatus, 
  ModalType,
  ActivePage
} from '../types';

interface SalesRepRow {
  user: ManagedUser;
  orders: number;
  delivered: number;
  conversion: number;
  revenue: number;
}

interface SalesRepsProps {
  salesRepRows: SalesRepRow[];
  filteredSalesRepRows: SalesRepRow[];
  salesPeriod: Period;
  periods: readonly Period[];
  handleSalesPeriodChange: (period: Period) => void;
  salesDateRange: DateRange;
  setSalesDateRange: React.Dispatch<React.SetStateAction<DateRange>>;
  showSalesDateRange: boolean;
  setShowSalesDateRange: (show: boolean | ((prev: boolean) => boolean)) => void;
  applySalesDateRange: () => void;
  salesStatus: RepStatus;
  setSalesStatus: (status: RepStatus) => void;
  repStatuses: readonly RepStatus[];
  currency: CurrencyCode;
  setCurrency: (currency: CurrencyCode) => void;
  currencies: Record<CurrencyCode, { label: string; locale: string; currency: string }>;
  formatMoney: (amount: number) => string;
  setModal: (modal: ModalType) => void;
  setSelectedSalesRepId: (id: string) => void;
  showToast: (msg: string) => void;
  renderDateRangeCalendar: (id: string, range: DateRange, setRange: React.Dispatch<React.SetStateAction<DateRange>>, apply: () => void, close: () => void) => React.ReactNode;
}

export const SalesReps: React.FC<SalesRepsProps> = ({
  salesRepRows,
  filteredSalesRepRows,
  salesPeriod,
  periods,
  handleSalesPeriodChange,
  salesDateRange,
  setSalesDateRange,
  showSalesDateRange,
  setShowSalesDateRange,
  applySalesDateRange,
  salesStatus,
  setSalesStatus,
  repStatuses,
  currency,
  setCurrency,
  currencies,
  formatMoney,
  setModal,
  setSelectedSalesRepId,
  showToast,
  renderDateRangeCalendar
}) => {
  const topPerformer = useMemo(() => {
    if (filteredSalesRepRows.length === 0) return null;
    const sorted = [...filteredSalesRepRows].sort((a, b) => b.revenue - a.revenue);
    return sorted[0];
  }, [filteredSalesRepRows]);

  const teamStats = useMemo(() => {
    const totalRevenue = filteredSalesRepRows.reduce((sum, row) => sum + row.revenue, 0);
    const totalDelivered = filteredSalesRepRows.reduce((sum, row) => sum + row.delivered, 0);
    const activeCount = filteredSalesRepRows.filter(r => r.user.active).length;

    return [
      { label: 'Active Reps', value: activeCount, icon: UserCheck, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
      { label: 'Team Revenue', value: formatMoney(totalRevenue), icon: TrendingUp, color: 'text-primary', bg: 'bg-primary/10' },
      { label: 'Total Sales', value: totalDelivered, icon: Zap, color: 'text-amber-500', bg: 'bg-amber-500/10' },
      { label: 'Avg Conversion', value: `${filteredSalesRepRows.length ? Math.round(filteredSalesRepRows.reduce((sum, row) => sum + row.conversion, 0) / filteredSalesRepRows.length) : 0}%`, icon: Target, color: 'text-indigo-500', bg: 'bg-indigo-500/10' },
    ];
  }, [filteredSalesRepRows, formatMoney]);

  return (
    <div className="space-y-8 pb-12">
      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="space-y-1">
          <h1 className="text-4xl font-black tracking-tight bg-gradient-to-r from-gray-900 to-gray-600 bg-clip-text text-transparent">
            Sales Force
          </h1>
          <p className="text-muted-foreground font-medium">
            Manage performance and compensation for your representative team.
          </p>
        </div>

        <button 
          onClick={() => setModal("addSalesRep")}
          className="flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-2xl text-sm font-black shadow-lg shadow-primary/20 hover:scale-105 active:scale-95 transition-all"
        >
          <Plus className="w-4 h-4" />
          ADD REPRESENTATIVE
        </button>
      </header>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex bg-white/50 backdrop-blur-xl p-1 border border-white/40 rounded-xl shadow-sm">
            {periods.map((item) => (
              <button 
                key={item}
                onClick={() => handleSalesPeriodChange(item)}
                className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  salesPeriod === item 
                  ? "bg-white text-gray-900 shadow-sm" 
                  : "text-muted-foreground hover:text-gray-900"
                }`}
              >
                {item}
              </button>
            ))}
          </div>

          <div className="relative">
            <button 
              onClick={() => setShowSalesDateRange(prev => !prev)}
              className="flex items-center gap-2 px-4 py-2 bg-white/50 border border-white/40 rounded-xl text-xs font-bold hover:bg-white transition-all shadow-sm"
            >
              <Calendar className="w-3.5 h-3.5 text-primary" />
              {salesPeriod === "Custom" ? "EDIT RANGE" : "DATE RANGE"}
            </button>
            {showSalesDateRange && renderDateRangeCalendar("sales-date-range-panel", salesDateRange, setSalesDateRange, applySalesDateRange, () => setShowSalesDateRange(false))}
          </div>

          <select 
            className="px-4 py-2 bg-white/50 border border-white/40 rounded-xl text-xs font-bold focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all shadow-sm"
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
        </div>

        <div className="flex items-center gap-3">
          <select 
            className="px-4 py-2 bg-white border border-gray-100 rounded-xl text-xs font-bold focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all shadow-sm"
            value={salesStatus} 
            onChange={(e) => setSalesStatus(e.target.value as RepStatus)}
          >
            {repStatuses.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {teamStats.map((stat, idx) => (
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
              <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wider">{stat.label}</h3>
              <span className="text-2xl font-black tracking-tight text-gray-900">{stat.value}</span>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Reps Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8">
        <AnimatePresence mode="popLayout">
          {filteredSalesRepRows.length === 0 ? (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="col-span-full py-20 text-center opacity-50 flex flex-col items-center gap-4"
            >
              <LayoutGrid className="w-16 h-16 text-gray-300" />
              <p className="text-sm font-bold text-muted-foreground italic">No representatives found for this selection.</p>
            </motion.div>
          ) : (
            filteredSalesRepRows.map((row, idx) => {
              const { user, revenue, delivered, conversion } = row;
              const isTop = user.id === topPerformer?.user.id;
              const aov = delivered === 0 ? 0 : Math.round(revenue / delivered);
              
              return (
                <motion.div
                  key={user.id}
                  layout
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ delay: idx * 0.05 }}
                  className={`relative group p-8 bg-white/40 backdrop-blur-xl border border-white/40 rounded-[3rem] shadow-sm hover:shadow-2xl hover:shadow-primary/10 transition-all overflow-hidden ${
                    isTop ? 'ring-2 ring-primary/20' : ''
                  }`}
                >
                  {isTop && (
                    <div className="absolute top-0 right-0 p-6">
                      <div className="p-2 bg-amber-400 text-white rounded-xl shadow-lg shadow-amber-400/20 animate-bounce">
                        <Trophy className="w-5 h-5" />
                      </div>
                    </div>
                  )}

                  <div className="flex items-center gap-6 mb-8">
                    <div className="relative">
                      <div className="w-16 h-16 rounded-3xl bg-gradient-to-br from-primary/10 to-primary/5 flex items-center justify-center text-xl font-black text-primary shadow-inner">
                        {user.name.charAt(0)}
                      </div>
                      <div className={`absolute -bottom-1 -right-1 w-5 h-5 rounded-full border-4 border-white ${
                        user.active ? 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]' : 'bg-gray-300'
                      }`} />
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <h2 className="text-lg font-black text-gray-900 truncate max-w-[150px]">{user.name}</h2>
                      </div>
                      <div className="flex flex-col gap-0.5">
                        <div className="text-[10px] font-black text-muted-foreground uppercase tracking-widest flex items-center gap-1.5">
                          <Mail className="w-3 h-3" />
                          {user.email}
                        </div>
                        <div className="text-[10px] font-black text-primary uppercase tracking-widest flex items-center gap-1.5">
                          <Zap className="w-3 h-3" />
                          {user.role}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 mb-8">
                    <div className="p-4 bg-gray-50/50 rounded-2xl space-y-1 border border-white/40">
                      <span className="text-[9px] font-black text-muted-foreground uppercase tracking-widest">Revenue</span>
                      <div className="text-sm font-black text-gray-900">{formatMoney(revenue)}</div>
                    </div>
                    <div className="p-4 bg-gray-50/50 rounded-2xl space-y-1 border border-white/40">
                      <span className="text-[9px] font-black text-muted-foreground uppercase tracking-widest">Orders</span>
                      <div className="text-sm font-black text-gray-900">{delivered}</div>
                    </div>
                    <div className="p-4 bg-gray-50/50 rounded-2xl space-y-1 border border-white/40">
                      <span className="text-[9px] font-black text-muted-foreground uppercase tracking-widest">Conv. Rate</span>
                      <div className="text-sm font-black text-emerald-600">{conversion}%</div>
                    </div>
                    <div className="p-4 bg-gray-50/50 rounded-2xl space-y-1 border border-white/40">
                      <span className="text-[9px] font-black text-muted-foreground uppercase tracking-widest">Avg. Order</span>
                      <div className="text-sm font-black text-primary">{formatMoney(aov)}</div>
                    </div>
                  </div>

                  <button 
                    onClick={() => {
                      setSelectedSalesRepId(user.id);
                      setModal("salesRepDetails");
                    }}
                    className="w-full flex items-center justify-between px-6 py-4 bg-white border border-gray-100 text-gray-900 rounded-2xl text-xs font-black uppercase tracking-widest shadow-sm hover:shadow-xl hover:border-primary/20 hover:text-primary transition-all active:scale-95 group/btn"
                  >
                    <span>Representative Insights</span>
                    <ChevronRight className="w-4 h-4 transition-transform group-hover/btn:translate-x-1" />
                  </button>
                </motion.div>
              );
            })
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};
