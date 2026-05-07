import React, { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Code2, 
  LayoutGrid, 
  ShoppingBag, 
  Sparkles, 
  Pencil, 
  Copy, 
  Check, 
  ExternalLink, 
  Smartphone, 
  Monitor, 
  Plus, 
  ChevronRight, 
  ArrowRight,
  Info,
  Settings,
  Palette,
  Eye,
  Type,
  MapPin,
  Gift
} from 'lucide-react';
import { 
  EmbedTab, 
  Product, 
  Pricing,
  ActivePage
} from '../types';

interface EmbedFormProps {
  embedTab: EmbedTab;
  setEmbedTab: (tab: EmbedTab) => void;
  embedTabs: readonly EmbedTab[];
  previewProduct: Product | undefined;
  products: Product[];
  setProducts: React.Dispatch<React.SetStateAction<Product[]>>;
  generatedProductId: string;
  setGeneratedProductId: (id: string) => void;
  embedStateField: string;
  setEmbedStateField: (field: string) => void;
  nigeriaStates: readonly string[];
  updateProductStates: (productId: string, states: string[]) => void;
  openAddProductModal: () => void;
  primaryPricing: (product: Product) => Pricing | undefined;
  formatProductMoney: (amount: number, currency: string) => string;
  generatedEmbedCode: string;
  copyEmbedCode: () => void;
  setHashRoute: (route: string) => void;
}

