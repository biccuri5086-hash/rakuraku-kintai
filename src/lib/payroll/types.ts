// Phase B 給与集計の型定義（純粋・フレームワーク非依存）
// 設計書：らくらく勤怠/specs/PHASE_B_給与エクスポート要件.md

export interface PunchEvent {
  user_id: string;
  user_name: string | null;
  type: string; // "clock_in" | "clock_out"（既存 attendance.type に準拠）
  timestamp: string; // ISO8601
}

export type HolidayMode = "weekly_fixed" | "shift";
export type ShiftStatutoryRule = "weekly_auto" | "fixed_dow";
export type RoundUnit = 1 | 5 | 15 | 60;
export type RoundScope = "month" | "day";
export type RoundMode = "up" | "nearest";

export interface DeemedBreakRule {
  over_min: number; // 実働（拘束）がこの分を超えたら
  break_min: number; // この休憩を控除
}

// 会社ごとの集計ルール（company_payroll_settings に対応）
export interface PayrollSettings {
  weekStart: number; // 0=日..6=土。週40h判定・週次休日判定の起算
  holidayMode: HolidayMode;
  prescribedOffDows: number[]; // 所定休日の曜日（weekly_fixed用・集計には未使用だが将来のUI用）
  statutoryHolidayDow: number; // 法定休日の曜日（0=日）
  shiftStatutoryRule: ShiftStatutoryRule;
  roundUnitMin: RoundUnit;
  roundScope: RoundScope;
  roundMode: RoundMode;
  overtimeRate: number; // 法定外割増（例 1.25）
  overtime60Rate: number; // 月60時間超の時間外割増（例 1.50）
  nightRate: number; // 深夜割増（例 1.25）
  holidayRate: number; // 法定休日割増（例 1.35）
  deemedBreaks: DeemedBreakRule[];
}

// 日次の内訳（timesheet_entries に対応）。work+overtime+holiday = 支払対象の実働。night は重複（overlay）。
export interface DayEntry {
  date: string; // YYYY-MM-DD（JST）
  inAt: string | null;
  outAt: string | null;
  grossMin: number; // 拘束（出勤〜退勤）
  breakMin: number; // 控除した休憩
  workMin: number; // 法定内通常
  overtimeMin: number; // 法定外残業
  nightMin: number; // 深夜（22-5時・overlay）
  holidayMin: number; // 法定休日労働
  isStatutoryHoliday: boolean;
  flags: string[]; // "missing_punch" / "needs_review"
}

// スタッフ×対象期間の集計（timesheets に対応）
export interface StaffPeriodResult {
  user_id: string;
  staff_name: string;
  workedDays: number; // 出勤日数（打刻漏れ日も含む）
  grossMin: number;
  breakMin: number;
  workMin: number;
  overtimeMin: number; // 法定外残業の合計（60h超分を含む）
  overtime60Min: number; // うち月60時間を超える分（割増率が高い）
  nightMin: number;
  holidayMin: number;
  paidMin: number; // work+overtime+holiday
  hourlyRate: number | null;
  estimatedPay: number | null; // 概算（正式な給与計算ではない）
  needsReview: boolean; // 打刻漏れ等があり管理者確認が必要
  entries: DayEntry[];
}
