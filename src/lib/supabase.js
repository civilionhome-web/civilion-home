import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isConfigured = Boolean(url && key && !url.includes('YOUR-PROJECT'));

export const supabase = createClient(url || 'http://localhost', key || 'missing-key', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

export const CLIENT_LOGIN = (import.meta.env.VITE_CLIENT_LOGIN || 'whatsapp').toLowerCase();

export const BUCKET = 'project-files';

// Throws the Supabase error so callers can show it.
export async function must(promise) {
  const { data, error } = await promise;
  if (error) throw error;
  return data;
}
