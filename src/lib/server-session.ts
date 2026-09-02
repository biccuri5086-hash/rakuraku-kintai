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
// シークレットのローテーション間隔。頻繁に回すとレースが増えるので控えめに。
export const ROTATE_INTERVAL_SEC = 60 * 60 * 24; // 24時間ごと
// ローテーション直後、並行して飛んでいた旧Cookieのリクエストを許容する猶予。
export const PREV_GRACE_SEC = 120;
// 失効済み行を監査目的で少し残してから物理削除するまでの保持期間。
export const REVOKED_RETENTION_SEC = 60 * 60 * 24 * 7; // 7日

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

// 残りの絶対期限からCookieのMax-Ageを算出（ローテーション時の再設定用）。
export function remainingMaxAge(absoluteExpiresAt: string, nowMs: number): number {
  const remain = Math.floor((Date.parse(absoluteExpiresAt) - nowMs) / 1000);
  return remain > 0 ? remain : 0;
}

export type RotationRow = {
  token_hash: string;
  prev_token_hash: string | null;
  rotated_at: string | null;
  created_at: string;
};

// 提示されたシークレットが、現在/直前(猶予内)/直前(猶予切れ=盗用疑い)/不一致 のどれか。
// - current:    現在のトークン
// - prev_grace: ローテーション直後の猶予内に届いた旧トークン（正常な並行リクエスト）
// - prev_stale: 猶予を過ぎた旧トークンの再利用（＝盗用の疑い→セッション失効へ）
// - none:       いずれにも一致しない（ただの無効）
export type SecretClass = "current" | "prev_grace" | "prev_stale" | "none";

export function classifyPresentedSecret(row: RotationRow, presentedSecret: string, nowMs: number): SecretClass {
  if (secretMatches(presentedSecret, row.token_hash)) return "current";
  if (row.prev_token_hash && secretMatches(presentedSecret, row.prev_token_hash)) {
    const rotatedMs = row.rotated_at ? Date.parse(row.rotated_at) : NaN;
    if (Number.isFinite(rotatedMs) && nowMs <= rotatedMs + PREV_GRACE_SEC * 1000) {
      return "prev_grace";
    }
    return "prev_stale";
  }
  return "none";
}

// 最後のローテーション（無ければ作成時）から一定間隔を過ぎていれば回す。
export function shouldRotate(row: RotationRow, nowMs: number): boolean {
  const base = Date.parse(row.rotated_at ?? row.created_at);
  if (!Number.isFinite(base)) return false;
  return nowMs - base >= ROTATE_INTERVAL_SEC * 1000;
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
  // ローテーションが起きた場合、呼び出し側(route handler)が新しいCookieを再設定する。
  rotatedCookie?: { value: string; maxAge: number };
};

