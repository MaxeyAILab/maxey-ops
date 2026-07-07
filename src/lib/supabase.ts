import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-side Supabase admin client (service-role key — never import this into
 * a client component). Used for private-bucket file storage. Returns null when
 * Supabase env vars aren't set, so local dev against the embedded Postgres can
 * fall back to disk storage without any Supabase project.
 */
const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "uploads";
export const storageConfigured = Boolean(url && serviceKey);

let client: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient | null {
  if (!storageConfigured) return null;
  if (!client) {
    client = createClient(url!, serviceKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}
