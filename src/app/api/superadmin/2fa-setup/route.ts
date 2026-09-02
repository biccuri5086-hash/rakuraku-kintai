import { NextRequest, NextResponse } from "next/server";
import { requireSuperContext } from "@/lib/tenant-context";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import QRCode from "qrcode";
import { generateSecret, buildOtpAuthUrl, verifyTOTP } from "@/lib/totp";
import { verifyPassword } from "@/lib/password";
import { errorResponse } from "@/lib/api-handler";
import { logAudit } from "@/lib/audit-log";
import { revokeOtherSessions } from "@/lib/server-session";

// 現在の状態＋新しいシークレット候補を返す
export async function GET(req: NextRequest) {
  try {
    const guard = await requireSuperContext();
    if (guard.error) return guard.error;
    const { superAdminId } = guard.ctx;

    const supabase = getSupabaseAdmin();
    const { data: admin } = await supabase
      .from("super_admins")
      .select("totp_secret, email")
      .eq("id", superAdminId)
      .maybeSingle();

    await logAudit(req, "super_2fa_view", undefined, {
      actorType: "super_admin", actorId: superAdminId,
    });

    const newSecret = generateSecret();
    const account = admin?.email ?? "superadmin";
    const otpauthUrl = buildOtpAuthUrl(newSecret, account, "RakurakuKintai-Owner");

    // QRはサーバー内で生成して data URI で返す。
    // 以前は外部のQR生成サービス(api.qrserver.com)に otpauth URL をそのまま渡していたため、
    // 2FAのシークレットが第三者のサーバーに送信されていた（＝2FAの意味が無くなる）。
    const qrDataUrl = await QRCode.toDataURL(otpauthUrl, { margin: 1, width: 240 });

    return NextResponse.json({
      ok: true,
      currentlyEnabled: !!admin?.totp_secret,
      newSecret,
      otpauthUrl,
      qrDataUrl,
    });
  } catch (e) {
    return errorResponse(e);
  }
}

// 6桁コードの検証（action:"verify"）／有効化（"enable"）／無効化（"disable"）
export async function POST(req: NextRequest) {
  try {
    const guard = await requireSuperContext();
    if (guard.error) return guard.error;
    const { superAdminId } = guard.ctx;

    let body: { secret?: string; code?: string; password?: string; action?: "verify" | "enable" | "disable" };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ ok: false, message: "不正なリクエスト" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    if (body.action === "disable") {
      // 解除は本人確認を必須にする。セッションを奪われただけで2FAを外せると、
      // 2FAを付けた意味が薄れるため（顧客管理者側と同じ扱い）。
      const { data: me } = await supabase
        .from("super_admins")
        .select("password_hash")
        .eq("id", superAdminId)
        .maybeSingle();

      if (!me || !body.password || !verifyPassword(body.password, me.password_hash)) {
        await logAudit(req, "super_2fa_disable_failure", { reason: "password_mismatch" }, {
          actorType: "super_admin", actorId: superAdminId,
        });
        return NextResponse.json(
          { ok: false, message: "パスワードが正しくありません" },
          { status: 401 }
        );
      }

      await supabase.from("super_admins").update({ totp_secret: null }).eq("id", superAdminId);
      await revokeOtherSessions("super_admin", superAdminId, guard.ctx.sessionId);
      await logAudit(req, "super_2fa_disabled", undefined, {
        actorType: "super_admin", actorId: superAdminId,
      });
      return NextResponse.json({ ok: true, disabled: true });
    }

    if (!body.secret || !body.code) {
      return NextResponse.json({ ok: false, message: "secret と code が必要です" }, { status: 400 });
    }

    const valid = verifyTOTP(body.secret, body.code);
    if (!valid) {
      return NextResponse.json({ ok: true, valid: false });
    }

    if (body.action === "enable") {
      await supabase.from("super_admins").update({ totp_secret: body.secret }).eq("id", superAdminId);
      await revokeOtherSessions("super_admin", superAdminId, guard.ctx.sessionId);
      await logAudit(req, "super_2fa_enabled", undefined, {
        actorType: "super_admin", actorId: superAdminId,
      });
    }

    return NextResponse.json({ ok: true, valid: true, saved: body.action === "enable" });
  } catch (e) {
    return errorResponse(e);
  }
}
