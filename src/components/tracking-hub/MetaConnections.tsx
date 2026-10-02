import { useState } from "react";
import { CheckCircle2, KeyRound, Plus, RefreshCw, TriangleAlert } from "lucide-react";
import { trackingHubApi, type HubConnection } from "../../lib/api";
import { ActionMenu, Card, Modal, PlatformIcon, StatusPill, ago, darkButton, input, labelCls, primaryButton, smallButton, type Toast } from "./HubParts";

// Meta Business connections (Bright, 2 Oct 2026): connect the business once
// with a System User token; Sync Assets finds its Pixels and ad accounts and
// the Owner switches each one on or off. "Add Manually" is still there for a
// Pixel owned by another business.

const STATUS: Record<HubConnection["status"], ["green" | "red" | "orange", string]> = { connected: ["green", "Connected"], error: ["red", "Problem"], disconnected: ["red", "Disconnected"], sync_failed: ["orange", "Connected · last sync failed"] };

/** The app pop-up shows a warning only for messages starting "Couldn't…". */
export const syncToast = (name: string, sync: { ok: boolean; message: string } | null, syncError: string | null) =>
  syncError ? `Couldn't read ${name}'s Pixels and ad accounts. ${syncError.replace(/^Couldn't sync\. /, "")}` : sync && !sync.ok ? `Couldn't finish the sync for ${name}. ${sync.message}` : `${name}: ${sync?.message ?? "saved."}`;

export function ConnectionsSection({ connections, onToast, onChanged, onConnect, onAddManually, onOpenPixel }: {
  connections: HubConnection[]; onToast: Toast; onChanged: () => void; onConnect: () => void; onAddManually: () => void; onOpenPixel: (sourceId: string) => void;
}) {
  if (connections.length === 0) {
    return (
      <Card className="p-6">
        <div className="flex flex-wrap items-start gap-4">
          <PlatformIcon platform="meta" size="lg" />
          <div className="min-w-0 flex-1">
            <h2 className="m-0 text-[17px] font-black text-gray-900 dark:text-slate-100">Connect your Meta Business once</h2>
            <p className="m-0 mt-1 max-w-2xl text-[13px] text-gray-600 dark:text-slate-400">Paste one System User token. Protohub finds the business's Pixels and ad accounts, and you switch on the ones to use. A new Pixel later? Press Sync Assets. No retyping.</p>
          </div>
          <div className="flex gap-2"><button type="button" className={smallButton} onClick={onAddManually}><Plus className="h-3.5 w-3.5" /> Add Manually</button><button type="button" className={`${primaryButton} !rounded-lg !px-4 !py-2 !text-[13px]`} onClick={onConnect}><Plus className="h-4 w-4" /> Connect Meta Business</button></div>
        </div>
      </Card>
    );
  }
  return (
    <div className="space-y-4">
      {connections.map((connection) => <ConnectionCard key={connection.id} connection={connection} onToast={onToast} onChanged={onChanged} onAddManually={onAddManually} onOpenPixel={onOpenPixel} />)}
    </div>
  );
}

