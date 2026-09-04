// jst.ts の月境界計算の自己テスト（月末・閏年をまたぐ集計期間の切り出しミスを防ぐ）。

import { jstMonthBounds } from "../src/lib/jst";

let failed = 0;
function eq(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failed++; console.log(`FAIL ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
  else console.log(`ok   ${name}`);
}

// 平年2月：28日までで翌月(3/1)に切り替わる
eq("2023-02 (平年) end", jstMonthBounds("2023-02").end, "2023-03-01T00:00:00+09:00");

// 閏年2月：29日まであるが、境界の切り出し自体は「翌月1日」で変わらない
// （集計側は attendance.timestamp < end で絞るだけなので、29日の打刻も正しく含まれる）
eq("2024-02 (閏年) end", jstMonthBounds("2024-02").end, "2024-03-01T00:00:00+09:00");
eq("2024-02 (閏年) start", jstMonthBounds("2024-02").start, "2024-02-01T00:00:00+09:00");

// 年またぎ：12月→翌年1月
eq("2024-12 end rolls to next year", jstMonthBounds("2024-12").end, "2025-01-01T00:00:00+09:00");
eq("2024-12 start", jstMonthBounds("2024-12").start, "2024-12-01T00:00:00+09:00");

// 1月→前年12月ではなく同年内の2月に正しく進む（year跨ぎと隣接しての回帰防止）
eq("2025-01 end", jstMonthBounds("2025-01").end, "2025-02-01T00:00:00+09:00");

if (failed > 0) {
  console.log(`\n${failed} 件失敗`);
  process.exit(1);
} else {
  console.log("\n全テスト成功");
}
