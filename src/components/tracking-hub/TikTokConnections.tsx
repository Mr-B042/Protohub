import { useState } from "react";
import { KeyRound, Plus, RefreshCw } from "lucide-react";
import { trackingHubApi, type HubTikTokConnection } from "../../lib/api";
import { ActionMenu, Card, CopyButton, Modal, PlatformIcon, StatusPill, Toggle, ago, input, labelCls, outlineButton, primaryButton, smallButton, useLoad, type Toast } from "./HubParts";

// TikTok Ads Manager (Bright, 8 Oct 2026): a Marketing API token plus the
// advertiser accounts it was authorised to, so Ad Spend reads TikTok's spend
// the way it reads Meta's. Sales TO TikTok use a TikTok Pixel data source.

function ConnectTikTok({ connection, onClose, onSaved }: { connection: HubTikTokConnection | null; onClose: () => void; onSaved: (message: string) => void }) {
  const [name, setName] = useState(connection?.name ?? "");
  const [token, setToken] = useState(connection ? "••••••••" : "");
  const [ids, setIds] = useState(connection ? connection.advertisers.map((row) => row.id).join(", ") : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    setBusy(true); setError("");
    try {
      const saved = connection ? await trackingHubApi.saveTikTok(connection.id, { name, accessToken: token, advertiserIds: ids }) : await trackingHubApi.connectTikTok({ name, accessToken: token, advertiserIds: ids });
      const readable = saved.advertisers.filter((row) => row.hasAccess).length;
      onSaved(readable ? `${saved.name}: ${readable} of ${saved.advertisers.length} advertiser account${saved.advertisers.length === 1 ? "" : "s"} can be read.` : `Couldn't read any of these advertiser accounts with that token. Check the token was authorised for them.`);
    } catch (err: any) { setError(err?.message ?? "Couldn't connect TikTok."); } finally { setBusy(false); }
  };
  return (
    <Modal title={connection ? "Edit TikTok Ads connection" : "Connect TikTok Ads Manager"} subtitle="So Ad Spend reads TikTok's spend by itself." onClose={onClose}>
      <ol className="m-0 mb-4 list-decimal space-y-1 pl-5 text-[12.5px] text-gray-600 dark:text-slate-300">
        <li>In TikTok for Business Developers (business-api.tiktok.com), create an app with <strong>Reporting</strong> and <strong>Ad Account Management</strong> read access.</li>
        <li>Once TikTok approves it, open the app's authorisation link and tick your advertiser accounts. Copy the long-term access token it gives.</li>
        <li>Paste the token here with the advertiser IDs (shown under each account name in TikTok Ads Manager).</li>
      </ol>
      <label className={labelCls}>Name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="TikTok Ads" className={input} /></label>
      <label className={`${labelCls} mt-3`}>Access token<input value={token} onChange={(event) => setToken(event.target.value)} onFocus={() => { if (token === "••••••••") setToken(""); }} placeholder="Paste the Marketing API token" className={input} /></label>
      <label className={`${labelCls} mt-3`}>Advertiser IDs<textarea value={ids} onChange={(event) => setIds(event.target.value)} rows={2} placeholder="7012345678901234567, 7012345678901234568" className={`${input} !h-auto py-2`} /></label>
      {error ? <p className="m-0 mt-3 text-[13px] font-semibold text-rose-600">{error}</p> : null}
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onClose} className={outlineButton}>Cancel</button>
        <button type="button" disabled={busy || !ids.trim() || (!connection && token.trim().length < 10)} onClick={save} className={primaryButton}>{busy ? "Checking with TikTok…" : connection ? "Save" : "Connect"}</button>
      </div>
    </Modal>
  );
}