// Cookie値から有効なセッションを解決し、必要ならスライド更新・ローテーションする。無効なら null。
export async function resolveServerSession(cookieValue: string | undefined | null): Promise<ResolvedSession | null> {
  const parsed = parseSessionCookie(cookieValue);
  if (!parsed) return null;
  const supabase = getSupabaseAdmin();

  const { data: row } = await supabase
    .from(TABLE)
    .select("id, actor_type, actor_id, company_id, token_hash, prev_token_hash, rotated_at, created_at, revoked_at, idle_expires_at, absolute_expires_at, last_used_at, idle_ttl_seconds")
    .eq("id", parsed.sessionId)
    .maybeSingle();
  if (!row) return null;

  const now = Date.now();
  const cls = classifyPresentedSecret(row as RotationRow, parsed.secret, now);

  if (cls === "none") return null;
  if (cls === "prev_stale") {
    // 猶予を過ぎた旧トークンの再利用＝盗用の疑い。セッションを失効させて締め出す。
    console.error(`[security] stale session secret reused; revoking session ${parsed.sessionId} (possible token theft)`);
    await supabase.from(TABLE).update({ revoked_at: new Date().toISOString() }).eq("id", parsed.sessionId).is("revoked_at", null);
    return null;
  }

  const evalResult = evaluateSession(row as SessionRow, now);
  if (evalResult.state !== "valid") return null;

  const base: ResolvedSession = {
    sessionId: row.id as string,
    actorType: row.actor_type as SessionActorType,
    actorId: row.actor_id as string,
    companyId: (row.company_id as string | null) ?? null,
  };

  // ローテーションは「現在のトークンでの利用」かつ間隔経過時のみ。
  if (cls === "current" && shouldRotate(row as RotationRow, now)) {
    const next = generateSession(); // 新しい sessionId は使わず secret のみ流用
    const nowIso = new Date(now).toISOString();
    // CAS: 読み取った token_hash がまだ現在値のときだけ回す（並行ローテーションのレース防止）。
    const { data: rotated } = await supabase
      .from(TABLE)
      .update({
        token_hash: hashSecret(next.secret),
        prev_token_hash: row.token_hash,
        rotated_at: nowIso,
        last_used_at: nowIso,
        idle_expires_at: evalResult.nextIdleExpiresAt,
      })
      .eq("id", parsed.sessionId)
      .eq("token_hash", row.token_hash as string)
      .is("revoked_at", null)
      .select("id");
    if (Array.isArray(rotated) && rotated.length > 0) {
      return {
        ...base,
        rotatedCookie: {
          value: `${parsed.sessionId}.${next.secret}`,
          maxAge: remainingMaxAge(row.absolute_expires_at as string, now),
        },
      };
    }
    // CAS負け（他リクエストが先にローテーション済み）→ 通常処理へフォールバック。
  }

  // 通常のスライド更新（間引きあり）。prev_grace のときはCookie再設定しない。
  if (evalResult.slide) {
    await supabase
      .from(TABLE)
      .update({ last_used_at: new Date().toISOString(), idle_expires_at: evalResult.nextIdleExpiresAt })
      .eq("id", parsed.sessionId)
      .is("revoked_at", null);
  }

  return base;
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

export type SessionSummary = {
  id: string;
  createdAt: string;
  lastUsedAt: string;
  idleExpiresAt: string;
  absoluteExpiresAt: string;
  userAgent: string | null;
  ip: string | null;
};

// 本人の「今有効な」セッション一覧（失効・期限切れは除外）。最近使った順。
export async function listSessionsForActor(
  actorType: SessionActorType,
  actorId: string
): Promise<SessionSummary[]> {
  const nowIso = new Date().toISOString();
  const { data } = await getSupabaseAdmin()
    .from(TABLE)
    .select("id, created_at, last_used_at, idle_expires_at, absolute_expires_at, user_agent, ip")
    .eq("actor_type", actorType)
    .eq("actor_id", actorId)
    .is("revoked_at", null)
    .gt("absolute_expires_at", nowIso)
    .gt("idle_expires_at", nowIso)
    .order("last_used_at", { ascending: false })
    .limit(100);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    createdAt: r.created_at as string,
    lastUsedAt: r.last_used_at as string,
    idleExpiresAt: r.idle_expires_at as string,
    absoluteExpiresAt: r.absolute_expires_at as string,
    userAgent: (r.user_agent as string | null) ?? null,
    ip: (r.ip as string | null) ?? null,
  }));
}

// 本人のセッションだけを失効できる（他人のIDを指定しても対象外＝IDOR防止）。
// 実際に失効させたら true。
export async function revokeSessionForActor(
  sessionId: string,
  actorType: SessionActorType,
  actorId: string
): Promise<boolean> {
  const { data } = await getSupabaseAdmin()
    .from(TABLE)
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", sessionId)
    .eq("actor_type", actorType)
    .eq("actor_id", actorId)
    .is("revoked_at", null)
    .select("id");
  return Array.isArray(data) && data.length > 0;
}

// 期限切れ・失効済みの行を物理削除する（定期スイープ）。削除件数を返す。
// - 絶対期限切れは即対象
// - 失効済みは監査のため一定期間残してから削除
export async function sweepExpiredSessions(nowMs: number = Date.now()): Promise<number> {
  const supabase = getSupabaseAdmin();
  const nowIso = new Date(nowMs).toISOString();
  const revokedCutoff = new Date(nowMs - REVOKED_RETENTION_SEC * 1000).toISOString();

  const { data: expired } = await supabase
    .from(TABLE)
    .delete()
    .lt("absolute_expires_at", nowIso)
    .select("id");

  const { data: oldRevoked } = await supabase
    .from(TABLE)
    .delete()
    .not("revoked_at", "is", null)
    .lt("revoked_at", revokedCutoff)
    .select("id");

  return (expired?.length ?? 0) + (oldRevoked?.length ?? 0);
}
