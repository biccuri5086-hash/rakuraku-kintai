// Phase C：抵触日アラート＆管理台帳の算出（純粋関数）。
// 既存データ（clients.teishokubi・assignments）から計算できるため、マイグレーション前でも動く。
// Phase C マイグレーションで clients.dispatch_start_date / teishokubi_extended_until / assignments.org_unit が
// 加わると、より正確な算出（受入開始+3年・延長・組織単位）に自動で切り替わる。
//
// 前提（v1・明記）：
//  - 事業所単位：抵触日 = 延長後 ?? 事業所抵触日 ?? (受入開始日+3年) ?? 不明
//  - 個人単位：同一(スタッフ×派遣先×組織単位)の ongoing 契約の最早 start_date + 3年
//  - クーリング期間（3ヶ月超の空白でリセット）は v1 では未考慮（最早開始日で算出）

import { ClientRec, AssignmentRec, StaffRec, ComplianceAlert, ComplianceLevel, LedgerRow } from "./types";

export const WARN_DAYS = 90;

// "YYYY-MM-DD" に n 年加算（存在しない日付は自然に繰り上がる）
export function addYears(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y + n, m - 1, d)).toISOString().slice(0, 10);
}

// "YYYY-MM-DD" に n ヶ月加算
export function addMonths(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, d)).toISOString().slice(0, 10);
}

// 個人単位の抵触日を、クーリング期間（3ヶ月超の空白で通算リセット）を考慮して算出する。
// 同一(スタッフ×派遣先×組織単位)の ongoing 契約群を受け取り、現在の継続期間の開始 +3年 を返す。
// 前の派遣の終了(end_date)から次の開始まで 3ヶ月を超える空白があれば、そこで通算がリセットされる。
export function individualLimitDate(group: AssignmentRec[]): { start: string; limit: string } | null {
  const sorted = [...group].filter((a) => a.type === "ongoing").sort((a, b) => a.start_date.localeCompare(b.start_date));
  if (!sorted.length) return null;
  let runStart = sorted[0].start_date;
  let prevEnd: string | null = sorted[0].end_date ?? null;
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i];
    // 直前が終了日ありで、その3ヶ月後より後に次が始まる＝クーリング成立 → 通算リセット
    if (prevEnd && a.start_date > addMonths(prevEnd, 3)) {
      runStart = a.start_date;
    }
    // 終了日が無い（期間未定）契約の後は空白が生じないものとして扱う
    prevEnd = a.end_date ? (prevEnd && prevEnd > a.end_date ? prevEnd : a.end_date) : null;
  }
  return { start: runStart, limit: addYears(runStart, 3) };
}

// target までの残り日数（today 基準、UTC日付差）
export function daysUntil(target: string, today: string): number {
  const t = Date.parse(`${target}T00:00:00Z`);
  const n = Date.parse(`${today}T00:00:00Z`);
  return Math.round((t - n) / 86400000);
}

export function levelOf(days: number | null): ComplianceLevel {
  if (days === null) return "unknown";
  if (days < 0) return "expired";
  if (days <= WARN_DAYS) return "warn";
  return "ok";
}

// 事業所抵触日
export function officeLimit(c: ClientRec): { date: string | null; basis: string } {
  if (c.teishokubi_extended_until) return { date: c.teishokubi_extended_until, basis: "延長後抵触日" };
  if (c.teishokubi) return { date: c.teishokubi, basis: "事業所抵触日" };
  if (c.dispatch_start_date) return { date: addYears(c.dispatch_start_date, 3), basis: "受入開始+3年" };
  return { date: null, basis: "未設定" };
}

const LEVEL_ORDER: Record<ComplianceLevel, number> = { expired: 0, warn: 1, unknown: 2, ok: 3 };

function sortAlerts(a: ComplianceAlert[]): ComplianceAlert[] {
  return a.sort((x, y) => {
    if (LEVEL_ORDER[x.level] !== LEVEL_ORDER[y.level]) return LEVEL_ORDER[x.level] - LEVEL_ORDER[y.level];
    const dx = x.daysRemaining ?? Number.POSITIVE_INFINITY;
    const dy = y.daysRemaining ?? Number.POSITIVE_INFINITY;
    return dx - dy;
  });
}