export const EmbedForm: React.FC<EmbedFormProps> = ({
  embedTab,
  setEmbedTab,
  embedTabs,
  previewProduct,
  products,
  setProducts,
  generatedProductId,
  setGeneratedProductId,
  embedStateField,
  setEmbedStateField,
  nigeriaStates,
  updateProductStates,
  openAddProductModal,
  primaryPricing,
  formatProductMoney,
  generatedEmbedCode,
  copyEmbedCode,
  setHashRoute
}) => {
  return (
    <div className="space-y-8 pb-12">
      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="space-y-1">
          <h1 className="text-4xl font-black tracking-tight bg-gradient-to-r from-gray-900 to-gray-600 bg-clip-text text-transparent">
            Form Architect
          </h1>
          <p className="text-muted-foreground font-medium">
            Customize, engineer, and deploy high-converting order forms to any digital ecosystem.
          </p>
        </div>

        <div className="flex bg-white/50 backdrop-blur-xl p-1 border border-white/40 rounded-2xl shadow-sm">
          {embedTabs.map((tab) => (
            <button 
              key={tab}
              onClick={() => {
                const nextHash = tab === "Generate" ? "#/dashboard/admin/embed?tab=generate" : "#/dashboard/admin/embed";
                window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${nextHash}`);
                setHashRoute(nextHash);
                setEmbedTab(tab);
              }}
              className={`px-6 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                embedTab === tab 
                ? "bg-primary text-primary-foreground shadow-lg shadow-primary/20" 
                : "text-muted-foreground hover:text-gray-900"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Column: Configuration */}
        <div className="lg:col-span-7 space-y-8">
          {embedTab === "Create Order Form" ? (
            <>
              {/* Product Selector */}
              <section className="p-8 bg-white/40 backdrop-blur-xl border border-white/40 rounded-[2.5rem] shadow-sm space-y-6">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <h2 className="text-xl font-black text-gray-900 flex items-center gap-3">
                      <LayoutGrid className="w-5 h-5 text-primary" />
                      Core Configuration
                    </h2>
                    <p className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">
                      Select primary asset for distribution
                    </p>
                  </div>
                </div>

                <div className="space-y-4">
                  <label className="block space-y-2">
                    <span className="text-[11px] font-black text-muted-foreground uppercase tracking-widest ml-1">Focus Product</span>
                    <select 
                      value={generatedProductId}
                      onChange={(e) => setGeneratedProductId(e.target.value)}
                      className="w-full px-4 py-3 bg-white border border-gray-100 rounded-2xl text-sm font-bold focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all shadow-sm"
                    >
                      {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </label>

                  <label className="block space-y-2">
                    <span className="text-[11px] font-black text-muted-foreground uppercase tracking-widest ml-1">Geographic Input Style</span>
                    <select 
                      value={embedStateField}
                      onChange={(e) => setEmbedStateField(e.target.value)}
                      className="w-full px-4 py-3 bg-white border border-gray-100 rounded-2xl text-sm font-bold focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all shadow-sm"
                    >
                      <option value="Free-text input">Free-text input (Global Standard)</option>
                      <option value="Dropdown">Dropdown (Nigerian States Precision)</option>
                    </select>
                  </label>
                </div>
              </section>

              {/* State Filtering */}
              {previewProduct && embedStateField === "Dropdown" && (
                <section className="p-8 bg-white/40 backdrop-blur-xl border border-white/40 rounded-[2.5rem] shadow-sm space-y-6">
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <h2 className="text-xl font-black text-gray-900 flex items-center gap-3">
                        <MapPin className="w-5 h-5 text-rose-500" />
                        Zonal Restrictions
                      </h2>
                      <p className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">
                        Configure regional availability
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button 
                        onClick={() => updateProductStates(previewProduct!.id, [])}
                        className="px-3 py-1.5 bg-gray-50 text-[9px] font-black uppercase tracking-widest rounded-xl hover:bg-gray-100 transition-colors"
                      >
                        ALL
                      </button>
                      <button 
                        onClick={() => updateProductStates(previewProduct!.id, ["__none__"])}
                        className="px-3 py-1.5 bg-gray-50 text-[9px] font-black uppercase tracking-widest rounded-xl hover:bg-gray-100 transition-colors"
                      >
                        CLEAR
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-[16rem] overflow-y-auto pr-2 custom-scrollbar">
                    {nigeriaStates.map(state => {
                      const selected = previewProduct!.availableStates ?? [];
                      const allSelected = selected.length === 0;
                      const isOn = allSelected || selected.includes(state);
                      
                      return (
                        <label 
                          key={state}
                          className={`flex items-center gap-3 p-3 rounded-2xl border transition-all cursor-pointer ${
                            isOn 
                            ? 'bg-primary/5 border-primary/20' 
                            : 'bg-white border-gray-100 opacity-50 grayscale hover:grayscale-0 hover:opacity-100'
                          }`}
                        >
                          <input 
                            type="checkbox" 
                            checked={isOn}
                            onChange={() => {
                              if (allSelected) {
                                updateProductStates(previewProduct!.id, nigeriaStates.filter(s => s !== state));
                              } else if (selected.includes(state)) {
                                updateProductStates(previewProduct!.id, selected.filter(s => s !== state));
                              } else {
                                updateProductStates(previewProduct!.id, [...selected.filter(s => s !== "__none__"), state]);
                              }
                            }}
                            className="w-4 h-4 rounded-lg accent-primary"
                          />
                          <span className="text-[11px] font-bold text-gray-700">{state}</span>
                        </label>
                      );
                    })}
                  </div>
                </section>
              )}

              {/* Cross-Sell & Upsell */}
              {previewProduct && (
                <section className="p-8 bg-amber-50/50 backdrop-blur-xl border border-amber-200/50 rounded-[2.5rem] shadow-sm space-y-6">
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <h2 className="text-xl font-black text-amber-900 flex items-center gap-3">
                        <ShoppingBag className="w-5 h-5" />
                        Revenue Accelerators
                      </h2>
                      <p className="text-[10px] font-black text-amber-700 uppercase tracking-widest">
                        Configure cross-sell & bundle logic
                      </p>
                    </div>
                  </div>

                  <div className="space-y-4">
                    {products.filter(p => p.id !== previewProduct?.id).map(cp => {
                      const selected = previewProduct!.crossSellProductIds ?? [];
                      const on = selected.includes(cp.id);
                      const standardPrice = primaryPricing(cp)?.sellingPrice ?? 0;
                      const currency = primaryPricing(cp)?.currency ?? "NGN";
                      const override = previewProduct!.crossSellPriceOverrides?.[cp.id];

                      return (
                        <div key={cp.id} className={`group p-4 bg-white border rounded-3xl transition-all ${on ? 'border-amber-300 shadow-lg shadow-amber-500/5' : 'border-gray-100 hover:border-amber-200'}`}>
                          <div className="flex items-center gap-4">
                            <input 
                              type="checkbox" 
                              checked={on}
                              onChange={() => setProducts(prev => prev.map(p => p.id !== previewProduct!.id ? p : { 
                                ...p, 
                                crossSellProductIds: on ? selected.filter(id => id !== cp.id) : [...selected, cp.id] 
                              }))}
                              className="w-5 h-5 rounded-lg accent-amber-500"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="font-bold text-gray-900 text-sm">{cp.name}</div>
                              <div className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">
                                Standard: {formatProductMoney(standardPrice, currency)}
                              </div>
                            </div>
                            {on && (
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] font-black text-amber-700">BUNDLE PRICE</span>
                                <input 
                                  type="number" 
                                  value={typeof override === 'number' ? override : ''}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setProducts(prev => prev.map(p => {
                                      if (p.id !== previewProduct!.id) return p;
                                      const next = { ...(p.crossSellPriceOverrides ?? {}) };
                                      if (val === "") delete next[cp.id];
                                      else next[cp.id] = Number(val) || 0;
                                      return { ...p, crossSellPriceOverrides: next };
                                    }));
                                  }}
                                  placeholder={String(standardPrice)}
                                  className="w-24 px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-xl text-xs font-black text-amber-900 focus:outline-none"
                                />
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}

              {/* Free Gifts */}
              {previewProduct && (
                <section className="p-8 bg-emerald-50/50 backdrop-blur-xl border border-emerald-200/50 rounded-[2.5rem] shadow-sm space-y-6">
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <h2 className="text-xl font-black text-emerald-900 flex items-center gap-3">
                        <Gift className="w-5 h-5" />
                        Loyalty Incentives
                      </h2>
                      <p className="text-[10px] font-black text-emerald-700 uppercase tracking-widest">
                        Automated free gift allocation
                      </p>
                    </div>
                  </div>

                  <div className="space-y-4">
                    {products.filter(p => p.id !== previewProduct?.id).map(cp => {
                      const selected = previewProduct!.freeGiftProductIds ?? [];
                      const on = selected.includes(cp.id);

                      return (
                        <div key={cp.id} className={`p-4 bg-white border rounded-3xl transition-all ${on ? 'border-emerald-300 shadow-lg shadow-emerald-500/5' : 'border-gray-100 hover:border-emerald-200'}`}>
                          <label className="flex items-center gap-4 cursor-pointer">
                            <input 
                              type="checkbox" 
                              checked={on}
                              onChange={() => setProducts(prev => prev.map(p => p.id !== previewProduct!.id ? p : { 
                                ...p, 
                                freeGiftProductIds: on ? selected.filter(id => id !== cp.id) : [...selected, cp.id] 
                              }))}
                              className="w-5 h-5 rounded-lg accent-emerald-500"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="font-bold text-gray-900 text-sm">{cp.name}</div>
                              <div className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">
                                Auto-attach on main purchase
                              </div>
                            </div>
                          </label>
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}
            </>
          ) : (
            /* Generate Tab */
            <section className="p-8 bg-gray-900 text-white rounded-[2.5rem] shadow-2xl space-y-8">
              <div className="space-y-2">
                <h2 className="text-2xl font-black flex items-center gap-3">
                  <Code2 className="w-6 h-6 text-primary" />
                  Deployment Payload
                </h2>
                <p className="text-sm text-gray-400 font-medium italic">
                  Integrate this snippet into your destination environment.
                </p>
              </div>

              <div className="relative group">
                <pre className="p-6 bg-black/50 border border-white/10 rounded-3xl overflow-x-auto text-[11px] font-mono leading-relaxed text-primary/80 custom-scrollbar max-h-[30rem]">
                  {generatedEmbedCode}
                </pre>
                <button 
                  onClick={copyEmbedCode}
                  className="absolute top-4 right-4 flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-xl text-[10px] font-black uppercase tracking-widest shadow-lg hover:scale-105 active:scale-95 transition-all"
                >
                  <Copy className="w-3.5 h-3.5" />
                  CLONE SNIPPET
                </button>
              </div>

              <div className="p-6 bg-white/5 border border-white/10 rounded-3xl flex items-start gap-4">
                <div className="p-3 rounded-2xl bg-primary/10 text-primary shrink-0">
                  <Info className="w-5 h-5" />
                </div>
                <div className="space-y-1">
                  <h4 className="text-xs font-black uppercase tracking-widest text-white">Integration Directive</h4>
                  <p className="text-[11px] font-medium text-gray-400 leading-relaxed">
                    Insert this payload into the target HTML block where the distribution interface should manifest. 
                    The script is optimized for low-latency asynchronous execution across all modern browsers.
                  </p>
                </div>
              </div>
            </section>
          )}
        </div>

        {/* Right Column: Live Preview */}
        <div className="lg:col-span-5 sticky top-8 space-y-6">
          <div className="flex items-center justify-between px-2">
            <h3 className="text-xs font-black text-muted-foreground uppercase tracking-[0.2em] flex items-center gap-2">
              <Eye className="w-3.5 h-3.5" />
              Live Monitor
            </h3>
            <div className="flex items-center gap-1.5">
              <div className="p-1.5 rounded-lg bg-gray-100 text-gray-400">
                <Smartphone className="w-3 h-3" />
              </div>
              <div className="p-1.5 rounded-lg bg-primary/10 text-primary shadow-sm shadow-primary/10">
                <Monitor className="w-3 h-3" />
              </div>
            </div>
          </div>

          <div className="relative aspect-[4/5] bg-white rounded-[3rem] border-8 border-gray-900 shadow-2xl overflow-hidden group">
            {/* Form Preview Mockup */}
            <div className="absolute inset-0 p-8 space-y-6 overflow-y-auto no-scrollbar">
              {previewProduct ? (
                <>
                  <div className="space-y-4">
                    <div className="h-4 w-24 bg-gray-100 rounded-full animate-pulse" />
                    <h2 className="text-2xl font-black text-gray-900">{previewProduct.name}</h2>
                    <p className="text-xs font-medium text-gray-500 leading-relaxed">
                      {previewProduct.formCustomText || "Secure your unit by completing the requisition details below. Accelerated delivery enabled for your region."}
                    </p>
                  </div>

                  <div className="space-y-4 pt-4 border-t border-gray-50">
                    {[
                      { label: "Full Identity", placeholder: "e.g. John Wick" },
                      { label: "Dispatch Signal", placeholder: "+234..." },
                      { label: "Destination Coordinate", placeholder: "Street address..." },
                    ].map((field, fidx) => (
                      <div key={fidx} className="space-y-1.5">
                        <label className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">{field.label}</label>
                        <div className="h-11 w-full bg-gray-50 border border-gray-100 rounded-xl" />
                      </div>
                    ))}

                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">Regional Zone</label>
                      <div className="h-11 w-full bg-gray-50 border border-gray-100 rounded-xl flex items-center justify-between px-4">
                        <span className="text-xs text-gray-400">
                          {embedStateField === "Dropdown" ? "Select your state..." : "Type your state..."}
                        </span>
                        <ChevronRight className="w-4 h-4 text-gray-300" />
                      </div>
                    </div>
                  </div>

                  <div className="pt-8">
                    <div className="w-full h-14 bg-gray-900 rounded-2xl flex items-center justify-center text-white text-xs font-black uppercase tracking-widest shadow-xl shadow-gray-900/20">
                      SUBMIT REQUISITION
                    </div>
                  </div>
                </>
              ) : (
                <div className="h-full flex flex-col items-center justify-center gap-4 opacity-30 text-center p-12">
                  <LayoutGrid className="w-12 h-12" />
                  <p className="text-sm font-black uppercase tracking-widest">Awaiting System Selection</p>
                </div>
              )}
            </div>
            
            {/* Interactive Overlay */}
            <div className="absolute inset-0 bg-gradient-to-t from-gray-900/10 to-transparent pointer-events-none" />
          </div>

          <div className="p-6 bg-white/40 backdrop-blur-xl border border-white/40 rounded-[2.5rem] shadow-sm flex items-center gap-4">
            <div className="p-3 rounded-2xl bg-indigo-50 text-indigo-600">
              <Smartphone className="w-5 h-5" />
            </div>
            <div className="space-y-1">
              <h4 className="text-xs font-black uppercase tracking-widest text-gray-900">Mobile Responsive</h4>
              <p className="text-[10px] font-medium text-muted-foreground italic">
                Form architecture automatically recalibrates for handheld precision.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
