import { NextRequest, NextResponse } from "next/server";
import { getTenantContext } from "@/lib/tenant-context";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { jstMonthBounds, jstThisMonth } from "@/lib/jst";
import { errorResponse } from "@/lib/api-handler";
import { aggregatePayroll } from "@/lib/payroll/aggregate";
import { loadFullSettings } from "@/lib/payroll/companySettings";
import { rowToAssignment, rowToPayRule, resolveDayRate } from "@/lib/payroll/payRules";
import type { PunchEvent } from "@/lib/payroll/types";
import { logAudit } from "@/lib/audit-log";

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

    const [{ data: punches, error: pErr }, { data: assignments }, { data: shifts }, { data: payRuleRows }] = await Promise.all([
      supabase
        .from("attendance")
        .select("user_id, user_name, type, timestamp")
        .eq("company_id", ctx.companyId)
        .gte("timestamp", start)
        .lt("timestamp", end)
        .order("timestamp", { ascending: true }),
      supabase.from("assignments").select("id, user_id, client_id, hourly_rate, start_date, end_date").eq("company_id", ctx.companyId).order("start_date", { ascending: false }),
      supabase.from("shifts").select("assignment_id, work_date, break_minutes").eq("company_id", ctx.companyId).gte("work_date", monthFirst).lt("work_date", nextFirst),
      supabase
        .from("pay_rules")
        .select("*")
        .eq("company_id", ctx.companyId)
        .lte("effective_from", nextFirst)
        .or(`effective_to.is.null,effective_to.gt.${monthFirst}`),
    ]);
    if (pErr) throw pErr;

    const assignToUser = new Map<string, string>();
    for (const a of assignments ?? []) assignToUser.set(a.id as string, a.user_id as string);
    const shiftBreakByKey = new Map<string, number>();
    for (const sh of shifts ?? []) {
      const uid = assignToUser.get(sh.assignment_id as string);
      if (!uid || sh.break_minutes == null) continue;
      const key = `${uid}|${sh.work_date}`;
      shiftBreakByKey.set(key, (shiftBreakByKey.get(key) ?? 0) + Number(sh.break_minutes));
    }

    // 掛け持ち対応：日ごとに契約(派遣先)とレートを解決する（preview と同じロジック）。
    const assignmentRows = (assignments ?? []).map(rowToAssignment);
    const payRules = (payRuleRows ?? []).map(rowToPayRule);
    const companyDefaults = {
      overtimeRate: settings.overtimeRate,
      overtime60Rate: settings.overtime60Rate,
      nightRate: settings.nightRate,
      holidayRate: settings.holidayRate,
    };
    const dayRate = (userId: string, date: string) =>
      resolveDayRate(date, userId, ctx.companyId, assignmentRows, payRules, companyDefaults);

    const rows = aggregatePayroll({ punches: (punches ?? []) as PunchEvent[], settings, shiftBreakByKey, dayRate });

    // 既に確定済みの月をもう一度確定すると無言で上書きされ、何がどう変わったか分からなくなる。
    // 確定済み分だけ、上書き前の値を控えておいて差分を監査ログに残す。
    const { data: existingTimesheets } = await supabase
      .from("timesheets")
      .select("user_id, work_min, overtime_min, night_min, holiday_min, estimated_pay, status")
      .eq("company_id", ctx.companyId)
      .eq("period_ym", month);
    const existingByUser = new Map((existingTimesheets ?? []).map((t) => [t.user_id as string, t]));

    const now = new Date().toISOString();
    let saved = 0;
    for (const r of rows) {
      const prev = existingByUser.get(r.user_id);
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
          assignment_id: e.assignmentId ?? null,
          client_id: e.clientId ?? null,
          in_at: e.inAt,
          out_at: e.outAt,
          work_min: e.workMin,
          overtime_min: e.overtimeMin,
          night_min: e.nightMin,
          holiday_min: e.holidayMin,
          flags: e.flags,
          // 確定時点で適用したレートを固定保存する。以後 pay_rules を改定しても、
          // この確定済み金額は再計算されない（監査・労使紛争対応のため）。
          applied_pay_rule_id: e.appliedPayRuleId ?? null,
          applied_hourly_rate: e.appliedHourlyRate ?? null,
          applied_overtime_rate: e.appliedOvertimeRate ?? null,
          applied_night_rate: e.appliedNightRate ?? null,
          applied_holiday_rate: e.appliedHolidayRate ?? null,
        }));
        const { error: eErr } = await supabase.from("timesheet_entries").insert(entryRows);
        if (eErr) return NextResponse.json({ ok: false, message: MIGRATION_MSG, detail: eErr.message }, { status: 409 });
      }
      saved += 1;

      if (prev && prev.status === "confirmed") {
        const fields: Array<[string, unknown, unknown]> = [
          ["work_min", prev.work_min, r.workMin],
          ["overtime_min", prev.overtime_min, r.overtimeMin],
          ["night_min", prev.night_min, r.nightMin],
          ["holiday_min", prev.holiday_min, r.holidayMin],
          ["estimated_pay", prev.estimated_pay, r.estimatedPay],
        ];
        const diff = Object.fromEntries(
          fields.filter(([, before, after]) => before !== after).map(([k, before, after]) => [k, { before, after }])
        );
        if (Object.keys(diff).length > 0) {
          await logAudit(req, "admin_payroll_reconfirm", { user_id: r.user_id, month, diff }, {
            actorType: "admin", actorId: ctx.adminId, companyId: ctx.companyId,
          });
        }
      }
    }

    return NextResponse.json({ ok: true, month, confirmed: saved, confirmedAt: now });
  } catch (e) {
    return errorResponse(e);
  }
}
