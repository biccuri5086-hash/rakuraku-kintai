// Phase B 給与集計ロジックの自己テスト（純粋関数の数値検証）。
// このプロジェクトにはテストランナーが無いため、tsc でコンパイルして node で実行する簡易スペック。
//
// 実行方法（node_modules 未使用でも可）：
//   tsc src/lib/payroll/*.ts scripts/payroll_selftest.ts \
//     --outDir /tmp/pbout --module commonjs --target es2020 \
//     --moduleResolution node --strict --esModuleInterop --ignoreDeprecations 6.0
//   node /tmp/pbout/payroll_selftest.js
// （tsconfig を無視するため、tsconfig の無いディレクトリから絶対パスで実行してもよい）

import { aggregatePayroll } from "../src/lib/payroll/aggregate";
import { DEFAULT_PAYROLL_SETTINGS } from "../src/lib/payroll/settings";
import { jstDowOfDate } from "../src/lib/payroll/time";
import { PunchEvent } from "../src/lib/payroll/types";
import { resolveDayRate, AssignmentRow, PayRuleRow } from "../src/lib/payroll/payRules";

let failed = 0;
function eq(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failed++; console.log(`FAIL ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
  else console.log(`ok   ${name}`);
}
const P = (u: string, t: string, ts: string): PunchEvent => ({ user_id: u, user_name: u, type: t, timestamp: ts });
const S = DEFAULT_PAYROLL_SETTINGS;
const rate = new Map([["u", 1000]]);
const one = (ps: PunchEvent[]) => aggregatePayroll({ punches: ps, settings: S, hourlyRateByUser: rate })[0];

// 平日9:00-18:00（拘束540分・みなし休憩60→実働480）
{
  const r = one([P("u", "clock_in", "2026-08-13T09:00:00+09:00"), P("u", "clock_out", "2026-08-13T18:00:00+09:00")]);
  eq("weekday grossMin", r.grossMin, 540);
  eq("weekday breakMin", r.breakMin, 60);
  eq("weekday workMin", r.workMin, 480);
  eq("weekday overtime", r.overtimeMin, 0);
  eq("weekday estPay", r.estimatedPay, 8000);
}
// 残業：9:00-20:00（拘束660・休憩60→実働600、8h超120が残業）
{
  const r = one([P("u", "clock_in", "2026-08-13T09:00:00+09:00"), P("u", "clock_out", "2026-08-13T20:00:00+09:00")]);
  eq("ot workMin", r.workMin, 480);
  eq("ot overtimeMin", r.overtimeMin, 120);
  eq("ot estPay", r.estimatedPay, 10500); // 480*1.0 + 120*1.25 = 630分相当
}
// 深夜（日跨ぎ）：21:00-翌0:00（拘束180・休憩0→実働180、深夜22-24=120）
{
  const r = one([P("u", "clock_in", "2026-08-13T21:00:00+09:00"), P("u", "clock_out", "2026-08-14T00:00:00+09:00")]);
  eq("night workMin", r.workMin, 180);
  eq("night nightMin", r.nightMin, 120);
  eq("night estPay", r.estimatedPay, 3500); // 180*1.0 + 120*0.25
}
// 打刻漏れ（退勤なし）→ 締め対象外・要確認
{
  const r = one([P("u", "clock_in", "2026-08-13T09:00:00+09:00")]);
  eq("missing needsReview", r.needsReview, true);
  eq("missing paidMin", r.paidMin, 0);
  eq("missing flags", r.entries[0].flags, ["missing_punch", "needs_review"]);
}
// 法定休日（日曜・weekly_fixed）→ 全額 holiday
{
  eq("2026-08-16 is Sunday", jstDowOfDate("2026-08-16"), 0);
  const r = one([P("u", "clock_in", "2026-08-16T09:00:00+09:00"), P("u", "clock_out", "2026-08-16T18:00:00+09:00")]);
  eq("holiday holidayMin", r.holidayMin, 480);
  eq("holiday workMin", r.workMin, 0);
  eq("holiday estPay", r.estimatedPay, 10800); // 480*1.35
}
// 週40h超：月-土 各8h実働（480×6=2880）→ 480分が残業へ
{
  const ps: PunchEvent[] = [];
  for (const day of ["2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14", "2026-08-15"]) {
    ps.push(P("u", "clock_in", `${day}T09:00:00+09:00`), P("u", "clock_out", `${day}T18:00:00+09:00`));
  }
  const r = one(ps);
  eq("week40 workMin", r.workMin, 2400);
  eq("week40 overtimeMin", r.overtimeMin, 480);
}

// 月60時間超の時間外割増：週1日勤務を20週分（各週40h以内→週40h按分なし）、各日9:00-22:00
// 拘束780・休憩60→実働720、日8h超で残業240/日。20日で残業4800分（>3600）。
{
  const ps: PunchEvent[] = [];
  // 2024-01-01(月)から7日おきに20回（各日が別々の週＝週40h按分が起きない）
  const start = new Date(Date.UTC(2024, 0, 1));
  for (let i = 0; i < 20; i++) {
    const d = new Date(start.getTime() + i * 7 * 86400000).toISOString().slice(0, 10);
    ps.push(P("u", "clock_in", `${d}T09:00:00+09:00`), P("u", "clock_out", `${d}T22:00:00+09:00`));
  }
  const r = one(ps);
  eq("ot60 workMin", r.workMin, 9600); // 480*20
  eq("ot60 overtimeMin(total)", r.overtimeMin, 4800); // 240*20
  eq("ot60 overtime60Min", r.overtime60Min, 1200); // 4800-3600
  // 概算: 9600*1.0 + 3600*1.25 + 1200*1.5 = 9600+4500+1800 = 15900分相当 → 1000/60*15900
  eq("ot60 estPay", r.estimatedPay, 265000);
}

// --- 掛け持ち（同月に複数派遣先）でも正しい時給が使われることの検証 ---
// これが今回のバグ修正の本題：user_id ごとに1つの時給ではなく、日ごとに契約(派遣先)を
// 解決して、その契約の時給で支払額を計算する。
{
  const COMPANY = "co1";
  const assignments: AssignmentRow[] = [
    // 前半：派遣先A・時給1200円（1〜15日）
    { id: "asg-a", userId: "u", clientId: "client-a", hourlyRate: 1200, startDate: "2026-09-01", endDate: "2026-09-15" },
    // 後半：派遣先B・時給1500円（16〜30日）
    { id: "asg-b", userId: "u", clientId: "client-b", hourlyRate: 1500, startDate: "2026-09-16", endDate: "2026-09-30" },
  ];
  const payRules: PayRuleRow[] = []; // pay_rules 未登録でも assignments.hourlyRate にフォールバックする
  const defaults = { overtimeRate: S.overtimeRate, overtime60Rate: S.overtime60Rate, nightRate: S.nightRate, holidayRate: S.holidayRate };
  const dayRate = (userId: string, date: string) => resolveDayRate(date, userId, COMPANY, assignments, payRules, defaults);

  // 前半3日・後半3日、平日9:00-18:00（実働480分/日）
  const ps: PunchEvent[] = [];
  for (const day of ["2026-09-01", "2026-09-02", "2026-09-03"]) {
    ps.push(P("u", "clock_in", `${day}T09:00:00+09:00`), P("u", "clock_out", `${day}T18:00:00+09:00`));
  }
  for (const day of ["2026-09-16", "2026-09-17", "2026-09-18"]) {
    ps.push(P("u", "clock_in", `${day}T09:00:00+09:00`), P("u", "clock_out", `${day}T18:00:00+09:00`));
  }
  const r = aggregatePayroll({ punches: ps, settings: S, dayRate })[0];

  eq("dual-assignment workMin total", r.workMin, 480 * 6);
  eq("dual-assignment ratesMixed", r.ratesMixed, true);
  eq("dual-assignment hourlyRate is null (mixed)", r.hourlyRate, null);
  // 修正前のバグ：全480*6分が片方の時給(例:1500)で計算されてしまっていた（1500/60*2880=72000）。
  // 修正後：前半3日は1200円、後半3日は1500円で正しく按分される。
  eq("dual-assignment estPay uses per-day rate", r.estimatedPay, Math.round((1200 / 60) * 1440 + (1500 / 60) * 1440));
  eq("dual-assignment entry1 assignmentId", r.entries.find((e) => e.date === "2026-09-01")?.assignmentId, "asg-a");
  eq("dual-assignment entry2 assignmentId", r.entries.find((e) => e.date === "2026-09-16")?.assignmentId, "asg-b");
  eq("dual-assignment no review needed", r.needsReview, false);
}

// --- rate_unresolved の日も「月60h超」の累積カウントには含める ---
// (バグ再現テスト：未解決日を累積から除外すると、以降の日の60h超判定がずれて過小払いになる)
{
  // 週1日・9:00-22:00（実働480・残業240/日）を19週分。最初の14週は契約なし(rate_unresolved)、
  // 残り5週だけ契約でカバーする。7日おきの配置は既存の ot60 テストと同様、週40h按分を避けるため。
  const start = new Date(Date.UTC(2024, 0, 1));
  const dates: string[] = [];
  for (let i = 0; i < 19; i++) {
    dates.push(new Date(start.getTime() + i * 7 * 86400000).toISOString().slice(0, 10));
  }
  const unresolvedDates = dates.slice(0, 14); // 累積残業 240*14=3360分（まだ60h未満）
  const resolvedDates = dates.slice(14); // この5週(1200分)の一部が60h超に食い込むはず

  const assignments: AssignmentRow[] = [
    { id: "asg-a", userId: "u", clientId: "client-a", hourlyRate: 1000, startDate: resolvedDates[0], endDate: resolvedDates[resolvedDates.length - 1] },
  ];
  const defaults = { overtimeRate: S.overtimeRate, overtime60Rate: S.overtime60Rate, nightRate: S.nightRate, holidayRate: S.holidayRate };
  const dayRate = (userId: string, date: string) => resolveDayRate(date, userId, "co1", assignments, [], defaults);

  const ps: PunchEvent[] = [];
  for (const day of dates) {
    ps.push(P("u", "clock_in", `${day}T09:00:00+09:00`), P("u", "clock_out", `${day}T22:00:00+09:00`));
  }
  const r = aggregatePayroll({ punches: ps, settings: S, dayRate })[0];

  // 累積: 未解決14週で3360分消費 → 解決5週(1200分)のうち 240分は60h未満側、960分は60h超側。
  // 未解決日を累積から除外するバグがあると、解決5週の残業は「まだ0分から積み上げ」扱いになり
  // 1200分すべてが誤って60h未満(1.25倍)側で計算されてしまう＝過小払い。
  const expectedOt60 = 960, expectedOtBase = 240;
  const expected = Math.round(
    (1000 / 60) * (480 * 5 + expectedOtBase * S.overtimeRate + expectedOt60 * S.overtime60Rate)
  );
  eq("unresolved days still count toward monthly OT60 cumulative", r.estimatedPay, expected);
}

// --- dayRate で契約が特定できない日は要確認（黙って丸めない） ---
{
  const assignments: AssignmentRow[] = [
    { id: "asg-a", userId: "u", clientId: "client-a", hourlyRate: 1200, startDate: "2026-09-01", endDate: "2026-09-05" },
  ];
  const defaults = { overtimeRate: S.overtimeRate, overtime60Rate: S.overtime60Rate, nightRate: S.nightRate, holidayRate: S.holidayRate };
  const dayRate = (userId: string, date: string) => resolveDayRate(date, userId, "co1", assignments, [], defaults);
  // 契約期間外(9/10)の打刻
  const r = aggregatePayroll({
    punches: [P("u", "clock_in", "2026-09-10T09:00:00+09:00"), P("u", "clock_out", "2026-09-10T18:00:00+09:00")],
    settings: S,
    dayRate,
  })[0];
  eq("unresolved rate needsReview", r.needsReview, true);
  eq("unresolved rate flag", r.entries[0].flags.includes("rate_unresolved"), true);
  eq("unresolved rate still counts workMin", r.workMin, 480);
}

// --- 派遣先報告 ---
import { aggregateClientReport, ClientPunch } from "../src/lib/payroll/clientReport";
{
  const a2c = new Map([
    ["a1", { clientId: "c1", clientName: "派遣先A" }],
    ["a2", { clientId: "c2", clientName: "派遣先B" }],
  ]);
  const CP = (u: string, t: string, ts: string, a: string | null): ClientPunch => ({ user_id: u, user_name: u, type: t, timestamp: ts, assignment_id: a });
  const ps: ClientPunch[] = [
    CP("u", "clock_in", "2026-08-10T09:00:00+09:00", "a1"), CP("u", "clock_out", "2026-08-10T18:00:00+09:00", "a1"),
    CP("u", "clock_in", "2026-08-11T09:00:00+09:00", "a2"), CP("u", "clock_out", "2026-08-11T18:00:00+09:00", "a2"),
    CP("v", "clock_in", "2026-08-10T09:00:00+09:00", "a1"), CP("v", "clock_out", "2026-08-10T17:00:00+09:00", "a1"),
  ];
  const rows = aggregateClientReport(ps, a2c);
  eq("client count", rows.length, 2);
  const A = rows.find((r) => r.client_id === "c1")!;
  eq("clientA totalDays", A.totalDays, 2);
  eq("clientA totalGross", A.totalGrossMin, 540 + 480);
  eq("clientA staff u days", A.staff.find((s) => s.user_id === "u")!.days, 1);
  const B = rows.find((r) => r.client_id === "c2")!;
  eq("clientB totalGross", B.totalGrossMin, 540);
}

// --- 会社設定の検証・往復マッピング ---
import { validateFull, rowToFull, fullToRow, DEFAULT_FULL_SETTINGS } from "../src/lib/payroll/companySettings";
{
  // 不正: 丸め単位10はNG
  const bad = validateFull({ ...toBody(DEFAULT_FULL_SETTINGS), roundUnitMin: 10 });
  eq("validate reject unit10", bad.ok, false);
  // 正常
  const good = validateFull(toBody({ ...DEFAULT_FULL_SETTINGS, closingDay: 20, roundUnitMin: 15, holidayMode: "shift" }));
  eq("validate ok", good.ok, true);
  if (good.ok) {
    eq("validate closingDay", good.value.closingDay, 20);
    eq("validate unit", good.value.roundUnitMin, 15);
    // 行への往復（row → full）
    const row = fullToRow("co1", good.value);
    const back = rowToFull(row);
    eq("roundtrip unit", back.roundUnitMin, 15);
    eq("roundtrip holidayMode", back.holidayMode, "shift");
    eq("roundtrip closingDay", back.closingDay, 20);
  }
  // 未適用フォールバック相当：空行 → デフォルト
  eq("empty row → default unit", rowToFull({}).roundUnitMin, DEFAULT_FULL_SETTINGS.roundUnitMin);
}

console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILED`);
if (failed) process.exit(1);

// FullPayrollSettings → PUT body(JSON) 相当（camelCaseそのまま）
function toBody(s: typeof DEFAULT_FULL_SETTINGS): Record<string, unknown> {
  return { ...s };
}
