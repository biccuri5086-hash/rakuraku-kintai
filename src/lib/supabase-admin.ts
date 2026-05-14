import { createClient, SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (_client) return _client;
  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const rawKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!rawUrl || !rawKey) {
    throw new Error("SUPABASE env vars missing");
  }
  const url = rawUrl.trim().replace(/^["']|["']$/g, "");
  const key = rawKey.trim().replace(/^["']|["']$/g, "");
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(url)) {
    throw new Error(
      `NEXT_PUBLIC_SUPABASE_URL format is invalid. Got: "${url}" (length=${url.length}). Expected: https://xxxx.supabase.co`
    );
  }
  if (key.length < 20) {
    throw new Error(`SUPABASE_SERVICE_ROLE_KEY looks too short (length=${key.length})`);
  }
  _client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _client;
}
