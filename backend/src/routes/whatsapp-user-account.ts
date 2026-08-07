import { Router } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import {
  beginUserWhatsAppConnection,
  disconnectUserWhatsAppConnection,
  disconnectWhatsAppConnection,
  listUserWhatsAppGroups,
  type WhatsAppPairingMode
} from "../lib/whatsapp-runtime.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

const ConnectSchema = z.object({
  mode: z.enum(["qr", "pairing_code"]),
  phone: z.string().optional(),
  riskAcknowledged: z.boolean().optional()
});

const AckSchema = z.object({
  riskAcknowledged: z.literal(true)
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function defaultAccount(orgId: string, userId: string) {
  return {
    org_id: orgId,
    user_id: userId,
    enabled: false,
    provider: "baileys",
    connection_status: "disconnected",
    connected_phone: "",
    connected_name: "",
    last_connected_at: null,
    last_error: "",
    pairing_mode: null,
    pairing_phone: "",
    pairing_code: "",
    qr_code_data_url: "",
    risk_acknowledged_at: null,
    updated_at: null
  };
}

async function loadAccount(orgId: string, userId: string) {
  const { data, error } = await supabase
    .from("whatsapp_user_accounts")
    .select("*")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return data ?? defaultAccount(orgId, userId);
}

async function recentDispatches(orgId: string, userId: string, team = false) {
  let query = supabase
    .from("whatsapp_order_dispatches")
    .select("*, sender:users!whatsapp_order_dispatches_sender_user_id_fkey(id, name, role)")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (!team) query = query.eq("sender_user_id", userId);

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

router.get("/me/connect", async (req, res) => {
  try {
    const [account, dispatches] = await Promise.all([
      loadAccount(req.user!.orgId, req.user!.id),
      recentDispatches(req.user!.orgId, req.user!.id)
    ]);
    res.json({ account, dispatches });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Could not load WhatsApp account." });
  }
});

router.post("/me/connect", async (req, res) => {
  const parsed = ConnectSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  try {
    if (parsed.data.riskAcknowledged) {
      await supabase
        .from("whatsapp_user_accounts")
        .upsert({
          org_id: req.user!.orgId,
          user_id: req.user!.id,
          provider: "baileys",
          risk_acknowledged_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }, { onConflict: "org_id,user_id" });
    }

    const mode = parsed.data.mode as WhatsAppPairingMode;
    await beginUserWhatsAppConnection(req.user!.orgId, req.user!.id, mode, parsed.data.phone ?? null);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Could not start your WhatsApp connection." });
    return;
  }

  let account = await loadAccount(req.user!.orgId, req.user!.id);
  const started = Date.now();
  while (
    Date.now() - started < 6000 &&
    account.connection_status === "pairing" &&
    !account.qr_code_data_url &&
    !account.pairing_code
  ) {
    await sleep(500);
    account = await loadAccount(req.user!.orgId, req.user!.id);
  }

  res.json({ account });
});

router.post("/me/risk-acknowledgement", async (req, res) => {
  const parsed = AckSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Risk acknowledgement is required before direct sending." });
    return;
  }

  const { data, error } = await supabase
    .from("whatsapp_user_accounts")
    .upsert({
      org_id: req.user!.orgId,
      user_id: req.user!.id,
      provider: "baileys",
      risk_acknowledged_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }, { onConflict: "org_id,user_id" })
    .select()
    .single();

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json({ account: data });
});

router.post("/me/disconnect", async (req, res) => {
  try {
    await disconnectUserWhatsAppConnection(req.user!.orgId, req.user!.id);
    res.json({ account: defaultAccount(req.user!.orgId, req.user!.id) });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Could not disconnect your WhatsApp." });
  }
});

router.get("/me/groups", async (req, res) => {
  try {
    const groups = await listUserWhatsAppGroups(req.user!.orgId, req.user!.id);
    res.json({ groups });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Could not import WhatsApp groups." });
  }
});

router.get("/dispatches", requireRole("Owner", "Admin"), async (req, res) => {
  try {
    const scope = String(req.query.scope ?? "team");
    const team = scope !== "me";
    res.json({ dispatches: await recentDispatches(req.user!.orgId, req.user!.id, team) });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Could not load dispatch logs." });
  }
});

// Owner/Admin can view any user's account + dispatches for view-as mode.
router.get("/user/:userId/connect", requireRole("Owner", "Admin"), async (req, res) => {
  try {
    const userId = String(req.params["userId"] ?? "");
    const [account, dispatches] = await Promise.all([
      loadAccount(req.user!.orgId, userId),
      recentDispatches(req.user!.orgId, userId)
    ]);
    res.json({ account, dispatches });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Could not load user WhatsApp account." });
  }
});

// ── Owner/Admin: every WhatsApp account in the org, in one list ───────────
//
// There was no way to SEE these. An Owner could fetch one account if they
// already knew the user id, which is no use when the question is "which of
// these is stuck and costing me money". Two accounts retried for a day before
// anyone could have noticed from inside the app.
router.get("/accounts", requireRole("Owner", "Admin"), async (req, res) => {
  try {
    const orgId = req.user!.orgId;
    const [{ data: accounts }, { data: people }] = await Promise.all([
      supabase
        .from("whatsapp_user_accounts")
        .select("user_id, enabled, connection_status, connected_phone, connected_name, last_error, last_connected_at, updated_at")
        .eq("org_id", orgId),
      supabase.from("users").select("id, name, role").eq("org_id", orgId)
    ]);
    const nameOf = new Map((people ?? []).map((p: any) => [String(p.id), { name: p.name as string, role: p.role as string }]));
    const rows = (accounts ?? []).map((account: any) => ({
      ...account,
      userName: nameOf.get(String(account.user_id))?.name ?? "Unknown user",
      userRole: nameOf.get(String(account.user_id))?.role ?? null
    }));
    // Anything still enabled but not connected is what a reader is looking for,
    // so it sorts to the top rather than being hunted for.
    rows.sort((a: any, b: any) => {
      const problem = (r: any) => (r.enabled && r.connection_status !== "connected" ? 0 : 1);
      return problem(a) - problem(b) || String(a.userName).localeCompare(String(b.userName));
    });
    res.json({ accounts: rows });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Could not load WhatsApp accounts." });
  }
});

// The master switch. Disconnects every enabled account in the org - personal
// accounts and the shared org automation - in one action.
router.post("/disable-all", requireRole("Owner", "Admin"), async (req, res) => {
  try {
    const orgId = req.user!.orgId;
    const { data: accounts } = await supabase
      .from("whatsapp_user_accounts")
      .select("user_id")
      .eq("org_id", orgId)
      .eq("enabled", true);

    const userIds = (accounts ?? []).map((row: any) => String(row.user_id));
    // Sequential, not parallel: each disconnect tears down a socket and writes
    // a row, and firing them all at once is how you trip the contention this
    // module has been bitten by before.
    let disabled = 0;
    for (const userId of userIds) {
      try { await disconnectUserWhatsAppConnection(orgId, userId); disabled += 1; }
      catch { /* keep going - one stuck socket must not block the rest */ }
    }
    let orgDisabled = false;
    try { await disconnectWhatsAppConnection(orgId); orgDisabled = true; } catch { /* may not be connected */ }

    res.json({ disabled, orgDisabled, total: userIds.length });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Could not disable WhatsApp." });
  }
});

// Owner/Admin can disconnect ANY user's account.
//
// Until now only /me/disconnect existed, so an account stuck failing could only
// be switched off by the person who owned it. Two accounts sat errored+enabled
// for a day retrying every five seconds, and the Owner watching the bill had no
// way to stop them.
router.post("/user/:userId/disconnect", requireRole("Owner", "Admin"), async (req, res) => {
  try {
    const userId = String(req.params["userId"] ?? "");
    if (!userId) { res.status(400).json({ error: "A user is required." }); return; }
    await disconnectUserWhatsAppConnection(req.user!.orgId, userId);
    res.json({ account: defaultAccount(req.user!.orgId, userId) });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Could not disconnect that WhatsApp account." });
  }
});

export default router;
