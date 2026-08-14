// Phase B 給与集計の中核（純粋関数）。
// 打刻イベント（clock_in/clock_out）→ 日次内訳（実働/残業/深夜/法定休日）→ 期間集計。
// 設計・前提は specs/PHASE_B_給与エクスポート要件.md を参照。
//
// 実装している法的モデル（v1・前提を明記）：
//  - 実働 = 拘束(出勤〜退勤) − 休憩（シフト休憩があれば優先、無ければみなし休憩）
//  - 深夜 = 勤務区間のうち 22:00–05:00 に重なる分（割増に上乗せ＝overlay。実働に対しては net で上限）
//  - 法定休日：曜日固定 or シフトの週次自動判定（後述）。法定休日労働は全額 holiday バケット（残業と二重計上しない）
//  - 法定外残業：非休日日の「日8h超」＋「週40h超（法定内の超過分を後から残業へ移動）」
//  - 打刻漏れ（退勤なし）は締め対象外＋ needs_review フラグ（自動補完しない＝管理者確認必須）
//  - 丸めは既定で月合計に適用（切り捨て一方向は不可）

import { PunchEvent, PayrollSettings, DayEntry, StaffPeriodResult } from "./types";
import { jstDateOf, jstDowOfDate, nightMinutes, weekKey } from "./time";
import { roundMinutes, deemedBreak } from "./settings";

const DAILY_LEGAL_MIN = 480; // 8h
const WEEKLY_LEGAL_MIN = 2400; // 40h

export interface AggregateInput {
  punches: PunchEvent[];
  settings: PayrollSettings;
  shiftBreakByKey?: Map<string, number>; // key = `${user_id}|${YYYY-MM-DD}` → シフト休憩分
  hourlyRateByUser?: Map<string, number>; // 概算用の時給
}

type Session = { in: string; out: string };

function pushMap<K, V>(m: Map<K, V[]>, k: K, v: V): void {
  const arr = m.get(k);
  if (arr) arr.push(v);
  else m.set(k, [v]);
}

// 法定休日にあたる日付集合を、スタッフの出勤日から求める
function computeStatutoryHolidays(
  workedDates: string[],
  s: PayrollSettings
): Set<string> {
  const hol = new Set<string>();
  const useDow =
    s.holidayMode === "weekly_fixed" ||
    (s.holidayMode === "shift" && s.shiftStatutoryRule === "fixed_dow");
  if (useDow) {
    for (const d of workedDates) if (jstDowOfDate(d) === s.statutoryHolidayDow) hol.add(d);
    return hol;
  }
  // shift + weekly_auto：週に休みが1日も無ければ（＝7日とも出勤）、その週の最終出勤日を法定休日労働とみなす
  const weeks = new Map<string, string[]>();
  for (const d of workedDates) pushMap(weeks, weekKey(d, s.weekStart), d);
  for (const dates of weeks.values()) {
    if (dates.length >= 7) {
      dates.sort();
      hol.add(dates[dates.length - 1]);
    }
  }
  return hol;
}

// 週40h超の法定内労働を残業へ移す（非休日・打刻漏れ以外のみ対象、後の日から移動）
function applyWeekly40(entries: DayEntry[], weekStart: number): void {
  const weeks = new Map<string, DayEntry[]>();
  for (const e of entries) {
    if (e.flags.length || e.isStatutoryHoliday) continue;
    pushMap(weeks, weekKey(e.date, weekStart), e);
  }
  for (const es of weeks.values()) {
    let excess = es.reduce((a, e) => a + e.workMin, 0) - WEEKLY_LEGAL_MIN;
    if (excess <= 0) continue;
    es.sort((a, b) => b.date.localeCompare(a.date));
    for (const e of es) {
      if (excess <= 0) break;
      const move = Math.min(excess, e.workMin);
      e.workMin -= move;
      e.overtimeMin += move;
      excess -= move;
    }
  }
}

