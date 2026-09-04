import { NextRequest, NextResponse } from "next/server";
import { getTenantContext } from "@/lib/tenant-context";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { errorResponse } from "@/lib/api-handler";
import { jstToday } from "@/lib/jst";
import { resolveEffectiveForAssignment } from "@/lib/payroll/payRuleAdmin";

// 継承チェーン（会社/派遣先/契約のどれが勝っているか）を返す。管理画面の可視化用。
export async function GET(req: NextRequest) {
  try {
    const ctx = await getTenantContext();
    if (!ctx) return NextResponse.json({ ok: false }, { status: 401 });

    const url = new URL(req.url);
    const assignmentId = url.searchParams.get("assignmentId");
    const date = url.searchParams.get("date") || jstToday();
    if (!assignmentId) return NextResponse.json({ ok: false, message: "assignmentId が必要です" }, { status: 400 });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ ok: false, message: "date の形式が不正です" }, { status: 400 });

    const supabase = getSupabaseAdmin();
    const result = await resolveEffectiveForAssignment(supabase, ctx.companyId, assignmentId, date);
    if (!result) return NextResponse.json({ ok: false, message: "契約が見つかりません" }, { status: 404 });

    return NextResponse.json({
      ok: true,
      date,
      winner: {
        scope: result.chain.find((l) => l.isWinner)?.scope ?? null,
        ruleId: result.chain.find((l) => l.isWinner)?.rule?.id ?? null,
      },
      chain: result.chain.map((l) => ({
        scope: l.scope,
        rule: l.rule
          ? {
              id: l.rule.id,
              baseHourlyRate: l.rule.baseHourlyRate,
              overtimeRate: l.rule.overtimeRate,
              overtime60Rate: l.rule.overtime60Rate,
              nightRate: l.rule.nightRate,
              holidayRate: l.rule.holidayRate,
              effectiveFrom: l.rule.effectiveFrom,
              effectiveTo: l.rule.effectiveTo,
            }
          : null,
        isWinner: l.isWinner,
      })),
      resolvedHourlyRate: result.resolvedHourlyRate,
      assignmentFallbackHourlyRate: result.assignment.hourlyRate,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
