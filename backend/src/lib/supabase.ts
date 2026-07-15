import { createClient } from "@supabase/supabase-js";
import "./load-env.js";
import { assertSafeSupabaseRuntime } from "./local-safety.js";

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.");
}

assertSafeSupabaseRuntime(url);

// Service role client — bypasses RLS for server-side operations.
// Never expose this key to the frontend.
export const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false }
});

// Anon-key client. Required for flows that go through Supabase's public auth
// API (e.g. resetPasswordForEmail, which only triggers email delivery from
// the anon-key endpoint — admin.generateLink does not send mail).
const anonKey = process.env.SUPABASE_ANON_KEY;
export const supabaseAnon = anonKey
  ? createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    })
  : null;

// Supabase Auth clients keep an in-memory refresh promise. Sharing one client
// between concurrent HTTP requests can make different users receive the same
// in-flight refresh result. Login and refresh routes must use a fresh client.
export const createSupabaseAuthClient = () => createClient(url, anonKey ?? serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
});

// Create a client scoped to a specific user (respects RLS)
export const supabaseAs = (accessToken: string) => {
  if (!anonKey) throw new Error("SUPABASE_ANON_KEY is required for user-scoped clients.");
  return createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false }
  });
};
