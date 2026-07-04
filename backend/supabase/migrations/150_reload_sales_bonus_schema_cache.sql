-- Force PostgREST to reload its schema cache after the sales bonus tables land.
-- Without this, Supabase REST can temporarily return PGRST205 for the new tables.
notify pgrst, 'reload schema';
