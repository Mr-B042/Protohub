import { useState } from "react";
import {
  Box, ChevronDown, Crown, Gift, Layers, Mail, MessageSquareText, Monitor, Package, RefreshCw, Rocket, ShoppingCart, Smartphone, Sparkles, Star, Tag, Target
} from "lucide-react";
import type { EmDesigner } from "../../lib/api";
import EmailFrame from "./EmailFrame";
import { Card, Tick, Toggle, input, select } from "./em-ui";
import { GOALS, OFFER_TYPES, fieldsFor, priceText, type Draft } from "./wizard-model";

/** Step 1, Campaign Setup (image 44). */

const GOAL_ICON: Record<string, typeof Mail> = { refresh: RefreshCw, cart: ShoppingCart, tag: Tag, rocket: Rocket, cartx: ShoppingCart, box: Box, star: Star, mail: Mail };
const OFFER_ICON: Record<string, typeof Mail> = { product: Package, discount: Tag, bundle: Layers, loyalty: Crown, custom: MessageSquareText };

/** Subject ideas from the goal, product and offer (written rules, no AI). */
export function subjectIdeas(draft: Draft, designer: EmDesigner | null) {
  const f = fieldsFor(draft, designer);
  const product = f.productName || "our best seller";
  const benefit = f.offerOn && f.offerBenefit ? f.offerBenefit : "";
  const brand = f.brand || "us";
  const ideas: Record<string, string[]> = {
    retention: [`We picked something new for you, {{First Name}}`, `Your home will love the ${product}`, benefit ? `${benefit} on your next order` : `Time for a fresh upgrade?`],
    upsell: [`Double the Clean ✨ Upgrade to ${product} Today!`, `{{First Name}}, your ${product} upgrade is here`, benefit ? `${benefit} when you upgrade to ${product}` : `Get more from your home with ${product}`],
    promotion: [benefit ? `${benefit} on ${product}, this week only` : `A special offer on ${product}`, `For you first: a deal on ${product}`, `Don't miss this, {{First Name}}`],
    launch: [`New: ${product} just arrived`, `Be the first to get ${product}`, `Something new from ${brand}`],
    cart: [`You left ${product} behind`, `Still thinking about ${product}, {{First Name}}?`, `Your order is one step away`],
    winback: [benefit ? `We miss you! ${benefit} inside` : `We miss you, {{First Name}}`, `It's been a while. Here's a welcome back gift`, `Come back for ${product}`],
    appreciation: [`Thank you, {{First Name}} 💜`, `A small thank-you from ${brand}`, `You're one of our best customers`],
    announcement: [`An update for you from ${brand}`, `News you should know, {{First Name}}`, `Something is changing at ${brand}`]
  };
  return ideas[draft.goal] ?? ideas.retention;
}

