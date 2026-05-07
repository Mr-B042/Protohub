import React, { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  CalendarClock, 
  CalendarDays, 
  Package, 
  UserRound, 
  Truck,
  CheckCircle2,
  Clock,
  Filter,
  ArrowRight,
  Phone,
  Search,
  LayoutGrid
} from 'lucide-react';
import { TrackedOrder, ManagedUser, ScheduleRange } from '../types';

interface ScheduledDeliveriesProps {
  scheduledDeliveryRows: TrackedOrder[];
  scheduleRange: ScheduleRange;
  setScheduleRange: (range: ScheduleRange) => void;
  scheduleRanges: readonly ScheduleRange[];
  users: ManagedUser[];
  agentNameForOrder: (order: TrackedOrder) => string;
  displayDateFromKey: (key: string) => string;
  showToast: (msg: string) => void;
}

export const ScheduledDeliveries: React.FC<ScheduledDeliveriesProps> = ({
  scheduledDeliveryRows,
  scheduleRange,
  setScheduleRange,
  scheduleRanges,
  users,
  agentNameForOrder,
  displayDateFromKey,
  showToast
}) => {
  const stats = useMemo(() => {
    const total = scheduledDeliveryRows.length;
    const dispatched = scheduledDeliveryRows.filter(o => o.status === "Dispatched").length;
    const confirmed = scheduledDeliveryRows.filter(o => o.status === "Confirmed").length;
    const postponed = scheduledDeliveryRows.filter(o => o.status === "Postponed").length;

    return [
      { label: 'Total Scheduled', value: total, icon: CalendarClock, color: 'text-blue-500', bg: 'bg-blue-500/10' },
      { label: 'Confirmed', value: confirmed, icon: CheckCircle2, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
      { label: 'In Dispatch', value: dispatched, icon: Truck, color: 'text-indigo-500', bg: 'bg-indigo-500/10' },
      { label: 'Postponed', value: postponed, icon: Clock, color: 'text-rose-500', bg: 'bg-rose-500/10' },
    ];
  }, [scheduledDeliveryRows]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Delivered': return 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20';
      case 'Dispatched': return 'bg-indigo-500/10 text-indigo-600 border-indigo-500/20';
      case 'Confirmed': return 'bg-blue-500/10 text-blue-600 border-blue-500/20';
      case 'Postponed': return 'bg-rose-500/10 text-rose-600 border-rose-500/20';
      case 'In Process': return 'bg-amber-500/10 text-amber-600 border-amber-500/20';
      default: return 'bg-gray-500/10 text-gray-600 border-gray-500/20';
    }
  };

  return (
    <div className="space-y-8 pb-12">
      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="space-y-1">
          <h1 className="text-4xl font-black tracking-tight bg-gradient-to-r from-gray-900 to-gray-600 bg-clip-text text-transparent">
            Scheduled Deliveries
          </h1>
          <p className="text-muted-foreground font-medium">
            Track committed delivery dates from sales representatives.
          </p>
        </div>

        <div className="flex bg-white/50 backdrop-blur-xl p-1.5 border border-white/40 rounded-2xl shadow-sm overflow-x-auto no-scrollbar">
          {scheduleRanges.map((range) => (
            <button
              key={range}
              onClick={() => {
                setScheduleRange(range);
                showToast(`Viewing deliveries for ${range}`);
              }}
              className={`px-6 py-2 rounded-xl text-sm font-bold transition-all whitespace-nowrap ${
                scheduleRange === range 
                ? "bg-primary text-primary-foreground shadow-lg shadow-primary/20" 
                : "text-muted-foreground hover:text-gray-900 hover:bg-white/50"
              }`}
            >
              {range}
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

      {/* Table Section */}
      <section className="bg-white/40 backdrop-blur-xl border border-white/40 rounded-[2.5rem] shadow-sm overflow-hidden">
        <div className="px-8 py-6 border-b border-white/40 flex items-center justify-between bg-white/20">
          <h2 className="text-xl font-black text-gray-900 flex items-center gap-3">
            <LayoutGrid className="w-5 h-5 text-primary" />
            Active Commitments ({scheduleRange})
          </h2>
          <div className="flex items-center gap-4">
            <div className="relative group">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground transition-colors group-focus-within:text-primary" />
              <input 
                type="text" 
                placeholder="Search schedule..."
                className="pl-11 pr-4 py-2 bg-white border border-gray-100 rounded-xl text-xs font-bold focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all w-48 shadow-sm"
              />
            </div>
          </div>
        </div>

        <div className="overflow-x-auto overflow-y-visible">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50/50">
                <th className="px-8 py-4 text-xs font-black text-muted-foreground uppercase tracking-widest">Order ID</th>
                <th className="px-8 py-4 text-xs font-black text-muted-foreground uppercase tracking-widest">Customer</th>
                <th className="px-8 py-4 text-xs font-black text-muted-foreground uppercase tracking-widest">Product</th>
                <th className="px-8 py-4 text-xs font-black text-muted-foreground uppercase tracking-widest">Team Assigned</th>
                <th className="px-8 py-4 text-xs font-black text-muted-foreground uppercase tracking-widest text-right">Commitment Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/40">
              <AnimatePresence mode="popLayout">
                {scheduledDeliveryRows.length === 0 ? (
                  <motion.tr
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                  >
                    <td colSpan={5} className="px-8 py-20 text-center">
                      <div className="flex flex-col items-center gap-4 opacity-50">
                        <div className="w-16 h-16 rounded-[2rem] bg-gray-100 flex items-center justify-center text-gray-400">
                          <CalendarClock className="w-8 h-8" />
                        </div>
                        <p className="text-sm font-bold text-muted-foreground italic max-w-xs mx-auto">
                          No deliveries scheduled for {scheduleRange.toLowerCase()}.
                        </p>
                      </div>
                    </td>
                  </motion.tr>
                ) : (
                  scheduledDeliveryRows.map((order, idx) => (
                    <motion.tr
                      key={order.id}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 20 }}
                      transition={{ delay: idx * 0.03 }}
                      className="group hover:bg-white/40 transition-all duration-300"
                    >
                      <td className="px-8 py-5 font-black text-gray-900 group-hover:text-primary transition-colors">
                        {order.id}
                      </td>
                      <td className="px-8 py-5">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center text-[10px] font-black text-gray-500 uppercase">
                            {order.customer.charAt(0)}
                          </div>
                          <div>
                            <div className="font-bold text-gray-900">{order.customer}</div>
                            <div className="text-[10px] font-black text-muted-foreground flex items-center gap-1.5 uppercase tracking-wider">
                              <Phone className="w-3 h-3" />
                              {order.phone}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-8 py-5">
                        <div className="space-y-1">
                          <div className="font-bold text-gray-900 flex items-center gap-2">
                            <Package className="w-3.5 h-3.5 text-primary" />
                            {order.productName}
                          </div>
                          <div className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">
                            {order.packageName}
                          </div>
                        </div>
                      </td>
                      <td className="px-8 py-5">
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-2">
                            <span className="p-1 rounded-md bg-amber-50 text-amber-600">
                              <UserRound className="w-3 h-3" />
                            </span>
                            <span className="text-xs font-bold text-gray-900">
                              {users.find((user) => user.id === order.assignedRepId)?.name ?? "Unassigned"}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="p-1 rounded-md bg-indigo-50 text-indigo-600">
                              <Truck className="w-3 h-3" />
                            </span>
                            <span className="text-[10px] font-black text-muted-foreground uppercase tracking-wider">
                              {agentNameForOrder(order)}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="px-8 py-5 text-right">
                        <div className="space-y-2 flex flex-col items-end">
                          <span className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border ${getStatusColor(order.status ?? 'New')}`}>
                            {order.status ?? 'New'}
                          </span>
                          <div className="text-sm font-black text-primary flex items-center gap-1.5">
                            <CalendarDays className="w-3.5 h-3.5" />
                            {displayDateFromKey(order.scheduledDate || "")}
                          </div>
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
