import React, { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Plus, 
  Download, 
  Search, 
  Filter, 
  Calendar, 
  RefreshCw, 
  Archive, 
  History, 
  Flame, 
  TrendingUp,
  ArrowDownRight,
  ArrowUpRight,
  CircleDollarSign,
  PieChart,
  BarChart3,
  ExternalLink,
  ChevronRight,
  Package,
  Layers,
  LayoutGrid
} from 'lucide-react';
import { 
  ExpenseRecord, 
  Period, 
  DateRange, 
  CurrencyCode, 
  ExpenseFilter, 
  ModalType 
} from '../types';

interface ExpensesProps {
  expenses: ExpenseRecord[];
  filteredExpenses: ExpenseRecord[];
  expensePeriod: Period;
  periods: readonly Period[];
  handleExpensePeriodChange: (period: Period) => void;
  expenseDateRange: DateRange;
  setExpenseDateRange: React.Dispatch<React.SetStateAction<DateRange>>;
  showExpenseDateRange: boolean;
  setShowExpenseDateRange: (show: boolean | ((prev: boolean) => boolean)) => void;
  applyExpenseDateRange: () => void;
  totalExpenses: number;
  productLinkedExpenses: number;
  generalExpenses: number;
  dailyBurnRate: number;
  expenseRevenue: number;
  expenseCogs: number;
  expenseNetProfit: number;
  expenseMargin: number;
  expenseSearch: string;
  setExpenseSearch: (search: string) => void;
  expenseFilter: ExpenseFilter;
  setExpenseFilter: (filter: ExpenseFilter) => void;
  expenseFilters: readonly ExpenseFilter[];
  currency: CurrencyCode;
  setCurrency: (currency: CurrencyCode) => void;
  currencies: Record<CurrencyCode, { label: string; locale: string; currency: string }>;
  formatMoney: (amount: number) => string;
  setModal: (modal: ModalType) => void;
  showToast: (msg: string) => void;
  exportExpensesCsv: () => void;
  renderDateRangeCalendar: (id: string, range: DateRange, setRange: React.Dispatch<React.SetStateAction<DateRange>>, apply: () => void, close: () => void) => React.ReactNode;
  normalizeDateKey: (date: string) => string;
}

