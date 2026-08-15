import { NextRequest, NextResponse } from "next/server";
import { getTenantContext } from "@/lib/tenant-context";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { jstMonthBounds, jstThisMonth } from "@/lib/jst";
import { errorResponse } from "@/lib/api-handler";
import { aggregatePayroll } from "@/lib/payroll/aggregate";
import { loadFullSettings } from "@/lib/payroll/companySettings";
import type { PunchEvent } from "@/lib/payroll/types";

// 月次の締め（確定）。timesheets / timesheet_entries に保存する。
// これらのテーブルは PHASE_B_MIGRATION.sql 適用後に存在するため、未適用時は 409（未適用）を返す。
// テナント境界：companyId はセッションから導出。

const MIGRATION_MSG = "締めを保存できませんでした。給与テーブル（PHASE_B_MIGRATION.sql）の適用が必要です。";

// GET: 対象月の確定状況（未適用でも {available:false} を返して画面を壊さない）
export async function GET(req: NextRequest) {
  try {
    const ctx = await getTenantContext();
    if (!ctx) return NextResponse.json({ ok: false, message: "未認証" }, { status: 401 });
    const url = new URL(req.url);
    const month = /^\d{4}-\d{2}$/.test(url.searchParams.get("month") ?? "")
      ? url.searchParams.get("month")!
      : jstThisMonth();
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("timesheets")
      .select("user_id, status, confirmed_at")
      .eq("company_id", ctx.companyId)
      .eq("period_ym", month);
    if (error) return NextResponse.json({ ok: true, available: false, month, confirmed: [] });
    const confirmed = (data ?? []).filter((r) => r.status === "confirmed");
    return NextResponse.json({
      ok: true,
      available: true,
      month,
      confirmedCount: confirmed.length,
      confirmedAt: confirmed[0]?.confirmed_at ?? null,
    });
  } catch (e) {
    return errorResponse(e);
  }
}

// POST: 対象月を締める（実打刻から集計して timesheets/entries を保存）
export async function POST(req: NextRequest) {
  try {
    const ctx = await getTenantContext();
    if (!ctx) return NextResponse.json({ ok: false, message: "未認証" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const month = /^\d{4}-\d{2}$/.test((body as { month?: string }).month ?? "")
      ? (body as { month: string }).month
      : jstThisMonth();

    const supabase = getSupabaseAdmin();
    const { settings } = await loadFullSettings(supabase, ctx.companyId);

    const { start, end } = jstMonthBounds(month);
    const [y, m] = month.split("-").map(Number);
    const monthFirst = `${month}-01`;
    const nextFirst = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`;

    const [{ data: punches, error: pErr }, { data: assignments }, { data: shifts }] = await Promise.all([
      supabase
        .from("attendance")
        .select("user_id, user_name, type, timestamp")
        .eq("company_id", ctx.companyId)
        .gte("timestamp", start)
        .lt("timestamp", end)
        .order("timestamp", { ascending: true }),
      supabase.from("assignments").select("id, user_id, hourly_rate, start_date").eq("company_id", ctx.companyId).order("start_date", { ascending: false }),
      supabase.from("shifts").select("assignment_id, work_date, break_minutes").eq("company_id", ctx.companyId).gte("work_date", monthFirst).lt("work_date", nextFirst),
    ]);
    if (pErr) throw pErr;

    const hourlyRateByUser = new Map<string, number>();
    const assignToUser = new Map<string, string>();
    for (const a of assignments ?? []) {
      assignToUser.set(a.id as string, a.user_id as string);
      if (a.hourly_rate != null && !hourlyRateByUser.has(a.user_id as string)) hourlyRateByUser.set(a.user_id as string, Number(a.hourly_rate));
    }
    const shiftBreakByKey = new Map<string, number>();
    for (const sh of shifts ?? []) {
      const uid = assignToUser.get(sh.assignment_id as string);
      if (!uid || sh.break_minutes == null) continue;
      const key = `${uid}|${sh.work_date}`;
      shiftBreakByKey.set(key, (shiftBreakByKey.get(key) ?? 0) + Number(sh.break_minutes));
    }

    const rows = aggregatePayroll({ punches: (punches ?? []) as PunchEvent[], settings, shiftBreakByKey, hourlyRateByUser });

    const now = new Date().toISOString();
    let saved = 0;
    for (const r of rows) {
      const { data: ts, error: tErr } = await supabase
        .from("timesheets")
        .upsert(
          {
            company_id: ctx.companyId,
            user_id: r.user_id,
            period_ym: month,
            work_min: r.workMin,
            overtime_min: r.overtimeMin,
            night_min: r.nightMin,
            holiday_min: r.holidayMin,
            estimated_pay: r.estimatedPay,
            status: "confirmed",
            confirmed_at: now,
            confirmed_by: ctx.adminId,
          },
          { onConflict: "company_id,user_id,period_ym" }
        )
        .select("id")
        .single();
      if (tErr || !ts) {
        return NextResponse.json({ ok: false, message: MIGRATION_MSG, detail: tErr?.message }, { status: 409 });
      }
      const tsId = (ts as { id: string }).id;
      await supabase.from("timesheet_entries").delete().eq("timesheet_id", tsId);
      if (r.entries.length) {
        const entryRows = r.entries.map((e) => ({
          timesheet_id: tsId,
          company_id: ctx.companyId,
          work_date: e.date,
          in_at: e.inAt,
          out_at: e.outAt,
          work_min: e.workMin,
          overtime_min: e.overtimeMin,
          night_min: e.nightMin,
          holiday_min: e.holidayMin,
          flags: e.flags,
        }));
        const { error: eErr } = await supabase.from("timesheet_entries").insert(entryRows);
        if (eErr) return NextResponse.json({ ok: false, message: MIGRATION_MSG, detail: eErr.message }, { status: 409 });
      }
      saved += 1;
    }

    return NextResponse.json({ ok: true, month, confirmed: saved, confirmedAt: now });
  } catch (e) {
    return errorResponse(e);
  }
}
