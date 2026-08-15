import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/tenant-context";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { jstToday } from "@/lib/jst";
import { errorResponse } from "@/lib/api-handler";
import { computeComplianceAlerts } from "@/lib/compliance/alerts";
import type { ClientRec, AssignmentRec, StaffRec } from "@/lib/compliance/types";

// Phase C: 抵触日アラート（読み取り専用）。既存データ(clients.teishokubi・assignments)から算出。
// clients/assignments は select("*") で取得するため、Phase C マイグレーション未適用でも動作し、
// 追加列(dispatch_start_date / teishokubi_extended_until / org_unit)が入れば自動でより正確になる。
// テナント境界：companyId はセッションから導出。

export async function GET() {
  try {
    const ctx = await getTenantContext();
    if (!ctx) return NextResponse.json({ ok: false, message: "未認証" }, { status: 401 });

    const supabase = getSupabaseAdmin();
    const [{ data: clients, error }, { data: assignments }, { data: staff }] = await Promise.all([
      supabase.from("clients").select("*").eq("company_id", ctx.companyId),
      supabase.from("assignments").select("*").eq("company_id", ctx.companyId),
      supabase.from("user_profiles").select("user_id, display_name").eq("company_id", ctx.companyId),
    ]);
    if (error) throw error;

    const alerts = computeComplianceAlerts(
      (clients ?? []) as ClientRec[],
      (assignments ?? []) as AssignmentRec[],
      (staff ?? []) as StaffRec[],
      jstToday()
    );

    const counts = {
      expired: alerts.filter((a) => a.level === "expired").length,
      warn: alerts.filter((a) => a.level === "warn").length,
      unknown: alerts.filter((a) => a.level === "unknown").length,
    };

    return NextResponse.json({ ok: true, today: jstToday(), counts, alerts });
  } catch (e) {
    return errorResponse(e);
  }
}
