import { NextRequest, NextResponse } from "next/server";
import { requireTenantContext } from "@/lib/tenant-context";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import QRCode from "qrcode";
import { generateSecret, buildOtpAuthUrl, verifyTOTP } from "@/lib/totp";
import { verifyPassword } from "@/lib/password";
import { logAudit } from "@/lib/audit-log";
import { errorResponse } from "@/lib/api-handler";
import { revokeOtherSessions } from "@/lib/server-session";

// 顧客（派遣会社）の管理者が自分で2FAを設定する。
// 管理画面は給与額と個人情報を扱うため、パスワード1つで守るには重い。
//
// 運営者用(/api/superadmin/2fa-setup)と同じ流れだが、無効化には現在のパスワードを
// 要求する点が異なる。セッションを奪われただけで2FAを外せてしまうと、
// 2FAを付けた意味が薄れるため。

// 現在の状態＋新しいシークレット候補を返す
export async function GET(req: NextRequest) {
  try {
    const guard = await requireTenantContext();
    if (guard.error) return guard.error;
    const { adminId, companyId } = guard.ctx;

    const supabase = getSupabaseAdmin();
    const { data: admin } = await supabase
      .from("admins")
      .select("totp_secret, email")
      .eq("id", adminId)
      .eq("company_id", companyId)
      .maybeSingle();

    if (!admin) {
      return NextResponse.json({ ok: false, message: "管理者が見つかりません" }, { status: 404 });
    }

    const { data: company } = await supabase
      .from("companies")
      .select("name")
      .eq("id", companyId)
      .maybeSingle();

    await logAudit(req, "admin_2fa_setup_view", undefined, {
      actorType: "admin", actorId: adminId, companyId,
    });

    const newSecret = generateSecret();
    // 同じ人が複数の会社の管理者を兼任している場合、認証アプリの一覧で
    // どちらの会社のものか区別できるよう会社名を添える。
    const account = company?.name ? `${admin.email}（${company.name}）` : admin.email;
    const otpauthUrl = buildOtpAuthUrl(newSecret, account, "RakurakuKintai");

    // QRはサーバー内で生成して data URI で返す。外部のQR生成サービスに
    // otpauth URL を渡すと、2FAのシークレットが第三者に渡ってしまう。
    const qrDataUrl = await QRCode.toDataURL(otpauthUrl, { margin: 1, width: 240 });

    return NextResponse.json({
      ok: true,
      currentlyEnabled: !!admin.totp_secret,
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
    const guard = await requireTenantContext();
    if (guard.error) return guard.error;
    const { adminId, companyId } = guard.ctx;

    let body: { secret?: string; code?: string; password?: string; action?: "verify" | "enable" | "disable" };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ ok: false, message: "不正なリクエスト" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    if (body.action === "disable") {
      // 無効化は本人確認を必須にする。
      const { data: admin } = await supabase
        .from("admins")
        .select("password_hash")
        .eq("id", adminId)
        .eq("company_id", companyId)
        .maybeSingle();

      if (!admin || !body.password || !verifyPassword(body.password, admin.password_hash)) {
        await logAudit(req, "admin_2fa_disable_failure", { reason: "password_mismatch" }, {
          actorType: "admin", actorId: adminId, companyId,
        });
        return NextResponse.json(
          { ok: false, message: "パスワードが正しくありません" },
          { status: 401 }
        );
      }

      await supabase
        .from("admins")
        .update({ totp_secret: null })
        .eq("id", adminId)
        .eq("company_id", companyId);

      await revokeOtherSessions("admin", adminId, guard.ctx.sessionId);
      await logAudit(req, "admin_2fa_disabled", undefined, {
        actorType: "admin", actorId: adminId, companyId,
      });
      return NextResponse.json({ ok: true, disabled: true });
    }

    if (!body.secret || !body.code) {
      return NextResponse.json({ ok: false, message: "secret と code が必要です" }, { status: 400 });
    }

    if (!verifyTOTP(body.secret, body.code)) {
      return NextResponse.json({ ok: true, valid: false });
    }

    if (body.action === "enable") {
      await supabase
        .from("admins")
        .update({ totp_secret: body.secret })
        .eq("id", adminId)
        .eq("company_id", companyId);

      await revokeOtherSessions("admin", adminId, guard.ctx.sessionId);
      await logAudit(req, "admin_2fa_enabled", undefined, {
        actorType: "admin", actorId: adminId, companyId,
      });
    }

    return NextResponse.json({ ok: true, valid: true, saved: body.action === "enable" });
  } catch (e) {
    return errorResponse(e);
  }
}
