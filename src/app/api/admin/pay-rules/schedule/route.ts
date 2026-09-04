import { NextRequest, NextResponse } from "next/server";
import { getTenantContext } from "@/lib/tenant-context";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { errorResponse } from "@/lib/api-handler";
import { logAudit } from "@/lib/audit-log";
import { jstToday } from "@/lib/jst";
import { verifyPayRuleToken } from "@/lib/payRuleToken";

// 改定予約の確定。previewToken の中身だけを信用して書き込む
// （フロントから再送された数値は一切見ない＝プレビューと確定の内容が食い違わない）。
export async function POST(req: NextRequest) {
  try {
    const ctx = await getTenantContext();
    if (!ctx) return NextResponse.json({ ok: false }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const token = String(body?.previewToken ?? "");
    const draft = verifyPayRuleToken(token);
    if (!draft) {
      return NextResponse.json({ ok: false, message: "プレビューの有効期限が切れました。もう一度やり直してください。" }, { status: 400 });
    }
    if (draft.companyId !== ctx.companyId) {
      // 他テナントのトークンを流用しようとした場合。通常のUI操作では発生しない。
      return NextResponse.json({ ok: false, message: "不正なリクエストです" }, { status: 403 });
    }
    if (draft.effectiveFrom < jstToday()) {
      return NextResponse.json({ ok: false, message: "開始日が過去になっています。もう一度やり直してください。" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.rpc("fn_schedule_pay_rule", {
      p_company_id: ctx.companyId,
      p_scope: draft.scope,
      p_client_id: draft.clientId,
      p_assignment_id: draft.assignmentId,
      p_effective_from: draft.effectiveFrom,
      p_base_hourly_rate: draft.baseHourlyRate,
      p_overtime_rate: draft.overtimeRate,
      p_overtime60_rate: draft.overtime60Rate,
      p_night_rate: draft.nightRate,
      p_holiday_rate: draft.holidayRate,
    });
    if (error) {
      // マイグレーション未適用(関数が無い)・排他制約違反などをそのままエラーメッセージに含めない
      return NextResponse.json({ ok: false, message: "改定の予約に失敗しました。日付が既存のルールと重なっていないか確認してください。" }, { status: 409 });
    }

    const row = Array.isArray(data) ? data[0] : data;
    const newRuleId = row?.new_rule_id as string | undefined;
    if (!newRuleId) {
      return NextResponse.json({ ok: false, message: "改定の予約に失敗しました" }, { status: 500 });
    }

    await logAudit(
      req,
      "admin_pay_rule_scheduled",
      {
        scope: draft.scope,
        clientId: draft.clientId,
        assignmentId: draft.assignmentId,
        effectiveFrom: draft.effectiveFrom,
        baseHourlyRate: draft.baseHourlyRate,
        closedRuleId: row?.closed_rule_id ?? null,
      },
      { actorType: "admin", actorId: ctx.adminId, companyId: ctx.companyId }
    );

    return NextResponse.json({ ok: true, ruleId: newRuleId });
  } catch (e) {
    return errorResponse(e);
  }
}
