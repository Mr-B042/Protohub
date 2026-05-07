import React, { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Users, 
  Download, 
  Search, 
  Filter, 
  Calendar, 
  RefreshCw, 
  CheckCircle2, 
  CircleDollarSign, 
  UserRound, 
  AlertTriangle,
  ChevronRight,
  TrendingUp,
  CreditCard,
  Target,
  ArrowUpRight,
  MoreVertical,
  ShieldCheck,
  ShieldAlert
} from 'lucide-react';
import { 
  CustomerRecord, 
  Period, 
  DateRange, 
  CurrencyCode, 
  CustomerSource, 
  ActivePage,
  CustomerFlag
} from '../types';

interface CustomersProps {
  customerRecords: CustomerRecord[];
  filteredCustomers: CustomerRecord[];
  customerPeriod: Period;
  periods: readonly Period[];
  handleCustomerPeriodChange: (period: Period) => void;
  customerDateRange: DateRange;
  setCustomerDateRange: React.Dispatch<React.SetStateAction<DateRange>>;
  showCustomerDateRange: boolean;
  setShowCustomerDateRange: (show: boolean | ((prev: boolean) => boolean)) => void;
  applyCustomerDateRange: () => void;
  customerSearch: string;
  setCustomerSearch: (search: string) => void;
  customerSource: CustomerSource;
  setCustomerSource: (source: CustomerSource) => void;
  customerSources: readonly CustomerSource[];
  activeCustomerCount: number;
  returningRate: number;
  avgLifetimeValue: number;
  currency: CurrencyCode;
  setCurrency: (currency: CurrencyCode) => void;
  currencies: Record<CurrencyCode, { label: string; locale: string; currency: string }>;
  formatMoney: (amount: number) => string;
  isCustomerFlagged: (phone: string) => boolean;
  customerFlags: Record<string, CustomerFlag>;
  normalizePhone: (phone: string) => string;
  unflagCustomer: (phone: string) => void;
  openFlagCustomer: (phone: string) => void;
  setOrderSearch: (search: string) => void;
  setActivePage: (page: ActivePage) => void;
  showToast: (msg: string) => void;
  exportCustomersCsv: () => void;
  renderDateRangeCalendar: (id: string, range: DateRange, setRange: React.Dispatch<React.SetStateAction<DateRange>>, apply: () => void, close: () => void) => React.ReactNode;
}

