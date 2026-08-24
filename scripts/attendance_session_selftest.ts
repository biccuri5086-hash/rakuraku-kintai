// 打刻セッション判定の自己テスト。とくに夜勤（日跨ぎ）の退勤が通ることを担保する。
import {
  resolveSessionState,
  canPunch,
  MAX_OPEN_SESSION_HOURS,
  Punch,
} from "../src/lib/attendance-session";

let failed = 0;
function eq(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failed++; console.log(`FAIL ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
  else console.log(`ok   ${name}`);
}
// 降順（新しい順）で渡す
const desc = (...p: Punch[]) => [...p].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
const at = (iso: string) => new Date(iso);

// --- 未打刻 ---
{
  eq("idle: 打刻なし", resolveSessionState([], at("2026-08-13T09:00:00+09:00")).kind, "idle");
  eq("idle: 出勤は可", canPunch("clock_in", { kind: "idle" }).allowed, true);
  eq("idle: 退勤は不可", canPunch("clock_out", { kind: "idle" }).allowed, false);
}

// --- 日勤 ---
{
  const p = desc({ type: "clock_in", timestamp: "2026-08-13T09:00:00+09:00" });
  const s = resolveSessionState(p, at("2026-08-13T12:00:00+09:00"));
  eq("日勤: 勤務中", s.kind, "working");
  eq("日勤: 退勤できる", canPunch("clock_out", s, at("2026-08-13T18:00:00+09:00")).allowed, true);
  eq("日勤: 二重出勤は拒否", canPunch("clock_in", s, at("2026-08-13T12:00:00+09:00")).allowed, false);
}

// --- 夜勤（日跨ぎ）：これが修正前は退勤できなかったケース ---
{
  const p = desc({ type: "clock_in", timestamp: "2026-08-13T22:00:00+09:00" });
  const morning = at("2026-08-14T07:00:00+09:00");
  const s = resolveSessionState(p, morning);
  eq("夜勤: 翌朝も勤務中", s.kind, "working");
  eq("夜勤: 翌朝に退勤できる", canPunch("clock_out", s, morning).allowed, true);
  eq("夜勤: openedAt は前日の出勤", s.kind === "working" ? s.openedAt : null, "2026-08-13T22:00:00+09:00");
}

// --- 夜勤明け：同じ暦日の夜にもう一度出勤できる ---
{
  const p = desc(
    { type: "clock_in", timestamp: "2026-08-13T22:00:00+09:00" },
    { type: "clock_out", timestamp: "2026-08-14T07:00:00+09:00" },
  );
  const tonight = at("2026-08-14T22:00:00+09:00");
  const s = resolveSessionState(p, tonight);
  // 退勤から18h以上経過 → idle（次の勤務に入れる）
  eq("夜勤明け: 夜には未打刻状態", s.kind, "idle");
  eq("夜勤明け: 夜に出勤できる", canPunch("clock_in", s, tonight).allowed, true);
}

// --- 退勤直後の完了表示とクールダウン ---
{
  const p = desc(
    { type: "clock_in", timestamp: "2026-08-13T09:00:00+09:00" },
    { type: "clock_out", timestamp: "2026-08-13T18:00:00+09:00" },
  );
  const justAfter = at("2026-08-13T18:01:00+09:00");
  const s = resolveSessionState(p, justAfter);
  eq("完了: kind", s.kind, "completed");
  eq("完了: 出退勤の組が返る", s.kind === "completed" ? [s.openedAt, s.closedAt] : null,
     ["2026-08-13T09:00:00+09:00", "2026-08-13T18:00:00+09:00"]);
  eq("完了: 直後の再出勤は拒否（誤タップ防止）", canPunch("clock_in", s, justAfter).allowed, false);
  eq("完了: 10分後は再出勤できる", canPunch("clock_in", s, at("2026-08-13T18:10:00+09:00")).allowed, true);
  eq("完了: 二重退勤は拒否", canPunch("clock_out", s, justAfter).allowed, false);
}

// --- 退勤打刻漏れ（24時間以上開きっぱなし） ---
{
  const p = desc({ type: "clock_in", timestamp: "2026-08-13T09:00:00+09:00" });
  const nextDay = at("2026-08-14T10:00:00+09:00"); // 25時間後
  const s = resolveSessionState(p, nextDay);
  eq("打刻漏れ: stale 判定", s.kind, "stale");
  eq("打刻漏れ: 退勤は拒否（管理者確認）", canPunch("clock_out", s, nextDay).allowed, false);
  eq("打刻漏れ: 当日の出勤は妨げない", canPunch("clock_in", s, nextDay).allowed, true);
}

// --- 境界：ちょうど MAX_OPEN_SESSION_HOURS ---
{
  const p = desc({ type: "clock_in", timestamp: "2026-08-13T09:00:00+09:00" });
  const justUnder = at(`2026-08-13T09:00:00+09:00`);
  justUnder.setTime(justUnder.getTime() + (MAX_OPEN_SESSION_HOURS * 3600 - 1) * 1000);
  eq("境界: 24時間直前は勤務中", resolveSessionState(p, justUnder).kind, "working");
  const justOver = new Date(justUnder.getTime() + 2000);
  eq("境界: 24時間経過で stale", resolveSessionState(p, justOver).kind, "stale");
}

console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILED`);
if (failed) process.exit(1);
