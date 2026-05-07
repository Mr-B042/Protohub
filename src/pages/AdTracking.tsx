import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { 
  Megaphone, 
  BookOpen, 
  ExternalLink, 
  TrendingUp, 
  Users, 
  Target,
  ArrowUpRight,
  Filter,
  Search,
  Package,
  Calendar,
  Layers,
  CircleDollarSign
} from 'lucide-react';
import { TrackedOrder, ProductCurrencyCode } from '../types';

interface AdTrackingProps {
  trackedOrders: TrackedOrder[];
  formatProductMoney: (amount: number, currency: ProductCurrencyCode) => string;
  showToast: (msg: string) => void;
}

export const AdTracking: React.FC<AdTrackingProps> = ({
  trackedOrders,
  formatProductMoney,
  showToast
}) => {
  const stats = useMemo(() => {
    const totalAttributed = trackedOrders.length;
    const totalRevenue = trackedOrders.reduce((sum, order) => sum + order.amount, 0);
    const uniqueCampaigns = new Set(trackedOrders.map(o => o.utmCampaign)).size;
    const uniqueSources = new Set(trackedOrders.map(o => o.utmSource)).size;

    return [
      { label: 'Attributed Orders', value: totalAttributed, icon: Target, color: 'text-indigo-500', bg: 'bg-indigo-500/10' },
      { label: 'Tracked Revenue', value: formatProductMoney(totalRevenue, 'NGN'), icon: CircleDollarSign, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
      { label: 'Active Campaigns', value: uniqueCampaigns, icon: Layers, color: 'text-blue-500', bg: 'bg-blue-500/10' },
      { label: 'Ad Channels', value: uniqueSources, icon: Megaphone, color: 'text-amber-500', bg: 'bg-amber-500/10' },
    ];
  }, [trackedOrders, formatProductMoney]);

  return (
    <div className="space-y-8 pb-12">
      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="space-y-1">
          <h1 className="text-4xl font-black tracking-tight bg-gradient-to-r from-gray-900 to-gray-600 bg-clip-text text-transparent">
            Ad Tracking
          </h1>
          <p className="text-muted-foreground font-medium">
            Monitor marketing performance and attribution through UTM parameters.
          </p>
        </div>

        <button 
          onClick={() => showToast("Ad tracking documentation coming soon!")}
          className="flex items-center gap-2 px-6 py-3 bg-white border border-gray-100 text-gray-900 rounded-2xl text-sm font-black shadow-sm hover:shadow-xl hover:border-primary/20 hover:-translate-y-0.5 active:translate-y-0 transition-all"
        >
          <BookOpen className="w-4 h-4 text-primary" />
          READ TRACKING GUIDE
        </button>
      </header>

      {/* Guide Callout */}
      <motion.div 
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        className="relative overflow-hidden group p-8 bg-gradient-to-br from-primary/5 to-indigo-500/5 border border-primary/10 rounded-[2.5rem] flex flex-col md:flex-row items-center gap-8 shadow-inner shadow-primary/5"
      >
        <div className="absolute top-0 right-0 -translate-y-1/2 translate-x-1/2 w-64 h-64 bg-primary/10 blur-[100px] rounded-full group-hover:bg-primary/20 transition-all duration-1000" />
        <div className="w-16 h-16 rounded-[1.5rem] bg-white shadow-xl shadow-primary/10 flex items-center justify-center text-primary shrink-0">
          <Target className="w-8 h-8 animate-pulse" />
        </div>
        <div className="flex-1 space-y-2 text-center md:text-left relative">
          <h2 className="text-xl font-black text-gray-900">Maximize Attribution Accuracy</h2>
          <p className="text-sm font-medium text-muted-foreground max-w-2xl">
            Learn how to properly tag your ad links with UTM parameters so every order gets attributed to the right campaign and creative. This data is critical for scaling your winning ads.
          </p>
        </div>
        <button className="flex items-center gap-2 px-8 py-3 bg-primary text-primary-foreground rounded-2xl text-sm font-black shadow-lg shadow-primary/20 hover:scale-105 active:scale-95 transition-all relative">
          LEARN MORE
          <ArrowUpRight className="w-4 h-4" />
        </button>
      </motion.div>

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
            <Filter className="w-5 h-5 text-primary" />
            Tracked Order Attribution
          </h2>
          <div className="flex items-center gap-4">
            <div className="relative group">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground transition-colors group-focus-within:text-primary" />
              <input 
                type="text" 
                placeholder="Search campaigns..."
                className="pl-11 pr-4 py-2 bg-white border border-gray-100 rounded-xl text-xs font-bold focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all w-48 shadow-sm"
              />
            </div>
            <span className="px-4 py-1.5 bg-primary/10 text-primary text-[10px] font-black rounded-full uppercase tracking-widest border border-primary/20">
              {trackedOrders.length} Attributed
            </span>
          </div>
        </div>

        <div className="overflow-x-auto overflow-y-visible">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50/50">
                <th className="px-8 py-4 text-xs font-black text-muted-foreground uppercase tracking-widest">Order ID</th>
                <th className="px-8 py-4 text-xs font-black text-muted-foreground uppercase tracking-widest">Customer</th>
                <th className="px-8 py-4 text-xs font-black text-muted-foreground uppercase tracking-widest">Product</th>
                <th className="px-8 py-4 text-xs font-black text-muted-foreground uppercase tracking-widest">Campaign</th>
                <th className="px-8 py-4 text-xs font-black text-muted-foreground uppercase tracking-widest">Source</th>
                <th className="px-8 py-4 text-xs font-black text-muted-foreground uppercase tracking-widest text-right">Revenue</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/40">
              {trackedOrders.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-8 py-20 text-center">
                    <div className="flex flex-col items-center gap-4 opacity-50">
                      <Target className="w-12 h-12 text-muted-foreground" />
                      <p className="text-sm font-bold text-muted-foreground italic max-w-xs mx-auto">
                        No UTM-tracked orders yet. Submit a preview order from Embed Form to test attribution.
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                trackedOrders.map((order, idx) => (
                  <tr key={order.id} className="group hover:bg-white/40 transition-all duration-300">
                    <td className="px-8 py-5">
                      <span className="font-black text-gray-900 group-hover:text-primary transition-colors">{order.id}</span>
                    </td>
                    <td className="px-8 py-5">
                      <div className="space-y-1">
                        <div className="font-bold text-gray-900">{order.customer}</div>
                        <div className="text-[10px] font-black text-muted-foreground flex items-center gap-1.5 uppercase tracking-wider">
                          <Calendar className="w-3 h-3" />
                          {order.date}
                        </div>
                      </div>
                    </td>
                    <td className="px-8 py-5">
                      <div className="space-y-1">
                        <div className="font-bold text-gray-900 flex items-center gap-2">
                          <Package className="w-3.5 h-3.5 text-primary" />
                          {order.productName}
                        </div>
                        <div className="text-xs font-bold text-muted-foreground">
                          {order.packageName}
                        </div>
                      </div>
                    </td>
                    <td className="px-8 py-5">
                      <span className="px-3 py-1 bg-indigo-50 text-indigo-600 rounded-full text-[10px] font-black uppercase tracking-widest border border-indigo-100">
                        {order.utmCampaign}
                      </span>
                    </td>
                    <td className="px-8 py-5">
                      <span className="px-3 py-1 bg-blue-50 text-blue-600 rounded-full text-[10px] font-black uppercase tracking-widest border border-blue-100">
                        {order.utmSource}
                      </span>
                    </td>
                    <td className="px-8 py-5 text-right">
                      <span className="font-black text-primary">
                        {formatProductMoney(order.amount, order.currency)}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
