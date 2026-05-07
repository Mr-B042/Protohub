import React, { useMemo } from "react";
import { 
  Boxes, 
  History, 
  Tag, 
  Package, 
  ClipboardCheck, 
  Search, 
  Plus, 
  TrendingUp, 
  ArrowUpRight, 
  ArrowDownRight,
  AlertCircle,
  Eye,
  Pencil,
  Trash2,
  ChevronRight,
  Filter,
  BarChart3,
  Archive,
  ArrowRight
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "../lib/utils";
import type { 
  Product, 
  StockMovement, 
  InventoryView, 
  ProductCurrencyCode, 
  StockMovementType 
} from "../types";

interface InventoryProps {
  products: Product[];
  stockMovements: StockMovement[];
  inventoryView: InventoryView;
  setInventoryView: (view: InventoryView) => void;
  inventorySearch: string;
  setInventorySearch: (search: string) => void;
  productCurrencies: any;
  setModal: (modal: any) => void;
  setSelectedProductId: (id: string) => void;
  historyProductFilter: string;
  setHistoryProductFilter: (filter: string) => void;
  historyTypeFilter: "All Types" | StockMovementType;
  setHistoryTypeFilter: (filter: "All Types" | StockMovementType) => void;
  historyStartDate: string;
  setHistoryStartDate: (date: string) => void;
  historyEndDate: string;
  setHistoryEndDate: (date: string) => void;
  stockMovementTypes: string[];
}

export const Inventory: React.FC<InventoryProps> = ({
  products,
  stockMovements,
  inventoryView,
  setInventoryView,
  inventorySearch,
  setInventorySearch,
  productCurrencies,
  setModal,
  setSelectedProductId,
  historyProductFilter,
  setHistoryProductFilter,
  historyTypeFilter,
  setHistoryTypeFilter,
  historyStartDate,
  setHistoryStartDate,
  historyEndDate,
  setHistoryEndDate,
  stockMovementTypes,
}) => {
  const selectedProduct = useMemo(() =>
    products.find(p => p.id === historyProductFilter) || null
  , [products, historyProductFilter]);

  const filteredProducts = useMemo(() =>
    products.filter(p =>
      p.name.toLowerCase().includes(inventorySearch.toLowerCase()) ||
      p.sku.toLowerCase().includes(inventorySearch.toLowerCase())
    )
  , [products, inventorySearch]);

  const filteredMovements = useMemo(() => {
    const start = historyStartDate ? new Date(historyStartDate).getTime() : null;
    const end   = historyEndDate ? new Date(historyEndDate).getTime() + 86_400_000 - 1 : null;
    return stockMovements.filter(m => {
      if (historyProductFilter && historyProductFilter !== "All Products"
          && m.productId !== historyProductFilter) return false;
      if (historyTypeFilter && historyTypeFilter !== "All Types"
          && m.type !== historyTypeFilter) return false;
      const t = new Date(m.date).getTime();
      if (start !== null && t < start) return false;
      if (end !== null && t > end) return false;
      return true;
    });
  }, [stockMovements, historyProductFilter, historyTypeFilter, historyStartDate, historyEndDate]);

  const stats = useMemo(() => {
    const totalItems = products.length;
    const lowStock = products.filter(p => p.warehouseStock <= p.reorderPoint).length;
    const totalValue = products.reduce((sum, p) => {
      const price = p.pricings.find(pr => pr.isPrimary)?.sellingPrice || 0;
      return sum + (price * p.warehouseStock);
    }, 0);
    return { totalItems, lowStock, totalValue };
  }, [products]);

  const formatMoney = (amount: number, code: ProductCurrencyCode = "NGN") =>
    new Intl.NumberFormat(productCurrencies[code]?.locale || "en-NG", {
      style: "currency",
      currency: productCurrencies[code]?.currency || "NGN",
      maximumFractionDigits: 0
    }).format(amount || 0);

  const renderDashboard = () => (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {[
          { title: "Total Products", value: stats.totalItems, icon: Boxes, color: "text-blue-500", bg: "bg-blue-500/10" },
          { title: "Low Stock Items", value: stats.lowStock, icon: AlertCircle, color: "text-rose-500", bg: "bg-rose-500/10" },
          { title: "Inventory Value", value: formatMoney(stats.totalValue), icon: TrendingUp, color: "text-emerald-500", bg: "bg-emerald-500/10" },
        ].map((stat, idx) => (
          <motion.div
            key={stat.title}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.1 }}
            className="glass rounded-3xl p-6 border border-white/40 shadow-xl shadow-black/5"
          >
            <div className={cn("w-12 h-12 rounded-2xl flex items-center justify-center mb-4", stat.bg, stat.color)}>
              <stat.icon className="w-6 h-6" />
            </div>
            <p className="text-sm font-bold text-muted-foreground uppercase tracking-wider">{stat.title}</p>
            <p className="text-3xl font-black mt-1 tracking-tight">{stat.value}</p>
          </motion.div>
        ))}
      </div>

      {/* Products Table */}
      <div className="glass rounded-[2.5rem] border border-white/40 shadow-2xl shadow-black/5 overflow-hidden">
        <div className="p-6 border-b border-black/5 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white/30">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <input
              type="text"
              value={inventorySearch}
              onChange={(e) => setInventorySearch(e.target.value)}
              placeholder="Search products, SKU..."
              className="w-full pl-12 pr-4 py-3 bg-white/50 backdrop-blur-sm border border-black/5 rounded-2xl focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all font-medium"
            />
          </div>
          
          <div className="flex items-center gap-3">
            <button 
              onClick={() => setInventoryView("history")}
              className="px-5 py-3 rounded-2xl bg-black/5 hover:bg-black/10 transition-colors font-bold text-sm flex items-center gap-2"
            >
              <History className="w-4 h-4" /> History
            </button>
            <button 
              onClick={() => setModal("addProduct")}
              className="px-6 py-3 rounded-2xl bg-primary text-primary-foreground font-bold shadow-lg shadow-primary/20 hover:scale-105 active:scale-95 transition-all flex items-center gap-2"
            >
              <Plus className="w-5 h-5" /> Add Product
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-left bg-black/[0.02]">
                <th className="px-8 py-5 text-xs font-black uppercase tracking-widest text-muted-foreground">Product</th>
                <th className="px-8 py-5 text-xs font-black uppercase tracking-widest text-muted-foreground">Stock Level</th>
                <th className="px-8 py-5 text-xs font-black uppercase tracking-widest text-muted-foreground">Unit Value</th>
                <th className="px-8 py-5 text-xs font-black uppercase tracking-widest text-muted-foreground">Status</th>
                <th className="px-8 py-5 text-xs font-black uppercase tracking-widest text-muted-foreground text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5">
              {filteredProducts.map((product) => {
                const isLow = product.warehouseStock <= product.reorderPoint;
                const primaryPrice = product.pricings.find(p => p.isPrimary) || product.pricings[0];
                
                return (
                  <tr key={product.id} className="group hover:bg-primary/5 transition-colors">
                    <td className="px-8 py-6">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-black/5 to-black/[0.02] flex items-center justify-center group-hover:from-primary/10 group-hover:to-primary/5 transition-colors">
                          <Package className="w-6 h-6 text-muted-foreground group-hover:text-primary transition-colors" />
                        </div>
                        <div>
                          <p className="font-black group-hover:text-primary transition-colors cursor-pointer" onClick={() => { setSelectedProductId(product.id); setModal("productDetails"); }}>
                            {product.name}
                          </p>
                          <p className="text-xs text-muted-foreground font-bold uppercase tracking-wider">{product.sku}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-8 py-6">
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-xs font-bold">
                          <span className={cn(isLow ? "text-rose-500" : "text-emerald-500")}>
                            {product.warehouseStock} units available
                          </span>
                          <span className="text-muted-foreground">Reorder at {product.reorderPoint}</span>
                        </div>
                        <div className="w-48 h-2 bg-black/5 rounded-full overflow-hidden">
                          <motion.div 
                            initial={{ width: 0 }}
                            animate={{ width: `${Math.min(100, (product.warehouseStock / (product.reorderPoint * 2)) * 100)}%` }}
                            className={cn("h-full rounded-full", isLow ? "bg-rose-500" : "bg-emerald-500")}
                          />
                        </div>
                      </div>
                    </td>
                    <td className="px-8 py-6 font-bold">
                      {primaryPrice ? formatMoney(primaryPrice.sellingPrice, primaryPrice.currency) : "N/A"}
                    </td>
                    <td className="px-8 py-6">
                      <span className={cn(
                        "px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider border",
                        product.active 
                          ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" 
                          : "bg-slate-500/10 text-slate-500 border-slate-500/20"
                      )}>
                        {product.active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-8 py-6">
                      <div className="flex items-center justify-end gap-2">
                        <button 
                          onClick={() => { setSelectedProductId(product.id); setInventoryView("pricing"); }}
                          className="p-2.5 rounded-xl border border-black/5 hover:bg-black/5 transition-all"
                          title="Pricing"
                        >
                          <Tag className="w-5 h-5 text-muted-foreground" />
                        </button>
                        <button 
                          onClick={() => { setSelectedProductId(product.id); setModal("updateStock"); }}
                          className="p-2.5 rounded-xl border border-black/5 hover:bg-black/5 transition-all"
                          title="Update Stock"
                        >
                          <Archive className="w-5 h-5 text-muted-foreground" />
                        </button>
                        <button 
                          onClick={() => { setSelectedProductId(product.id); setModal("editProduct"); }}
                          className="p-2.5 rounded-xl border border-black/5 hover:bg-black/5 transition-all"
                          title="Edit"
                        >
                          <Pencil className="w-5 h-5 text-muted-foreground" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  const renderHistory = () => (
    <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-500">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="space-y-1">
          <button 
            onClick={() => setInventoryView("dashboard")}
            className="flex items-center gap-2 text-primary font-bold text-sm hover:underline mb-2"
          >
            <ArrowRight className="w-4 h-4 rotate-180" /> Back to Dashboard
          </button>
          <h1 className="text-4xl font-black tracking-tight">Stock History</h1>
          <p className="text-muted-foreground font-medium text-lg">Detailed log of all inventory movements</p>
        </div>
      </header>

      <div className="glass rounded-[2.5rem] border border-white/40 shadow-2xl shadow-black/5 overflow-hidden">
        <div className="p-8 border-b border-black/5 bg-white/30 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="space-y-2">
            <p className="text-xs font-black uppercase tracking-widest text-muted-foreground ml-2">Product Filter</p>
            <select 
              value={historyProductFilter}
              onChange={(e) => setHistoryProductFilter(e.target.value)}
              className="w-full px-4 py-3 bg-white/50 backdrop-blur-sm border border-black/5 rounded-2xl focus:outline-none focus:ring-2 focus:ring-primary/20 font-bold appearance-none cursor-pointer"
            >
              <option value="All Products">All Products</option>
              {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className="space-y-2">
            <p className="text-xs font-black uppercase tracking-widest text-muted-foreground ml-2">Type Filter</p>
            <select 
              value={historyTypeFilter}
              onChange={(e) => setHistoryTypeFilter(e.target.value as any)}
              className="w-full px-4 py-3 bg-white/50 backdrop-blur-sm border border-black/5 rounded-2xl focus:outline-none focus:ring-2 focus:ring-primary/20 font-bold appearance-none cursor-pointer"
            >
              {stockMovementTypes.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="space-y-2">
            <p className="text-xs font-black uppercase tracking-widest text-muted-foreground ml-2">Start Date</p>
            <input 
              type="date"
              value={historyStartDate}
              onChange={(e) => setHistoryStartDate(e.target.value)}
              className="w-full px-4 py-3 bg-white/50 backdrop-blur-sm border border-black/5 rounded-2xl focus:outline-none focus:ring-2 focus:ring-primary/20 font-bold"
            />
          </div>
          <div className="space-y-2">
            <p className="text-xs font-black uppercase tracking-widest text-muted-foreground ml-2">End Date</p>
            <input 
              type="date"
              value={historyEndDate}
              onChange={(e) => setHistoryEndDate(e.target.value)}
              className="w-full px-4 py-3 bg-white/50 backdrop-blur-sm border border-black/5 rounded-2xl focus:outline-none focus:ring-2 focus:ring-primary/20 font-bold"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-black/[0.02] text-left">
                <th className="px-8 py-5 text-xs font-black uppercase tracking-widest text-muted-foreground">Date</th>
                <th className="px-8 py-5 text-xs font-black uppercase tracking-widest text-muted-foreground">Product</th>
                <th className="px-8 py-5 text-xs font-black uppercase tracking-widest text-muted-foreground">Type</th>
                <th className="px-8 py-5 text-xs font-black uppercase tracking-widest text-muted-foreground text-right">Qty</th>
                <th className="px-8 py-5 text-xs font-black uppercase tracking-widest text-muted-foreground text-right">Balance</th>
                <th className="px-8 py-5 text-xs font-black uppercase tracking-widest text-muted-foreground">By</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5">
              {filteredMovements.map((m) => (
                <tr key={m.id} className="hover:bg-primary/5 transition-colors">
                  <td className="px-8 py-5 text-muted-foreground font-bold whitespace-nowrap">
                    {new Date(m.date).toLocaleDateString()}
                  </td>
                  <td className="px-8 py-5 font-black">{m.productName}</td>
                  <td className="px-8 py-5">
                    <span className="px-3 py-1 rounded-lg bg-black/5 text-[10px] font-black uppercase tracking-wider border border-black/5">
                      {m.type}
                    </span>
                  </td>
                  <td className={cn(
                    "px-8 py-5 text-right font-black",
                    m.qty > 0 ? "text-emerald-600" : "text-rose-600"
                  )}>
                    {m.qty > 0 ? `+${m.qty}` : m.qty}
                  </td>
                  <td className="px-8 py-5 text-right font-black">{m.balanceAfter}</td>
                  <td className="px-8 py-5 text-muted-foreground font-medium italic">{m.by}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  return (
    <AnimatePresence mode="wait">
      {inventoryView === "dashboard" ? renderDashboard() : 
       inventoryView === "history" ? renderHistory() : 
       <div className="flex flex-col items-center justify-center min-h-[60vh] text-center space-y-6">
         <div className="w-24 h-24 rounded-[2rem] bg-primary/10 flex items-center justify-center text-primary border border-primary/20 shadow-xl shadow-primary/5">
           <BarChart3 className="w-12 h-12 animate-pulse" />
         </div>
         <div className="space-y-2">
           <h2 className="text-3xl font-black tracking-tight">Modernizing {inventoryView} view</h2>
           <p className="text-muted-foreground max-w-md mx-auto font-medium">
             We're currently refactoring the <strong>{inventoryView}</strong> section. 
             This detailed view will be available shortly with enhanced features.
           </p>
         </div>
         <button 
           onClick={() => setInventoryView("dashboard")}
           className="px-6 py-3 bg-primary text-primary-foreground rounded-2xl font-bold shadow-lg shadow-primary/20 hover:scale-105 active:scale-95 transition-all"
         >
           Back to Inventory
         </button>
       </div>}
    </AnimatePresence>
  );
};
