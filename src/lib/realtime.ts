// Frontend Supabase client - used only for Realtime subscriptions.
// Uses the anon key (safe to expose to the browser; restricted by RLS).
// Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your Vercel environment.

import { createClient } from "@supabase/supabase-js";

const url     = (import.meta as any).env?.VITE_SUPABASE_URL     as string | undefined;
const anonKey = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY as string | undefined;

export const browserSupabaseClient = url && anonKey
  ? createClient(url, anonKey, {
      auth: { persistSession: false }
    })
  : null;

// If env vars are missing (e.g. local dev without Supabase), export null
// so callers can skip subscription gracefully.
export const realtimeClient = url && anonKey
  ? createClient(url, anonKey, {
      auth: { persistSession: false },
      realtime: { params: { eventsPerSecond: 10 } }
    })
  : null;
