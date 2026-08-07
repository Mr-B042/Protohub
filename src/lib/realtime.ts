// Frontend Supabase client - used only for Realtime subscriptions.
// Uses the anon key (safe to expose to the browser; restricted by RLS).
// Set VITE_SUPABASE_URL and either VITE_SUPABASE_ANON_KEY or
// VITE_SUPABASE_PUBLISHABLE_KEY in your Vercel environment.

import { createClient } from "@supabase/supabase-js";

const env = (import.meta as any).env ?? {};
const url = env.VITE_SUPABASE_URL as string | undefined;
// Supabase now issues publishable keys (sb_publishable_...) and calls the old
// JWT one legacy, so both names are in circulation and either is correct here.
// Accepting only one is how a key that WAS set sat there doing nothing.
const anonKey = (env.VITE_SUPABASE_ANON_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY) as string | undefined;

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
