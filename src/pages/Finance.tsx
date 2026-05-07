import React, { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  TrendingUp, 
  TrendingDown, 
  DollarSign, 
  PieChart, 
  BarChart3, 
  ArrowUpRight, 
  ArrowDownRight, 
  Calendar, 
  Filter, 
  Download, 
  Search,
  CheckCircle2,
  AlertCircle,
  CreditCard,
  Wallet,
  Building2,
  FileText,
  ChevronRight,
  LayoutGrid,
  Info,
  Package,
  Zap,
  Globe,
  ArrowRight
} from 'lucide-react';
import { 
  FinanceTab, 
  Period, 
  DateRange, 
  CurrencyCode, 
  Product, 
  ExpenseRecord,
  ModalType,
  ActivePage
} from '../types';

interface FinanceProps {
  financeTab: FinanceTab;
  setFinanceTab: (tab: FinanceTab) => void;
  financeTabs: readonly FinanceTab[];
  financePeriod: Period;
  handleFinancePeriodChange: (period: Period) => void;
  periods: readonly Period[];
  financeDateRange: DateRange;
  setFinanceDateRange: React.Dispatch<React.SetStateAction<DateRange>>;
  showFinanceDateRange: boolean;
  setShowFinanceDateRange: (show: boolean | ((prev: boolean) => boolean)) => void;
  applyFinanceDateRange: () => void;
  financeProductFilter: string[];
  setFinanceProductFilter: React.Dispatch<React.SetStateAction<string[]>>;
  products: Product[];
  financeRevenue: number;
  financeDeliveredCount: number;
  financeGrossProfit: number;
  financeGrossMargin: number;
  financeNetProfit: number;
  financeNetMargin: number;
  financeExpenseTotal: number;
  financeExpenses: ExpenseRecord[];
  totalRemittanceReceived: number;
  totalRemittanceOutstanding: number;
  totalRemittanceExpected: number;
  totalLogisticsCost: number;
  financeChartData: { label: string; revenue: number; expenses: number }[];
  financeChartMax: number;
  currency: CurrencyCode;
  setCurrency: (currency: CurrencyCode) => void;
  currencies: Record<CurrencyCode, { label: string; locale: string; currency: string }>;
  formatMoney: (amount: number) => string;
  renderDateRangeCalendar: (id: string, range: DateRange, setRange: React.Dispatch<React.SetStateAction<DateRange>>, apply: () => void, close: () => void) => React.ReactNode;
  exportFinancialReport: () => void;
  showToast: (msg: string) => void;
  productFilterActive: boolean;
}

