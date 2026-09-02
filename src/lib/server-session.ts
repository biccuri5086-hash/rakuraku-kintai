// サーバ側セッション表による、失効可能な継続ログイン（案C）。
//
// これまでの署名Cookie(stateless)は「発行したら期限まで無効化できない」弱点があった。
// ここでは不透明なランダムトークンをCookieに入れ、DB(auth_sessions)側で状態を持つ。
// - 個別/一括で失効できる（パスワード・2FA変更時に他端末を自動ログアウト）
// - スライディング期限（使うたび先送り）＋絶対上限（放置でも必ず切れる）
// - Cookieに入るのは乱数の“シークレット”で、DBにはそのSHA-256ハッシュのみ保存
//   → DBが漏れてもCookieは再現できない。SESSION_SECRETの強度とも独立。
//
// 判定ロジックは純粋関数に切り出し、scripts/server_session_selftest.ts で検証する。
import crypto from "node:crypto";
import { getSupabaseAdmin } from "./supabase-admin";

export type SessionActorType = "admin" | "super_admin";

// スライディング窓（アイドル）と絶対上限。remember=false は短命セッション。
export const IDLE_MAX_AGE_REMEMBERED = 60 * 60 * 24 * 30; // 30日（使い続ける限り継続）
export const ABSOLUTE_MAX_AGE_REMEMBERED = 60 * 60 * 24 * 90; // 90日（放置でも必ず失効）
export const IDLE_MAX_AGE_SESSION = 60 * 60 * 12; // 12時間
export const ABSOLUTE_MAX_AGE_SESSION = 60 * 60 * 12; // 12時間
// スライド更新のDB書き込みを間引く（毎リクエスト書かない）。
export const SLIDE_THROTTLE_SEC = 60 * 5;

const TABLE = "auth_sessions";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── 純粋関数 ────────────────────────────────────────────────
export function generateSession(): { sessionId: string; secret: string; cookieValue: string } {
  const sessionId = crypto.randomUUID();
  const secret = crypto.randomBytes(32).toString("base64url");
  return { sessionId, secret, cookieValue: `${sessionId}.${secret}` };
}

export function hashSecret(secret: string): string {
  return crypto.createHash("sha256").update(secret).digest("hex");
}

export function parseSessionCookie(value: string | undefined | null): { sessionId: string; secret: string } | null {
  if (!value) return null;
  const idx = value.indexOf(".");
  if (idx <= 0) return null;
  const sessionId = value.slice(0, idx);
  const secret = value.slice(idx + 1);
  if (!sessionId || !secret) return null;
  if (!UUID_RE.test(sessionId)) return null;
  return { sessionId, secret };
}

