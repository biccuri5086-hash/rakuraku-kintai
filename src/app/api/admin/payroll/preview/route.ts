import { NextRequest, NextResponse } from "next/server";
import { getTenantContext } from "@/lib/tenant-context";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { jstMonthBounds, jstThisMonth } from "@/lib/jst";
import { errorResponse } from "@/lib/api-handler";
import { aggregatePayroll } from "@/lib/payroll/aggregate";
import { DEFAULT_PAYROLL_SETTINGS } from "@/lib/payroll/settings";
import type { PunchEvent } from "@/lib/payroll/types";

// Phase B: 給与集計プレビュー（読み取り専用・マイグレーション不要）。
// 実打刻(attendance)＋契約(assignments)＋シフト(shifts) から、割増込みの集計と概算給与を返す。
// 会社設定(company_payroll_settings)は未適用のため当面デフォルトを使用（適用後にここで読み替える）。
// テナント境界：companyId は必ずセッションから導出（リクエスト値は信用しない）＝IDOR対策。

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

    const { start, end } = jstMonthBounds(month);
    const [y, m] = month.split("-").map(Number);
    const monthFirst = `${month}-01`;
    const nextFirst = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`;

    const supabase = getSupabaseAdmin();
    const [{ data: punches, error }, { data: assignments }, { data: shifts }] = await Promise.all([
      supabase
        .from("attendance")
        .select("user_id, user_name, type, timestamp")
        .eq("company_id", ctx.companyId)
        .gte("timestamp", start)
        .lt("timestamp", end)
        .order("timestamp", { ascending: true }),
      supabase
        .from("assignments")
        .select("id, user_id, hourly_rate, start_date")
        .eq("company_id", ctx.companyId)
        .order("start_date", { ascending: false }),
      supabase
        .from("shifts")
        .select("assignment_id, work_date, break_minutes")
        .eq("company_id", ctx.companyId)
        .gte("work_date", monthFirst)
        .lt("work_date", nextFirst),
    ]);
    if (error) throw error;

    // 時給：時給が入った契約のうち最新開始日のものをスタッフの概算用に採用
    const hourlyRateByUser = new Map<string, number>();
    const assignToUser = new Map<string, string>();
    for (const a of assignments ?? []) {
      assignToUser.set(a.id as string, a.user_id as string);
      if (a.hourly_rate != null && !hourlyRateByUser.has(a.user_id as string)) {
        hourlyRateByUser.set(a.user_id as string, Number(a.hourly_rate));
      }
    }

    // シフト休憩を (user_id|日付) 単位で合算（あればみなし休憩より優先）
    const shiftBreakByKey = new Map<string, number>();
    for (const sh of shifts ?? []) {
      const uid = assignToUser.get(sh.assignment_id as string);
      if (!uid || sh.break_minutes == null) continue;
      const key = `${uid}|${sh.work_date}`;
      shiftBreakByKey.set(key, (shiftBreakByKey.get(key) ?? 0) + Number(sh.break_minutes));
    }

    const settings = DEFAULT_PAYROLL_SETTINGS; // TODO: company_payroll_settings 適用後に会社別設定を読む
    const rows = aggregatePayroll({
      punches: (punches ?? []) as PunchEvent[],
      settings,
      shiftBreakByKey,
      hourlyRateByUser,
    });

    if (format === "csv") {
      // 給与ソフトに繋ぎやすい形：1行=スタッフ×対象月、分を主に（時間は参考）
      const header = [
        "スタッフID", "氏名", "対象月",
        "実働(法定内)分", "残業分", "深夜分", "法定休日分", "支払対象分",
        "実働(H:MM)", "時給", "概算支給額", "要確認",
      ];
      const lines = rows.map((r) =>
        [
          r.user_id, r.staff_name, month,
          r.workMin, r.overtimeMin, r.nightMin, r.holidayMin, r.paidMin,
          minutesToHm(r.paidMin), r.hourlyRate ?? "", r.estimatedPay ?? "", r.needsReview ? "要確認" : "",
        ].join(",")
      );
      const csv = "﻿" + [header.join(","), ...lines].join("\r\n") + "\r\n";
      return new NextResponse(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="payroll_${month}.csv"`,
        },
      });
    }

    // JSON：管理画面の締めプレビュー用
    const view = rows.map((r) => ({
      user_id: r.user_id,
      staff_name: r.staff_name,
      workedDays: r.workedDays,
      workMin: r.workMin,
      overtimeMin: r.overtimeMin,
      nightMin: r.nightMin,
      holidayMin: r.holidayMin,
      paidMin: r.paidMin,
      paidHm: minutesToHm(r.paidMin),
      hourlyRate: r.hourlyRate,
      estimatedPay: r.estimatedPay,
      needsReview: r.needsReview,
    }));
    const totals = rows.reduce(
      (t, r) => {
        t.workMin += r.workMin;
        t.overtimeMin += r.overtimeMin;
        t.nightMin += r.nightMin;
        t.holidayMin += r.holidayMin;
        t.estimatedPay += r.estimatedPay ?? 0;
        return t;
      },
      { workMin: 0, overtimeMin: 0, nightMin: 0, holidayMin: 0, estimatedPay: 0 }
    );

    return NextResponse.json({ ok: true, month, settingsSource: "default", rows: view, totals });
  } catch (e) {
    return errorResponse(e);
  }
}
