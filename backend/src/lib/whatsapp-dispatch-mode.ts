import { supabase } from "./supabase.js";

// Org WhatsApp setup mode. true = each member connects their OWN account + manages
// their own destinations (dispatch sends from their own number); false (default) =
// shared: the admin/owner connects once and everyone dispatches through that account.
export async function isPerUserWhatsAppDispatch(orgId: string): Promise<boolean> {
  const { data } = await supabase
    .from("whatsapp_settings")
    .select("per_user_dispatch")
    .eq("org_id", orgId)
    .maybeSingle();
  return data?.per_user_dispatch === true;
}
