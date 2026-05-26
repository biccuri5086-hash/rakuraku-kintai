import { NextRequest, NextResponse } from "next/server";
import { requireTenantContext } from "@/lib/tenant-context";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { generateSecret, buildOtpAuthUrl, verifyTOTP } from "@/lib/totp";
import { errorResponse } from "@/lib/api-handler";
import { logAudit } from "@/lib/audit-log";

export async function GET(req: NextRequest) {
  try {
    const guard = await requireTenantContext();
    if (guard.error) return guard.error;
    const { adminId, companyId } = guard.ctx;

    await logAudit(req, "admin_2fa_setup_view", undefined, {
      actorType: "admin", actorId: adminId, companyId,
    });

    const supabase = getSupabaseAdmin();
    const { data: admin } = await supabase
      .from("admins")
      .select("totp_secret, email")
      .eq("id", adminId)
      .maybeSingle();

    const newSecret = generateSecret();
    const account = admin?.email ?? "admin";
    const otpauthUrl = buildOtpAuthUrl(newSecret, account, "RakurakuKintai");

    return NextResponse.json({
      ok: true,
      currentlyEnabled: !!admin?.totp_secret,
      newSecret,
      otpauthUrl,
    });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const guard = await requireTenantContext();
    if (guard.error) return guard.error;
    const { adminId, companyId } = guard.ctx;

    let body: { secret?: string; code?: string; action?: "verify" | "enable" | "disable" };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ ok: false, message: "不正なリクエスト" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    if (body.action === "disable") {
      await supabase.from("admins").update({ totp_secret: null }).eq("id", adminId);
      await logAudit(req, "admin_2fa_setup_view", { action: "disabled" }, {
        actorType: "admin", actorId: adminId, companyId,
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
      await supabase.from("admins").update({ totp_secret: body.secret }).eq("id", adminId);
      await logAudit(req, "admin_2fa_setup_view", { action: "enabled" }, {
        actorType: "admin", actorId: adminId, companyId,
      });
    }

    return NextResponse.json({ ok: true, valid: true, saved: body.action === "enable" });
  } catch (e) {
    return errorResponse(e);
  }
}
