import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { verifyPassword } from "@/lib/password";
import { signSuperToken, SUPER_SESSION_COOKIE, SESSION_MAX_AGE } from "@/lib/tenant-session";
import { checkRateLimit, recordFailure, recordSuccess } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit-log";
import { errorResponse } from "@/lib/api-handler";

function rateLimitKey(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  return "super:" + (fwd ? fwd.split(",")[0].trim() : req.headers.get("x-real-ip") ?? "unknown");
}

export async function POST(req: NextRequest) {
  try {
    const key = rateLimitKey(req);
    const limit = checkRateLimit(key);
    if (!limit.allowed) {
      await logAudit(req, "super_login_failure", { reason: "rate_limited", remaining_sec: limit.resetInSec });
      return NextResponse.json(
        { ok: false, message: `試行回数の上限に達しました。${Math.ceil(limit.resetInSec / 60)}分後にお試しください` },
        { status: 429 }
      );
    }

    let body: { email?: string; password?: string };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ ok: false, message: "不正なリクエスト" }, { status: 400 });
    }

    const email = (body.email ?? "").trim().toLowerCase();
    const password = body.password ?? "";
    if (!email || !password) {
      return NextResponse.json({ ok: false, message: "メールとパスワードを入力してください" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { data: admin } = await supabase
      .from("super_admins")
      .select("id, password_hash, is_active")
      .eq("email", email)
      .maybeSingle();

    if (!admin || !admin.is_active || !verifyPassword(password, admin.password_hash)) {
      recordFailure(key);
      await logAudit(req, "super_login_failure", { email });
      return NextResponse.json({ ok: false, message: "メールまたはパスワードが正しくありません" }, { status: 401 });
    }

    recordSuccess(key);
    await supabase.from("super_admins").update({ last_login_at: new Date().toISOString() }).eq("id", admin.id);
    await logAudit(req, "super_login_success", { email }, { actorType: "super_admin", actorId: admin.id });

    const token = signSuperToken({ superAdminId: admin.id });
    const store = await cookies();
    store.set(SUPER_SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE,
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