export const Expenses: React.FC<ExpensesProps> = ({
  expenses,
  filteredExpenses,
  expensePeriod,
  periods,
  handleExpensePeriodChange,
  expenseDateRange,
  setExpenseDateRange,
  showExpenseDateRange,
  setShowExpenseDateRange,
  applyExpenseDateRange,
  totalExpenses,
  productLinkedExpenses,
  generalExpenses,
  dailyBurnRate,
  expenseRevenue,
  expenseCogs,
  expenseNetProfit,
  expenseMargin,
  expenseSearch,
  setExpenseSearch,
  expenseFilter,
  setExpenseFilter,
  expenseFilters,
  currency,
  setCurrency,
  currencies,
  formatMoney,
  setModal,
  showToast,
  exportExpensesCsv,
  renderDateRangeCalendar,
  normalizeDateKey
}) => {
  const topProducts = useMemo(() => {
    return Object.entries(
      filteredExpenses.filter((e) => e.productId).reduce<Record<string, { name: string; total: number }>>((acc, e) => {
        const key = e.productId!;
        acc[key] = { name: e.productName, total: (acc[key]?.total ?? 0) + e.amount };
        return acc;
      }, {})
    ).sort((a, b) => b[1].total - a[1].total).slice(0, 5);
  }, [filteredExpenses]);

  const monthlyTrend = useMemo(() => {
    const now = new Date();
    return Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1);
      const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const total = expenses.filter((e) => normalizeDateKey(e.date).startsWith(mk)).reduce((s, e) => s + e.amount, 0);
      return { label: d.toLocaleString("en-US", { month: "short" }), total, isCurrentMonth: i === 5 };
    });
  }, [expenses, normalizeDateKey]);

  const monthMax = Math.max(...monthlyTrend.map((d) => d.total), 1);

  const stats = [
    { title: "Total Expenses", value: formatMoney(totalExpenses), helper: `${filteredExpenses.length} records`, icon: Archive, color: "text-blue-500", bg: "bg-blue-500/10" },
    { title: "Product-Linked", value: formatMoney(productLinkedExpenses), helper: `${totalExpenses === 0 ? 0 : Math.round((productLinkedExpenses / totalExpenses) * 100)}% of total`, icon: Layers, color: "text-purple-500", bg: "bg-purple-500/10" },
    { title: "General Expenses", value: formatMoney(generalExpenses), helper: "Operations & Overhead", icon: History, color: "text-amber-500", bg: "bg-amber-500/10" },
    { title: "Daily Burn", value: formatMoney(dailyBurnRate), helper: "Avg. this period", icon: Flame, color: "text-rose-500", bg: "bg-rose-500/10" }
  ];

  return (
    <div className="space-y-8 pb-12">
      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="space-y-1">
          <h1 className="text-4xl font-black tracking-tight bg-gradient-to-r from-gray-900 to-gray-600 bg-clip-text text-transparent">
            Expense Management
          </h1>
          <p className="text-muted-foreground font-medium">
            Monitor and manage your e-commerce operational costs.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button 
            onClick={() => showToast("Expenses refreshed.")}
            className="p-3 bg-white border border-gray-100 text-gray-500 rounded-2xl shadow-sm hover:shadow-xl hover:border-primary/20 hover:text-primary transition-all active:scale-95"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
          <button 
            onClick={() => setModal("addExpense")}
            className="flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-2xl text-sm font-black shadow-lg shadow-primary/20 hover:scale-105 active:scale-95 transition-all"
          >
            <Plus className="w-4 h-4" />
            ADD EXPENSE
          </button>
        </div>
      </header>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex bg-white/50 backdrop-blur-xl p-1 border border-white/40 rounded-xl shadow-sm">
            {periods.map((item) => (
              <button 
                key={item}
                onClick={() => handleExpensePeriodChange(item)}
                className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  expensePeriod === item 
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
              onClick={() => setShowExpenseDateRange(prev => !prev)}
              className="flex items-center gap-2 px-4 py-2 bg-white/50 border border-white/40 rounded-xl text-xs font-bold hover:bg-white transition-all shadow-sm"
            >
              <Calendar className="w-3.5 h-3.5 text-primary" />
              {expensePeriod === "Custom" ? "EDIT RANGE" : "DATE RANGE"}
            </button>
            {showExpenseDateRange && renderDateRangeCalendar("expense-date-range-panel", expenseDateRange, setExpenseDateRange, applyExpenseDateRange, () => setShowExpenseDateRange(false))}
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
              value={expenseSearch}
              onChange={(e) => setExpenseSearch(e.target.value)}
              placeholder="Search descriptions..."
              className="w-full pl-11 pr-4 py-2.5 bg-white border border-gray-100 rounded-2xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all shadow-sm"
            />
          </div>
          <button 
            onClick={exportExpensesCsv}
            className="p-2.5 bg-white border border-gray-100 text-gray-500 rounded-xl shadow-sm hover:text-primary transition-all active:scale-95"
            title="Export Expenses"
          >
            <Download className="w-5 h-5" />
          </button>
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

      {/* Profit Impact Section */}
      <section className="relative overflow-hidden p-8 bg-white/40 backdrop-blur-xl border border-white/40 rounded-[2.5rem] shadow-sm">
        <div className="absolute top-0 right-0 -translate-y-1/2 translate-x-1/2 w-64 h-64 bg-primary/5 blur-[100px] rounded-full" />
        <div className="relative space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-black text-gray-900 flex items-center gap-3">
              <PieChart className="w-5 h-5 text-primary" />
              Profit Impact Report
            </h2>
            <span className={`px-4 py-1.5 rounded-full text-xs font-black uppercase tracking-widest border ${
              expenseMargin >= 20 ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-amber-50 text-amber-600 border-amber-100'
            }`}>
              {expenseMargin}% Margin
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: "Gross Revenue", value: formatMoney(expenseRevenue), icon: TrendingUp, color: "text-emerald-600", bg: "bg-emerald-50" },
              { label: "Cost of Goods", value: formatMoney(expenseCogs), icon: ArrowDownRight, color: "text-rose-500", bg: "bg-rose-50" },
              { label: "Total Expenses", value: formatMoney(totalExpenses), icon: Filter, color: "text-rose-500", bg: "bg-rose-50" },
              { label: "Net Profit", value: formatMoney(expenseNetProfit), icon: CircleDollarSign, color: "text-primary", bg: "bg-primary/5" },
            ].map((item, idx) => (
              <div key={item.label} className="flex items-center gap-4">
                {idx > 0 && <span className="hidden lg:block text-xl font-black text-gray-300">{idx === 3 ? '=' : '-'}</span>}
                <div className={`flex-1 p-5 ${item.bg} border border-white/40 rounded-2xl space-y-2 group transition-all hover:scale-105 hover:shadow-lg`}>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">{item.label}</span>
                    <item.icon className={`w-3.5 h-3.5 ${item.color}`} />
                  </div>
                  <strong className={`text-xl font-black tracking-tight ${item.color}`}>{item.value}</strong>
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-6 pt-2">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.4)]" />
              <span className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">
                COGS ({expenseRevenue === 0 ? 0 : Math.round((expenseCogs / expenseRevenue) * 100)}%)
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-rose-400 shadow-[0_0_8px_rgba(244,63,94,0.4)]" />
              <span className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">
                Operations ({expenseRevenue === 0 ? 0 : Math.round((totalExpenses / expenseRevenue) * 100)}%)
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.4)]" />
              <span className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">
                Profit Margin ({expenseMargin}%)
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Analytics Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Top Product Expenses */}
        <article className="p-8 bg-white/40 backdrop-blur-xl border border-white/40 rounded-[2.5rem] shadow-sm flex flex-col">
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-xl font-black text-gray-900 flex items-center gap-3">
              <Package className="w-5 h-5 text-purple-500" />
              Product Ad Spend
            </h2>
          </div>
          
          <div className="flex-1 space-y-4">
            {topProducts.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 opacity-50 space-y-3">
                <LayoutGrid className="w-10 h-10 text-gray-300" />
                <p className="text-sm font-bold text-muted-foreground italic">No linked expenses this period</p>
              </div>
            ) : (
              topProducts.map(([id, item], idx) => (
                <div key={id} className="group relative flex items-center justify-between p-4 bg-white/40 border border-white/40 rounded-2xl hover:scale-[1.02] hover:shadow-xl hover:shadow-purple-500/5 transition-all">
                  <div className="flex items-center gap-4">
                    <span className="text-xs font-black text-purple-400/50">#0{idx + 1}</span>
                    <span className="text-sm font-bold text-gray-900 truncate max-w-[200px]">{item.name}</span>
                  </div>
                  <strong className="text-sm font-black text-primary">{formatMoney(item.total)}</strong>
                </div>
              ))
            )}
          </div>
        </article>

        {/* Monthly Trend */}
        <article className="p-8 bg-white/40 backdrop-blur-xl border border-white/40 rounded-[2.5rem] shadow-sm">
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-xl font-black text-gray-900 flex items-center gap-3">
              <BarChart3 className="w-5 h-5 text-indigo-500" />
              6-Month Trend
            </h2>
          </div>

          <div className="flex items-end justify-between gap-2 h-48 px-4">
            {monthlyTrend.map((m) => (
              <div key={m.label} className="flex-1 flex flex-col items-center gap-4 group">
                <div className="relative w-full flex items-end justify-center h-32">
                  <motion.div 
                    initial={{ height: 0 }}
                    animate={{ height: m.total === 0 ? "4px" : `${(m.total / monthMax) * 100}%` }}
                    className={`w-full max-w-[40px] rounded-t-xl transition-all group-hover:scale-x-110 ${
                      m.isCurrentMonth 
                      ? "bg-gradient-to-t from-primary to-primary/60 shadow-[0_0_20px_rgba(26,111,191,0.3)]" 
                      : "bg-gray-200/60 group-hover:bg-indigo-200"
                    }`}
                  >
                    <div className="opacity-0 group-hover:opacity-100 absolute -top-8 left-1/2 -translate-x-1/2 px-2 py-1 bg-gray-900 text-white text-[9px] font-black rounded pointer-events-none transition-all whitespace-nowrap z-10">
                      {formatMoney(m.total)}
                    </div>
                  </motion.div>
                </div>
                <span className={`text-[10px] font-black tracking-widest uppercase ${
                  m.isCurrentMonth ? "text-primary" : "text-muted-foreground"
                }`}>
                  {m.label}
                </span>
              </div>
            ))}
          </div>
        </article>
      </div>

      {/* Main Expense Table */}
      <section className="bg-white/40 backdrop-blur-xl border border-white/40 rounded-[2.5rem] shadow-sm overflow-hidden">
        <div className="px-8 py-6 border-b border-white/40 flex items-center justify-between bg-white/20">
          <h2 className="text-xl font-black text-gray-900 flex items-center gap-3">
            <Filter className="w-5 h-5 text-primary" />
            Operational Log
          </h2>
          <div className="flex items-center gap-3">
            <select 
              className="px-4 py-2 bg-white border border-gray-100 rounded-xl text-xs font-bold focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all shadow-sm"
              value={expenseFilter} 
              onChange={(e) => setExpenseFilter(e.target.value as ExpenseFilter)}
            >
              {expenseFilters.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
            <span className="px-4 py-1.5 bg-primary/10 text-primary text-[10px] font-black rounded-full uppercase tracking-widest border border-primary/20">
              {filteredExpenses.length} Records
            </span>
          </div>
        </div>

        <div className="overflow-x-auto overflow-y-visible">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50/50">
                <th className="px-8 py-4 text-xs font-black text-muted-foreground uppercase tracking-widest">Entry Detail</th>
                <th className="px-8 py-4 text-xs font-black text-muted-foreground uppercase tracking-widest">Category</th>
                <th className="px-8 py-4 text-xs font-black text-muted-foreground uppercase tracking-widest">Linked Asset</th>
                <th className="px-8 py-4 text-xs font-black text-muted-foreground uppercase tracking-widest text-right">Amount</th>
                <th className="px-8 py-4 text-xs font-black text-muted-foreground uppercase tracking-widest text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/40">
              <AnimatePresence mode="popLayout">
                {filteredExpenses.length === 0 ? (
                  <motion.tr
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                  >
                    <td colSpan={5} className="px-8 py-20 text-center">
                      <div className="flex flex-col items-center gap-4 opacity-50">
                        <Archive className="w-12 h-12 text-muted-foreground" />
                        <p className="text-sm font-bold text-muted-foreground italic max-w-xs mx-auto">
                          No expenses recorded for this period.
                        </p>
                      </div>
                    </td>
                  </motion.tr>
                ) : (
                  filteredExpenses.map((expense, idx) => (
                    <motion.tr
                      key={expense.id}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 20 }}
                      transition={{ delay: idx * 0.02 }}
                      className="group hover:bg-white/60 transition-all duration-300"
                    >
                      <td className="px-8 py-5">
                        <div className="space-y-1">
                          <div className="font-bold text-gray-900 group-hover:text-primary transition-colors">
                            {expense.description}
                          </div>
                          <div className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">
                            {expense.date}
                          </div>
                        </div>
                      </td>
                      <td className="px-8 py-5">
                        <span className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border ${
                          expense.type === "Ad Spend" ? "bg-purple-50 text-purple-600 border-purple-100" :
                          expense.type === "Delivery" ? "bg-blue-50 text-blue-600 border-blue-100" :
                          "bg-gray-50 text-gray-600 border-gray-100"
                        }`}>
                          {expense.type}
                        </span>
                      </td>
                      <td className="px-8 py-5">
                        {expense.productId ? (
                          <div className="flex items-center gap-2">
                            <Package className="w-3.5 h-3.5 text-purple-400" />
                            <span className="text-xs font-bold text-gray-700 truncate max-w-[150px]">
                              {expense.productName}
                            </span>
                          </div>
                        ) : (
                          <span className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">General Overhead</span>
                        )}
                      </td>
                      <td className="px-8 py-5 text-right">
                        <span className="font-black text-rose-500">
                          {formatMoney(expense.amount)}
                        </span>
                      </td>
                      <td className="px-8 py-5 text-right">
                        <button className="p-2.5 rounded-xl bg-white border border-gray-100 text-gray-400 hover:text-primary hover:border-primary/20 hover:shadow-lg transition-all active:scale-95">
                          <ExternalLink className="w-4 h-4" />
                        </button>
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
