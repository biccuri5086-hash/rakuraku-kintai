import { NextRequest, NextResponse } from "next/server";
import { getTenantContext } from "@/lib/tenant-context";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { errorResponse } from "@/lib/api-handler";
import { jstToday } from "@/lib/jst";
import { validatePayRuleDraft, computeRateChange, PayRuleDraftInput } from "@/lib/payroll/payRuleValidation";
import { issuePayRuleToken } from "@/lib/payRuleToken";

// 改定予約の書き込み前プレビュー。ここでは一切書き込まず、50%変動チェックと
// 署名付きトークン(previewToken)の発行だけを行う。確定は schedule エンドポイントで行う。
export async function POST(req: NextRequest) {
  try {
    const ctx = await getTenantContext();
    if (!ctx) return NextResponse.json({ ok: false }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const draft: PayRuleDraftInput = {
      scope: body?.scope,
      clientId: body?.clientId ? String(body.clientId) : null,
      assignmentId: body?.assignmentId ? String(body.assignmentId) : null,
      effectiveFrom: String(body?.effectiveFrom ?? ""),
      baseHourlyRate: body?.baseHourlyRate === null || body?.baseHourlyRate === undefined ? null : Number(body.baseHourlyRate),
      overtimeRate: Number(body?.overtimeRate),
      overtime60Rate: Number(body?.overtime60Rate),
      nightRate: Number(body?.nightRate),
      holidayRate: Number(body?.holidayRate),
    };

    const today = jstToday();
    const validation = validatePayRuleDraft(draft, today);
    if (!validation.ok) return NextResponse.json({ ok: false, message: validation.error }, { status: 400 });

    const supabase = getSupabaseAdmin();

    // 「今まさに有効(effective_to IS NULL)」な同一スコープ・同一対象の行を探す。
    // これが改定予約で自動的に effective_to を切られる対象であり、比較対象の「現在の時給」でもある。
    let openQuery = supabase
      .from("pay_rules")
      .select("id, base_hourly_rate")
      .eq("company_id", ctx.companyId)
      .eq("scope", draft.scope)
      .is("effective_to", null);
    openQuery = draft.scope === "assignment" ? openQuery.eq("assignment_id", draft.assignmentId).is("client_id", null)
      : draft.scope === "client" ? openQuery.eq("client_id", draft.clientId).is("assignment_id", null)
      : openQuery.is("client_id", null).is("assignment_id", null);
    const { data: openRow, error: openErr } = await openQuery.maybeSingle();
    if (openErr) throw openErr;

    if (openRow && draft.effectiveFrom <= today) {
      return NextResponse.json({ ok: false, message: "開始日は現在有効なルールの開始日より後にしてください" }, { status: 400 });
    }

    let currentRate: number | null = openRow?.base_hourly_rate != null ? Number(openRow.base_hourly_rate) : null;
    if (currentRate === null && draft.scope === "assignment") {
      const { data: assignment } = await supabase
        .from("assignments")
        .select("hourly_rate")
        .eq("company_id", ctx.companyId)
        .eq("id", draft.assignmentId)
        .maybeSingle();
      currentRate = assignment?.hourly_rate != null ? Number(assignment.hourly_rate) : null;
    }

    const change = computeRateChange(currentRate, draft.baseHourlyRate);

    const previewToken = issuePayRuleToken({
      companyId: ctx.companyId,
      scope: draft.scope,
      clientId: draft.clientId,
      assignmentId: draft.assignmentId,
      effectiveFrom: draft.effectiveFrom,
      baseHourlyRate: draft.baseHourlyRate,
      overtimeRate: draft.overtimeRate,
      overtime60Rate: draft.overtime60Rate,
      nightRate: draft.nightRate,
      holidayRate: draft.holidayRate,
      adminId: ctx.adminId,
    });

    return NextResponse.json({
      ok: true,
      currentRate,
      newRate: draft.baseHourlyRate,
      changePercent: change.changePercent,
      needsConfirmation: change.needsConfirmation,
      previewToken,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
