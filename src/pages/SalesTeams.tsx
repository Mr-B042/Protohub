import React, { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Users, 
  Plus, 
  Search, 
  Filter, 
  Shield, 
  Boxes, 
  PackageCheck, 
  Info, 
  ChevronRight,
  UserRound,
  LayoutGrid,
  ShieldCheck,
  Target,
  Zap,
  Tag,
  Link2
} from 'lucide-react';
import { 
  SalesTeam, 
  ManagedUser, 
  Product, 
  ModalType,
  ActivePage,
  ProductCurrencyCode
} from '../types';

interface SalesRepRow {
  user: ManagedUser;
  orders: number;
  delivered: number;
  conversion: number;
  revenue: number;
}

interface SalesTeamsProps {
  salesTeams: SalesTeam[];
  salesRepUsers: ManagedUser[];
  products: Product[];
  users: ManagedUser[];
  salesRepRows: SalesRepRow[];
  productTeamScope: (product: Product) => string[];
  primaryPricing: (product: Product) => { sellingPrice: number; currency: string } | undefined;
  formatProductMoney: (amount: number, currency: ProductCurrencyCode) => string;
  totalProductStock: (product: Product) => number;
  teamForRep: (rep: ManagedUser) => SalesTeam | undefined;
  setModal: (modal: ModalType) => void;
  setNewTeamName: (name: string) => void;
  setNewTeamLeadId: (id: string) => void;
  showToast: (msg: string) => void;
}