export const Finance: React.FC<FinanceProps> = ({
  financeTab,
  setFinanceTab,
  financeTabs,
  financePeriod,
  handleFinancePeriodChange,
  periods,
  financeDateRange,
  setFinanceDateRange,
  showFinanceDateRange,
  setShowFinanceDateRange,
  applyFinanceDateRange,
  financeProductFilter,
  setFinanceProductFilter,
  products,
  financeRevenue,
  financeDeliveredCount,
  financeGrossProfit,
  financeGrossMargin,
  financeNetProfit,
  financeNetMargin,
  financeExpenseTotal,
  financeExpenses,
  totalRemittanceReceived,
  totalRemittanceOutstanding,
  totalRemittanceExpected,
  totalLogisticsCost,
  financeChartData,
  financeChartMax,
  currency,
  setCurrency,
  currencies,
  formatMoney,
  renderDateRangeCalendar,
  exportFinancialReport,
  showToast,
  productFilterActive
}) => {
  const topStats = useMemo(() => [
    { label: "Total Revenue", value: formatMoney(financeRevenue), sub: `${financeDeliveredCount} Delivered`, icon: DollarSign, color: "text-emerald-500", bg: "bg-emerald-500/10" },
    { label: "Gross Profit", value: formatMoney(financeGrossProfit), sub: `${financeGrossMargin}% Margin`, icon: Zap, color: "text-blue-500", bg: "bg-blue-500/10" },
    { label: "Net Profit", value: formatMoney(financeNetProfit), sub: `${financeNetMargin}% Margin`, icon: PieChart, color: "text-indigo-500", bg: "bg-indigo-500/10" },
    { label: "Operational Burn", value: formatMoney(financeExpenseTotal), sub: `${financeExpenses.length} Records`, icon: TrendingDown, color: "text-rose-500", bg: "bg-rose-500/10" },
  ], [financeRevenue, financeDeliveredCount, financeGrossProfit, financeGrossMargin, financeNetProfit, financeNetMargin, financeExpenseTotal, financeExpenses, formatMoney]);

  return (
    <div className="space-y-8 pb-12">
      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="space-y-1">
          <h1 className="text-4xl font-black tracking-tight bg-gradient-to-r from-gray-900 to-gray-600 bg-clip-text text-transparent">
            Financial Ledger
          </h1>
          <p className="text-muted-foreground font-medium">
            Analyze profit margins, operational costs, and partner remittances.
          </p>
        </div>

        <button 
          onClick={exportFinancialReport}
          className="flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-2xl text-sm font-black shadow-lg shadow-primary/20 hover:scale-105 active:scale-95 transition-all"
        >
          <Download className="w-4 h-4" />
          EXPORT FINANCIAL REPORT
        </button>
      </header>

      {/* Primary Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex bg-white/50 backdrop-blur-xl p-1 border border-white/40 rounded-xl shadow-sm">
            {periods.map((item) => (
              <button 
                key={item}
                onClick={() => handleFinancePeriodChange(item)}
                className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  financePeriod === item 
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
              onClick={() => setShowFinanceDateRange(prev => !prev)}
              className="flex items-center gap-2 px-4 py-2 bg-white/50 border border-white/40 rounded-xl text-xs font-bold hover:bg-white transition-all shadow-sm"
            >
              <Calendar className="w-3.5 h-3.5 text-primary" />
              {financePeriod === "Custom" ? "EDIT RANGE" : "DATE RANGE"}
            </button>
            {showFinanceDateRange && renderDateRangeCalendar("finance-date-range-panel", financeDateRange, setFinanceDateRange, applyFinanceDateRange, () => setShowFinanceDateRange(false))}
          </div>

          <select 
            className="px-4 py-2 bg-white/50 border border-white/40 rounded-xl text-xs font-bold focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all shadow-sm"
            value={currency} 
            onChange={(e) => {
              const next = e.target.value as CurrencyCode;
              setCurrency(next);
              showToast(`Currency switched to ${currencies[next].label}.`);
            }}
          >
            {Object.keys(currencies).map(c => (
              <option key={c} value={c}>{currencies[c as CurrencyCode].label}</option>
            ))}
          </select>
        </div>

        <nav className="flex items-center gap-1 bg-white/50 backdrop-blur-xl p-1 border border-white/40 rounded-2xl shadow-sm overflow-x-auto no-scrollbar">
          {financeTabs.map((tab) => (
            <button
              key={tab}
              onClick={() => setFinanceTab(tab)}
              className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest whitespace-nowrap transition-all ${
                financeTab === tab 
                ? "bg-primary text-primary-foreground shadow-lg shadow-primary/20" 
                : "text-muted-foreground hover:text-gray-900"
              }`}
            >
              {tab}
            </button>
          ))}
        </nav>
      </div>

      {/* Product Scoping Chips */}
      <section className="p-6 bg-white/40 backdrop-blur-xl border border-white/40 rounded-[2.5rem] shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div className="space-y-1">
            <h2 className="text-sm font-black text-gray-900 flex items-center gap-2 uppercase tracking-tighter">
              <Package className="w-4 h-4 text-primary" />
              Portfolio Filter
            </h2>
            <p className="text-[10px] font-medium text-muted-foreground italic">
              Select one or more products to isolate financial performance across all reports.
            </p>
          </div>
          {productFilterActive && (
            <button 
              onClick={() => setFinanceProductFilter([])}
              className="text-[9px] font-black text-rose-500 uppercase tracking-widest hover:underline"
            >
              Clear All Filters
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setFinanceProductFilter([])}
            className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
              !productFilterActive 
              ? "bg-gray-900 text-white shadow-lg" 
              : "bg-white/50 text-muted-foreground border border-white/40 hover:bg-white"
            }`}
          >
            Consolidated View ({products.length})
          </button>
          {products.map((product) => {
            const selected = financeProductFilter.includes(product.id);
            return (
              <button
                key={product.id}
                onClick={() => setFinanceProductFilter((prev) => 
                  prev.includes(product.id) ? prev.filter((id) => id !== product.id) : [...prev, product.id]
                )}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all border ${
                  selected 
                  ? "bg-primary border-primary text-primary-foreground shadow-lg shadow-primary/10" 
                  : "bg-white/50 border-white/40 text-muted-foreground hover:bg-white"
                }`}
              >
                {selected && <CheckCircle2 className="w-3 h-3" />}
                {product.name}
              </button>
            );
          })}
        </div>
      </section>

      {/* Sub-tab Content: Financial Overview */}
      {financeTab === "Financial Overview" && (
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-8"
        >
          {/* Stats Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {topStats.map((stat, idx) => (
              <div
                key={stat.label}
                className="group p-6 bg-white/40 backdrop-blur-xl border border-white/40 rounded-[2.5rem] shadow-sm hover:shadow-xl hover:shadow-primary/5 transition-all"
              >
                <div className="flex items-center justify-between mb-4">
                  <div className={`p-3 rounded-2xl ${stat.bg} ${stat.color} transition-transform group-hover:scale-110 duration-500`}>
                    <stat.icon className="w-5 h-5" />
                  </div>
                </div>
                <div className="space-y-1">
                  <h3 className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">{stat.label}</h3>
                  <div className="text-xl font-black tracking-tight text-gray-900">{stat.value}</div>
                  <p className="text-[9px] font-bold text-muted-foreground italic uppercase tracking-wider">{stat.sub}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Cash Position & Reconciliation */}
          <section className="p-8 bg-white/40 backdrop-blur-xl border border-white/40 rounded-[3rem] shadow-sm">
            <div className="flex items-start justify-between mb-8">
              <div className="space-y-1">
                <h2 className="text-xl font-black text-gray-900 flex items-center gap-3">
                  <Wallet className="w-5 h-5 text-emerald-500" />
                  Cash Velocity & Liquidity
                </h2>
                <p className="text-xs font-medium text-muted-foreground italic">
                  POD Reconciliation: Comparative analysis between recognized revenue and physical cash receipts.
                </p>
              </div>
              <button 
                onClick={() => setFinanceTab("Remittance")}
                className="flex items-center gap-2 px-4 py-2 bg-white/50 border border-white/40 rounded-xl text-[9px] font-black uppercase tracking-[0.2em] hover:bg-white hover:text-primary transition-all shadow-sm"
              >
                REMITTANCE HUB
                <ArrowRight className="w-3 h-3" />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {[
                { label: "Recognized Revenue", value: formatMoney(financeRevenue), sub: `Confirmed Deliveries (${financeDeliveredCount})`, icon: Building2, color: "text-blue-500", bg: "bg-blue-50" },
                { label: "Actual Cash Received", value: formatMoney(totalRemittanceReceived), sub: "Settled by Partners", icon: CreditCard, color: "text-emerald-500", bg: "bg-emerald-50" },
                { label: "Outstanding (A/R)", value: formatMoney(totalRemittanceOutstanding), sub: `${totalRemittanceExpected === 0 ? 0 : Math.round((totalRemittanceReceived / totalRemittanceExpected) * 100)}% Collection Efficiency`, icon: AlertCircle, color: "text-amber-500", bg: "bg-amber-50" },
              ].map((item) => (
                <div key={item.label} className={`p-6 rounded-[2rem] border border-white/40 ${item.bg}`}>
                  <div className="flex items-center gap-2 mb-3">
                    <item.icon className={`w-4 h-4 ${item.color}`} />
                    <span className={`text-[10px] font-black uppercase tracking-widest ${item.color}`}>{item.label}</span>
                  </div>
                  <div className="text-2xl font-black text-gray-900 mb-1">{item.value}</div>
                  <p className="text-[10px] font-bold text-muted-foreground italic">{item.sub}</p>
                </div>
              ))}
            </div>
          </section>

          {/* Performance Chart Placeholder/Structure */}
          <section className="p-8 bg-white/40 backdrop-blur-xl border border-white/40 rounded-[3rem] shadow-sm">
            <div className="flex items-center justify-between mb-8">
              <h2 className="text-xl font-black text-gray-900 flex items-center gap-3">
                <BarChart3 className="w-5 h-5 text-primary" />
                Capital Flow Trends
              </h2>
              <div className="flex items-center gap-6">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-emerald-400" />
                  <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Revenue</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-rose-400" />
                  <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Operating Costs</span>
                </div>
              </div>
            </div>

            {financeChartData.every((d) => d.revenue === 0 && d.expenses === 0) ? (
              <div className="py-20 text-center opacity-30 flex flex-col items-center gap-4">
                <LayoutGrid className="w-16 h-16" />
                <p className="text-sm font-bold italic">No financial movement detected for the selected parameters.</p>
              </div>
            ) : (
              <div className="h-64 flex items-end gap-1 px-4">
                {financeChartData.map((d, i) => {
                  const revH = Math.round((d.revenue / (financeChartMax || 1)) * 100);
                  const expH = Math.round((d.expenses / (financeChartMax || 1)) * 100);
                  const showLabel = financeChartData.length <= 14 || i % Math.ceil(financeChartData.length / 14) === 0 || i === financeChartData.length - 1;

                  return (
                    <div key={i} className="flex-1 flex flex-col items-center gap-2 group min-w-0">
                      <div className="w-full flex items-end justify-center gap-0.5 h-48 relative">
                        {/* Revenue Bar */}
                        <motion.div 
                          initial={{ height: 0 }}
                          animate={{ height: `${revH}%` }}
                          className="w-full max-w-[12px] bg-emerald-400 rounded-t-lg relative group-hover:bg-emerald-500 transition-colors shadow-lg shadow-emerald-400/10"
                        >
                          <div className="absolute -top-10 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-[9px] font-bold px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-10 shadow-xl">
                            Rev: {formatMoney(d.revenue)}
                          </div>
                        </motion.div>
                        {/* Expense Bar */}
                        <motion.div 
                          initial={{ height: 0 }}
                          animate={{ height: `${expH}%` }}
                          className="w-full max-w-[12px] bg-rose-400 rounded-t-lg relative group-hover:bg-rose-500 transition-colors shadow-lg shadow-rose-400/10"
                        >
                          <div className="absolute -top-10 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-[9px] font-bold px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-10 shadow-xl">
                            Exp: {formatMoney(d.expenses)}
                          </div>
                        </motion.div>
                      </div>
                      {showLabel && (
                        <span className="text-[9px] font-black text-muted-foreground uppercase tracking-tighter truncate w-full text-center">
                          {d.label}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </motion.div>
      )}

      {financeTab !== "Financial Overview" && (
        <div className="py-20 text-center bg-white/20 border border-dashed border-white/40 rounded-[3rem] opacity-50 flex flex-col items-center gap-4">
          <Info className="w-12 h-12 text-muted-foreground" />
          <div className="space-y-1">
            <h3 className="text-lg font-black text-gray-900 uppercase tracking-tighter">{financeTab}</h3>
            <p className="text-sm font-medium italic">Detailed report view for {financeTab} is active.</p>
          </div>
        </div>
      )}
    </div>
  );
};
