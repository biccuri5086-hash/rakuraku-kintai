// 会社ごとの給与集計設定（company_payroll_settings）の読み書き・検証・マッピング。
// テーブル未適用（PHASE_B_MIGRATION.sql 未実行）でも、読み取りは DEFAULT にフォールバックして動く。
// 書き込み（保存）はテーブル適用後に有効になる。

import type { SupabaseClient } from "@supabase/supabase-js";
import { PayrollSettings, RoundUnit } from "./types";
import { DEFAULT_PAYROLL_SETTINGS } from "./settings";

// 集計設定 ＋ 締め日（締め日は期間の区切りに使う値。集計コアには渡さない）
export type FullPayrollSettings = PayrollSettings & { closingDay: number };

export const DEFAULT_FULL_SETTINGS: FullPayrollSettings = {
  ...DEFAULT_PAYROLL_SETTINGS,
  closingDay: 31,
};

const ROUND_UNITS = [1, 5, 15, 60];

function num(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function dowArray(v: unknown, fallback: number[]): number[] {
  if (!Array.isArray(v)) return fallback;
  const arr = v.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
  return arr.length ? arr : fallback;
}
function parseDeemed(v: unknown, fallback: { over_min: number; break_min: number }[]) {
  if (!Array.isArray(v)) return fallback;
  const arr = v
    .map((r) => ({ over_min: Number((r as { over_min?: unknown }).over_min), break_min: Number((r as { break_min?: unknown }).break_min) }))
    .filter((r) => Number.isFinite(r.over_min) && Number.isFinite(r.break_min) && r.over_min >= 0 && r.break_min >= 0);
  return arr.length ? arr : fallback;
}

// DBの行（snake_case）→ 設定。各フィールドは不正ならデフォルトに寄せる。
export function rowToFull(row: Record<string, unknown>): FullPayrollSettings {
  const d = DEFAULT_FULL_SETTINGS;
  const unit = Number(row.round_unit_min);
  return {
    closingDay: Math.min(31, Math.max(1, Math.round(num(row.closing_day, d.closingDay)))),
    weekStart: Math.min(6, Math.max(0, Math.round(num(row.week_start, d.weekStart)))),
    holidayMode: row.holiday_mode === "shift" ? "shift" : "weekly_fixed",
    prescribedOffDows: dowArray(row.prescribed_off_dows, d.prescribedOffDows),
    statutoryHolidayDow: Math.min(6, Math.max(0, Math.round(num(row.statutory_holiday_dow, d.statutoryHolidayDow)))),
    shiftStatutoryRule: row.shift_statutory_rule === "fixed_dow" ? "fixed_dow" : "weekly_auto",
    roundUnitMin: (ROUND_UNITS.includes(unit) ? unit : d.roundUnitMin) as RoundUnit,
    roundScope: row.round_scope === "day" ? "day" : "month",
    roundMode: row.round_mode === "nearest" ? "nearest" : "up",
    overtimeRate: num(row.overtime_rate, d.overtimeRate),
    nightRate: num(row.night_rate, d.nightRate),
    holidayRate: num(row.holiday_rate, d.holidayRate),
    deemedBreaks: parseDeemed(row.deemed_break_json, d.deemedBreaks),
  };
}

// 設定 → DBの行（upsert 用）
export function fullToRow(companyId: string, s: FullPayrollSettings): Record<string, unknown> {
  return {
    company_id: companyId,
    closing_day: s.closingDay,
    week_start: s.weekStart,
    holiday_mode: s.holidayMode,
    prescribed_off_dows: s.prescribedOffDows,
    statutory_holiday_dow: s.statutoryHolidayDow,
    shift_statutory_rule: s.shiftStatutoryRule,
    round_unit_min: s.roundUnitMin,
    round_scope: s.roundScope,
    round_mode: s.roundMode,
    overtime_rate: s.overtimeRate,
    night_rate: s.nightRate,
    holiday_rate: s.holidayRate,
    deemed_break_json: s.deemedBreaks,
  };
}

// 受け取った JSON を検証して FullPayrollSettings に確定（不正は error）
export function validateFull(body: unknown): { ok: true; value: FullPayrollSettings } | { ok: false; error: string } {
  if (typeof body !== "object" || body === null) return { ok: false, error: "invalid body" };
  const b = body as Record<string, unknown>;
  const closingDay = Math.round(num(b.closingDay, NaN));
  if (!Number.isInteger(closingDay) || closingDay < 1 || closingDay > 31) return { ok: false, error: "closingDay は 1〜31" };
  const weekStart = Math.round(num(b.weekStart, NaN));
  if (!Number.isInteger(weekStart) || weekStart < 0 || weekStart > 6) return { ok: false, error: "weekStart は 0〜6" };
  if (b.holidayMode !== "weekly_fixed" && b.holidayMode !== "shift") return { ok: false, error: "holidayMode 不正" };
  const statutoryHolidayDow = Math.round(num(b.statutoryHolidayDow, NaN));
  if (!Number.isInteger(statutoryHolidayDow) || statutoryHolidayDow < 0 || statutoryHolidayDow > 6) return { ok: false, error: "statutoryHolidayDow は 0〜6" };
  if (b.shiftStatutoryRule !== "weekly_auto" && b.shiftStatutoryRule !== "fixed_dow") return { ok: false, error: "shiftStatutoryRule 不正" };
  const unit = Math.round(num(b.roundUnitMin, NaN));
  if (!ROUND_UNITS.includes(unit)) return { ok: false, error: "roundUnitMin は 1/5/15/60" };
  if (b.roundScope !== "month" && b.roundScope !== "day") return { ok: false, error: "roundScope 不正" };
  if (b.roundMode !== "up" && b.roundMode !== "nearest") return { ok: false, error: "roundMode は up/nearest" };
  const rate = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 1 && n <= 3 ? n : null;
  };
  const ot = rate(b.overtimeRate), ni = rate(b.nightRate), ho = rate(b.holidayRate);
  if (ot === null || ni === null || ho === null) return { ok: false, error: "割増率は 1.0〜3.0" };

  return {
    ok: true,
    value: {
      closingDay,
      weekStart,
      holidayMode: b.holidayMode,
      prescribedOffDows: dowArray(b.prescribedOffDows, DEFAULT_FULL_SETTINGS.prescribedOffDows),
      statutoryHolidayDow,
      shiftStatutoryRule: b.shiftStatutoryRule,
      roundUnitMin: unit as RoundUnit,
      roundScope: b.roundScope,
      roundMode: b.roundMode,
      overtimeRate: ot,
      nightRate: ni,
      holidayRate: ho,
      deemedBreaks: parseDeemed(b.deemedBreaks, DEFAULT_FULL_SETTINGS.deemedBreaks),
    },
  };
}

// 会社設定を読む。テーブル未適用・行なし・エラー時は DEFAULT にフォールバック（source で区別）。
export async function loadFullSettings(
  supabase: SupabaseClient,
  companyId: string
): Promise<{ settings: FullPayrollSettings; source: "db" | "default" }> {
  try {
    const { data, error } = await supabase
      .from("company_payroll_settings")
      .select("*")
      .eq("company_id", companyId)
      .maybeSingle();
    if (error || !data) return { settings: DEFAULT_FULL_SETTINGS, source: "default" };
    return { settings: rowToFull(data as Record<string, unknown>), source: "db" };
  } catch {
    return { settings: DEFAULT_FULL_SETTINGS, source: "default" };
  }
}
