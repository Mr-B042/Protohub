import React, { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Repeat2, 
  Search, 
  UserRound, 
  ArrowRight, 
  Info, 
  LayoutGrid, 
  CheckCircle2, 
  XCircle, 
  Zap, 
  ShieldAlert, 
  ChevronRight,
  TrendingUp,
  History,
  Lock,
  Unlock,
  Settings,
  MoreVertical
} from 'lucide-react';
import { 
  RoundRobinTab, 
  ManagedUser, 
  ActivePage
} from '../types';

interface RoundRobinRow {
  user: ManagedUser;
  openOrders: number;
  delivered: number;
}

interface RoundRobinProps {
  roundRobinTab: RoundRobinTab;
  setRoundRobinTab: (tab: RoundRobinTab) => void;
  roundRobinTabs: readonly RoundRobinTab[];
  roundRobinSearch: string;
  setRoundRobinSearch: (search: string) => void;
  roundRobinActiveRows: RoundRobinRow[];
  roundRobinExcludedRows: RoundRobinRow[];
  roundRobinRows: RoundRobinRow[];
  users: ManagedUser[];
  setUsers: React.Dispatch<React.SetStateAction<ManagedUser[]>>;
  openEditUserModal: (user: ManagedUser) => void;
  showToast: (msg: string) => void;
}

