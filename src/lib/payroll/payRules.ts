// 派遣先ごとの賃率・計算ルールの解決ロジック（純粋関数）。
// 設計書：らくらく勤怠/specs/ARCH_商用インフラ設計_v1.md 3章
//
// 背景：現状の給与計算(preview/confirm)は assignments.hourly_rate を
// user_id ごとに「最初に見つかった1件」だけ採用しており、同月に複数派遣先を
// 掛け持ちすると片方の時給で全時間が計算されるバグがある。
// pay_rules は scope(company/client/assignment) と有効期間(effective_from/to)で
// ルールを版管理し、打刻日ごとに正しいルールへ解決できるようにする。
//
// 【この関数を preview/confirm に組み込む改修は別タスクとする】
// 金額計算に直結するため、労務レビュー(skills/labor-advisor)を通してから
// 既存の hourlyRateByUser 方式を置き換える。本ファイルは解決ロジックの土台。

export type PayRuleScope = "company" | "client" | "assignment";

export interface PayRuleRow {
  id: string;
  companyId: string;
  scope: PayRuleScope;
  clientId: string | null;
  assignmentId: string | null;
  /** YYYY-MM-DD */
  effectiveFrom: string;
  /** YYYY-MM-DD。null = 現在も有効 */
  effectiveTo: string | null;
  baseHourlyRate: number | null;
  overtimeRate: number;
  overtime60Rate: number;
  nightRate: number;
  holidayRate: number;
}

export interface PayRuleTarget {
  companyId: string;
  clientId: string | null;
  assignmentId: string | null;
}

const SCOPE_PRIORITY: Record<PayRuleScope, number> = {
  assignment: 0,
  client: 1,
  company: 2,
};

function isActiveOn(rule: PayRuleRow, workDate: string): boolean {
  if (rule.effectiveFrom > workDate) return false;
  if (rule.effectiveTo !== null && rule.effectiveTo <= workDate) return false;
  return true;
}

function matchesScope(rule: PayRuleRow, target: PayRuleTarget): boolean {
  if (rule.companyId !== target.companyId) return false;
  if (rule.scope === "assignment") return rule.assignmentId !== null && rule.assignmentId === target.assignmentId;
  if (rule.scope === "client") return rule.clientId !== null && rule.clientId === target.clientId;
  return rule.scope === "company";
}

/**
 * 打刻日・対象（会社/派遣先/契約）に対して、最も優先度の高い有効なルールを1件返す。
 * 優先順位: assignment > client > company。同一優先度に複数あれば effectiveFrom が新しい方。
 * 該当なしなら null（呼び出し側は company の既定値等にフォールバックする）。
 */
export function resolvePayRule(
  workDate: string,
  target: PayRuleTarget,
  rules: PayRuleRow[]
): PayRuleRow | null {
  const candidates = rules.filter((r) => matchesScope(r, target) && isActiveOn(r, workDate));
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    const p = SCOPE_PRIORITY[a.scope] - SCOPE_PRIORITY[b.scope];
    if (p !== 0) return p;
    return a.effectiveFrom < b.effectiveFrom ? 1 : a.effectiveFrom > b.effectiveFrom ? -1 : 0;
  });
  return candidates[0];
}
