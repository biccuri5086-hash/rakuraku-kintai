import { getSupabaseAdmin } from "./supabase-admin";

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetInSec: number;
};

// DB関数 rate_limit_consume（0012）が使えるか。関数が無い環境（マイグレーション適用前に
// アプリだけ先にデプロイされた場合）では従来の「読む→判定→失敗後に加算」に戻る。
let atomicAvailable = true;

function isMissingFunction(e: { code?: string } | null): boolean {
  return !!e && (e.code === "PGRST202" || e.code === "42883");
}

/**
 * 試行の入口で呼ぶ。1回のSQLで「+1」と「上限判定」を同時に行うので、
 * 同時に大量のリクエストが来ても上限を超えて通ることはない。
 * 許可された試行のうち失敗でなかったもの（2FA入力待ちなど）は releaseAttempt で戻す。
 */
export async function checkRateLimit(key: string): Promise<RateLimitResult> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("rate_limit_consume", {
    p_key: key,
    p_max: MAX_ATTEMPTS,
    p_window_seconds: WINDOW_MS / 1000,
  });
  if (!error && Array.isArray(data) && data[0]) {
    atomicAvailable = true;
    const row = data[0] as { allowed: boolean; remaining: number; reset_in_sec: number };
    return { allowed: row.allowed, remaining: row.remaining, resetInSec: row.reset_in_sec };
  }
  if (!isMissingFunction(error)) {
    // 原因不明のエラーで認証の入口を開けっぱなしにしない（安全側＝拒否）。
    throw new Error(`rate_limit_consume failed: ${error?.message ?? "empty result"}`);
  }
  atomicAvailable = false;
  return legacyCheckRateLimit(key);
}

/** 失敗ではなかった試行（2FAコードの入力待ちなど）の分を戻す。 */
export async function releaseAttempt(key: string): Promise<void> {
  if (!atomicAvailable) return;
  const supabase = getSupabaseAdmin();
  await supabase.rpc("rate_limit_release", { p_key: key });
}

async function legacyCheckRateLimit(key: string): Promise<RateLimitResult> {
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

/**
 * 失敗を記録する。0012 適用後は checkRateLimit が試行の入口で数えているので何もしない
 * （適用前の環境でだけ従来どおり加算する）。
 */
export async function recordFailure(key: string): Promise<void> {
  if (atomicAvailable) return;
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
