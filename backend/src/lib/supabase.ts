import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.");
}

// Service role client — bypasses RLS for server-side operations.
// Never expose this key to the frontend.
export const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false }
});

// Create a client scoped to a specific user (respects RLS)
export const supabaseAs = (accessToken: string) =>
  createClient(url, process.env.SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false }
  });
