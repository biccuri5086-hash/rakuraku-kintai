// pay_rules の入力検証（純粋関数）。API・管理画面フロントの両方から同じ関数を呼ぶ。
// 設計書：らくらく勤怠/specs/PAY_RULES_ADMIN_UI_設計.md

import { PayRuleScope } from "./payRules";

export const MIN_HOURLY_RATE = 100;
export const MAX_HOURLY_RATE = 100000;
export const MIN_MULTIPLIER_RATE = 1.0;
export const MAX_MULTIPLIER_RATE = 3.0;
// 変動幅がこれ以上なら確認ダイアログを強制する（誤入力対策のフェイルセーフ）
export const RATE_CHANGE_CONFIRM_THRESHOLD = 0.5;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type PayRuleDraftInput = {
  scope: PayRuleScope;
  clientId: string | null;
  assignmentId: string | null;
  effectiveFrom: string;
  baseHourlyRate: number | null;
  overtimeRate: number;
  overtime60Rate: number;
  nightRate: number;
  holidayRate: number;
};

export type ValidationResult = { ok: true } | { ok: false; error: string };

function isMultiplierValid(v: number): boolean {
  return Number.isFinite(v) && v >= MIN_MULTIPLIER_RATE && v <= MAX_MULTIPLIER_RATE;
}

/** 今日(JST)の "YYYY-MM-DD" を渡して、過去日付を弾く（過去への遡及編集は許可しない）。 */
export function validatePayRuleDraft(draft: PayRuleDraftInput, todayJst: string): ValidationResult {
  if (draft.scope === "client" && !draft.clientId) return { ok: false, error: "派遣先スコープには clientId が必要です" };
  if (draft.scope === "assignment" && !draft.assignmentId) return { ok: false, error: "契約スコープには assignmentId が必要です" };
  if (draft.scope === "company" && (draft.clientId || draft.assignmentId)) {
    return { ok: false, error: "会社スコープに clientId/assignmentId は指定できません" };
  }

  if (!DATE_RE.test(draft.effectiveFrom)) return { ok: false, error: "開始日の形式が不正です" };
  if (draft.effectiveFrom < todayJst) return { ok: false, error: "開始日は今日以降の日付を指定してください（過去日付への変更はできません）" };

  if (draft.baseHourlyRate !== null) {
    if (!Number.isFinite(draft.baseHourlyRate) || draft.baseHourlyRate < MIN_HOURLY_RATE || draft.baseHourlyRate > MAX_HOURLY_RATE) {
      return { ok: false, error: `時給は${MIN_HOURLY_RATE}円〜${MAX_HOURLY_RATE.toLocaleString()}円の範囲で入力してください` };
    }
  }

  for (const [label, v] of [
    ["残業割増率", draft.overtimeRate],
    ["60時間超割増率", draft.overtime60Rate],
    ["深夜割増率", draft.nightRate],
    ["法定休日割増率", draft.holidayRate],
  ] as const) {
    if (!isMultiplierValid(v)) {
      return { ok: false, error: `${label}は${MIN_MULTIPLIER_RATE.toFixed(2)}〜${MAX_MULTIPLIER_RATE.toFixed(2)}の範囲で入力してください` };
    }
  }

  return { ok: true };
}

export type RateChange = {
  changePercent: number | null;
  needsConfirmation: boolean;
};

/** 現在の時給と変更後の時給を比べ、50%以上の変動なら確認を要求する。 */
export function computeRateChange(currentRate: number | null, newRate: number | null): RateChange {
  if (currentRate === null || newRate === null || currentRate === 0) {
    return { changePercent: null, needsConfirmation: false };
  }
  const changePercent = ((newRate - currentRate) / currentRate) * 100;
  return { changePercent, needsConfirmation: Math.abs(changePercent) / 100 >= RATE_CHANGE_CONFIRM_THRESHOLD };
}