export const Customers: React.FC<CustomersProps> = ({
  customerRecords,
  filteredCustomers,
  customerPeriod,
  periods,
  handleCustomerPeriodChange,
  customerDateRange,
  setCustomerDateRange,
  showCustomerDateRange,
  setShowCustomerDateRange,
  applyCustomerDateRange,
  customerSearch,
  setCustomerSearch,
  customerSource,
  setCustomerSource,
  customerSources,
  activeCustomerCount,
  returningRate,
  avgLifetimeValue,
  currency,
  setCurrency,
  currencies,
  formatMoney,
  isCustomerFlagged,
  customerFlags,
  normalizePhone,
  unflagCustomer,
  openFlagCustomer,
  setOrderSearch,
  setActivePage,
  showToast,
  exportCustomersCsv,
  renderDateRangeCalendar
}) => {
  const stats = [
    { title: "Total Customers", value: customerRecords.length, helper: `${filteredCustomers.length} visible`, icon: UserRound, color: "text-blue-500", bg: "bg-blue-500/10" },
    { title: "Active Customers", value: activeCustomerCount, helper: "Ordered at least once", icon: CheckCircle2, color: "text-emerald-500", bg: "bg-emerald-500/10" },
    { title: "Returning Rate", value: `${returningRate}%`, helper: "2+ successful orders", icon: RefreshCw, color: "text-cyan-500", bg: "bg-cyan-500/10" },
    { title: "Avg. LTV", value: formatMoney(avgLifetimeValue), helper: "Spend per customer", icon: CircleDollarSign, color: "text-indigo-500", bg: "bg-indigo-500/10" }
  ];

  const getReliabilityColor = (reliability: number) => {
    if (reliability >= 70) return 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20';
    if (reliability >= 40) return 'bg-amber-500/10 text-amber-600 border-amber-500/20';
    return 'bg-rose-500/10 text-rose-600 border-rose-500/20';
  };

  return (
    <div className="space-y-8 pb-12">
      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="space-y-1">
          <h1 className="text-4xl font-black tracking-tight bg-gradient-to-r from-gray-900 to-gray-600 bg-clip-text text-transparent">
            Customer Directory
          </h1>
          <p className="text-muted-foreground font-medium">
            Manage relationships and track lifetime value performance.
          </p>
        </div>

        <button 
          onClick={exportCustomersCsv}
          className="flex items-center gap-2 px-6 py-3 bg-white border border-gray-100 text-gray-900 rounded-2xl text-sm font-black shadow-sm hover:shadow-xl hover:border-primary/20 hover:-translate-y-0.5 active:translate-y-0 transition-all"
        >
          <Download className="w-4 h-4 text-primary" />
          EXPORT CSV
        </button>
      </header>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex bg-white/50 backdrop-blur-xl p-1 border border-white/40 rounded-xl shadow-sm">
            {periods.map((item) => (
              <button 
                key={item}
                onClick={() => handleCustomerPeriodChange(item)}
                className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  customerPeriod === item 
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
              onClick={() => setShowCustomerDateRange(prev => !prev)}
              className="flex items-center gap-2 px-4 py-2 bg-white/50 border border-white/40 rounded-xl text-xs font-bold hover:bg-white transition-all shadow-sm"
            >
              <Calendar className="w-3.5 h-3.5 text-primary" />
              {customerPeriod === "Custom" ? "EDIT RANGE" : "DATE RANGE"}
            </button>
            {showCustomerDateRange && renderDateRangeCalendar("customer-date-range-panel", customerDateRange, setCustomerDateRange, applyCustomerDateRange, () => setShowCustomerDateRange(false))}
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
            <option value="NGN">₦ NGN</option>
            <option value="USD">$ USD</option>
            <option value="GBP">£ GBP</option>
          </select>
        </div>

        <div className="flex items-center gap-3 flex-1 max-w-md">
          <div className="relative flex-1 group">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground transition-colors group-focus-within:text-primary" />
            <input 
              type="text" 
              value={customerSearch}
              onChange={(e) => setCustomerSearch(e.target.value)}
              placeholder="Search name, phone, email..."
              className="w-full pl-11 pr-4 py-2.5 bg-white border border-gray-100 rounded-2xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all shadow-sm"
            />
          </div>
          <select 
            className="px-4 py-2.5 bg-white border border-gray-100 rounded-2xl text-xs font-bold focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all shadow-sm"
            value={customerSource} 
            onChange={(e) => setCustomerSource(e.target.value as CustomerSource)}
          >
            {customerSources.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map((stat, idx) => (
          <motion.div
            key={stat.title}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.1 }}
            className="group p-6 bg-white/40 backdrop-blur-xl border border-white/40 rounded-[2.5rem] shadow-sm hover:shadow-xl hover:shadow-primary/5 transition-all"
          >
            <div className="flex items-center justify-between mb-4">
              <div className={`p-3 rounded-2xl ${stat.bg} ${stat.color} transition-transform group-hover:scale-110 duration-500`}>
                <stat.icon className="w-6 h-6" />
              </div>
              <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                <TrendingUp className="w-4 h-4 text-emerald-500" />
              </div>
            </div>
            <div className="space-y-1">
              <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wider">{stat.title}</h3>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-black tracking-tight text-gray-900">{stat.value}</span>
                <span className="text-[10px] font-bold text-muted-foreground italic">{stat.helper}</span>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Table Section */}
      <section className="bg-white/40 backdrop-blur-xl border border-white/40 rounded-[2.5rem] shadow-sm overflow-hidden">
        <div className="overflow-x-auto overflow-y-visible">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50/50">
                <th className="px-8 py-4 text-xs font-black text-muted-foreground uppercase tracking-widest">Customer Identity</th>
                <th className="px-8 py-4 text-xs font-black text-muted-foreground uppercase tracking-widest">Activity</th>
                <th className="px-8 py-4 text-xs font-black text-muted-foreground uppercase tracking-widest">Performance</th>
                <th className="px-8 py-4 text-xs font-black text-muted-foreground uppercase tracking-widest">LTV Value</th>
                <th className="px-8 py-4 text-xs font-black text-muted-foreground uppercase tracking-widest text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/40">
              <AnimatePresence mode="popLayout">
                {filteredCustomers.length === 0 ? (
                  <motion.tr
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                  >
                    <td colSpan={5} className="px-8 py-20 text-center">
                      <div className="flex flex-col items-center gap-4 opacity-50">
                        <div className="w-16 h-16 rounded-[2rem] bg-gray-100 flex items-center justify-center text-gray-400">
                          <Users className="w-8 h-8" />
                        </div>
                        <p className="text-sm font-bold text-muted-foreground italic max-w-xs mx-auto">
                          No matching customers found. Try adjusting your search or filters.
                        </p>
                      </div>
                    </td>
                  </motion.tr>
                ) : (
                  filteredCustomers.map((customer, idx) => {
                    const reliability = customer.orders === 0 ? 0 : Math.round((customer.successful / customer.orders) * 100);
                    const flagged = isCustomerFlagged(customer.phone);
                    const flagData = customerFlags[normalizePhone(customer.phone)];
                    
                    return (
                      <motion.tr
                        key={customer.id}
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 20 }}
                        transition={{ delay: idx * 0.02 }}
                        className={`group hover:bg-white/60 transition-all duration-300 ${flagged ? 'bg-rose-50/40' : ''}`}
                      >
                        <td className="px-8 py-5">
                          <div className="flex items-center gap-4">
                            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center font-black text-sm shadow-inner transition-transform group-hover:scale-105 ${
                              flagged ? 'bg-rose-100 text-rose-600' : 'bg-primary/10 text-primary'
                            }`}>
                              {customer.name.charAt(0)}
                            </div>
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-gray-900 group-hover:text-primary transition-colors">
                                  {customer.name}
                                </span>
                                {flagged && (
                                  <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-rose-500 text-white text-[8px] font-black uppercase tracking-widest shadow-sm shadow-rose-500/20" title={flagData?.reason}>
                                    <ShieldAlert className="w-2.5 h-2.5" />
                                    FLAGGED
                                  </span>
                                )}
                              </div>
                              <div className="text-[10px] font-black text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                                <CreditCard className="w-3 h-3" />
                                {customer.phone}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-8 py-5">
                          <div className="space-y-2">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-gray-900">{customer.orders} Orders</span>
                              <span className="text-[10px] font-black text-muted-foreground uppercase tracking-widest px-2 py-0.5 bg-gray-100 rounded-md border border-gray-200">
                                {customer.source}
                              </span>
                            </div>
                            <div className="flex items-center gap-3">
                              <div className="flex items-center gap-1">
                                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                <span className="text-[10px] font-bold text-emerald-600">{customer.successful} OK</span>
                              </div>
                              <div className="flex items-center gap-1">
                                <div className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                                <span className="text-[10px] font-bold text-rose-600">{customer.cancelled} CANC</span>
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-8 py-5">
                          <div className="space-y-2">
                            <div className="flex items-center justify-between text-[10px] font-black text-muted-foreground uppercase tracking-widest mb-1">
                              <span>Reliability</span>
                              <span className={reliability >= 70 ? 'text-emerald-600' : 'text-amber-600'}>{reliability}%</span>
                            </div>
                            <div className="w-32 h-1.5 bg-gray-100 rounded-full overflow-hidden border border-gray-200/50">
                              <motion.div 
                                initial={{ width: 0 }}
                                animate={{ width: `${reliability}%` }}
                                className={`h-full rounded-full ${
                                  reliability >= 70 ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]' : 
                                  reliability >= 40 ? 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.4)]' : 
                                  'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.4)]'
                                }`}
                              />
                            </div>
                          </div>
                        </td>
                        <td className="px-8 py-5">
                          <div className="flex flex-col items-start gap-1">
                            <span className="text-lg font-black text-primary tracking-tight">
                              {formatMoney(customer.totalSpend)}
                            </span>
                            <span className="text-[9px] font-black text-muted-foreground uppercase tracking-widest">
                              Lifetime Spend
                            </span>
                          </div>
                        </td>
                        <td className="px-8 py-5 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button 
                              onClick={() => { setOrderSearch(customer.phone); setActivePage("Orders"); }}
                              className="px-4 py-2 bg-white border border-gray-100 text-gray-700 rounded-xl text-[10px] font-black uppercase tracking-widest shadow-sm hover:shadow-lg hover:border-primary/20 hover:text-primary transition-all active:scale-95"
                            >
                              VIEW ORDERS
                            </button>
                            {flagged ? (
                              <button 
                                onClick={() => unflagCustomer(customer.phone)}
                                className="p-2 bg-rose-500 text-white rounded-xl shadow-lg shadow-rose-500/20 hover:bg-rose-600 transition-all active:scale-90"
                                title="Unflag Customer"
                              >
                                <ShieldCheck className="w-4 h-4" />
                              </button>
                            ) : (
                              <button 
                                onClick={() => openFlagCustomer(customer.phone)}
                                className="p-2 bg-white border border-rose-100 text-rose-500 rounded-xl shadow-sm hover:bg-rose-50 hover:border-rose-200 transition-all active:scale-90"
                                title="Flag Customer"
                              >
                                <AlertTriangle className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </td>
                      </motion.tr>
                    );
                  })
                )}
              </AnimatePresence>
            </tbody>
          </table>
        </div>
        
        <div className="px-8 py-4 bg-gray-50/30 border-t border-white/40 flex items-center justify-between">
          <span className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.2em]">
            Displaying {filteredCustomers.length} of {customerRecords.length} records
          </span>
        </div>
      </section>
    </div>
  );
};
