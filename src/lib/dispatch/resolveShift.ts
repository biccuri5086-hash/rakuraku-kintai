// 打刻(clock_in)時に「どの契約・現場の勤務か」を解決する純粋関数。
// 設計書：らくらく勤怠/specs/ARCH_商用インフラ設計_v1.md 3-4章
//
// 方針：黙って推測しない。シフト表と1対1に決まるときだけ shift_match。
// シフトが無くても契約が1件しかなければ manual（単発派遣など）。
// 同日に複数のシフト/契約が重なる場合は unresolved とし、管理者が後から確認できるようにする
// （attendance.resolved_by / client_id を見れば「要確認」の日が分かる）。

export interface ShiftCandidate {
  id: string;
  assignmentId: string;
  /** YYYY-MM-DD */
  workDate: string;
}

export interface AssignmentLite {
  id: string;
  clientId: string | null;
}

export type ResolvedBy = "shift_match" | "manual" | "unresolved";

export interface ShiftResolution {
  shiftId: string | null;
  assignmentId: string | null;
  clientId: string | null;
  resolvedBy: ResolvedBy;
}

/**
 * candidateDates（通常は当日・前日のJST日付。夜勤の日跨ぎを拾うため）に一致するシフトを
 * 探し、1件だけならそれを採用する。シフトが無くても有効な契約が1件だけならそれを採用する。
 */
export function resolveClockInShift(
  candidateDates: string[],
  shifts: ShiftCandidate[],
  assignments: AssignmentLite[]
): ShiftResolution {
  const matchingShifts = shifts.filter((s) => candidateDates.includes(s.workDate));

  if (matchingShifts.length === 1) {
    const sh = matchingShifts[0];
    const a = assignments.find((x) => x.id === sh.assignmentId);
    return { shiftId: sh.id, assignmentId: sh.assignmentId, clientId: a?.clientId ?? null, resolvedBy: "shift_match" };
  }

  if (matchingShifts.length === 0 && assignments.length === 1) {
    const a = assignments[0];
    return { shiftId: null, assignmentId: a.id, clientId: a.clientId, resolvedBy: "manual" };
  }

  return { shiftId: null, assignmentId: null, clientId: null, resolvedBy: "unresolved" };
}