export default function TikTokConnections({ onToast }: { onToast: Toast }) {
  const { data, error, reload } = useLoad(() => trackingHubApi.tiktokConnections(), []);
  const [editing, setEditing] = useState<HubTikTokConnection | "new" | null>(null);
  if (!data) return error ? <Card className="p-4 text-[13px] text-rose-600">Couldn't load TikTok Ads: {error}</Card> : null;
  const params = (
    <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-slate-700 dark:bg-slate-800/50">
      <span className="block text-[12px] font-bold text-gray-700 dark:text-slate-300">Paste on every TikTok ad (Ad → Destination → URL parameters), so each order carries its campaign, ad group and ad:</span>
      <span className="mt-1 flex items-start gap-2"><code className="min-w-0 flex-1 break-all text-[11.5px] text-gray-800 dark:text-slate-200">{data.urlParameters}</code><CopyButton text={data.urlParameters} onToast={onToast} /></span>
      <span className="mt-1 block text-[11.5px] text-gray-500">Today's TikTok ads only pass the campaign name, so orders are matched to a campaign by name until these are added.</span>
    </div>
  );
  return (
    <>
      {data.connections.length === 0 ? (
        <Card className="p-6">
          <div className="flex flex-wrap items-start gap-4">
            <PlatformIcon platform="tiktok" size="lg" />
            <div className="min-w-0 flex-1">
              <h2 className="m-0 text-[17px] font-black text-gray-900 dark:text-slate-100">Connect TikTok Ads Manager</h2>
              <p className="m-0 mt-1 max-w-2xl text-[13px] text-gray-600 dark:text-slate-400">Reads TikTok's spend per campaign, ad group and ad every 30 minutes, so the Ad Spend tab measures TikTok orders against TikTok spend.</p>
              {params}
            </div>
            <button type="button" className={`${primaryButton} !rounded-lg !px-4 !py-2 !text-[13px]`} onClick={() => setEditing("new")}><Plus className="h-4 w-4" /> Connect TikTok Ads</button>
          </div>
        </Card>
      ) : data.connections.map((connection) => (
        <Card key={connection.id} className="p-5">
          <div className="flex flex-wrap items-start gap-4">
            <PlatformIcon platform="tiktok" size="lg" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="m-0 text-[17px] font-black text-gray-900 dark:text-slate-100">{connection.name}</h2>
                <StatusPill tone={!connection.hasToken ? "red" : connection.lastCheckOk === false ? "orange" : "green"}>{!connection.hasToken ? "No token" : connection.lastCheckOk === false ? "Problem" : "Connected"}</StatusPill>
              </div>
              <p className="m-0 mt-0.5 text-[12.5px] text-gray-500">{connection.lastCheckMessage ?? ""}{connection.lastCheckAt ? ` · checked ${ago(connection.lastCheckAt)}` : ""}</p>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" className={smallButton} onClick={async () => {
                try { const saved = await trackingHubApi.saveTikTok(connection.id, {}); onToast(`${saved.name}: ${saved.lastCheckMessage ?? "checked."}`); reload(); } catch (err: any) { onToast(`Couldn't check TikTok: ${err?.message ?? "try again."}`); }
              }}><RefreshCw className="h-3.5 w-3.5" /> Test Connection</button>
              <ActionMenu items={[
                { label: "Edit token / advertisers", onClick: () => setEditing(connection) },
                { label: "Remove", danger: true, onClick: async () => {
                  if (!window.confirm(`Remove ${connection.name}? Its TikTok spend stops coming in.`)) return;
                  try { await trackingHubApi.removeTikTok(connection.id); onToast("TikTok connection removed."); reload(); } catch (err: any) { onToast(`Couldn't remove: ${err?.message ?? "try again."}`); }
                } }
              ]} />
            </div>
          </div>
          <div className="mt-4 divide-y divide-gray-100 rounded-lg border border-gray-200 dark:divide-slate-800 dark:border-slate-700">
            {connection.advertisers.map((advertiser) => (
              <div key={advertiser.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5">
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold text-gray-900 dark:text-slate-100">{advertiser.name || "Advertiser"} <span className="font-normal text-gray-400">{advertiser.id}</span></span>
                  <span className="block text-[11.5px] text-gray-500">{advertiser.hasAccess ? [advertiser.currency, advertiser.timezone].filter(Boolean).join(" · ") || "Can be read" : <span className="inline-flex items-center gap-1 text-amber-700"><KeyRound className="h-3 w-3" /> This token can't read it. Authorise the app for this account.</span>}</span>
                </span>
                <Toggle checked={advertiser.active} disabled={!advertiser.hasAccess} onChange={async (active) => {
                  try { await trackingHubApi.setTikTokAdvertiserActive(connection.id, advertiser.id, active); onToast(active ? `${advertiser.name || advertiser.id}: spend will be read.` : `${advertiser.name || advertiser.id}: switched off.`); reload(); }
                  catch (err: any) { onToast(`Couldn't save: ${err?.message ?? "try again."}`); }
                }} />
              </div>
            ))}
          </div>
          {params}
        </Card>
      ))}
      {editing ? <ConnectTikTok connection={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={(message) => { setEditing(null); onToast(message); reload(); }} /> : null}
    </>
  );
}
