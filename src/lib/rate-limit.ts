import { getSupabaseAdmin } from "./supabase-admin";

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetInSec: number;
};

export async function checkRateLimit(key: string): Promise<RateLimitResult> {
  const supabase = getSupabaseAdmin();
  const now = new Date();
  const { data } = await supabase
    .from("rate_limits")
    .select("count, reset_at")
    .eq("key", key)
    .maybeSingle();

  if (!data || new Date(data.reset_at) < now) {
    return { allowed: true, remaining: MAX_ATTEMPTS, resetInSec: 0 };
  }
  if (data.count >= MAX_ATTEMPTS) {
    const resetInSec = Math.ceil((new Date(data.reset_at).getTime() - now.getTime()) / 1000);
    return { allowed: false, remaining: 0, resetInSec };
  }
  return { allowed: true, remaining: MAX_ATTEMPTS - data.count, resetInSec: 0 };
}

export async function recordFailure(key: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  const now = new Date();
  const { data } = await supabase
    .from("rate_limits")
    .select("count, reset_at")
    .eq("key", key)
    .maybeSingle();

  if (!data || new Date(data.reset_at) < now) {
    await supabase.from("rate_limits").upsert({
      key,
      count: 1,
      reset_at: new Date(now.getTime() + WINDOW_MS).toISOString(),
      updated_at: now.toISOString(),
    });
    return;
  }

  await supabase
    .from("rate_limits")
    .update({ count: data.count + 1, updated_at: now.toISOString() })
    .eq("key", key);
}

export async function recordSuccess(key: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  await supabase.from("rate_limits").delete().eq("key", key);
}
