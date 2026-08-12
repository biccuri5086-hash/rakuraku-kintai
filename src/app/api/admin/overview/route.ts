import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/tenant-context";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { jstToday } from "@/lib/jst";
import { errorResponse } from "@/lib/api-handler";

// 派遣管理のサマリー（派遣先数・稼働中契約数・本日のシフト）
export async function GET() {
  try {
    const ctx = await getTenantContext();
    if (!ctx) return NextResponse.json({ ok: false }, { status: 401 });

    const supabase = getSupabaseAdmin();
    const today = jstToday();

    const [{ count: clientsCount }, { count: activeAssignments }, { data: shifts }, { data: assignments }, { data: profiles }, { data: clients }] =
      await Promise.all([
        supabase.from("clients").select("id", { count: "exact", head: true }).eq("company_id", ctx.companyId),
        supabase.from("assignments").select("id", { count: "exact", head: true }).eq("company_id", ctx.companyId).eq("status", "active"),
        supabase
          .from("shifts")
          .select("id, assignment_id, start_time, end_time")
          .eq("company_id", ctx.companyId)
          .eq("work_date", today)
          .order("start_time", { ascending: true }),
        supabase.from("assignments").select("id, user_id, client_id").eq("company_id", ctx.companyId),
        supabase.from("user_profiles").select("user_id, display_name, full_name").eq("company_id", ctx.companyId),
        supabase.from("clients").select("id, name").eq("company_id", ctx.companyId),
      ]);

    const assignMap = new Map((assignments ?? []).map((a) => [a.id, a]));
    const staffMap = new Map((profiles ?? []).map((p) => [p.user_id, p.full_name || p.display_name || p.user_id]));
    const clientMap = new Map((clients ?? []).map((c) => [c.id, c.name]));

    const todayShifts = (shifts ?? []).map((sh) => {
      const a = assignMap.get(sh.assignment_id);
      return {
        id: sh.id,
        start_time: sh.start_time,
        end_time: sh.end_time,
        staff_name: a ? staffMap.get(a.user_id) ?? a.user_id : "—",
        client_name: a ? clientMap.get(a.client_id) ?? "—" : "—",
      };
    });

    return NextResponse.json({
      ok: true,
      clientsCount: clientsCount ?? 0,
      activeAssignments: activeAssignments ?? 0,
      todayShifts,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
