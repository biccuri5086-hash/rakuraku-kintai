import { NextRequest, NextResponse } from "next/server";
import { requireSuperContext } from "@/lib/tenant-context";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { logAudit } from "@/lib/audit-log";
import { errorResponse } from "@/lib/api-handler";

const BOOLEAN_FEATURES = [
  "feature_condition",
  "feature_gps",
  "feature_alert",
  "feature_monthly_report",
  "feature_multi_site",
  "feature_ai_risk_score",
  "comment_required",
] as const;

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const guard = await requireSuperContext();
    if (guard.error) return guard.error;
    const { id: companyId } = await ctx.params;
    if (!isUuid(companyId)) return NextResponse.json({ ok: false, message: "不正なID" }, { status: 400 });

    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return NextResponse.json({ ok: false }, { status: 400 }); }

    const update: Record<string, unknown> = {};
    for (const k of BOOLEAN_FEATURES) {
      if (typeof body[k] === "boolean") update[k] = body[k];
    }
    if (typeof body.max_staff_count === "number" && Number.isInteger(body.max_staff_count) && body.max_staff_count >= 0) {
      update.max_staff_count = body.max_staff_count;
    } else if (body.max_staff_count === null) {
      update.max_staff_count = null;
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ ok: false, message: "更新項目がありません" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("tenant_settings")
      .update(update)
      .eq("company_id", companyId)
      .select()
      .single();

    if (error) throw new Error(error.message);

    await logAudit(req, "super_company_update", { settings: update }, {
      actorType: "super_admin", actorId: guard.ctx.superAdminId, companyId,
    });

    return NextResponse.json({ ok: true, settings: data });
  } catch (e) {
    return errorResponse(e);
  }
}
