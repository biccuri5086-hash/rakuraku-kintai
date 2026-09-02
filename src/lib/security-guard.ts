// セキュリティ上の「フェイルセーフ」判定を集めた純粋関数群。
// 画面・API・スクリプトから同じ判定を使い、scripts/security_guard_selftest.ts でテストする。

// ── SESSION_SECRET の強度検査 ───────────────────────────────
// 署名Cookie(rk_tenant_session / rk_super_session / me_session)は
// すべて SESSION_SECRET だけで守られている。鍵が弱い・既定値・使い回しだと、
// パスワードや2FAに関係なく super セッションまで偽造でき、全社削除に至る。
// ここで「弱い鍵」を起動時・利用時に弾き、その経路を塞ぐ。
export const MIN_SECRET_LENGTH = 16;        // これ未満は即エラー（従来の下限を維持）
export const RECOMMENDED_SECRET_LENGTH = 32; // これ未満は警告（32バイト以上のランダム推奨）

// 既定値・サンプル・使い回しに現れがちな弱いトークン。
// 強いランダム鍵(base64/hex)には通常出現しない語だけを列挙する。
const WEAK_TOKENS = [
  "changeme", "change-me", "change_me",
  "password", "passwd",
  "placeholder", "example", "sample",
  "default", "dev-secret", "devsecret",
  "your-secret", "your_secret", "yoursecret",
  "insecure", "notsecret", "test-secret", "testsecret",
  "secret-key", "secretkey", "supabase-service",
];

const WEAK_EXACT = new Set([
  "secret", "test", "dev", "admin", "supabase", "session", "0123456789abcdef",
]);

export function uniqueCharCount(s: string): number {
  return new Set(s).size;
}

export type SecretVerdict =
  | { ok: true; warning?: string }
  | { ok: false; reason: string };

export function checkSessionSecret(secret: string | undefined | null): SecretVerdict {
  if (!secret) return { ok: false, reason: "SESSION_SECRET is not set" };
  if (secret.length < MIN_SECRET_LENGTH) {
    return { ok: false, reason: `SESSION_SECRET must be at least ${MIN_SECRET_LENGTH} characters (got ${secret.length})` };
  }
  const norm = secret.trim().toLowerCase();
  if (WEAK_EXACT.has(norm)) {
    return { ok: false, reason: "SESSION_SECRET is a known weak/default value" };
  }
  for (const token of WEAK_TOKENS) {
    if (norm.includes(token)) {
      return { ok: false, reason: `SESSION_SECRET contains a weak/default token ("${token}"); use a random 32+ char value` };
    }
  }
  // 反復・単調な鍵(例: "aaaa...", "abababab...")を弾く。
  if (uniqueCharCount(secret) < 8) {
    return { ok: false, reason: "SESSION_SECRET has too little entropy (fewer than 8 distinct characters)" };
  }
  if (secret.length < RECOMMENDED_SECRET_LENGTH) {
    return { ok: true, warning: `SESSION_SECRET is shorter than the recommended ${RECOMMENDED_SECRET_LENGTH} characters; rotate to a 32+ char random value` };
  }
  return { ok: true };
}

let _warned = false;
// 実行時に SESSION_SECRET を取り出す共通入口。弱ければ throw（フェイルクローズ）。
export function requireSessionSecret(secret: string | undefined | null): string {
  const verdict = checkSessionSecret(secret);
  if (!verdict.ok) throw new Error(verdict.reason);
  if (verdict.warning && !_warned) {
    _warned = true;
    console.warn(`[security] ${verdict.warning}`);
  }
  return secret as string;
}

// ── 破壊的操作の確認一致 ─────────────────────────────────────
// 会社削除など不可逆な操作で「対象名の再入力」をサーバ側で必須にする。
// セッションだけに依存せず、対象名を正確に知っていることを二重に要求する。
export function confirmationMatches(expected: string | null | undefined, provided: unknown): boolean {
  if (typeof expected !== "string" || expected.trim() === "") return false;
  if (typeof provided !== "string") return false;
  return expected.trim() === provided.trim();
}
