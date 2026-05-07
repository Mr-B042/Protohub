import React, { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Banknote, 
  Plus, 
  Eye, 
  Calendar, 
  History, 
  Settings2,
  Trash2,
  FileText,
  TrendingUp,
  AlertCircle,
  Users,
  ChevronRight,
  Download,
  Search,
  Wallet
} from 'lucide-react';
import { 
  ManagedUser, 
  PayStructure, 
  PayrollTab, 
  PayrollRow, 
  Penalty, 
  PayrollRun,
  ModalType
} from '../types';

interface PayrollProps {
  users: ManagedUser[];
  payStructures: PayStructure[];
  payrollTab: PayrollTab;
  setPayrollTab: (tab: PayrollTab) => void;
  payrollTabs: readonly PayrollTab[];
  payrollMonth: string;
  setPayrollMonth: (month: string) => void;
  payrollLabel: string;
  setPayrollLabel: (label: string) => void;
  payrollNotes: string;
  setPayrollNotes: (notes: string) => void;
  payrollPreviewRows: PayrollRow[];
  payrollGrandTotal: number;
  repPenalties: Penalty[];
  payrollRuns: PayrollRun[];
  openPayRateModal: (userId: string) => void;
  previewPayroll: () => void;
  openAddPenalty: () => void;
  removePenalty: (id: string) => void;
  savePayrollDraft: () => void;
  formatMoney: (amount: number) => string;
  displayDateFromKey: (key: string) => string;
  payStructureLabelFor: (structure: PayStructure) => string;
}

