import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { verifyPassword } from "@/lib/password";
import { signSuperToken, SUPER_SESSION_COOKIE, SESSION_MAX_AGE, SESSION_MAX_AGE_REMEMBERED } from "@/lib/tenant-session";
import { checkRateLimit, recordFailure, recordSuccess } from "@/lib/rate-limit";
import { verifyTOTP } from "@/lib/totp";
import { checkPassword } from "@/lib/password-policy";
import { TRUST_COOKIE, TRUSTED_DEVICE_MAX_AGE, credentialFingerprint, isTrustedDevice, signTrustToken } from "@/lib/trusted-device";
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

    let body: { email?: string; password?: string; totp?: string; remember?: boolean };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ ok: false, message: "不正なリクエスト" }, { status: 400 });
    }

    const email = (body.email ?? "").trim().toLowerCase();
    const password = body.password ?? "";
    const totpCode = body.totp;
    const remember = body.remember !== false; // 既定でこのブラウザを記憶する
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

    // 一度6桁を通したブラウザは7日間だけ省略できる。
    // パスワードや2FAの設定が変わると指紋が変わり、記憶は自動的に無効になる。
    const fingerprint = credentialFingerprint(admin.password_hash, admin.totp_secret);
    const store = await cookies();
    const trusted =
      !!admin.totp_secret &&
      isTrustedDevice(store.get(TRUST_COOKIE.super)?.value, "super", admin.id, fingerprint);

    // 2FAが有効で、かつこのブラウザが未記憶なら6桁コードを検証
    if (admin.totp_secret && !trusted) {
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
    if (admin.totp_secret && !trusted && remember) {
      store.set(TRUST_COOKIE.super, signTrustToken("super", admin.id, fingerprint), {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: TRUSTED_DEVICE_MAX_AGE,
      });
    }

    await logAudit(req, "super_login_success", { email, totp_used: !!admin.totp_secret, trusted_device: trusted }, { actorType: "super_admin", actorId: admin.id });

    // 「ログインしたままにする」を選んだ場合はセッションを7日保つ。
    // パスワードは保存しない。次に開いたときログイン済みとして扱うだけ。
    const sessionMaxAge = remember ? SESSION_MAX_AGE_REMEMBERED : SESSION_MAX_AGE;
    const token = signSuperToken({ superAdminId: admin.id }, sessionMaxAge);
    store.set(SUPER_SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: sessionMaxAge,
    });

    // いま入力されたパスワードが今の条件を満たしているかを見る。
    // 満たしていない既存利用者は締め出さず、ログイン後に変更を促す。
    const passwordNeedsUpdate = !checkPassword(password, { email: email }).ok;

    return NextResponse.json({ ok: true, passwordNeedsUpdate });
  } catch (e) {
    return errorResponse(e);
  }
}
