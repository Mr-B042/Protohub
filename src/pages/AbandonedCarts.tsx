import React, { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  ShoppingCart, 
  Search, 
  Filter, 
  Eye, 
  UserPlus, 
  ArrowRight,
  TrendingUp,
  BadgeCheck,
  UserRound,
  MoreVertical,
  Calendar,
  Phone,
  Package,
  ExternalLink,
  MessageCircle,
  Clock
} from 'lucide-react';
import { 
  AbandonedCartRecord, 
  ManagedUser, 
  CartStatus, 
  ModalType,
  ProductCurrencyCode
} from '../types';

interface AbandonedCartsProps {
  abandonedCarts: AbandonedCartRecord[];
  users: ManagedUser[];
  cartSearch: string;
  setCartSearch: (search: string) => void;
  cartStatus: CartStatus;
  setCartStatus: (status: CartStatus) => void;
  cartStatuses: CartStatus[];
  setModal: (modal: ModalType) => void;
  setSelectedCartId: (id: string) => void;
  updateCartStatus: (id: string, status: Exclude<CartStatus, "All statuses">) => void;
  formatProductMoney: (amount: number, currency: ProductCurrencyCode) => string;
  displayDateFromKey: (key: string) => string;
  showToast: (msg: string) => void;
}

export const AbandonedCarts: React.FC<AbandonedCartsProps> = ({
  abandonedCarts,
  users,
  cartSearch,
  setCartSearch,
  cartStatus,
  setCartStatus,
  cartStatuses,
  setModal,
  setSelectedCartId,
  updateCartStatus,
  formatProductMoney,
  displayDateFromKey,
  showToast
}) => {
  const filteredCarts = useMemo(() => {
    return abandonedCarts.filter((cart) => {
      const search = cartSearch.trim().toLowerCase();
      const matchesSearch = !search || 
        `${cart.id} ${cart.customer} ${cart.phone} ${cart.productName}`.toLowerCase().includes(search);
      const matchesStatus = cartStatus === "All statuses" || cart.status === cartStatus;
      return matchesSearch && matchesStatus;
    });
  }, [abandonedCarts, cartSearch, cartStatus]);

  const stats = useMemo(() => {
    const open = abandonedCarts.filter(c => ["Open abandoned", "Abandoned", "In progress"].includes(c.status)).length;
    const assigned = abandonedCarts.filter(c => c.assignedRepId && c.status !== "Converted").length;
    const contacted = abandonedCarts.filter(c => ["Contacted", "Converted", "No response", "Not interested"].includes(c.status)).length;
    const converted = abandonedCarts.filter(c => c.status === "Converted").length;
    const conversionRate = abandonedCarts.length === 0 ? 0 : Math.round((converted / abandonedCarts.length) * 100);

    return [
      { label: 'Open Carts', value: open, icon: ShoppingCart, color: 'text-blue-500', bg: 'bg-blue-500/10' },
      { label: 'Assigned', value: assigned, icon: UserRound, color: 'text-amber-500', bg: 'bg-amber-500/10' },
      { label: 'Contacted', value: contacted, icon: BadgeCheck, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
      { label: 'Conversion', value: `${conversionRate}%`, icon: TrendingUp, color: 'text-indigo-500', bg: 'bg-indigo-500/10', sub: `${converted} converted` },
    ];
  }, [abandonedCarts]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Converted': return 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20';
      case 'In progress': return 'bg-blue-500/10 text-blue-600 border-blue-500/20';
      case 'Contacted': return 'bg-indigo-500/10 text-indigo-600 border-indigo-500/20';
      case 'Abandoned':
      case 'Open abandoned': return 'bg-rose-500/10 text-rose-600 border-rose-500/20';
      case 'No response': return 'bg-slate-500/10 text-slate-600 border-slate-500/20';
      case 'Not interested': return 'bg-amber-500/10 text-amber-600 border-amber-500/20';
      default: return 'bg-gray-500/10 text-gray-600 border-gray-500/20';
    }
  };

  return (
    <div className="space-y-8 pb-12">
      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="space-y-1">
          <h1 className="text-4xl font-black tracking-tight bg-gradient-to-r from-gray-900 to-gray-600 bg-clip-text text-transparent">
            Abandoned Carts
          </h1>
          <p className="text-muted-foreground font-medium">
            Monitor and recover lost sales opportunities.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative group">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground transition-colors group-focus-within:text-primary" />
            <input
              type="text"
              placeholder="Search carts..."
              value={cartSearch}
              onChange={(e) => setCartSearch(e.target.value)}
              className="pl-11 pr-4 py-2.5 bg-white/50 backdrop-blur-xl border border-white/40 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-all w-full md:w-64 shadow-sm"
            />
          </div>
          <select
            value={cartStatus}
            onChange={(e) => setCartStatus(e.target.value as CartStatus)}
            className="px-4 py-2.5 bg-white/50 backdrop-blur-xl border border-white/40 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-all shadow-sm cursor-pointer font-medium"
          >
            {cartStatuses.map(status => (
              <option key={status} value={status}>{status}</option>
            ))}
          </select>
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
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-black tracking-tight text-gray-900">{stat.value}</span>
                {stat.sub && <span className="text-xs font-bold text-muted-foreground">{stat.sub}</span>}
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Table Section */}
      <section className="bg-white/40 backdrop-blur-xl border border-white/40 rounded-[2.5rem] shadow-sm overflow-hidden">
        <div className="px-8 py-6 border-b border-white/40 flex items-center justify-between">
          <h2 className="text-xl font-black text-gray-900 flex items-center gap-3">
            <Filter className="w-5 h-5 text-primary" />
            Cart Follow-up Queue
          </h2>
          <span className="px-4 py-1 bg-primary/10 text-primary text-xs font-black rounded-full uppercase tracking-widest">
            {filteredCarts.length} Records Found
          </span>
        </div>

        <div className="overflow-x-auto overflow-y-visible">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50/50">
                <th className="px-8 py-4 text-xs font-black text-muted-foreground uppercase tracking-widest">Customer</th>
                <th className="px-8 py-4 text-xs font-black text-muted-foreground uppercase tracking-widest">Order Details</th>
                <th className="px-8 py-4 text-xs font-black text-muted-foreground uppercase tracking-widest">Assignment</th>
                <th className="px-8 py-4 text-xs font-black text-muted-foreground uppercase tracking-widest">Status</th>
                <th className="px-8 py-4 text-xs font-black text-muted-foreground uppercase tracking-widest text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/40">
              <AnimatePresence mode="popLayout">
                {filteredCarts.length === 0 ? (
                  <motion.tr
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                  >
                    <td colSpan={5} className="px-8 py-20 text-center">
                      <div className="flex flex-col items-center gap-4">
                        <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center text-gray-400">
                          <ShoppingCart className="w-8 h-8" />
                        </div>
                        <div className="space-y-1">
                          <p className="text-lg font-bold text-gray-900">No matching carts</p>
                          <p className="text-sm text-muted-foreground">Try adjusting your filters or search term.</p>
                        </div>
                      </div>
                    </td>
                  </motion.tr>
                ) : (
                  filteredCarts.map((cart, idx) => (
                    <motion.tr
                      key={cart.id}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 20 }}
                      transition={{ delay: idx * 0.03 }}
                      className="group hover:bg-white/40 transition-all duration-300"
                    >
                      <td className="px-8 py-5">
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary/10 to-primary/5 flex items-center justify-center text-primary font-bold shadow-inner">
                            {cart.customer.charAt(0)}
                          </div>
                          <div>
                            <div className="font-bold text-gray-900">{cart.customer}</div>
                            <div className="text-xs font-bold text-muted-foreground flex items-center gap-2">
                              <Phone className="w-3 h-3" />
                              {cart.phone}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-8 py-5">
                        <div className="space-y-1">
                          <div className="font-bold text-gray-900 flex items-center gap-2">
                            <Package className="w-3.5 h-3.5 text-primary" />
                            {cart.productName}
                          </div>
                          <div className="text-xs font-bold text-muted-foreground">
                            {cart.packageName} · {formatProductMoney(cart.amount, cart.currency)}
                          </div>
                        </div>
                      </td>
                      <td className="px-8 py-5">
                        <div className="space-y-1">
                          <div className="font-bold text-gray-900 flex items-center gap-2">
                            <UserRound className="w-3.5 h-3.5 text-muted-foreground" />
                            {users.find((u) => u.id === cart.assignedRepId)?.name ?? "Unassigned"}
                          </div>
                          <div className="text-[10px] font-black text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                            <Clock className="w-3 h-3" />
                            Added {displayDateFromKey(cart.createdAt)}
                          </div>
                        </div>
                      </td>
                      <td className="px-8 py-5">
                        <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border ${getStatusColor(cart.status)} transition-all group-hover:scale-105 inline-block`}>
                          {cart.status}
                        </span>
                      </td>
                      <td className="px-8 py-5 text-right">
                        <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-all -translate-x-2 group-hover:translate-x-0">
                          <button 
                            onClick={() => {
                              setSelectedCartId(cart.id);
                              setModal('cartDetails' as ModalType);
                            }}
                            className="p-2.5 rounded-xl bg-white border border-gray-100 text-gray-500 hover:text-primary hover:border-primary/20 hover:shadow-lg transition-all"
                            title="View Details"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          <button 
                            onClick={() => {
                              setSelectedCartId(cart.id);
                              setModal('assignCart' as ModalType);
                            }}
                            className="p-2.5 rounded-xl bg-white border border-gray-100 text-gray-500 hover:text-amber-500 hover:border-amber-500/20 hover:shadow-lg transition-all"
                            title="Assign to Rep"
                          >
                            <UserPlus className="w-4 h-4" />
                          </button>
                          <div className="w-px h-6 bg-gray-100 mx-1" />
                          <button 
                            disabled={cart.status === "Converted"}
                            onClick={() => {
                              setSelectedCartId(cart.id);
                              setModal('convertCart' as ModalType);
                            }}
                            className="flex items-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground rounded-xl text-xs font-black shadow-lg shadow-primary/20 hover:scale-105 active:scale-95 transition-all disabled:opacity-50 disabled:grayscale disabled:scale-100"
                          >
                            CONVERT
                            <ArrowRight className="w-3.5 h-3.5" />
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
