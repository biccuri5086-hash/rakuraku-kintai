import { NextRequest, NextResponse } from "next/server";
import { getTenantContext } from "@/lib/tenant-context";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { errorResponse } from "@/lib/api-handler";
import { jstToday } from "@/lib/jst";
import { rowToPayRule } from "@/lib/payroll/payRules";

// pay_rules 一覧（scope+targetで絞り込み）。管理画面の履歴パネル用。
export async function GET(req: NextRequest) {
  try {
    const ctx = await getTenantContext();
    if (!ctx) return NextResponse.json({ ok: false }, { status: 401 });

    const url = new URL(req.url);
    const scope = url.searchParams.get("scope");
    const targetId = url.searchParams.get("targetId");
    if (scope !== "company" && scope !== "client" && scope !== "assignment") {
      return NextResponse.json({ ok: false, message: "scope は company/client/assignment のいずれかです" }, { status: 400 });
    }
    if (scope !== "company" && !targetId) {
      return NextResponse.json({ ok: false, message: "targetId が必要です" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    let query = supabase.from("pay_rules").select("*").eq("company_id", ctx.companyId).eq("scope", scope);
    if (scope === "client") query = query.eq("client_id", targetId);
    if (scope === "assignment") query = query.eq("assignment_id", targetId);

    const { data, error } = await query.order("effective_from", { ascending: false });
    if (error) throw error;

    const today = jstToday();
    const rules = (data ?? []).map(rowToPayRule).map((r) => ({
      id: r.id,
      scope: r.scope,
      clientId: r.clientId,
      assignmentId: r.assignmentId,
      effectiveFrom: r.effectiveFrom,
      effectiveTo: r.effectiveTo,
      baseHourlyRate: r.baseHourlyRate,
      overtimeRate: r.overtimeRate,
      overtime60Rate: r.overtime60Rate,
      nightRate: r.nightRate,
      holidayRate: r.holidayRate,
      status: r.effectiveFrom > today ? "future" : r.effectiveTo !== null && r.effectiveTo <= today ? "past" : "current",
    }));

    return NextResponse.json({ ok: true, rules });
  } catch (e) {
    return errorResponse(e);
  }
}