export function computeComplianceAlerts(
  clients: ClientRec[],
  assignments: AssignmentRec[],
  staff: StaffRec[],
  today: string
): ComplianceAlert[] {
  const clientById = new Map(clients.map((c) => [c.id, c]));
  const staffName = new Map(staff.map((s) => [s.user_id, s.display_name]));
  const alerts: ComplianceAlert[] = [];

  // 稼働中の派遣先（ongoing 契約がある client）
  const activeClientIds = new Set(
    assignments.filter((a) => a.type === "ongoing" && a.client_id).map((a) => a.client_id as string)
  );

  // 事業所単位：抵触日がある or 稼働中の派遣先
  for (const c of clients) {
    const { date, basis } = officeLimit(c);
    if (date === null && !activeClientIds.has(c.id)) continue; // 情報も稼働も無い先は出さない
    const days = date ? daysUntil(date, today) : null;
    alerts.push({
      scope: "office",
      level: levelOf(days),
      client_id: c.id,
      client_name: c.name,
      limitDate: date,
      daysRemaining: days,
      basis,
    });
  }

  // 個人単位：同一(スタッフ×派遣先×組織単位)の ongoing 群から、クーリング考慮の抵触日を算出
  const groups = new Map<string, AssignmentRec[]>();
  for (const a of assignments) {
    if (a.type !== "ongoing" || !a.client_id) continue;
    const key = `${a.user_id}|${a.client_id}|${a.org_unit ?? ""}`;
    const arr = groups.get(key);
    if (arr) arr.push(a);
    else groups.set(key, [a]);
  }
  for (const g of groups.values()) {
    const calc = individualLimitDate(g);
    if (!calc) continue;
    const a = g[0];
    const days = daysUntil(calc.limit, today);
    alerts.push({
      scope: "individual",
      level: levelOf(days),
      client_id: a.client_id,
      client_name: clientById.get(a.client_id as string)?.name ?? "（不明な派遣先）",
      staff_id: a.user_id,
      staff_name: staffName.get(a.user_id) ?? a.user_id,
      org_unit: a.org_unit ?? null,
      limitDate: calc.limit,
      daysRemaining: days,
      basis: `派遣開始 ${calc.start} +3年（クーリング考慮）`,
    });
  }

  return sortAlerts(alerts);
}

// 派遣元管理台帳（労働者派遣法 第37条相当の主要項目）
export function buildLedger(
  clients: ClientRec[],
  assignments: AssignmentRec[],
  staff: StaffRec[]
): LedgerRow[] {
  const clientById = new Map(clients.map((c) => [c.id, c]));
  const staffName = new Map(staff.map((s) => [s.user_id, s.display_name]));
  const staffById = new Map(staff.map((s) => [s.user_id, s]));

  // 個人抵触日（(スタッフ×派遣先×組織単位) 群からクーリング考慮で算出）
  const groups = new Map<string, AssignmentRec[]>();
  for (const a of assignments) {
    if (a.type !== "ongoing" || !a.client_id) continue;
    const key = `${a.user_id}|${a.client_id}|${a.org_unit ?? ""}`;
    const arr = groups.get(key);
    if (arr) arr.push(a);
    else groups.set(key, [a]);
  }
  const limitByKey = new Map<string, string>();
  for (const [key, g] of groups) {
    const calc = individualLimitDate(g);
    if (calc) limitByKey.set(key, calc.limit);
  }

  const rows: LedgerRow[] = assignments.map((a) => {
    const c = a.client_id ? clientById.get(a.client_id) : undefined;
    const s = staffById.get(a.user_id);
    const key = `${a.user_id}|${a.client_id}|${a.org_unit ?? ""}`;
    return {
      staff_id: a.user_id,
      staff_name: staffName.get(a.user_id) ?? a.user_id,
      client_name: c?.name ?? "（不明な派遣先）",
      org_unit: a.org_unit ?? null,
      job_content: a.job_content ?? null,
      type: a.type,
      start_date: a.start_date,
      end_date: a.end_date ?? null,
      individualLimit: a.type === "ongoing" ? limitByKey.get(key) ?? null : null,
      officeLimit: c ? officeLimit(c).date : null,
      dispatch_manager: c?.dispatch_manager ?? null,
      employment_type: s?.employment_type ?? null,
      social_insurance: s?.social_insurance ?? null,
    };
  });

  rows.sort((x, y) => x.client_name.localeCompare(y.client_name, "ja") || x.staff_name.localeCompare(y.staff_name, "ja"));
  return rows;
}