export default function StepSetup({ draft, designer, onChange }: { draft: Draft; designer: EmDesigner | null; onChange: (patch: Partial<Draft>) => void }) {
  const [mobile, setMobile] = useState(false);
  const [ideasOpen, setIdeasOpen] = useState(false);
  const [productOpen, setProductOpen] = useState(false);
  const products = designer?.products ?? [];
  const product = products.find((row) => row.id === draft.productId);
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.45fr)_minmax(0,1.2fr)]">
      <Card className="p-4">
        <h3 className="m-0 flex items-center gap-2 text-[17px] font-bold text-gray-900 dark:text-slate-50"><Target className="h-5 w-5 text-[#5B3FD9]" />Campaign Goal</h3>
        <div className="mt-3 space-y-1" role="radiogroup" aria-label="Campaign goal">
          {GOALS.map((goal) => {
            const Icon = GOAL_ICON[goal.icon] ?? Mail;
            const on = draft.goal === goal.key;
            return (
              <button key={goal.key} type="button" role="radio" aria-checked={on} onClick={() => onChange({ goal: goal.key })}
                className={`!min-h-0 flex w-full items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left ${on ? "border-[#8B74EE] bg-[#F5F2FE] dark:bg-violet-500/10" : "border-gray-100 hover:bg-gray-50 dark:border-slate-800 dark:hover:bg-slate-800"}`}>
                <Icon className="h-5 w-5 shrink-0 text-[#5B3FD9]" />
                <span className="min-w-0 flex-1"><span className="block text-[12.5px] font-bold leading-snug text-gray-900 dark:text-slate-50">{goal.label}</span><span className="block text-[11px] leading-snug text-gray-500">{goal.hint}</span></span>
                <Tick on={on} />
              </button>
            );
          })}
        </div>
      </Card>

      <Card className="p-4">
        <label className="block text-[13.5px] font-bold text-gray-900 dark:text-slate-50">Campaign Name <span className="text-rose-500">*</span>
          <input value={draft.name} onChange={(event) => onChange({ name: event.target.value })} placeholder="e.g. Upsell: Edge Brusher Max – Repeat Buyers" className={`${input} mt-1.5`} maxLength={160} />
        </label>
        <div className="mt-4">
          <div className="flex items-center justify-between">
            <span className="text-[13.5px] font-bold text-gray-900 dark:text-slate-50">Email Subject <span className="text-rose-500">*</span></span>
            <div className="relative">
              <button type="button" onClick={() => setIdeasOpen(!ideasOpen)} className="!min-h-0 inline-flex items-center gap-1.5 rounded-lg border border-[#C9BEF5] bg-white px-2.5 py-1 text-[12.5px] font-bold text-[#5B3FD9] hover:bg-[#F5F2FE] dark:bg-slate-900"><Sparkles className="h-3.5 w-3.5" />Ideas</button>
              {ideasOpen && (
                <div className="absolute right-0 z-20 mt-1 w-[300px] overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
                  <p className="m-0 px-3 py-1.5 text-[11.5px] text-gray-500">Subject ideas for this goal. Tap one to use it.</p>
                  {subjectIdeas(draft, designer).map((idea) => (
                    <button key={idea} type="button" onClick={() => { onChange({ subject: idea }); setIdeasOpen(false); }} className="!min-h-0 block w-full px-3 py-2 text-left text-[13px] text-gray-800 hover:bg-[#F5F2FE] dark:text-slate-200 dark:hover:bg-slate-800">{idea}</button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <input value={draft.subject} onChange={(event) => onChange({ subject: event.target.value })} placeholder="What the customer sees in their inbox" className={`${input} mt-1.5`} maxLength={200} />
        </div>
        <label className="mt-4 block text-[13.5px] font-bold text-gray-900 dark:text-slate-50">Preheader (Preview Text)
          <input value={draft.preheader} onChange={(event) => onChange({ preheader: event.target.value.slice(0, 100) })} placeholder="The short line shown after the subject" className={`${input} mt-1.5`} />
        </label>
        <p className="m-0 mt-1 text-right text-[12px] text-gray-500">{draft.preheader.length} / 100</p>

        <p className="m-0 mt-2 text-[13.5px] font-bold text-gray-900 dark:text-slate-50">Offer / Message Type</p>
        <div className="mt-2 grid grid-cols-3 gap-1.5 sm:grid-cols-5">
          {OFFER_TYPES.map((type) => {
            const Icon = OFFER_ICON[type.key] ?? Gift;
            const on = draft.offerType === type.key;
            return (
              <button key={type.key} type="button" onClick={() => onChange({ offerType: type.key, ...(type.key === "discount" ? { offer: { ...draft.offer, on: true } } : {}) })}
                className={`!min-h-0 relative flex flex-col items-center gap-1.5 rounded-xl border px-1 py-3 text-center text-[11px] font-bold leading-tight [overflow-wrap:anywhere] ${on ? "border-[#8B74EE] bg-[#F5F2FE] text-gray-900 dark:bg-violet-500/10 dark:text-slate-50" : "border-gray-200 text-gray-700 hover:bg-gray-50 dark:border-slate-700 dark:text-slate-300"}`}>
                {on && <span className="absolute right-1.5 top-1.5"><Tick on /></span>}
                <Icon className="h-5 w-5 text-[#5B3FD9]" />{type.label}
              </button>
            );
          })}
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="relative">
            <p className="m-0 mb-1.5 text-[13.5px] font-bold text-gray-900 dark:text-slate-50">Key Product (Optional)</p>
            <button type="button" onClick={() => setProductOpen(!productOpen)} className="!min-h-0 flex w-full items-center gap-2.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-left dark:border-slate-700 dark:bg-slate-950">
              {product?.image ? <img src={product.image} alt="" className="h-10 w-10 rounded-lg object-cover" /> : <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100 dark:bg-slate-800"><Package className="h-5 w-5 text-gray-400" /></span>}
              <span className="min-w-0 flex-1"><span className="block truncate text-[13.5px] font-bold text-gray-900 dark:text-slate-50">{product?.name ?? "No product"}</span><span className="block text-[12px] font-semibold text-[#5B3FD9]">{priceText(product)}</span></span>
              <ChevronDown className="h-4 w-4 text-gray-500" />
            </button>
            {productOpen && (
              <div className="absolute left-0 right-0 z-20 mt-1 max-h-[280px] overflow-y-auto rounded-xl border border-gray-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
                <button type="button" onClick={() => { onChange({ productId: null }); setProductOpen(false); }} className="!min-h-0 block w-full px-3 py-2 text-left text-[13px] text-gray-600 hover:bg-gray-50 dark:hover:bg-slate-800">No product</button>
                {products.map((row) => (
                  <button key={row.id} type="button" onClick={() => { onChange({ productId: row.id }); setProductOpen(false); }} className={`!min-h-0 flex w-full items-center gap-2.5 px-3 py-1.5 text-left hover:bg-[#F5F2FE] dark:hover:bg-slate-800 ${row.id === draft.productId ? "bg-[#F5F2FE] dark:bg-slate-800" : ""}`}>
                    {row.image ? <img src={row.image} alt="" className="h-8 w-8 rounded-md object-cover" /> : <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-gray-100 dark:bg-slate-800"><Package className="h-4 w-4 text-gray-400" /></span>}
                    <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-semibold text-gray-900 dark:text-slate-50">{row.name}</span><span className="block text-[11.5px] text-gray-500">{priceText(row) || "No price yet"}{row.links.length ? "" : " · no landing page"}</span></span>
                  </button>
                ))}
              </div>
            )}
            {product && !product.links.length && <p className="m-0 mt-1.5 text-[11.5px] text-amber-700">This product has no landing page in Tracking Hub, so add the button link in Design Email.</p>}
          </div>
          <div className="rounded-xl border border-gray-200 p-3 dark:border-slate-700">
            <div className="flex items-center justify-between">
              <span className="text-[13.5px] font-bold text-gray-900 dark:text-slate-50">Offer Details</span>
              <Toggle on={draft.offer.on} label="Include an offer" onChange={(on) => onChange({ offer: { ...draft.offer, on } })} />
            </div>
            <label className="mt-2 flex items-center gap-2 text-[13px] text-gray-700 dark:text-slate-300">
              <input type="radio" checked={draft.offer.on} onChange={() => onChange({ offer: { ...draft.offer, on: true } })} />Include Special Offer
            </label>
            <label className="mt-2 block text-[12.5px] font-semibold text-gray-800 dark:text-slate-200">Offer Title
              <input disabled={!draft.offer.on} value={draft.offer.title} onChange={(event) => onChange({ offer: { ...draft.offer, title: event.target.value.slice(0, 80) } })} placeholder="Upgrade & Save" className={`${input} mt-1 !py-2 disabled:opacity-50`} />
            </label>
            <label className="mt-2 block text-[12.5px] font-semibold text-gray-800 dark:text-slate-200">Discount / Benefit
              <input disabled={!draft.offer.on} value={draft.offer.benefit} onChange={(event) => onChange({ offer: { ...draft.offer, benefit: event.target.value.slice(0, 80) } })} placeholder="Up to 15% OFF" className={`${input} mt-1 !py-2 disabled:opacity-50`} />
            </label>
            <label className="mt-2 block text-[12.5px] font-semibold text-gray-800 dark:text-slate-200">Real Discount (Coupons &amp; Offers)
              <select value={draft.offerId ?? ""} onChange={(event) => {
                const offer = designer?.offers.find((row) => row.id === event.target.value);
                onChange(offer ? { offerId: offer.id, offer: { on: true, title: draft.offer.title || offer.name, benefit: offer.benefitText } } : { offerId: null });
              }} className={`${select} mt-1 !py-2`}>
                <option value="">None: the email only shows the words above</option>
                {(designer?.offers ?? []).map((offer) => <option key={offer.id} value={offer.id}>{offer.name}: {offer.benefitText} ({offer.code}){offer.state === "scheduled" ? ", starts later" : ""}</option>)}
              </select>
            </label>
            <p className="m-0 mt-1.5 text-[11.5px] leading-snug text-gray-500">
              {draft.offerId ? "When they order from this email, the order form shows the lower price and the order is saved with it. Nothing changes for anyone else." : "The email shows the offer. The price is still set by the rep or the order form."}
            </p>
          </div>
        </div>
      </Card>

      <Card className="p-4">
        <div className="flex items-center justify-between">
          <h3 className="m-0 text-[17px] font-bold text-gray-900 dark:text-slate-50">Email Preview</h3>
          <div className="inline-flex overflow-hidden rounded-xl border border-gray-200 dark:border-slate-700">
            <button type="button" aria-label="Desktop preview" onClick={() => setMobile(false)} className={`!min-h-0 px-3.5 py-2 ${!mobile ? "bg-[#5B3FD9] text-white" : "bg-white text-gray-600 dark:bg-slate-900"}`}><Monitor className="h-4 w-4" /></button>
            <button type="button" aria-label="Phone preview" onClick={() => setMobile(true)} className={`!min-h-0 px-3.5 py-2 ${mobile ? "bg-[#5B3FD9] text-white" : "bg-white text-gray-600 dark:bg-slate-900"}`}><Smartphone className="h-4 w-4" /></button>
          </div>
        </div>
        <div className="mt-3 max-h-[560px] overflow-y-auto rounded-xl border border-gray-100 bg-[#F4F2FB] dark:border-slate-800">
          <EmailFrame design={draft.design} mobile={mobile} preheader={draft.preheader} brand={designer?.sender.fromName} footerNote={designer?.settings.footerNote} fit minHeight={480} />
        </div>
      </Card>
    </div>
  );
}