export const Payroll: React.FC<PayrollProps> = ({
  users,
  payStructures,
  payrollTab,
  setPayrollTab,
  payrollTabs,
  payrollMonth,
  setPayrollMonth,
  payrollLabel,
  setPayrollLabel,
  payrollNotes,
  setPayrollNotes,
  payrollPreviewRows,
  payrollGrandTotal,
  repPenalties,
  payrollRuns,
  openPayRateModal,
  previewPayroll,
  openAddPenalty,
  removePenalty,
  savePayrollDraft,
  formatMoney,
  displayDateFromKey,
  payStructureLabelFor
}) => {
  const periodPenalties = useMemo(() => {
    return repPenalties.filter((pen) => {
      try {
        return new Date(pen.date).toLocaleString("en-US", { month: "long", year: "numeric" }) === payrollMonth.trim();
      } catch { return false; }
    });
  }, [repPenalties, payrollMonth]);

  const stats = useMemo(() => {
    const totalStaff = users.length;
    const structuresSet = payStructures.length;
    const lastRunTotal = payrollRuns[0]?.total ?? 0;

    return [
      { label: 'Team Size', value: totalStaff, icon: Users, color: 'text-blue-500', bg: 'bg-blue-500/10' },
      { label: 'Pay Rates Set', value: `${structuresSet}/${totalStaff}`, icon: Settings2, color: 'text-amber-500', bg: 'bg-amber-500/10' },
      { label: 'Last Payroll', value: formatMoney(lastRunTotal), icon: Wallet, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
      { label: 'Active Month', value: payrollMonth || 'Not Set', icon: Calendar, color: 'text-indigo-500', bg: 'bg-indigo-500/10' },
    ];
  }, [users, payStructures, payrollRuns, formatMoney, payrollMonth]);

  return (
    <div className="space-y-8 pb-12">
      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="space-y-1">
          <h1 className="text-4xl font-black tracking-tight bg-gradient-to-r from-gray-900 to-gray-600 bg-clip-text text-transparent">
            Payroll Workspace
          </h1>
          <p className="text-muted-foreground font-medium">
            Manage compensation, generate monthly runs, and track history.
          </p>
        </div>

        <div className="flex bg-white/50 backdrop-blur-xl p-1.5 border border-white/40 rounded-2xl shadow-sm overflow-x-auto no-scrollbar">
          {payrollTabs.map((tab) => (
            <button
              key={tab}
              onClick={() => setPayrollTab(tab)}
              className={`px-6 py-2 rounded-xl text-sm font-bold transition-all whitespace-nowrap ${
                payrollTab === tab 
                ? "bg-primary text-primary-foreground shadow-lg shadow-primary/20" 
                : "text-muted-foreground hover:text-gray-900 hover:bg-white/50"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
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
              <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wider">{stat.label}</h3>
              <span className="text-2xl font-black tracking-tight text-gray-900">{stat.value}</span>
            </div>
          </motion.div>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {payrollTab === "Pay Rates" && (
          <motion.section
            key="pay-rates"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="space-y-6"
          >
            <div className="bg-white/40 backdrop-blur-xl border border-white/40 rounded-[2.5rem] shadow-sm overflow-hidden">
              <div className="px-8 py-6 border-b border-white/40 flex items-center justify-between">
                <div className="space-y-1">
                  <h2 className="text-xl font-black text-gray-900 flex items-center gap-3">
                    <Settings2 className="w-5 h-5 text-primary" />
                    Compensation Structures
                  </h2>
                  <p className="text-xs font-bold text-muted-foreground italic">Set individual earnings per delivered order and base salary.</p>
                </div>
              </div>
              <div className="overflow-x-auto overflow-y-visible">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-gray-50/50">
                      <th className="px-8 py-4 text-xs font-black text-muted-foreground uppercase tracking-widest">Team Member</th>
                      <th className="px-8 py-4 text-xs font-black text-muted-foreground uppercase tracking-widest">Role</th>
                      <th className="px-8 py-4 text-xs font-black text-muted-foreground uppercase tracking-widest">Structure</th>
                      <th className="px-8 py-4 text-xs font-black text-muted-foreground uppercase tracking-widest">Last Updated</th>
                      <th className="px-8 py-4 text-xs font-black text-muted-foreground uppercase tracking-widest text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/40">
                    {users.map((user) => {
                      const structure = payStructures.find((s) => s.userId === user.id);
                      return (
                        <tr key={user.id} className="group hover:bg-white/40 transition-all duration-300">
                          <td className="px-8 py-5">
                            <div className="flex items-center gap-4">
                              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary/10 to-primary/5 flex items-center justify-center text-primary font-bold shadow-inner">
                                {user.name.charAt(0)}
                              </div>
                              <div>
                                <div className="font-bold text-gray-900">{user.name}</div>
                                <div className="text-xs font-bold text-muted-foreground">{user.email}</div>
                              </div>
                            </div>
                          </td>
                          <td className="px-8 py-5">
                            <span className="px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-gray-100 text-gray-600 border border-gray-200">
                              {user.role}
                            </span>
                          </td>
                          <td className="px-8 py-5">
                            <span className={`text-sm font-bold ${structure ? "text-emerald-600" : "text-amber-500"}`}>
                              {structure ? payStructureLabelFor(structure) : "⚠️ Not configured"}
                            </span>
                          </td>
                          <td className="px-8 py-5 text-xs font-black text-muted-foreground tracking-widest uppercase">
                            {structure?.updatedAt ?? "Never"}
                          </td>
                          <td className="px-8 py-5 text-right">
                            <button
                              onClick={() => openPayRateModal(user.id)}
                              className="px-4 py-2 bg-white border border-gray-100 text-gray-700 rounded-xl text-xs font-black shadow-sm hover:shadow-lg hover:border-primary/20 hover:text-primary transition-all group-hover:scale-105 active:scale-95"
                            >
                              {structure ? "EDIT RATE" : "SET RATE"}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </motion.section>
        )}

        {payrollTab === "Run Payroll" && (
          <motion.section
            key="run-payroll"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="space-y-8"
          >
            {/* Configuration Card */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 space-y-6">
                <div className="p-8 bg-white/40 backdrop-blur-xl border border-white/40 rounded-[2.5rem] shadow-sm space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.2em] ml-1">Run Month</label>
                      <div className="relative group">
                        <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                        <input
                          type="text"
                          value={payrollMonth}
                          onChange={(e) => {
                            setPayrollMonth(e.target.value);
                            setPayrollLabel(`${e.target.value || "Monthly"} Payroll`);
                          }}
                          placeholder="e.g., October 2023"
                          className="w-full pl-11 pr-4 py-3 bg-white/50 border border-white/40 rounded-2xl text-sm font-bold focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-all shadow-sm"
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.2em] ml-1">Run Label</label>
                      <div className="relative group">
                        <FileText className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                        <input
                          type="text"
                          value={payrollLabel}
                          onChange={(e) => setPayrollLabel(e.target.value)}
                          className="w-full pl-11 pr-4 py-3 bg-white/50 border border-white/40 rounded-2xl text-sm font-bold focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-all shadow-sm"
                        />
                      </div>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.2em] ml-1">Internal Notes</label>
                    <textarea
                      value={payrollNotes}
                      onChange={(e) => setPayrollNotes(e.target.value)}
                      placeholder="Add any context for this payroll run..."
                      rows={3}
                      className="w-full px-4 py-3 bg-white/50 border border-white/40 rounded-2xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-all shadow-sm resize-none"
                    />
                  </div>
                  <div className="flex items-center gap-4">
                    <button
                      onClick={previewPayroll}
                      className="flex-1 flex items-center justify-center gap-2 px-6 py-4 bg-white border border-gray-100 text-gray-900 rounded-2xl text-sm font-black shadow-sm hover:shadow-xl hover:border-primary/20 hover:-translate-y-0.5 active:translate-y-0 transition-all"
                    >
                      <Eye className="w-4 h-4" /> CALCULATE PREVIEW
                    </button>
                    <button
                      onClick={savePayrollDraft}
                      disabled={payrollPreviewRows.length === 0}
                      className="flex-1 flex items-center justify-center gap-2 px-6 py-4 bg-primary text-primary-foreground rounded-2xl text-sm font-black shadow-lg shadow-primary/20 hover:-translate-y-0.5 active:translate-y-0 transition-all disabled:opacity-50 disabled:grayscale disabled:translate-y-0"
                    >
                      <Download className="w-4 h-4" /> SAVE PAYROLL RUN
                    </button>
                  </div>
                </div>
              </div>

              {/* Penalties Summary Card */}
              <div className="space-y-6">
                <div className="p-8 bg-rose-50/50 backdrop-blur-xl border border-rose-100 rounded-[2.5rem] shadow-sm space-y-6">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-black text-rose-900 flex items-center gap-2">
                      <AlertCircle className="w-5 h-5" />
                      Penalties
                    </h3>
                    <button
                      onClick={openAddPenalty}
                      className="p-2 rounded-xl bg-rose-500 text-white shadow-lg shadow-rose-500/20 hover:scale-110 active:scale-95 transition-all"
                    >
                      <Plus className="w-5 h-5" />
                    </button>
                  </div>
                  <div className="space-y-3 max-h-[200px] overflow-y-auto no-scrollbar">
                    {periodPenalties.length === 0 ? (
                      <p className="text-xs font-bold text-rose-600/60 italic text-center py-4">No penalties for {payrollMonth || 'selected month'}</p>
                    ) : (
                      periodPenalties.map((pen) => (
                        <div key={pen.id} className="p-4 bg-white/60 border border-rose-200/40 rounded-2xl flex items-center justify-between group">
                          <div>
                            <div className="text-xs font-black text-rose-900">{pen.repName}</div>
                            <div className="text-[10px] font-bold text-rose-600 uppercase tracking-wider">{pen.type}</div>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-sm font-black text-rose-600">-{formatMoney(pen.amount)}</span>
                            <button
                              onClick={() => removePenalty(pen.id)}
                              className="opacity-0 group-hover:opacity-100 p-1 text-rose-400 hover:text-rose-600 transition-all"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Preview Table */}
            <div className="bg-white/40 backdrop-blur-xl border border-white/40 rounded-[2.5rem] shadow-sm overflow-hidden">
              <div className="px-8 py-6 border-b border-white/40 flex items-center justify-between bg-white/20">
                <h2 className="text-xl font-black text-gray-900 flex items-center gap-3">
                  <TrendingUp className="w-5 h-5 text-primary" />
                  Calculated Earnings Preview
                </h2>
                {payrollPreviewRows.length > 0 && (
                  <div className="flex items-baseline gap-2">
                    <span className="text-xs font-black text-muted-foreground uppercase tracking-widest">Total Payout:</span>
                    <span className="text-2xl font-black text-primary">{formatMoney(payrollGrandTotal)}</span>
                  </div>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-gray-50/50">
                      <th className="px-8 py-4 text-xs font-black text-muted-foreground uppercase tracking-widest">Member</th>
                      <th className="px-8 py-4 text-xs font-black text-muted-foreground uppercase tracking-widest text-center">Delivered</th>
                      <th className="px-8 py-4 text-xs font-black text-muted-foreground uppercase tracking-widest">Base Salary</th>
                      <th className="px-8 py-4 text-xs font-black text-muted-foreground uppercase tracking-widest">Commission</th>
                      <th className="px-8 py-4 text-xs font-black text-muted-foreground uppercase tracking-widest">Bonus</th>
                      <th className="px-8 py-4 text-xs font-black text-muted-foreground uppercase tracking-widest">Deductions</th>
                      <th className="px-8 py-4 text-xs font-black text-muted-foreground uppercase tracking-widest text-right">Net Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/40">
                    {payrollPreviewRows.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-8 py-20 text-center">
                          <div className="flex flex-col items-center gap-3">
                            <div className="w-12 h-12 rounded-2xl bg-gray-100 flex items-center justify-center text-gray-400">
                              <Eye className="w-6 h-6" />
                            </div>
                            <p className="text-sm font-bold text-muted-foreground italic">Click "Calculate Preview" to see results</p>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      payrollPreviewRows.map((row) => (
                        <tr key={row.userId} className="group hover:bg-white/40 transition-all">
                          <td className="px-8 py-5 font-bold text-gray-900">{row.name}</td>
                          <td className="px-8 py-5 text-center font-black text-gray-600">{row.delivered}</td>
                          <td className="px-8 py-5 font-bold text-gray-700">{formatMoney(row.fixedSalary)}</td>
                          <td className="px-8 py-5 font-bold text-gray-700">{formatMoney(row.commission)}</td>
                          <td className="px-8 py-5 font-bold text-emerald-600">{formatMoney(row.autoBonus ?? 0)}</td>
                          <td className="px-8 py-5 font-bold text-rose-500">
                            {(row.deductions ?? 0) > 0 ? `-${formatMoney(row.deductions ?? 0)}` : '—'}
                          </td>
                          <td className="px-8 py-5 text-right font-black text-primary text-base">
                            {formatMoney(row.total)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </motion.section>
        )}

        {payrollTab === "History" && (
          <motion.section
            key="history"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="space-y-6"
          >
            <div className="bg-white/40 backdrop-blur-xl border border-white/40 rounded-[2.5rem] shadow-sm overflow-hidden">
              <div className="px-8 py-6 border-b border-white/40 flex items-center justify-between">
                <h2 className="text-xl font-black text-gray-900 flex items-center gap-3">
                  <History className="w-5 h-5 text-primary" />
                  Past Payroll Runs
                </h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-gray-50/50">
                      <th className="px-8 py-4 text-xs font-black text-muted-foreground uppercase tracking-widest">Run Name</th>
                      <th className="px-8 py-4 text-xs font-black text-muted-foreground uppercase tracking-widest text-center">Month</th>
                      <th className="px-8 py-4 text-xs font-black text-muted-foreground uppercase tracking-widest text-center">Staff</th>
                      <th className="px-8 py-4 text-xs font-black text-muted-foreground uppercase tracking-widest">Total Payout</th>
                      <th className="px-8 py-4 text-xs font-black text-muted-foreground uppercase tracking-widest">Generated On</th>
                      <th className="px-8 py-4 text-xs font-black text-muted-foreground uppercase tracking-widest text-right">Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/40">
                    {payrollRuns.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-8 py-20 text-center text-sm font-bold text-muted-foreground italic">No payroll history found.</td>
                      </tr>
                    ) : (
                      payrollRuns.map((run) => (
                        <tr key={run.id} className="group hover:bg-white/40 transition-all">
                          <td className="px-8 py-5">
                            <div className="font-bold text-gray-900">{run.label}</div>
                            <div className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">{run.id}</div>
                          </td>
                          <td className="px-8 py-5 text-center font-bold text-gray-700">{run.month}</td>
                          <td className="px-8 py-5 text-center font-bold text-gray-700">{run.rows.length}</td>
                          <td className="px-8 py-5 font-black text-primary">{formatMoney(run.total)}</td>
                          <td className="px-8 py-5 text-xs font-black text-muted-foreground uppercase tracking-widest">
                            {displayDateFromKey(run.createdAt)}
                          </td>
                          <td className="px-8 py-5 text-right">
                            <button className="p-2.5 rounded-xl bg-white border border-gray-100 text-gray-400 hover:text-primary hover:border-primary/20 hover:shadow-lg transition-all">
                              <ChevronRight className="w-5 h-5" />
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </motion.section>
        )}
      </AnimatePresence>
    </div>
  );
};
