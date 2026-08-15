import { PayrollSettings, RoundMode } from "./types";

// 既定の集計ルール（company_payroll_settings 未適用の間はこれを使う）。
// 割増・みなし休憩・丸めはオーナー確定値（2026-08-14）。
export const DEFAULT_PAYROLL_SETTINGS: PayrollSettings = {
  weekStart: 1, // 月曜起算
  holidayMode: "weekly_fixed",
  prescribedOffDows: [0, 6], // 日・土
  statutoryHolidayDow: 0, // 日曜を法定休日
  shiftStatutoryRule: "weekly_auto",
  roundUnitMin: 1,
  roundScope: "month",
  roundMode: "up",
  overtimeRate: 1.25,
  overtime60Rate: 1.5, // 月60時間超の時間外
  nightRate: 1.25,
  holidayRate: 1.35,
  deemedBreaks: [
    { over_min: 360, break_min: 45 }, // 実働6h超→45分
    { over_min: 480, break_min: 60 }, // 実働8h超→60分
  ],
};

// 分の丸め（切り捨て一方向は許可しない＝up / nearest のみ）
export function roundMinutes(min: number, unit: number, mode: RoundMode): number {
  if (unit <= 1) return min;
  return mode === "up" ? Math.ceil(min / unit) * unit : Math.round(min / unit) * unit;
}

// みなし休憩：拘束(gross)がしきい値を超えたら控除する休憩分（最大のものを採用）
export function deemedBreak(grossMin: number, rules: { over_min: number; break_min: number }[]): number {
  let b = 0;
  for (const r of rules) if (grossMin > r.over_min) b = Math.max(b, r.break_min);
  return b;
}
