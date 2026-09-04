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

export interface PayRuleChainLink {
  scope: PayRuleScope;
  rule: PayRuleRow | null;
  isWinner: boolean;
}

/**
 * 管理画面の「継承の可視化」用：company/client/assignment それぞれで
 * 指定日に有効なルールが何か（無ければnull）を返し、実際に勝つスコープを isWinner で示す。
 * resolvePayRule と優先順位ロジックを共有する（表示と計算で判定がずれないように）。
 */
export function resolvePayRuleChain(
  workDate: string,
  target: PayRuleTarget,
  rules: PayRuleRow[]
): PayRuleChainLink[] {
  const winner = resolvePayRule(workDate, target, rules);
  const byScope = (scope: PayRuleScope): PayRuleRow | null => {
    const candidates = rules.filter((r) => r.scope === scope && matchesScope(r, target) && isActiveOn(r, workDate));
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : a.effectiveFrom > b.effectiveFrom ? -1 : 0));
    return candidates[0];
  };
  return (["company", "client", "assignment"] as PayRuleScope[]).map((scope) => {
    const rule = byScope(scope);
    return { scope, rule, isWinner: !!rule && !!winner && rule.id === winner.id };
  });
}

// ============================================================
// 掛け持ち対応：打刻日ごとに「どの契約(派遣先)の勤務だったか」を解決する。
// ============================================================
//
// 【なぜ attendance.assignment_id ではなく assignments.start_date/end_date で解決するか】
// 打刻時点でのシフト/現場紐付け（attendance.assignment_id）は今後の打刻にしか付かない。
// 過去分・移行期間のデータも正しく集計できるよう、まず契約の期間（日付単位）で解決する。
// 同日に複数の契約が重なる場合（直行直帰で同日に2現場）だけ ambiguous=true とし、
// 管理者確認を要求する（黙って片方のレートを採用しない）。

export interface AssignmentRow {
  id: string;
  userId: string;
  clientId: string | null;
  hourlyRate: number | null;
  /** YYYY-MM-DD */
  startDate: string;
  /** YYYY-MM-DD。null = 期間未定（現在も継続） */
  endDate: string | null;
}

export interface DailyAssignmentResolution {
  assignmentId: string | null;
  clientId: string | null;
  hourlyRate: number | null;
  /** 同日に複数の契約が重なっており、機械的に1つを選んだ（要確認） */
  ambiguous: boolean;
}

/** userId・work_date（YYYY-MM-DD）から、その日に有効だった契約を解決する。 */
export function resolveDailyAssignment(
  userId: string,
  workDate: string,
  assignments: AssignmentRow[]
): DailyAssignmentResolution {
  const matches = assignments.filter(
    (a) => a.userId === userId && a.startDate <= workDate && (a.endDate === null || a.endDate >= workDate)
  );
  if (matches.length === 0) return { assignmentId: null, clientId: null, hourlyRate: null, ambiguous: false };

  matches.sort((a, b) => (a.startDate < b.startDate ? 1 : a.startDate > b.startDate ? -1 : 0));
  const picked = matches[0];
  return {
    assignmentId: picked.id,
    clientId: picked.clientId,
    hourlyRate: picked.hourlyRate,
    ambiguous: matches.length > 1,
  };
}

export interface ResolvedDayRate {
  hourlyRate: number | null;
  overtimeRate: number;
  overtime60Rate: number;
  nightRate: number;
  holidayRate: number;
  assignmentId: string | null;
  clientId: string | null;
  payRuleId: string | null;
  ambiguous: boolean;
}

/** Supabase の assignments 行（snake_case）→ AssignmentRow */
export function rowToAssignment(row: Record<string, unknown>): AssignmentRow {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    clientId: row.client_id != null ? String(row.client_id) : null,
    hourlyRate: row.hourly_rate != null ? Number(row.hourly_rate) : null,
    startDate: String(row.start_date),
    endDate: row.end_date != null ? String(row.end_date) : null,
  };
}

/** Supabase の pay_rules 行（snake_case）→ PayRuleRow */
export function rowToPayRule(row: Record<string, unknown>): PayRuleRow {
  return {
    id: String(row.id),
    companyId: String(row.company_id),
    scope: row.scope as PayRuleScope,
    clientId: row.client_id != null ? String(row.client_id) : null,
    assignmentId: row.assignment_id != null ? String(row.assignment_id) : null,
    effectiveFrom: String(row.effective_from),
    effectiveTo: row.effective_to != null ? String(row.effective_to) : null,
    baseHourlyRate: row.base_hourly_rate != null ? Number(row.base_hourly_rate) : null,
    overtimeRate: Number(row.overtime_rate),
    overtime60Rate: Number(row.overtime60_rate),
    nightRate: Number(row.night_rate),
    holidayRate: Number(row.holiday_rate),
  };
}

export interface CompanyDefaultRates {
  overtimeRate: number;
  overtime60Rate: number;
  nightRate: number;
  holidayRate: number;
}

/**
 * 打刻日ごとの適用レートを解決する（給与集計 aggregatePayroll の dayRate として渡す想定）。
 * 優先順位: pay_rules(assignment>client>company) の値 → 無ければ assignments.hourly_rate /
 * 会社の既定割増率にフォールバックする（pay_rules 未整備でも既存の契約データだけで動く）。
 * その日の契約が特定できない（0件）場合は null を返す＝呼び出し側は要確認扱いにすること。
 */
export function resolveDayRate(
  workDate: string,
  userId: string,
  companyId: string,
  assignments: AssignmentRow[],
  payRules: PayRuleRow[],
  companyDefaults: CompanyDefaultRates
): ResolvedDayRate | null {
  const asg = resolveDailyAssignment(userId, workDate, assignments);
  if (asg.assignmentId === null) return null;

  const rule = resolvePayRule(
    workDate,
    { companyId, clientId: asg.clientId, assignmentId: asg.assignmentId },
    payRules
  );

  const hourlyRate = rule?.baseHourlyRate ?? asg.hourlyRate ?? null;

  return {
    hourlyRate,
    overtimeRate: rule?.overtimeRate ?? companyDefaults.overtimeRate,
    overtime60Rate: rule?.overtime60Rate ?? companyDefaults.overtime60Rate,
    nightRate: rule?.nightRate ?? companyDefaults.nightRate,
    holidayRate: rule?.holidayRate ?? companyDefaults.holidayRate,
    assignmentId: asg.assignmentId,
    clientId: asg.clientId,
    payRuleId: rule?.id ?? null,
    ambiguous: asg.ambiguous,
  };
}
