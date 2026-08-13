const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

export function jstToday(): string {
  const now = new Date();
  const jst = new Date(now.getTime() + JST_OFFSET_MS);
  return jst.toISOString().split("T")[0];
}

export function jstDayBounds(date: string): { start: string; end: string } {
  return {
    start: `${date}T00:00:00+09:00`,
    end: `${date}T23:59:59.999+09:00`,
  };
}

// "YYYY-MM" → その月のJST開始（当月1日00:00）と終了（翌月1日00:00）のISO境界
export function jstMonthBounds(month: string): { start: string; end: string } {
  const [y, m] = month.split("-").map(Number);
  const start = `${month}-01T00:00:00+09:00`;
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  const end = `${ny}-${String(nm).padStart(2, "0")}-01T00:00:00+09:00`;
  return { start, end };
}

// ISOタイムスタンプ → JSTでの日付文字列（"YYYY-MM-DD"）
export function jstDateOf(ts: string): string {
  const jst = new Date(new Date(ts).getTime() + JST_OFFSET_MS);
  return jst.toISOString().split("T")[0];
}

// 現在のJST月（"YYYY-MM"）
export function jstThisMonth(): string {
  return jstToday().slice(0, 7);
}
