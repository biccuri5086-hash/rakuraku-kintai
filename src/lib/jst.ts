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
