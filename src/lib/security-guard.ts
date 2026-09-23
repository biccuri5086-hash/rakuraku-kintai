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

// label は "SESSION_SECRET" / "SUPABASE_JWT_SECRET" 等、呼び出し元の環境変数名を
// そのままエラー文に出すための表示名。判定ロジック自体はどの鍵でも同じ強度基準を使う。
function checkSecretStrength(secret: string | undefined | null, label: string): SecretVerdict {
  if (!secret) return { ok: false, reason: `${label} is not set` };
  if (secret.length < MIN_SECRET_LENGTH) {
    return { ok: false, reason: `${label} must be at least ${MIN_SECRET_LENGTH} characters (got ${secret.length})` };
  }
  const norm = secret.trim().toLowerCase();
  if (WEAK_EXACT.has(norm)) {
    return { ok: false, reason: `${label} is a known weak/default value` };
  }
  for (const token of WEAK_TOKENS) {
    if (norm.includes(token)) {
      return { ok: false, reason: `${label} contains a weak/default token ("${token}"); use a random 32+ char value` };
    }
  }
  // 反復・単調な鍵(例: "aaaa...", "abababab...")を弾く。
  if (uniqueCharCount(secret) < 8) {
    return { ok: false, reason: `${label} has too little entropy (fewer than 8 distinct characters)` };
  }
  if (secret.length < RECOMMENDED_SECRET_LENGTH) {
    return { ok: true, warning: `${label} is shorter than the recommended ${RECOMMENDED_SECRET_LENGTH} characters; rotate to a 32+ char random value` };
  }
  return { ok: true };
}

export function checkSessionSecret(secret: string | undefined | null): SecretVerdict {
  return checkSecretStrength(secret, "SESSION_SECRET");
}

// RLS用スコープ付きJWT(src/lib/tenant-jwt.ts)の署名鍵。SESSION_SECRETとは別物・使い回し禁止
// (どちらかが漏れても、もう一方には影響しないようにするため)。
export function checkSupabaseJwtSecret(secret: string | undefined | null): SecretVerdict {
  return checkSecretStrength(secret, "SUPABASE_JWT_SECRET");
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

let _jwtWarned = false;
export function requireSupabaseJwtSecret(secret: string | undefined | null): string {
  const verdict = checkSupabaseJwtSecret(secret);
  if (!verdict.ok) throw new Error(verdict.reason);
  if (verdict.warning && !_jwtWarned) {
    _jwtWarned = true;
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