export function secretMatches(secret: string, storedHash: string | null | undefined): boolean {
  if (!storedHash) return false;
  const a = Buffer.from(hashSecret(secret));
  const b = Buffer.from(storedHash);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function computeExpiries(nowMs: number, remember: boolean): {
  idleTtlSeconds: number;
  idleExpiresAt: string;
  absoluteExpiresAt: string;
} {
  const idleTtlSeconds = remember ? IDLE_MAX_AGE_REMEMBERED : IDLE_MAX_AGE_SESSION;
  const absSeconds = remember ? ABSOLUTE_MAX_AGE_REMEMBERED : ABSOLUTE_MAX_AGE_SESSION;
  return {
    idleTtlSeconds,
    idleExpiresAt: new Date(nowMs + idleTtlSeconds * 1000).toISOString(),
    absoluteExpiresAt: new Date(nowMs + absSeconds * 1000).toISOString(),
  };
}

export type SessionRow = {
  revoked_at: string | null;
  idle_expires_at: string;
  absolute_expires_at: string;
  last_used_at: string;
  idle_ttl_seconds: number;
};

export type SessionEvaluation =
  | { state: "valid"; slide: boolean; nextIdleExpiresAt: string }
  | { state: "revoked" | "idle_expired" | "absolute_expired" | "malformed" };

export function evaluateSession(row: SessionRow, nowMs: number): SessionEvaluation {
  if (row.revoked_at) return { state: "revoked" };
  const abs = Date.parse(row.absolute_expires_at);
  const idle = Date.parse(row.idle_expires_at);
  const lastUsed = Date.parse(row.last_used_at);
  if (!Number.isFinite(abs) || !Number.isFinite(idle) || !Number.isFinite(lastUsed)) {
    return { state: "malformed" };
  }
  if (nowMs >= abs) return { state: "absolute_expired" };
  if (nowMs >= idle) return { state: "idle_expired" };
  const slide = nowMs - lastUsed >= SLIDE_THROTTLE_SEC * 1000;
  // アイドル窓を先送りしつつ、絶対上限は超えない。
  const nextIdle = Math.min(nowMs + row.idle_ttl_seconds * 1000, abs);
  return { state: "valid", slide, nextIdleExpiresAt: new Date(nextIdle).toISOString() };
}

// Cookie の Max-Age。絶対上限まで保持し、失効判定はサーバ側で行う。
export function cookieMaxAge(remember: boolean): number {
  return remember ? ABSOLUTE_MAX_AGE_REMEMBERED : ABSOLUTE_MAX_AGE_SESSION;
}

// ── DB I/O（薄いラッパー） ──────────────────────────────────
export async function createServerSession(input: {
  actorType: SessionActorType;
  actorId: string;
  companyId: string | null;
  remember: boolean;
  userAgent?: string | null;
  ip?: string | null;
}): Promise<{ cookieValue: string; maxAge: number }> {
  const { sessionId, secret, cookieValue } = generateSession();
  const now = Date.now();
  const exp = computeExpiries(now, input.remember);
  const nowIso = new Date(now).toISOString();

  const { error } = await getSupabaseAdmin().from(TABLE).insert({
    id: sessionId,
    actor_type: input.actorType,
    actor_id: input.actorId,
    company_id: input.companyId,
    token_hash: hashSecret(secret),
    idle_ttl_seconds: exp.idleTtlSeconds,
    idle_expires_at: exp.idleExpiresAt,
    absolute_expires_at: exp.absoluteExpiresAt,
    last_used_at: nowIso,
    created_at: nowIso,
    user_agent: (input.userAgent ?? "").slice(0, 300) || null,
    ip: input.ip ?? null,
  });
  if (error) throw new Error(`server-session insert: ${error.message}`);
  return { cookieValue, maxAge: cookieMaxAge(input.remember) };
}

export type ResolvedSession = {
  sessionId: string;
  actorType: SessionActorType;
  actorId: string;
  companyId: string | null;
};

// Cookie値から有効なセッションを解決し、必要ならスライド更新する。無効なら null。
export async function resolveServerSession(cookieValue: string | undefined | null): Promise<ResolvedSession | null> {
  const parsed = parseSessionCookie(cookieValue);
  if (!parsed) return null;
  const supabase = getSupabaseAdmin();

  const { data: row } = await supabase
    .from(TABLE)
    .select("id, actor_type, actor_id, company_id, token_hash, revoked_at, idle_expires_at, absolute_expires_at, last_used_at, idle_ttl_seconds")
    .eq("id", parsed.sessionId)
    .maybeSingle();
  if (!row) return null;
  if (!secretMatches(parsed.secret, row.token_hash)) return null;

  const evalResult = evaluateSession(row as SessionRow, Date.now());
  if (evalResult.state !== "valid") return null;

  if (evalResult.slide) {
    const nowIso = new Date().toISOString();
    await supabase
      .from(TABLE)
      .update({ last_used_at: nowIso, idle_expires_at: evalResult.nextIdleExpiresAt })
      .eq("id", parsed.sessionId)
      .is("revoked_at", null);
  }

  return {
    sessionId: row.id as string,
    actorType: row.actor_type as SessionActorType,
    actorId: row.actor_id as string,
    companyId: (row.company_id as string | null) ?? null,
  };
}

export async function revokeServerSession(sessionId: string): Promise<void> {
  await getSupabaseAdmin()
    .from(TABLE)
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", sessionId)
    .is("revoked_at", null);
}

// 認証情報の変更時に、指定セッション以外を一括失効（＝他端末を強制ログアウト）。
export async function revokeOtherSessions(
  actorType: SessionActorType,
  actorId: string,
  keepSessionId: string | null
): Promise<void> {
  let q = getSupabaseAdmin()
    .from(TABLE)
    .update({ revoked_at: new Date().toISOString() })
    .eq("actor_type", actorType)
    .eq("actor_id", actorId)
    .is("revoked_at", null);
  if (keepSessionId) q = q.neq("id", keepSessionId);
  await q;
}
