import crypto from "node:crypto";
import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { requireLineUser, LineUser } from "./line-auth";
import { requireSessionSecret } from "./security-guard";
import { getSupabaseAdmin } from "./supabase-admin";

const COOKIE_NAME = "me_session";
const TTL_SECONDS = 30 * 60;

// company_id が未確定であることを表す番兵（uuid とは絶対に衝突しない）
const COMPANY_UNKNOWN = "";
// company_id は確認済みだが所属会社が無い（未登録スタッフ）ことを表す番兵
const COMPANY_KNOWN_NULL = "null";

export type LineSession = { user: LineUser; companyId: string | null };

function getSecret(): string {
  return requireSessionSecret(process.env.SESSION_SECRET);
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", getSecret()).update(payload).digest("base64url");
}

/**
 * companyId === undefined … まだ会社IDを引いていない（次回アクセス時に再取得が必要）
 * companyId === null      … 会社IDを引いた結果、未登録スタッフだった
 * companyId === string    … 所属会社ID（打刻APIはこれで company_id の SELECT を省略できる）
 */
function encode(user: LineUser, companyId: string | null | undefined): string {
  const exp = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  const companyPart = companyId === undefined ? COMPANY_UNKNOWN : companyId === null ? COMPANY_KNOWN_NULL : companyId;
  const payload = `${user.userId}|${encodeURIComponent(user.displayName)}|${companyPart}|${exp}`;
  const sig = sign(payload);
  return `${payload}|${sig}`;
}

function decode(value: string): { user: LineUser; companyId: string | null | undefined } | null {
  const parts = value.split("|");
  if (parts.length !== 5) return null;
  const [userId, encodedName, companyPart, expStr, sig] = parts;
  const payload = `${userId}|${encodedName}|${companyPart}|${expStr}`;
  let expected: string;
  try {
    expected = sign(payload);
  } catch {
    return null;
  }
  if (sig !== expected) return null;
  const exp = parseInt(expStr, 10);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return null;
  const companyId = companyPart === COMPANY_UNKNOWN ? undefined : companyPart === COMPANY_KNOWN_NULL ? null : companyPart;
  return { user: { userId, displayName: decodeURIComponent(encodedName) }, companyId };
}

async function setCookie(cookieStore: Awaited<ReturnType<typeof cookies>>, user: LineUser, companyId: string | null | undefined) {
  cookieStore.set(COOKIE_NAME, encode(user, companyId), {
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
 * 本人確認 + company_id を1つのCookieでまとめてキャッシュする。
 * 打刻(/api/me/clock)・当日状況(/api/me/today)のように毎回 company_id を引く画面のための
 * 専用エントリポイント。company_id が未確定なCookieの場合のみ user_profiles を1回引き、
 * 結果を Cookie に書き戻すので、以降 TTL_SECONDS 以内の呼び出しは DB を引かない。
 */
export async function getLineSessionCached(req: NextRequest): Promise<LineSession | null> {
  const cookieStore = await cookies();
  const cookieValue = cookieStore.get(COOKIE_NAME)?.value;
  const cached = cookieValue ? decode(cookieValue) : null;

  const user = cached?.user ?? (await requireLineUser(req));
  if (!user) return null;

  if (cached && cached.companyId !== undefined) {
    return { user, companyId: cached.companyId };
  }

  const supabase = getSupabaseAdmin();
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("company_id")
    .eq("user_id", user.userId)
    .maybeSingle();
  const companyId: string | null = profile?.company_id ?? null;

  await setCookie(cookieStore, user, companyId);
  return { user, companyId };
}

/** 登録直後など、company_id が変わったことが分かっているタイミングでCookieを更新する。 */
export async function refreshSessionCompanyId(user: LineUser, companyId: string | null): Promise<void> {
  const cookieStore = await cookies();
  await setCookie(cookieStore, user, companyId);
}
