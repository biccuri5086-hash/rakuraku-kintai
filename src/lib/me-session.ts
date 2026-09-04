import crypto from "node:crypto";
import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { requireLineUser, LineUser } from "./line-auth";
import { requireSessionSecret } from "./security-guard";
import { getSupabaseAdmin } from "./supabase-admin";

const COOKIE_NAME = "me_session";
const TTL_SECONDS = 30 * 60;
// company_id・在籍状態は TTL_SECONDS より短い間隔で再確認する。
// スタッフの無効化(user_profiles.status)・会社の停止(companies.status)を
// 反映するまでの猶予をこの秒数以内に抑える（Cookie自体は最大30分残っても、
// 「打刻してよいか」はこの間隔で見直す）。
const COMPANY_FRESHNESS_SECONDS = 5 * 60;

// company_id が未確定であることを表す番兵（uuid とは絶対に衝突しない）
const COMPANY_UNKNOWN = "";
// company_id は確認済みだが所属会社が無い（未登録スタッフ）ことを表す番兵
const COMPANY_KNOWN_NULL = "null";

export type BlockedReason = "staff_inactive" | "company_suspended";

export type LineSession = {
  user: LineUser;
  companyId: string | null;
  /** 在籍中でも会社が停止中でもなければ undefined。打刻APIはこれを見て拒否する。 */
  blocked?: BlockedReason;
};

type CachedCompany = { companyId: string | null; verifiedAt: number; blocked: BlockedReason | null };

function getSecret(): string {
  return requireSessionSecret(process.env.SESSION_SECRET);
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", getSecret()).update(payload).digest("base64url");
}

/**
 * company === undefined … まだ会社ID/在籍状態を引いていない（次回アクセス時に再取得が必要）
 * company.companyId     … 所属会社ID（null なら未登録スタッフ）
 * company.verifiedAt    … このcompany情報をDBで確認したUNIX秒。COMPANY_FRESHNESS_SECONDS 超えたら再確認する
 * company.blocked       … 在籍状態(staff_inactive)/会社状態(company_suspended)によるブロック理由
 */
function encode(user: LineUser, company: CachedCompany | undefined): string {
  const exp = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  const companyPart = company === undefined ? COMPANY_UNKNOWN : company.companyId === null ? COMPANY_KNOWN_NULL : company.companyId;
  const verifiedAtPart = company === undefined ? "0" : String(company.verifiedAt);
  const blockedPart = company?.blocked ?? "";
  const payload = `${user.userId}|${encodeURIComponent(user.displayName)}|${companyPart}|${verifiedAtPart}|${blockedPart}|${exp}`;
  const sig = sign(payload);
  return `${payload}|${sig}`;
}

function decode(value: string): { user: LineUser; company: CachedCompany | undefined } | null {
  const parts = value.split("|");
  if (parts.length !== 7) return null;
  const [userId, encodedName, companyPart, verifiedAtPart, blockedPart, expStr, sig] = parts;
  const payload = `${userId}|${encodedName}|${companyPart}|${verifiedAtPart}|${blockedPart}|${expStr}`;
  let expected: string;
  try {
    expected = sign(payload);
  } catch {
    return null;
  }
  if (sig !== expected) return null;
  const exp = parseInt(expStr, 10);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return null;

  const user: LineUser = { userId, displayName: decodeURIComponent(encodedName) };
  if (companyPart === COMPANY_UNKNOWN) return { user, company: undefined };

  const companyId = companyPart === COMPANY_KNOWN_NULL ? null : companyPart;
  const verifiedAt = parseInt(verifiedAtPart, 10) || 0;
  const blocked = blockedPart === "staff_inactive" || blockedPart === "company_suspended" ? blockedPart : null;
  return { user, company: { companyId, verifiedAt, blocked } };
}

async function setCookie(cookieStore: Awaited<ReturnType<typeof cookies>>, user: LineUser, company: CachedCompany | undefined) {
  cookieStore.set(COOKIE_NAME, encode(user, company), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: TTL_SECONDS,
  });
}

/** LINEアクセストークンの検証結果（本人確認）だけをキャッシュする。company_id は見ない。 */
export async function getLineUserCached(req: NextRequest): Promise<LineUser | null> {
  const cookieStore = await cookies();
  const cookieValue = cookieStore.get(COOKIE_NAME)?.value;
  if (cookieValue) {
    const cached = decode(cookieValue);
    if (cached) return cached.user;
  }
  const user = await requireLineUser(req);
  if (user) {
    await setCookie(cookieStore, user, undefined);
  }
  return user;
}

/**
 * 本人確認 + company_id + 在籍/会社状態を1つのCookieでまとめてキャッシュする。
 * 打刻(/api/me/clock)・当日状況(/api/me/today)のように毎回 company_id を引く画面のための
 * 専用エントリポイント。COMPANY_FRESHNESS_SECONDS(5分)ごとに user_profiles.status /
 * companies.status を再確認し、無効化・会社停止を短い遅延で反映する。
 */
export async function getLineSessionCached(req: NextRequest): Promise<LineSession | null> {
  const cookieStore = await cookies();
  const cookieValue = cookieStore.get(COOKIE_NAME)?.value;
  const cached = cookieValue ? decode(cookieValue) : null;

  const user = cached?.user ?? (await requireLineUser(req));
  if (!user) return null;

  const nowSec = Math.floor(Date.now() / 1000);
  if (cached?.company !== undefined && nowSec - cached.company.verifiedAt < COMPANY_FRESHNESS_SECONDS) {
    return { user, companyId: cached.company.companyId, blocked: cached.company.blocked ?? undefined };
  }

  const supabase = getSupabaseAdmin();
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("company_id, status")
    .eq("user_id", user.userId)
    .maybeSingle();

  const companyId: string | null = profile?.company_id ?? null;
  let blocked: BlockedReason | null = null;

  if (profile && profile.status === "inactive") {
    blocked = "staff_inactive";
  } else if (companyId) {
    const { data: company } = await supabase.from("companies").select("status").eq("id", companyId).maybeSingle();
    if (company && (company.status === "suspended" || company.status === "cancelled")) {
      blocked = "company_suspended";
    }
  }

  await setCookie(cookieStore, user, { companyId, verifiedAt: nowSec, blocked });
  return { user, companyId, blocked: blocked ?? undefined };
}

/** 登録直後など、company_id が変わったことが分かっているタイミングでCookieを更新する。 */
export async function refreshSessionCompanyId(user: LineUser, companyId: string | null): Promise<void> {
  const cookieStore = await cookies();
  await setCookie(cookieStore, user, { companyId, verifiedAt: Math.floor(Date.now() / 1000), blocked: null });
}
