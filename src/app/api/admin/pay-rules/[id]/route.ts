import { NextRequest, NextResponse } from "next/server";
import { getTenantContext } from "@/lib/tenant-context";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { errorResponse } from "@/lib/api-handler";
import { logAudit } from "@/lib/audit-log";

// 「予約中」（まだ開始していない＝effective_from が未来）の改定だけ取消できる。
// 開始済み・過去の行は削除不可（非上書きの原則を貫く）。
// 取消時は、この予約が閉じていた直前の行を再オープンする（fn_cancel_pay_rule 内で実施）。
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getTenantContext();
    if (!ctx) return NextResponse.json({ ok: false }, { status: 401 });
    const { id } = await params;

    const supabase = getSupabaseAdmin();
    const { data: rule, error: fErr } = await supabase
      .from("pay_rules")
      .select("id, effective_from, scope, client_id, assignment_id")
      .eq("company_id", ctx.companyId)
      .eq("id", id)
      .maybeSingle();
    if (fErr) throw fErr;
    if (!rule) return NextResponse.json({ ok: false, message: "見つかりません" }, { status: 404 });

    const { error } = await supabase.rpc("fn_cancel_pay_rule", { p_company_id: ctx.companyId, p_rule_id: id });
    if (error) {
      return NextResponse.json({ ok: false, message: "取消できませんでした（開始済みのルールは取消できません）" }, { status: 403 });
    }

    await logAudit(req, "admin_pay_rule_cancelled", {
      scope: rule.scope, clientId: rule.client_id, assignmentId: rule.assignment_id, effectiveFrom: rule.effective_from,
    }, { actorType: "admin", actorId: ctx.adminId, companyId: ctx.companyId });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