function ConnectionCard({ connection, onToast, onChanged, onAddManually, onOpenPixel }: { connection: HubConnection; onToast: Toast; onChanged: () => void; onAddManually: () => void; onOpenPixel: (sourceId: string) => void }) {
  const [busy, setBusy] = useState("");
  const [editing, setEditing] = useState(false);
  const [tone, text] = STATUS[connection.status];
  const run = async (key: string, action: () => Promise<void>) => { setBusy(key); try { await action(); } catch (err: any) { onToast(err?.message ?? "Something went wrong."); } finally { setBusy(""); } };
  const sync = () => run("sync", async () => { const result = await trackingHubApi.syncConnection(connection.id); onToast(syncToast(connection.name, result, null)); onChanged(); });
  const test = () => run("test", async () => { const result = await trackingHubApi.testConnection(connection.id); onToast(result.ok ? result.message : `Couldn't connect: ${result.message}`); onChanged(); });
  const togglePixel = (sourceId: string, name: string, active: boolean) => run(`px${sourceId}`, async () => {
    const result = await trackingHubApi.setPixelActive(sourceId, active);
    onToast(active ? `${name} switched on.` : result.linksUsing ? `${name} switched off. ${result.linksUsing} tracking link${result.linksUsing === 1 ? " uses" : "s use"} it and will stop sending server events.` : `${name} switched off.`);
    onChanged();
  });
  const toggleAccount = (id: string, name: string, active: boolean) => run(`ad${id}`, async () => { await trackingHubApi.setAdAccountActive(id, active); onToast(`${name} switched ${active ? "on" : "off"}.`); onChanged(); });
  const pixelLine = (pixel: HubConnection["pixels"][number]) => pixel.hasAccess === false ? <span className="text-amber-600">No access: give it to the System User, then Sync</span>
    : !pixel.active ? <span className="text-gray-400">Off</span>
    : pixel.lastFiredAt ? <span className="text-emerald-600">Active · last event {ago(pixel.lastFiredAt)}</span> : <span className="text-emerald-600">Active</span>;
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start gap-3">
        <PlatformIcon platform="meta" size="lg" />
        <div className="min-w-0 flex-1">
          <p className="m-0 text-[11px] font-black uppercase tracking-wider text-gray-500">Meta Business Connection</p>
          <div className="mt-0.5 flex flex-wrap items-center gap-2"><h2 className="m-0 text-[18px] font-black text-gray-900 dark:text-slate-100">{connection.name || `Business ${connection.businessId}`}</h2><StatusPill tone={tone}>{text}</StatusPill></div>
          <dl className="m-0 mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-[12.5px] sm:grid-cols-3 xl:grid-cols-6">
            <Info label="Business ID">{connection.businessId}</Info>
            <Info label="System User">{connection.systemUserName ?? "—"}</Info>
            <Info label="Token">{connection.hasToken ? "••••••••••••" : <span className="text-rose-600">None</span>}</Info>
            <Info label="Timezone">{connection.timezone}</Info>
            <Info label="Currency">{connection.currency}</Info>
            <Info label="Last synced">{connection.lastSyncAt ? ago(connection.lastSyncAt) : "Never"}</Info>
          </dl>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className={`${darkButton} !rounded-lg !px-4 !py-2 !text-[13px]`} disabled={Boolean(busy) || !connection.hasToken} onClick={() => void sync()}><RefreshCw className={`h-4 w-4 ${busy === "sync" ? "animate-spin" : ""}`} /> {busy === "sync" ? "Syncing…" : "Sync Assets"}</button>
          <button type="button" className={smallButton} disabled={Boolean(busy) || !connection.hasToken} onClick={() => void test()}>{busy === "test" ? "Testing…" : "Test"}</button>
          <ActionMenu items={[
            { label: "Replace token / settings", onClick: () => setEditing(true) },
            { label: "Remove connection", danger: true, onClick: () => { if (!window.confirm(`Remove ${connection.name}? Its Pixels stay listed but lose this token, so they stop sending server events until they get a token again.`)) return; void run("remove", async () => { await trackingHubApi.removeConnection(connection.id); onToast("Connection removed."); onChanged(); }); } },
            { label: "Disconnect", danger: true, onClick: () => { if (!window.confirm(`Disconnect ${connection.name}? The token is removed: its Pixels stop sending server events and Meta's numbers cannot be read until you paste a token again.`)) return; void run("disconnect", async () => { await trackingHubApi.disconnectConnection(connection.id); onToast("Disconnected."); onChanged(); }); } }
          ]} />
        </div>
      </div>
      {connection.status === "error" || connection.status === "disconnected" ? (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-[12.5px] text-rose-800">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{connection.status === "disconnected" ? "No token: this business's Pixels cannot send server events or read Meta's numbers. Replace the token to reconnect." : <><strong>{connection.human?.title ?? connection.lastCheckMessage}</strong>{connection.human?.action ? ` ${connection.human.action}` : ""}</>}</span>
        </div>
      ) : null}
      {connection.lastSyncMessage ? <p className={`m-0 mt-3 text-[12px] ${connection.lastSyncOk === false ? "text-amber-700" : "text-gray-500"}`}>Last sync: {connection.lastSyncMessage}</p> : null}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-gray-200 dark:border-slate-700">
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2.5 dark:border-slate-800"><p className="m-0 text-[12px] font-black uppercase tracking-wider text-gray-500">Datasets / Pixels ({connection.pixels.length})</p><button type="button" className="!min-h-0 inline-flex items-center gap-1 text-[12.5px] font-semibold text-blue-600" onClick={onAddManually}><Plus className="h-3.5 w-3.5" /> Add Manually</button></div>
          <ul className="m-0 max-h-80 list-none divide-y divide-gray-100 overflow-y-auto p-0 dark:divide-slate-800">
            {connection.pixels.map((pixel) => (
              <li key={pixel.sourceId} className="flex items-start gap-3 px-4 py-2.5">
                <input type="checkbox" aria-label={`Use ${pixel.name}`} checked={pixel.active} disabled={busy === `px${pixel.sourceId}`} onChange={(event) => void togglePixel(pixel.sourceId, pixel.name, event.target.checked)} className="mt-1 h-4 w-4 accent-blue-600" />
                <button type="button" className="!min-h-0 min-w-0 flex-1 text-left" onClick={() => onOpenPixel(pixel.sourceId)}>
                  <span className="block truncate text-[13.5px] font-semibold text-gray-900 dark:text-slate-100">{pixel.name}</span>
                  <span className="block text-[11.5px] text-gray-500">ID: {pixel.pixelId}</span>
                  <span className="block text-[11.5px]">{pixelLine(pixel)}</span>
                </button>
              </li>
            ))}
            {connection.pixels.length === 0 ? <li className="px-4 py-6 text-center text-[12.5px] text-gray-500">No Pixel found yet. Give the Pixels to the System User in Meta Business Settings, then press Sync Assets.</li> : null}
          </ul>
        </div>
        <div className="rounded-xl border border-gray-200 dark:border-slate-700">
          <div className="border-b border-gray-100 px-4 py-2.5 dark:border-slate-800"><p className="m-0 text-[12px] font-black uppercase tracking-wider text-gray-500">Ad Accounts ({connection.adAccounts.length})</p></div>
          <ul className="m-0 max-h-80 list-none divide-y divide-gray-100 overflow-y-auto p-0 dark:divide-slate-800">
            {connection.adAccounts.map((account) => (
              <li key={account.id} className="flex items-start gap-3 px-4 py-2.5">
                <input type="checkbox" aria-label={`Use ${account.name}`} checked={account.active} disabled={busy === `ad${account.id}`} onChange={(event) => void toggleAccount(account.id, account.name || `act_${account.accountId}`, event.target.checked)} className="mt-1 h-4 w-4 accent-blue-600" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-semibold text-gray-900 dark:text-slate-100">{account.name || "Ad account"}</span>
                  <span className="block text-[11.5px] text-gray-500">act_{account.accountId}{account.currency ? ` · ${account.currency}` : ""}</span>
                  {!account.hasAccess ? <span className="block text-[11.5px] text-amber-600">No access: give it to the System User, then Sync</span> : null}
                </span>
              </li>
            ))}
            {connection.adAccounts.length === 0 ? <li className="px-4 py-6 text-center text-[12.5px] text-gray-500">No ad account found yet.</li> : null}
          </ul>
          <p className="m-0 border-t border-gray-100 px-4 py-2 text-[11px] text-gray-400 dark:border-slate-800">Reconciliation reads Meta's purchases from the ad accounts switched on.</p>
        </div>
      </div>
      {editing ? <EditConnection connection={connection} onClose={() => setEditing(false)} onSaved={(message) => { setEditing(false); onToast(message); onChanged(); }} /> : null}
    </Card>
  );
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="min-w-0"><dt className="text-[11px] text-gray-500">{label}</dt><dd className="m-0 break-all font-semibold text-gray-800 dark:text-slate-200">{children}</dd></div>;
}

