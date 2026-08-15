// Phase C コンプラ算出の自己テスト。
// 実行: tsc src/lib/compliance/*.ts scripts/compliance_selftest.ts --outDir /tmp/cout \
//   --module commonjs --target es2020 --moduleResolution node --strict --esModuleInterop --ignoreDeprecations 6.0
//   && node /tmp/cout/scripts/compliance_selftest.js

import { computeComplianceAlerts, buildLedger, addYears, daysUntil, officeLimit, addMonths, individualLimitDate } from "../src/lib/compliance/alerts";
import { ClientRec, AssignmentRec, StaffRec } from "../src/lib/compliance/types";

let failed = 0;
function eq(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failed++; console.log(`FAIL ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
  else console.log(`ok   ${name}`);
}

const today = "2026-08-15";

eq("addYears", addYears("2023-09-01", 3), "2026-09-01");
eq("daysUntil future", daysUntil("2026-08-25", today), 10);
eq("daysUntil past", daysUntil("2026-08-05", today), -10);

// officeLimit の優先順位
eq("office extended wins", officeLimit({ id: "c", name: "X", teishokubi: "2027-01-01", teishokubi_extended_until: "2030-01-01" }).date, "2030-01-01");
eq("office fallback start+3y", officeLimit({ id: "c", name: "X", dispatch_start_date: "2024-09-01" }).date, "2027-09-01");
eq("office unknown", officeLimit({ id: "c", name: "X" }).date, null);

const clients: ClientRec[] = [
  { id: "c1", name: "派遣先A", teishokubi: "2026-10-01" }, // office 47日 → warn
  { id: "c2", name: "派遣先B", dispatch_start_date: "2024-09-01" }, // office 2027-09-01 → ok
];
const staff: StaffRec[] = [{ user_id: "u", display_name: "山田" }];
const assignments: AssignmentRec[] = [
  { id: "a1", user_id: "u", client_id: "c1", type: "ongoing", start_date: "2023-09-01" }, // 個人 2026-09-01 → 17日 warn
  { id: "a2", user_id: "u", client_id: "c2", type: "ongoing", start_date: "2025-01-01" }, // 個人 2028-01-01 → ok
];

const alerts = computeComplianceAlerts(clients, assignments, staff, today);
// 最優先は個人 u@c1（残17日, warn）が事業所c1（残47日, warn）より先
eq("first alert is individual u@c1", `${alerts[0].scope}:${alerts[0].client_id}:${alerts[0].daysRemaining}`, "individual:c1:17");
eq("second alert office c1", `${alerts[1].scope}:${alerts[1].client_id}:${alerts[1].daysRemaining}`, "office:c1:47");
const warns = alerts.filter((a) => a.level === "warn").length;
eq("warn count", warns, 2);

// 管理台帳
const ledger = buildLedger(clients, assignments, staff);
eq("ledger rows", ledger.length, 2);
const rowC1 = ledger.find((r) => r.client_name === "派遣先A")!;
eq("ledger c1 individualLimit", rowC1.individualLimit, "2026-09-01");
eq("ledger c1 officeLimit", rowC1.officeLimit, "2026-10-01");

// --- クーリング期間（3ヶ月超の空白で通算リセット） ---
eq("addMonths", addMonths("2020-06-30", 3), "2020-09-30");
{
  const A = (id: string, s: string, e: string | null): AssignmentRec => ({ id, user_id: "u", client_id: "c1", type: "ongoing", start_date: s, end_date: e });
  // クーリング成立：2019終了 → 2024開始（空白>3ヶ月）→ 通算リセット、抵触日=2024+3年
  const cool = individualLimitDate([A("a", "2019-01-01", "2019-03-31"), A("b", "2024-01-01", null)]);
  eq("cooling start reset", cool?.start, "2024-01-01");
  eq("cooling limit", cool?.limit, "2027-01-01");
  // 非成立：2023-06-30終了 → 2023-08-01開始（空白1ヶ月）→ リセットなし、抵触日=2023-01-01+3年
  const cont = individualLimitDate([A("a", "2023-01-01", "2023-06-30"), A("b", "2023-08-01", null)]);
  eq("no-cooling start", cont?.start, "2023-01-01");
  eq("no-cooling limit", cont?.limit, "2026-01-01");
}

console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILED`);
if (failed) process.exit(1);
