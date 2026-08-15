// 派遣先向け勤怠報告の集計（純粋関数）。
// 打刻イベントを時系列でペアリングし、各セッションを clock_in の assignment_id 経由で派遣先(client)に紐づけ、
// 派遣先 → スタッフ → { 就業日数, 就業時間(拘束) } に集計する。
// ※ 派遣先報告は「その現場で誰が・いつ・何時間働いたか」が目的なので拘束(gross)ベースで出す（休憩控除前）。

import { jstDateOf } from "./time";

export interface ClientPunch {
  user_id: string;
  user_name: string | null;
  type: string; // clock_in / clock_out
  timestamp: string;
  assignment_id: string | null;
}

export interface ClientReportStaff {
  user_id: string;
  staff_name: string;
  days: number;
  grossMin: number;
}

export interface ClientReportRow {
  client_id: string | null;
  client_name: string;
  staff: ClientReportStaff[];
  totalDays: number;
  totalGrossMin: number;
}

const UNASSIGNED = "__unassigned__";

export function aggregateClientReport(
  punches: ClientPunch[],
  assignmentToClient: Map<string, { clientId: string; clientName: string }>
): ClientReportRow[] {
  // スタッフごとに時系列でセッション化（clock_in の assignment_id を保持）
  const byUser = new Map<string, ClientPunch[]>();
  for (const p of punches) {
    const arr = byUser.get(p.user_id);
    if (arr) arr.push(p);
    else byUser.set(p.user_id, [p]);
  }

  // client(またはUNASSIGNED) → staffKey → { name, daysSet, grossMin }
  type StaffAgg = { name: string; days: Set<string>; grossMin: number };
  const clients = new Map<string, { name: string; clientId: string | null; staff: Map<string, StaffAgg> }>();

  const ensureClient = (key: string, name: string, clientId: string | null) => {
    let c = clients.get(key);
    if (!c) {
      c = { name, clientId, staff: new Map() };
      clients.set(key, c);
    }
    return c;
  };

  for (const [user_id, list] of byUser) {
    const sorted = [...list].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const name = sorted.find((p) => p.user_name)?.user_name || user_id;
    let pending: ClientPunch | null = null;
    for (const p of sorted) {
      if (p.type === "clock_in") {
        pending = p;
      } else if (p.type === "clock_out") {
        if (pending && p.timestamp > pending.timestamp) {
          const gross = Math.round((new Date(p.timestamp).getTime() - new Date(pending.timestamp).getTime()) / 60000);
          const date = jstDateOf(pending.timestamp);
          const mapped = pending.assignment_id ? assignmentToClient.get(pending.assignment_id) : undefined;
          const key = mapped ? mapped.clientId : UNASSIGNED;
          const c = ensureClient(key, mapped ? mapped.clientName : "（契約未割当）", mapped ? mapped.clientId : null);
          let s = c.staff.get(user_id);
          if (!s) {
            s = { name, days: new Set(), grossMin: 0 };
            c.staff.set(user_id, s);
          }
          s.days.add(date);
          s.grossMin += gross;
        }
        pending = null;
      }
    }
  }

  const rows: ClientReportRow[] = [];
  for (const c of clients.values()) {
    const staff: ClientReportStaff[] = [...c.staff.entries()]
      .map(([user_id, s]) => ({ user_id, staff_name: s.name, days: s.days.size, grossMin: s.grossMin }))
      .sort((a, b) => a.staff_name.localeCompare(b.staff_name, "ja"));
    rows.push({
      client_id: c.clientId,
      client_name: c.name,
      staff,
      totalDays: staff.reduce((a, s) => a + s.days, 0),
      totalGrossMin: staff.reduce((a, s) => a + s.grossMin, 0),
    });
  }
  // 未割当を最後に、それ以外は派遣先名順
  rows.sort((a, b) => {
    if (a.client_id === null) return 1;
    if (b.client_id === null) return -1;
    return a.client_name.localeCompare(b.client_name, "ja");
  });
  return rows;
}
