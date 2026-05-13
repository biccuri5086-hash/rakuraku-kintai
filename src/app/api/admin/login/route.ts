import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { signToken, SESSION_COOKIE, SESSION_MAX_AGE } from "@/lib/admin-session";
import { checkRateLimit, recordFailure, recordSuccess } from "@/lib/rate-limit";

function clientKey(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

export async function POST(req: NextRequest) {
  const key = clientKey(req);

  const limit = checkRateLimit(key);
  if (!limit.allowed) {
    const mins = Math.ceil(limit.resetInSec / 60);
    return NextResponse.json(
      { ok: false, message: `試行回数の上限に達しました。${mins}分後にお試しください` },
      { status: 429 }
    );
  }

  const correct = process.env.ADMIN_PASSWORD;
  if (!correct) {
    return NextResponse.json({ ok: false, message: "サーバー設定エラー" }, { status: 500 });
  }

  let password: unknown;
  try {
    const body = await req.json();
    password = body?.password;
  } catch {
    return NextResponse.json({ ok: false, message: "不正なリクエスト" }, { status: 400 });
  }

  if (typeof password !== "string" || password !== correct) {
    recordFailure(key);
    return NextResponse.json({ ok: false, message: "パスワードが違います" }, { status: 401 });
  }

  recordSuccess(key);

  const token = signToken();
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });

  return NextResponse.json({ ok: true });
}