export const SalesTeams: React.FC<SalesTeamsProps> = ({
  salesTeams,
  salesRepUsers,
  products,
  users,
  salesRepRows,
  productTeamScope,
  primaryPricing,
  formatProductMoney,
  totalProductStock,
  teamForRep,
  setModal,
  setNewTeamName,
  setNewTeamLeadId,
  showToast
}) => {
  const stats = [
    { label: "Total Teams", value: salesTeams.length, helper: "Active selling groups", icon: Users, color: "text-blue-500", bg: "bg-blue-500/10" },
    { label: "Assigned Reps", value: salesRepUsers.length, helper: "Mapped to a team", icon: UserRound, color: "text-emerald-500", bg: "bg-emerald-500/10" },
    { label: "Scoped Products", value: products.filter((p) => productTeamScope(p).length > 0).length, helper: "Product-team links", icon: PackageCheck, color: "text-orange-500", bg: "bg-orange-500/10" },
    { label: "All-Team Products", value: products.filter((p) => productTeamScope(p).length === 0).length, helper: "Visible to everyone", icon: Boxes, color: "text-purple-500", bg: "bg-purple-500/10" },
  ];

  return (
    <div className="space-y-8 pb-12">
      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="space-y-1">
          <h1 className="text-4xl font-black tracking-tight bg-gradient-to-r from-gray-900 to-gray-600 bg-clip-text text-transparent">
            Sales Structure
          </h1>
          <p className="text-muted-foreground font-medium">
            Define team hierarchies, leads, and product selling scopes.
          </p>
        </div>

        <button 
          onClick={() => { setNewTeamName(""); setNewTeamLeadId(""); setModal("createTeam"); }}
          className="flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-2xl text-sm font-black shadow-lg shadow-primary/20 hover:scale-105 active:scale-95 transition-all"
        >
          <Plus className="w-4 h-4" />
          CREATE TEAM
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
              <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wider">{stat.label}</h3>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-black tracking-tight text-gray-900">{stat.value}</span>
                <span className="text-[10px] font-bold text-muted-foreground italic">{stat.helper}</span>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Team Config Summary */}
      <section className="p-8 bg-white/40 backdrop-blur-xl border border-white/40 rounded-[2.5rem] shadow-sm">
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-xl font-black text-gray-900 flex items-center gap-3">
            <ShieldCheck className="w-5 h-5 text-primary" />
            Active Configuration
          </h2>
          <button 
            onClick={() => showToast("Reviewing team architecture...")}
            className="flex items-center gap-2 text-xs font-black text-primary uppercase tracking-widest hover:opacity-70 transition-opacity"
          >
            Architecture Workflow
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
          {[
            { label: "Primary Team", value: salesTeams[0]?.name ?? "None", icon: Users },
            { label: "Lead Manager", value: users.find((u) => u.id === salesTeams[0]?.leadId)?.name ?? "Unassigned", icon: UserRound },
            { label: "Product Visibility", value: salesTeams.length ? "Scoped Access" : "Universal", icon: Boxes },
            { label: "Assignment Strategy", value: "Round Robin (Intra-team)", icon: Target },
          ].map((item) => (
            <div key={item.label} className="space-y-3 p-4 bg-white/40 rounded-2xl border border-white/40">
              <div className="flex items-center gap-2 text-muted-foreground">
                <item.icon className="w-3.5 h-3.5" />
                <span className="text-[10px] font-black uppercase tracking-widest">{item.label}</span>
              </div>
              <div className="text-sm font-black text-gray-900">{item.value}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Members & Scopes Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
        {/* Team Members Table */}
        <section className="bg-white/40 backdrop-blur-xl border border-white/40 rounded-[2.5rem] shadow-sm overflow-hidden flex flex-col">
          <div className="px-8 py-6 border-b border-white/40 flex items-center justify-between bg-white/20">
            <h2 className="text-lg font-black text-gray-900 flex items-center gap-3">
              <Zap className="w-5 h-5 text-amber-500" />
              Member Assignments
            </h2>
            <span className="px-3 py-1 bg-amber-50 text-amber-600 text-[10px] font-black rounded-full uppercase tracking-widest">
              {salesRepUsers.length} Reps
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-gray-50/50">
                  <th className="px-8 py-4 text-[10px] font-black text-muted-foreground uppercase tracking-widest">Representative</th>
                  <th className="px-8 py-4 text-[10px] font-black text-muted-foreground uppercase tracking-widest">Team Link</th>
                  <th className="px-8 py-4 text-[10px] font-black text-muted-foreground uppercase tracking-widest text-right">Conv.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/40">
                {salesRepRows.map((row) => {
                  const team = teamForRep(row.user);
                  const lead = users.find((u) => u.id === team?.leadId);
                  return (
                    <tr key={row.user.id} className="group hover:bg-white/60 transition-all duration-300">
                      <td className="px-8 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-[10px] font-black text-primary">
                            {row.user.name.charAt(0)}
                          </div>
                          <div>
                            <div className="text-sm font-bold text-gray-900 group-hover:text-primary transition-colors">{row.user.name}</div>
                            <div className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">Lead: {lead?.name ?? "None"}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-8 py-4">
                        <span className="px-2 py-1 rounded-md bg-gray-100 text-gray-600 text-[10px] font-black uppercase tracking-widest border border-gray-200">
                          {team?.name ?? "Unassigned"}
                        </span>
                      </td>
                      <td className="px-8 py-4 text-right">
                        <span className="text-sm font-black text-gray-900">{row.conversion}%</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* Product Scope Table */}
        <section className="bg-white/40 backdrop-blur-xl border border-white/40 rounded-[2.5rem] shadow-sm overflow-hidden flex flex-col">
          <div className="px-8 py-6 border-b border-white/40 flex items-center justify-between bg-white/20">
            <h2 className="text-lg font-black text-gray-900 flex items-center gap-3">
              <Link2 className="w-5 h-5 text-indigo-500" />
              Product Mapping
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-gray-50/50">
                  <th className="px-8 py-4 text-[10px] font-black text-muted-foreground uppercase tracking-widest">Product Entity</th>
                  <th className="px-8 py-4 text-[10px] font-black text-muted-foreground uppercase tracking-widest">Scope</th>
                  <th className="px-8 py-4 text-[10px] font-black text-muted-foreground uppercase tracking-widest text-right">Price</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/40">
                {products.map((product) => {
                  const scope = productTeamScope(product);
                  const pricing = primaryPricing(product);
                  return (
                    <tr key={product.id} className="group hover:bg-white/60 transition-all duration-300">
                      <td className="px-8 py-4">
                        <div className="space-y-0.5">
                          <div className="text-sm font-bold text-gray-900 group-hover:text-primary transition-colors">{product.name}</div>
                          <div className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">{product.sku}</div>
                        </div>
                      </td>
                      <td className="px-8 py-4">
                        <div className="flex flex-wrap gap-1">
                          {scope.length === 0 ? (
                            <span className="px-2 py-1 rounded-md bg-indigo-50 text-indigo-600 text-[9px] font-black uppercase tracking-widest border border-indigo-100">
                              Universal
                            </span>
                          ) : (
                            scope.map(s => (
                              <span key={s} className="px-2 py-1 rounded-md bg-amber-50 text-amber-600 text-[9px] font-black uppercase tracking-widest border border-amber-100">
                                {s}
                              </span>
                            ))
                          )}
                        </div>
                      </td>
                      <td className="px-8 py-4 text-right">
                        <span className="text-sm font-black text-primary">
                          {formatProductMoney(pricing?.sellingPrice ?? 0, (pricing?.currency as ProductCurrencyCode) ?? "NGN")}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
};
