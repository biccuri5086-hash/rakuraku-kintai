import { NextRequest, NextResponse } from "next/server";
import { getTenantContext } from "@/lib/tenant-context";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { jstMonthBounds, jstThisMonth } from "@/lib/jst";
import { errorResponse } from "@/lib/api-handler";
import { aggregateClientReport } from "@/lib/payroll/clientReport";
import type { ClientPunch } from "@/lib/payroll/clientReport";

// Phase B: 派遣先向け勤怠報告（読み取り専用・マイグレーション不要）。
// 打刻 → 契約(assignment) → 派遣先(client) に紐づけ、派遣先ごとの就業実績（スタッフ・日数・時間）を返す。
// テナント境界：companyId はセッションから導出（IDOR対策）。

function minutesToHm(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await getTenantContext();
    if (!ctx) return NextResponse.json({ ok: false, message: "未認証" }, { status: 401 });

    const url = new URL(req.url);
    const month = /^\d{4}-\d{2}$/.test(url.searchParams.get("month") ?? "")
      ? url.searchParams.get("month")!
      : jstThisMonth();
    const format = url.searchParams.get("format");
    const onlyClient = url.searchParams.get("client_id"); // CSVを特定派遣先だけに絞る用

    const { start, end } = jstMonthBounds(month);
    const supabase = getSupabaseAdmin();
    const [{ data: punches, error }, { data: assignments }, { data: clients }] = await Promise.all([
      supabase
        .from("attendance")
        .select("user_id, user_name, type, timestamp, assignment_id")
        .eq("company_id", ctx.companyId)
        .gte("timestamp", start)
        .lt("timestamp", end)
        .order("timestamp", { ascending: true }),
      supabase.from("assignments").select("id, client_id").eq("company_id", ctx.companyId),
      supabase.from("clients").select("id, name").eq("company_id", ctx.companyId),
    ]);
    if (error) throw error;

    const clientName = new Map<string, string>();
    for (const c of clients ?? []) clientName.set(c.id as string, (c.name as string) ?? "（名称未設定）");

    const assignmentToClient = new Map<string, { clientId: string; clientName: string }>();
    for (const a of assignments ?? []) {
      if (a.client_id) {
        assignmentToClient.set(a.id as string, {
          clientId: a.client_id as string,
          clientName: clientName.get(a.client_id as string) ?? "（名称未設定）",
        });
      }
    }

    let rows = aggregateClientReport((punches ?? []) as ClientPunch[], assignmentToClient);
    if (onlyClient) rows = rows.filter((r) => r.client_id === onlyClient);

    if (format === "csv") {
      // 監査ログはベストエフォート（payroll_exports 未適用でもCSV出力は成功させる）
      try {
        await supabase.from("payroll_exports").insert({
          company_id: ctx.companyId,
          period_ym: month,
          scope: "client_report",
          format: "csv_generic",
          row_count: rows.reduce((a, r) => a + r.staff.length, 0),
          created_by: ctx.adminId,
        });
      } catch {
        /* テーブル未適用時は無視 */
      }
      const header = ["派遣先", "スタッフID", "氏名", "対象月", "就業日数", "就業時間(拘束・分)", "就業時間(H:MM)"];
      const lines: string[] = [];
      for (const r of rows) {
        for (const s of r.staff) {
          lines.push(
            [r.client_name, s.user_id, s.staff_name, month, s.days, s.grossMin, minutesToHm(s.grossMin)].join(",")
          );
        }
      }
      const csv = "﻿" + [header.join(","), ...lines].join("\r\n") + "\r\n";
      const fname = onlyClient ? `client_report_${onlyClient}_${month}.csv` : `client_report_${month}.csv`;
      return new NextResponse(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${fname}"`,
        },
      });
    }

    const view = rows.map((r) => ({
      client_id: r.client_id,
      client_name: r.client_name,
      totalDays: r.totalDays,
      totalGrossMin: r.totalGrossMin,
      totalGrossHm: minutesToHm(r.totalGrossMin),
      staff: r.staff.map((s) => ({ ...s, grossHm: minutesToHm(s.grossMin) })),
    }));
    return NextResponse.json({ ok: true, month, clients: view });
  } catch (e) {
    return errorResponse(e);
  }
}