export const RoundRobin: React.FC<RoundRobinProps> = ({
  roundRobinTab,
  setRoundRobinTab,
  roundRobinTabs,
  roundRobinSearch,
  setRoundRobinSearch,
  roundRobinActiveRows,
  roundRobinExcludedRows,
  roundRobinRows,
  users,
  setUsers,
  openEditUserModal,
  showToast
}) => {
  const handleAdvanceSequence = () => {
    const reps = users.filter((u) => u.role === "Sales Rep");
    if (reps.length === 0) { 
      showToast("No sales representatives in the distribution sequence."); 
      return; 
    }
    
    const first = reps[0];
    setUsers((prev) => {
      const nonReps = prev.filter((u) => u.role !== "Sales Rep");
      const rotated = [...reps.slice(1), first];
      return [...nonReps, ...rotated];
    });
    showToast(`Sequence advanced. ${reps[1]?.name ?? reps[0].name} is now priority #1.`);
  };

  return (
    <div className="space-y-8 pb-12">
      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="space-y-1">
          <h1 className="text-4xl font-black tracking-tight bg-gradient-to-r from-gray-900 to-gray-600 bg-clip-text text-transparent">
            Lead Orchestration
          </h1>
          <p className="text-muted-foreground font-medium">
            Configure the automated lead distribution sequence for your sales workforce.
          </p>
        </div>

        <button 
          onClick={handleAdvanceSequence}
          className="flex items-center gap-2 px-6 py-3 bg-rose-500 text-white rounded-2xl text-sm font-black shadow-lg shadow-rose-500/20 hover:scale-105 active:scale-95 transition-all"
        >
          <Repeat2 className="w-4 h-4" />
          ADVANCE SEQUENCE
        </button>
      </header>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex bg-white/50 backdrop-blur-xl p-1 border border-white/40 rounded-2xl shadow-sm">
            {roundRobinTabs.map((tab) => (
              <button 
                key={tab}
                onClick={() => setRoundRobinTab(tab)}
                className={`px-6 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                  roundRobinTab === tab 
                  ? "bg-primary text-primary-foreground shadow-lg shadow-primary/20" 
                  : "text-muted-foreground hover:text-gray-900"
                }`}
              >
                {tab}
                <span className="ml-2 opacity-50">
                  ({tab === "Active Sequence" ? roundRobinActiveRows.length : roundRobinExcludedRows.length})
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="relative group flex-1 max-w-md">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground transition-colors group-focus-within:text-primary" />
          <input 
            type="text" 
            value={roundRobinSearch}
            onChange={(e) => setRoundRobinSearch(e.target.value)}
            placeholder="Search representatives..."
            className="w-full pl-11 pr-4 py-2.5 bg-white border border-gray-100 rounded-2xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all shadow-sm"
          />
        </div>
      </div>

      {/* Sequence List */}
      <section className="space-y-4">
        <div className="flex items-center justify-between px-2">
          <h2 className="text-xl font-black text-gray-900 flex items-center gap-3">
            <LayoutGrid className="w-5 h-5 text-primary" />
            Distribution Queue
          </h2>
          <span className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.2em]">
            Priority Sorted
          </span>
        </div>

        <div className="flex flex-col gap-3">
          <AnimatePresence mode="popLayout">
            {roundRobinRows.length === 0 ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="py-20 text-center bg-white/40 border border-dashed border-white/40 rounded-[2.5rem] opacity-50 flex flex-col items-center gap-4"
              >
                <UserRound className="w-12 h-12 text-muted-foreground" />
                <p className="text-sm font-bold italic">No representatives found in this segment.</p>
              </motion.div>
            ) : (
              roundRobinRows.map((row, idx) => (
                <motion.article
                  key={row.user.id}
                  layout
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  transition={{ delay: idx * 0.05 }}
                  className={`group p-6 bg-white/40 backdrop-blur-xl border border-white/40 rounded-[2.5rem] shadow-sm hover:shadow-xl hover:shadow-primary/5 transition-all flex items-center gap-6 ${
                    idx === 0 && roundRobinTab === "Active Sequence" ? 'ring-2 ring-primary/20 border-primary/20' : ''
                  }`}
                >
                  <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-sm font-black shadow-inner shrink-0 ${
                    idx === 0 && roundRobinTab === "Active Sequence" 
                    ? 'bg-primary text-white' 
                    : 'bg-white border border-gray-100 text-muted-foreground'
                  }`}>
                    #{idx + 1}
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-gray-900 group-hover:text-primary transition-colors">
                      {row.user.name}
                    </div>
                    <div className="text-[10px] font-black text-muted-foreground uppercase tracking-widest truncate">
                      {row.user.email}
                    </div>
                  </div>

                  <div className="hidden sm:flex items-center gap-8 shrink-0">
                    <div className="text-center">
                      <div className="text-sm font-black text-gray-900">{row.openOrders}</div>
                      <div className="text-[9px] font-black text-muted-foreground uppercase tracking-widest">Active Orders</div>
                    </div>
                    <div className="text-center">
                      <div className="text-sm font-black text-emerald-600">{row.delivered}</div>
                      <div className="text-[9px] font-black text-muted-foreground uppercase tracking-widest">Successful</div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => openEditUserModal(row.user)}
                      className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                        row.user.active 
                        ? 'bg-white border border-rose-100 text-rose-500 hover:bg-rose-500 hover:text-white' 
                        : 'bg-white border border-emerald-100 text-emerald-500 hover:bg-emerald-500 hover:text-white'
                      }`}
                    >
                      {row.user.active ? 'EXCLUDE FROM LIST' : 'RE-ENABLE RECIPIENT'}
                    </button>
                    <button className="p-2.5 rounded-xl bg-white border border-gray-100 text-gray-400 hover:text-primary hover:border-primary/20 transition-all">
                      <MoreVertical className="w-4 h-4" />
                    </button>
                  </div>
                </motion.article>
              ))
            )}
          </AnimatePresence>
        </div>
      </section>

      {/* Explanation Banner */}
      <section className="p-8 bg-primary/5 border border-primary/10 rounded-[3rem] flex items-start gap-6">
        <div className="p-4 rounded-[1.5rem] bg-primary/10 text-primary">
          <Zap className="w-6 h-6" />
        </div>
        <div className="space-y-2">
          <h3 className="text-lg font-black text-gray-900 flex items-center gap-2">
            Dynamic Load Balancing
            <ArrowRight className="w-4 h-4" />
          </h3>
          <p className="text-sm font-medium text-gray-600 leading-relaxed max-w-2xl">
            The round-robin algorithm ensures equitable lead distribution across your sales team. 
            New orders are assigned to the representative at <strong className="text-primary font-black">Priority #1</strong>. 
            Once an assignment is logged, the recipient is cycled to the end of the active sequence to maintain workforce balance.
          </p>
        </div>
      </section>
    </div>
  );
};
