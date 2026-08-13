import { NextRequest, NextResponse } from "next/server";
import { getTenantContext } from "@/lib/tenant-context";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { jstMonthBounds, jstDateOf, jstThisMonth } from "@/lib/jst";
import { errorResponse } from "@/lib/api-handler";

type Punch = { user_id: string; user_name: string | null; type: string; timestamp: string };

type StaffSummary = {
  user_id: string;
  staff_name: string;
  days: number; // 出勤日数
  grossMinutes: number; // 拘束時間（出勤〜退勤）
  breakMinutes: number; // 控除した休憩合計
  totalMinutes: number; // 実働合計（拘束 - 休憩）
  missingClockOut: number; // 退勤打刻もれ日数
  hourlyRate: number | null; // 契約から取得した時給（不明ならnull）
  estimatedPay: number | null; // 概算支給額（時給×実働、割増は未考慮）
};

// 休憩控除の既定値（労働基準法第34条の最低基準）。
// 6時間超で45分、8時間超で60分。シフトに休憩が明示されていればそちらを優先する。
function statutoryBreak(grossMin: number): number {
  if (grossMin > 480) return 60;
  if (grossMin > 360) return 45;
  return 0;
}

// 月をまたぐ勤怠を、スタッフ×JST日付で集計する。
// 打刻イベント方式（clock_in / clock_out の行）から、各日の最初の出勤〜最後の退勤で拘束時間を出し、休憩を引く。
// breakMap: `${user_id}|${date}` -> シフトに登録された休憩分（あればそれを使う）
function aggregate(punches: Punch[], rateMap: Map<string, number>, breakMap: Map<string, number>): StaffSummary[] {
  // user_id -> date -> { in?: ts, out?: ts, name }
  const byStaff = new Map<string, { name: string; days: Map<string, { in?: string; out?: string }> }>();

  for (const p of punches) {
    const date = jstDateOf(p.timestamp);
    if (!byStaff.has(p.user_id)) byStaff.set(p.user_id, { name: p.user_name || p.user_id, days: new Map() });
    const staff = byStaff.get(p.user_id)!;
    if (p.user_name) staff.name = p.user_name;
    if (!staff.days.has(date)) staff.days.set(date, {});
    const day = staff.days.get(date)!;
    if (p.type === "clock_in") {
      // その日の最初の出勤を採用
      if (!day.in || p.timestamp < day.in) day.in = p.timestamp;
    } else if (p.type === "clock_out") {
      // その日の最後の退勤を採用
      if (!day.out || p.timestamp > day.out) day.out = p.timestamp;
    }
  }

  const rows: StaffSummary[] = [];
  for (const [user_id, staff] of byStaff) {
    let days = 0;
    let grossMinutes = 0;
    let breakMinutes = 0;
    let totalMinutes = 0;
    let missingClockOut = 0;
    for (const [date, day] of staff.days) {
      if (!day.in) continue; // 出勤打刻が無い日は集計対象外
      days += 1;
      if (day.out && day.out > day.in) {
        const gross = Math.round((new Date(day.out).getTime() - new Date(day.in).getTime()) / 60000);
        const key = `${user_id}|${date}`;
        const brk = breakMap.has(key) ? breakMap.get(key)! : statutoryBreak(gross);
        const net = Math.max(0, gross - brk);
        grossMinutes += gross;
        breakMinutes += brk;
        totalMinutes += net;
      } else {
        missingClockOut += 1;
      }
    }
    const hourlyRate = rateMap.get(user_id) ?? null;
    const estimatedPay = hourlyRate != null ? Math.round((totalMinutes / 60) * hourlyRate) : null;
    rows.push({
      user_id, staff_name: staff.name, days,
      grossMinutes, breakMinutes, totalMinutes, missingClockOut, hourlyRate, estimatedPay,
    });
  }
  rows.sort((a, b) => a.staff_name.localeCompare(b.staff_name, "ja"));
  return rows;
}

function minutesToHm(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await getTenantContext();
    if (!ctx) return NextResponse.json({ ok: false }, { status: 401 });

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
    const [{ data, error }, { data: assignments }, { data: shifts }] = await Promise.all([
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

    // スタッフごとの時給：時給が入った契約のうち最新の開始日のものを採用（概算用）
    const rateMap = new Map<string, number>();
    const assignToUser = new Map<string, string>();
    for (const a of assignments ?? []) {
      assignToUser.set(a.id, a.user_id);
      if (a.hourly_rate != null && !rateMap.has(a.user_id)) rateMap.set(a.user_id, Number(a.hourly_rate));
    }

    // シフトに休憩が登録されていれば、その日の休憩控除に使う（(user_id, 日付) 単位で合算）
    const breakMap = new Map<string, number>();
    for (const sh of shifts ?? []) {
      const uid = assignToUser.get(sh.assignment_id);
      if (!uid || sh.break_minutes == null) continue;
      const key = `${uid}|${sh.work_date}`;
      breakMap.set(key, (breakMap.get(key) ?? 0) + Number(sh.break_minutes));
    }

    const summary = aggregate((data ?? []) as Punch[], rateMap, breakMap);

    if (format === "csv") {
      const header = ["スタッフ", "出勤日数", "拘束時間(H:MM)", "休憩(分)", "実働時間(H:MM)", "実働分", "時給", "概算支給額", "退勤打刻もれ"];
      const lines = summary.map((s) =>
        [
          s.staff_name,
          s.days,
          minutesToHm(s.grossMinutes),
          s.breakMinutes,
          minutesToHm(s.totalMinutes),
          s.totalMinutes,
          s.hourlyRate ?? "",
          s.estimatedPay ?? "",
          s.missingClockOut,
        ].join(",")
      );
      // Excel(日本語)向けにBOMを付与
      const csv = "﻿" + [header.join(","), ...lines].join("\r\n") + "\r\n";
      return new NextResponse(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="attendance_${month}.csv"`,
        },
      });
    }

    const rows = summary.map((s) => ({
      ...s,
      totalHm: minutesToHm(s.totalMinutes),
      grossHm: minutesToHm(s.grossMinutes),
    }));
    return NextResponse.json({ ok: true, month, rows });
  } catch (e) {
    return errorResponse(e);
  }
}
