// 打刻時の現場紐付け(resolveClockInShift)の自己テスト。

import { resolveClockInShift, ShiftCandidate, AssignmentLite } from "../src/lib/dispatch/resolveShift";

let failed = 0;
function eq(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failed++; console.log(`FAIL ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
  else console.log(`ok   ${name}`);
}

const TODAY = "2026-09-10";
const YESTERDAY = "2026-09-09";

// シフトが1件だけ一致 → shift_match
{
  const shifts: ShiftCandidate[] = [{ id: "sh1", assignmentId: "a1", workDate: TODAY }];
  const assignments: AssignmentLite[] = [{ id: "a1", clientId: "c1" }, { id: "a2", clientId: "c2" }];
  const r = resolveClockInShift([YESTERDAY, TODAY], shifts, assignments);
  eq("single shift match", r, { shiftId: "sh1", assignmentId: "a1", clientId: "c1", resolvedBy: "shift_match" });
}

// 夜勤：前日のシフトを拾う
{
  const shifts: ShiftCandidate[] = [{ id: "sh1", assignmentId: "a1", workDate: YESTERDAY }];
  const assignments: AssignmentLite[] = [{ id: "a1", clientId: "c1" }];
  const r = resolveClockInShift([YESTERDAY, TODAY], shifts, assignments);
  eq("night shift picks yesterday", r.shiftId, "sh1");
}

// シフト表が無いが契約が1件だけ → manual
{
  const r = resolveClockInShift([YESTERDAY, TODAY], [], [{ id: "a1", clientId: "c1" }]);
  eq("single assignment fallback", r, { shiftId: null, assignmentId: "a1", clientId: "c1", resolvedBy: "manual" });
}

// 同日に複数シフトが重なる（直行直帰の掛け持ち）→ 黙って選ばず unresolved
{
  const shifts: ShiftCandidate[] = [
    { id: "sh1", assignmentId: "a1", workDate: TODAY },
    { id: "sh2", assignmentId: "a2", workDate: TODAY },
  ];
  const assignments: AssignmentLite[] = [{ id: "a1", clientId: "c1" }, { id: "a2", clientId: "c2" }];
  const r = resolveClockInShift([YESTERDAY, TODAY], shifts, assignments);
  eq("ambiguous same-day shifts -> unresolved", r.resolvedBy, "unresolved");
}

// 契約もシフトも無い（招待コードのみで即打刻等）→ unresolved
{
  const r = resolveClockInShift([YESTERDAY, TODAY], [], []);
  eq("no data -> unresolved", r.resolvedBy, "unresolved");
}

// 契約が複数あり、シフト表も無い → 黙って選ばず unresolved
{
  const r = resolveClockInShift([YESTERDAY, TODAY], [], [{ id: "a1", clientId: "c1" }, { id: "a2", clientId: "c2" }]);
  eq("multiple assignments without shift -> unresolved", r.resolvedBy, "unresolved");
}

if (failed > 0) {
  console.log(`\n${failed} 件失敗`);
  process.exit(1);
} else {
  console.log("\n全テスト成功");
}
