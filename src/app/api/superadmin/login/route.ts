import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { verifyPassword } from "@/lib/password";
import { signSuperToken, SUPER_SESSION_COOKIE, SESSION_MAX_AGE } from "@/lib/tenant-session";
import { checkRateLimit, recordFailure, recordSuccess } from "@/lib/rate-limit";
import { verifyTOTP } from "@/lib/totp";
import { logAudit } from "@/lib/audit-log";
import { errorResponse } from "@/lib/api-handler";

function rateLimitKey(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  return "super:" + (fwd ? fwd.split(",")[0].trim() : req.headers.get("x-real-ip") ?? "unknown");
}

export async function POST(req: NextRequest) {
  try {
    const key = rateLimitKey(req);
    const limit = await checkRateLimit(key);
    if (!limit.allowed) {
      await logAudit(req, "super_login_failure", { reason: "rate_limited", remaining_sec: limit.resetInSec });
      return NextResponse.json(
        { ok: false, message: `試行回数の上限に達しました。${Math.ceil(limit.resetInSec / 60)}分後にお試しください` },
        { status: 429 }
      );
    }

    let body: { email?: string; password?: string; totp?: string };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ ok: false, message: "不正なリクエスト" }, { status: 400 });
    }

    const email = (body.email ?? "").trim().toLowerCase();
    const password = body.password ?? "";
    const totpCode = body.totp;
    if (!email || !password) {
      return NextResponse.json({ ok: false, message: "メールとパスワードを入力してください" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { data: admin } = await supabase
      .from("super_admins")
      .select("id, password_hash, totp_secret, is_active")
      .eq("email", email)
      .maybeSingle();

    if (!admin || !admin.is_active || !verifyPassword(password, admin.password_hash)) {
      await recordFailure(key);
      await logAudit(req, "super_login_failure", { email });
      return NextResponse.json({ ok: false, message: "メールまたはパスワードが正しくありません" }, { status: 401 });
    }

    // 2FAが有効なら6桁コードを検証
    if (admin.totp_secret) {
      if (typeof totpCode !== "string" || !totpCode) {
        return NextResponse.json(
          { ok: false, message: "認証コード（6桁）を入力してください", code: "TOTP_REQUIRED" },
          { status: 401 }
        );
      }
      if (!verifyTOTP(admin.totp_secret, totpCode)) {
        await recordFailure(key);
        await logAudit(req, "super_login_2fa_failure", { email }, {
          actorType: "super_admin", actorId: admin.id,
        });
        return NextResponse.json(
          { ok: false, message: "認証コードが正しくありません", code: "TOTP_INVALID" },
          { status: 401 }
        );
      }
    }

    await recordSuccess(key);
    await supabase.from("super_admins").update({ last_login_at: new Date().toISOString() }).eq("id", admin.id);
    await logAudit(req, "super_login_success", { email, totp_used: !!admin.totp_secret }, { actorType: "super_admin", actorId: admin.id });

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
