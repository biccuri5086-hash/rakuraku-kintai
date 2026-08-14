// JST（+9h）の時刻ユーティリティ。既存 src/lib/jst.ts と同じ +9h 方針で、集計に必要な最小限を自前実装。
// 純粋関数のみ（副作用・外部依存なし）。

const JST_OFFSET_MIN = 9 * 60;

// ISOタイムスタンプ → JSTの日付 "YYYY-MM-DD"
export function jstDateOf(ts: string): string {
  return new Date(new Date(ts).getTime() + JST_OFFSET_MIN * 60000).toISOString().slice(0, 10);
}

// "YYYY-MM-DD" の曜日（0=日..6=土）。カレンダー日付なのでUTC正午基準で安定して求める。
export function jstDowOfDate(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

// JSTの「エポックからの分」
function jstEpochMin(ts: string): number {
  return Math.floor((new Date(ts).getTime() + JST_OFFSET_MIN * 60000) / 60000);
}

// 勤務区間 [inTs, outTs] のうち深夜帯(22:00–翌05:00 JST)に重なる分数
export function nightMinutes(inTs: string, outTs: string): number {
  const s = jstEpochMin(inTs);
  const e = jstEpochMin(outTs);
  if (e <= s) return 0;
  let total = 0;
  const startDay = Math.floor(s / 1440) - 1;
  const endDay = Math.floor(e / 1440) + 1;
  for (let k = startDay; k <= endDay; k++) {
    const ns = k * 1440 + 22 * 60; // 22:00
    const ne = k * 1440 + 29 * 60; // 翌05:00
    total += Math.max(0, Math.min(e, ne) - Math.max(s, ns));
  }
  return total;
}

// "YYYY-MM-DD" に n 日加算（JSTカレンダー）
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// date が属する「週の起算日」（weekStart 曜日以前で直近）の "YYYY-MM-DD"
export function weekKey(date: string, weekStart: number): string {
  const dow = jstDowOfDate(date);
  const diff = (dow - weekStart + 7) % 7;
  return addDays(date, -diff);
}
