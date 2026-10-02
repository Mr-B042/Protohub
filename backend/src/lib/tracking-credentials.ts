import { supabase } from "./supabase.js";

// Tracking Hub (2 Oct 2026): a Tracking Link (meta_capi_configs row) can point
// at a Data Source instead of carrying its own Pixel ID and token. Every
// sender (form orders, server auto-submits, delivered events) resolves the
// credentials here, so the token lives in one place.

type LinkRow = Record<string, any> & { data_source_id?: string | null; pixel_id?: string | null; access_token?: string | null; test_event_code?: string | null };

/** The Meta Business connection's token (Pixels found through a connection use it). */
export async function connectionToken(connectionId: string | null | undefined): Promise<string | null> {
  if (!connectionId) return null;
  const { data } = await supabase.from("tracking_meta_connections").select("access_token").eq("id", connectionId).maybeSingle();
  return data?.access_token || null;
}

export async function withDataSource<T extends LinkRow>(row: T | null | undefined): Promise<T | null> {
  if (!row) return null;
  if (!row.data_source_id) return row;
  const { data: source } = await supabase.from("tracking_data_sources")
    .select("pixel_id, access_token, test_event_code, status, active, connection_id").eq("id", row.data_source_id).maybeSingle();
  if (!source) return row;
  // A Pixel switched off in the hub sends nothing (recorded as "no token").
  const token = source.active === false ? null : source.access_token || (await connectionToken(source.connection_id)) || row.access_token || null;
  return {
    ...row,
    pixel_id: source.pixel_id || row.pixel_id || null,
    access_token: token,
    // A data source marked Testing always sends to Meta's Test Events tab.
    test_event_code: row.test_event_code || (source.status === "testing" ? source.test_event_code : null) || source.test_event_code || null
  };
}

/**
 * Tracking Hub Settings (2 Oct 2026): "Enable Tracking Hub", "Send Server
 * Events (CAPI)" and the tracking mode. Off = Protohub sends nothing to Meta
 * for that branch. Purchase also stops on "Thank-you page only". Any read
 * problem = allowed, so a settings hiccup never silently stops tracking.
 */
export async function serverEventsAllowed(orgId: string, branchId: string | null | undefined, kind: "Purchase" | "Delivered" = "Purchase"): Promise<boolean> {
  if (!branchId) return true;
  try {
    const { data } = await supabase.from("tracking_settings").select("settings").eq("org_id", orgId).eq("branch_id", branchId).maybeSingle();
    const settings = (data?.settings ?? {}) as { enabled?: boolean; sendCapi?: boolean; trackingMode?: string };
    if (settings.enabled === false || settings.sendCapi === false) return false;
    if (kind === "Purchase" && settings.trackingMode === "thank_you") return false;
    return true;
  } catch {
    return true;
  }
}