const CURRENCIES = ["NGN", "USD", "GHS", "KES"];
const TIMEZONES = ["Africa/Lagos", "Africa/Accra", "Africa/Nairobi", "UTC"];

export function ConnectModal({ onClose, onDone, onToast }: { onClose: () => void; onDone: () => void; onToast: Toast }) {
  const [token, setToken] = useState("");
  const [businessId, setBusinessId] = useState("");
  const [choices, setChoices] = useState<Array<{ id: string; name: string }> | null>(null);
  const [currency, setCurrency] = useState("NGN");
  const [timezone, setTimezone] = useState("Africa/Lagos");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const connect = async () => {
    setError("");
    setNote("");
    setBusy(true);
    try {
      let chosen = businessId.trim();
      if (!chosen) {
        const who = await trackingHubApi.lookupToken(token.trim());
        if (who.businesses.length > 1) { setChoices(who.businesses); setBusinessId(who.businesses[0].id); setNote(`This token can see ${who.businesses.length} businesses. Choose which one to connect, then press Connect again.`); setBusy(false); return; }
        if (who.businesses.length === 1) chosen = who.businesses[0].id;
        else { setError(who.businessesError ? `${who.businessesError}. Enter the Business ID instead (Meta Business Settings → Business info).` : "Meta did not say which business this token belongs to. Enter the Business ID (Meta Business Settings → Business info)."); setBusy(false); return; }
      }
      const result = await trackingHubApi.connect({ accessToken: token.trim(), businessId: chosen, currency, timezone });
      onToast(syncToast(result.name, result.sync, result.syncError));
      onDone();
    } catch (err: any) {
      setError(err?.message ?? "Could not connect.");
      setBusy(false);
    }
  };
  return (
    <Modal title="Connect Meta Business" subtitle="Once per business. Its Pixels and ad accounts are found for you." onClose={onClose} wide>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-3">
          <label className={labelCls}>System User token<input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Paste from Meta Business Settings → System Users" className={`${input} font-mono`} /></label>
          {choices ? (
            <label className={labelCls}>Business<select value={businessId} onChange={(e) => setBusinessId(e.target.value)} className={input}>{choices.map((row) => <option key={row.id} value={row.id}>{row.name} ({row.id})</option>)}</select></label>
          ) : (
            <label className={labelCls}>Business ID <span className="font-normal text-gray-400">(optional: found from the token)</span><input value={businessId} onChange={(e) => setBusinessId(e.target.value)} placeholder="e.g. 102938475610293" className={`${input} font-mono`} /></label>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={labelCls}>Currency<select value={currency} onChange={(e) => setCurrency(e.target.value)} className={input}>{CURRENCIES.map((value) => <option key={value}>{value}</option>)}</select></label>
            <label className={labelCls}>Timezone<select value={timezone} onChange={(e) => setTimezone(e.target.value)} className={input}>{TIMEZONES.map((value) => <option key={value}>{value}</option>)}</select></label>
          </div>
          {note ? <p className="m-0 rounded-lg bg-blue-50 p-3 text-[13px] font-semibold text-blue-800">{note}</p> : null}
          {error ? <p className="m-0 rounded-lg bg-rose-50 p-3 text-[13px] font-semibold text-rose-700">{error}</p> : null}
          <div className="flex justify-end gap-2"><button type="button" className={smallButton} onClick={onClose}>Cancel</button><button type="button" className={`${primaryButton} !rounded-lg !px-4 !py-2 !text-[13px]`} disabled={busy || token.trim().length < 10} onClick={() => void connect()}><KeyRound className="h-4 w-4" /> {busy ? "Connecting…" : "Connect and find assets"}</button></div>
        </div>
        <aside className="rounded-xl bg-gray-50 p-4 text-[12.5px] text-gray-700 dark:bg-slate-800 dark:text-slate-300">
          <p className="m-0 font-black text-gray-900 dark:text-slate-100">Get the token (once)</p>
          <ol className="m-0 mt-2 list-decimal space-y-1.5 pl-4">
            <li>Meta Business Settings → Users → <strong>System Users</strong> → Add (Admin).</li>
            <li><strong>Assign assets</strong>: every Pixel/dataset and ad account Protohub should use.</li>
            <li><strong>Generate token</strong> with <code>ads_read</code>, <code>ads_management</code> and <code>business_management</code>.</li>
            <li>Paste it here. The token stays on Protohub's server.</li>
          </ol>
          <p className="m-0 mt-3 flex gap-1.5 text-gray-500"><CheckCircle2 className="h-4 w-4 shrink-0 fill-emerald-500 text-white" />A Pixel or ad account not assigned to the System User shows as "No access" until you assign it and press Sync Assets.</p>
        </aside>
      </div>
    </Modal>
  );
}

function EditConnection({ connection, onClose, onSaved }: { connection: HubConnection; onClose: () => void; onSaved: (message: string) => void }) {
  const [token, setToken] = useState("");
  const [businessId, setBusinessId] = useState(connection.businessId);
  const [currency, setCurrency] = useState(connection.currency);
  const [timezone, setTimezone] = useState(connection.timezone);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Modal title={`Edit ${connection.name}`} subtitle={`Business ${connection.businessId}`} onClose={onClose}>
      <div className="space-y-3">
        <label className={labelCls}>Business portfolio ID <span className="font-normal text-gray-400">(Meta Business Settings → Business info)</span><input value={businessId} onChange={(e) => setBusinessId(e.target.value.trim())} className={`${input} font-mono`} /></label>
        <label className={labelCls}>New System User token <span className="font-normal text-gray-400">(leave empty to keep the current one)</span><input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder={connection.hasToken ? "Token saved: paste to replace" : "Paste the System User token"} className={`${input} font-mono`} /></label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={labelCls}>Currency<select value={currency} onChange={(e) => setCurrency(e.target.value)} className={input}>{CURRENCIES.map((value) => <option key={value}>{value}</option>)}</select></label>
          <label className={labelCls}>Timezone<select value={timezone} onChange={(e) => setTimezone(e.target.value)} className={input}>{TIMEZONES.map((value) => <option key={value}>{value}</option>)}</select></label>
        </div>
        {error ? <p className="m-0 rounded-lg bg-rose-50 p-3 text-[13px] font-semibold text-rose-700">{error}</p> : null}
        <div className="flex justify-end gap-2"><button type="button" className={smallButton} onClick={onClose}>Cancel</button>
          <button type="button" className={`${darkButton} !rounded-lg !px-4 !py-2 !text-[13px]`} disabled={busy} onClick={async () => {
            setBusy(true);
            setError("");
            try {
              const result = await trackingHubApi.saveConnection(connection.id, { accessToken: token.trim() || undefined, businessId: businessId !== connection.businessId ? businessId : undefined, currency, timezone });
              onSaved(result.sync || result.syncError ? syncToast(result.name, result.sync, result.syncError) : "Connection saved.");
            } catch (err: any) { setError(err?.message ?? "Could not save."); setBusy(false); }
          }}>{busy ? "Checking…" : "Save"}</button></div>
      </div>
    </Modal>
  );
}
