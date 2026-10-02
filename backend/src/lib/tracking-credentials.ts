import { supabase } from "./supabase.js";

// Tracking Hub (2 Oct 2026): a Tracking Link (meta_capi_configs row) can point
// at a Data Source instead of carrying its own Pixel ID and token. Every
// sender (form orders, server auto-submits, delivered events) resolves the
// credentials here, so the token lives in one place.

type LinkRow = Record<string, any> & { data_source_id?: string | null; pixel_id?: string | null; access_token?: string | null; test_event_code?: string | null };

export async function withDataSource<T extends LinkRow>(row: T | null | undefined): Promise<T | null> {
  if (!row) return null;
  if (!row.data_source_id) return row;
  const { data: source } = await supabase.from("tracking_data_sources")
    .select("pixel_id, access_token, test_event_code, status").eq("id", row.data_source_id).maybeSingle();
  if (!source) return row;
  return {
    ...row,
    pixel_id: source.pixel_id || row.pixel_id || null,
    access_token: source.access_token || row.access_token || null,
    // A data source marked Testing always sends to Meta's Test Events tab.
    test_event_code: row.test_event_code || (source.status === "testing" ? source.test_event_code : null) || source.test_event_code || null
  };
}