export function aggregatePayroll(input: AggregateInput): StaffPeriodResult[] {
  const { settings } = input;
  const shiftBreak = input.shiftBreakByKey ?? new Map<string, number>();
  const rateMap = input.hourlyRateByUser ?? new Map<string, number>();
  const roundDay = settings.roundScope === "day" && settings.roundUnitMin > 1;

  // 1. 打刻を時系列にペアリングして「勤務セッション」を作る（日跨ぎ・複数回打刻に対応）。
  //    セッションは開始（clock_in）のJST日付に帰属させる。未対応の clock_in はその日の打刻漏れ。
  const byStaff = new Map<string, { name: string; sessions: Session[]; missingDates: Set<string> }>();
  const punchesByUser = new Map<string, PunchEvent[]>();
  for (const p of input.punches) pushMap(punchesByUser, p.user_id, p);

  for (const [user_id, list] of punchesByUser) {
    const sorted = [...list].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const name = sorted.find((p) => p.user_name)?.user_name || user_id;
    const sessions: Session[] = [];
    const missingDates = new Set<string>();
    let pendingIn: string | null = null;
    for (const p of sorted) {
      if (p.type === "clock_in") {
        if (pendingIn) missingDates.add(jstDateOf(pendingIn)); // 前の出勤に退勤が無い
        pendingIn = p.timestamp;
      } else if (p.type === "clock_out") {
        if (pendingIn) {
          if (p.timestamp > pendingIn) sessions.push({ in: pendingIn, out: p.timestamp });
          pendingIn = null;
        }
        // 出勤のない退勤（orphan）は無視
      }
    }
    if (pendingIn) missingDates.add(jstDateOf(pendingIn));
    byStaff.set(user_id, { name, sessions, missingDates });
  }

  const results: StaffPeriodResult[] = [];
  for (const [user_id, st] of byStaff) {
    // 日付 → その日のセッション集約（複数セッションは合算。開始日に帰属）
    const dayAgg = new Map<string, { grossMin: number; night: number; firstIn: string; lastOut: string }>();
    for (const s of st.sessions) {
      const date = jstDateOf(s.in);
      const gross = Math.round((new Date(s.out).getTime() - new Date(s.in).getTime()) / 60000);
      const night = nightMinutes(s.in, s.out);
      const cur = dayAgg.get(date);
      if (!cur) dayAgg.set(date, { grossMin: gross, night, firstIn: s.in, lastOut: s.out });
      else {
        cur.grossMin += gross;
        cur.night += night;
        if (s.in < cur.firstIn) cur.firstIn = s.in;
        if (s.out > cur.lastOut) cur.lastOut = s.out;
      }
    }

    const workedDates = [...new Set([...dayAgg.keys(), ...st.missingDates])].sort();
    const holidayDates = computeStatutoryHolidays(workedDates, settings);

    const entries: DayEntry[] = [];
    for (const date of workedDates) {
      const isHol = holidayDates.has(date);

      // 打刻漏れのある日は締め対象外（確認必須）
      if (st.missingDates.has(date)) {
        const dd = dayAgg.get(date);
        entries.push({
          date, inAt: dd?.firstIn ?? null, outAt: dd?.lastOut ?? null,
          grossMin: 0, breakMin: 0, workMin: 0, overtimeMin: 0, nightMin: 0, holidayMin: 0,
          isStatutoryHoliday: isHol, flags: ["missing_punch", "needs_review"],
        });
        continue;
      }

      const dd = dayAgg.get(date)!;
      const gross = dd.grossMin;
      const key = `${user_id}|${date}`;
      const brk = shiftBreak.has(key) ? shiftBreak.get(key)! : deemedBreak(gross, settings.deemedBreaks);
      const net = Math.max(0, gross - brk);
      let night = Math.min(net, dd.night);

      let workMin = 0, overtimeMin = 0, holidayMin = 0;
      if (isHol) {
        holidayMin = net; // 法定休日は全額 holiday（残業と二重計上しない）
      } else {
        overtimeMin = Math.max(0, net - DAILY_LEGAL_MIN);
        workMin = net - overtimeMin;
      }

      if (roundDay) {
        workMin = roundMinutes(workMin, settings.roundUnitMin, settings.roundMode);
        overtimeMin = roundMinutes(overtimeMin, settings.roundUnitMin, settings.roundMode);
        night = roundMinutes(night, settings.roundUnitMin, settings.roundMode);
        holidayMin = roundMinutes(holidayMin, settings.roundUnitMin, settings.roundMode);
      }

      entries.push({
        date, inAt: dd.firstIn, outAt: dd.lastOut,
        grossMin: gross, breakMin: brk, workMin, overtimeMin, nightMin: night, holidayMin,
        isStatutoryHoliday: isHol, flags: [],
      });
    }

    applyWeekly40(entries, settings.weekStart);

    // 期間合計
    let grossMin = 0, breakMin = 0, workMin = 0, overtimeMin = 0, nightMin = 0, holidayMin = 0;
    let workedDays = 0, needsReview = false;
    for (const e of entries) {
      workedDays += 1;
      if (e.flags.includes("missing_punch")) {
        needsReview = true;
        continue; // 締め対象外
      }
      grossMin += e.grossMin;
      breakMin += e.breakMin;
      workMin += e.workMin;
      overtimeMin += e.overtimeMin;
      nightMin += e.nightMin;
      holidayMin += e.holidayMin;
    }

    if (settings.roundScope === "month" && settings.roundUnitMin > 1) {
      workMin = roundMinutes(workMin, settings.roundUnitMin, settings.roundMode);
      overtimeMin = roundMinutes(overtimeMin, settings.roundUnitMin, settings.roundMode);
      nightMin = roundMinutes(nightMin, settings.roundUnitMin, settings.roundMode);
      holidayMin = roundMinutes(holidayMin, settings.roundUnitMin, settings.roundMode);
    }

    const paidMin = workMin + overtimeMin + holidayMin;
    const rate = rateMap.get(user_id) ?? null;
    // 概算：通常=1.0、残業=overtimeRate、法定休日=holidayRate、深夜は上乗せ(nightRate-1)
    const estimatedPay =
      rate != null
        ? Math.round(
            (rate / 60) *
              (workMin + overtimeMin * settings.overtimeRate + holidayMin * settings.holidayRate + nightMin * (settings.nightRate - 1))
          )
        : null;

    results.push({
      user_id, staff_name: st.name, workedDays,
      grossMin, breakMin, workMin, overtimeMin, nightMin, holidayMin, paidMin,
      hourlyRate: rate, estimatedPay, needsReview, entries,
    });
  }

  results.sort((a, b) => a.staff_name.localeCompare(b.staff_name, "ja"));
  return results;
}
