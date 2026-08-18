// 有給残高ロジックの自己テスト（純粋関数の数値検証）。
// 実行：tsc -p tsconfig.test.json && node .test-build/scripts/paid_leave_selftest.js
import { activeGrantedDays, takenDays, remainingDays, nextExpiry } from "../src/lib/paid-leave/balance";
import type { LeaveGrant, LeaveTaking } from "../src/lib/paid-leave/balance";

let failed = 0;
function eq(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failed++; console.log(`FAIL ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
  else console.log(`ok   ${name}`);
}

const TODAY = "2026-08-19";
const G = (granted_days: number, expires_on: string): LeaveGrant => ({ granted_days, expires_on });
const T = (days: number): LeaveTaking => ({ days });

// 基本：10日付与・1日取得 → 残9
{
  const g = [G(10, "2028-08-19")];
  const t = [T(1)];
  eq("basic active", activeGrantedDays(g, TODAY), 10);
  eq("basic taken", takenDays(t), 1);
  eq("basic remaining", remainingDays(g, t, TODAY), 9);
}

// 半休：0.5+0.5 の取得 → 取得計1.0、残9
{
  const g = [G(10, "2028-08-19")];
  const t = [T(0.5), T(0.5)];
  eq("half taken total", takenDays(t), 1);
  eq("half remaining", remainingDays(g, t, TODAY), 9);
}

// 半休が残に反映：10付与・0.5取得 → 残9.5
{
  eq("half remaining 9.5", remainingDays([G(10, "2028-08-19")], [T(0.5)], TODAY), 9.5);
}

// 失効：失効済み付与は有効付与から除外（残はマイナスもあり得る）
{
  const g = [G(10, "2025-08-18")]; // 昨年失効
  const t = [T(2)];
  eq("expired active=0", activeGrantedDays(g, TODAY), 0);
  eq("expired remaining=-2", remainingDays(g, t, TODAY), -2);
}

// 失効境界：expires_on === today は「有効」（>= today）
{
  eq("expiry boundary today = active", activeGrantedDays([G(5, TODAY)], TODAY), 5);
  eq("expiry boundary yesterday = inactive", activeGrantedDays([G(5, "2026-08-18")], TODAY), 0);
}

// 複数付与：有効2件の合計から取得を引く
{
  const g = [G(10, "2028-01-01"), G(5, "2027-06-30"), G(3, "2025-01-01") /*失効*/];
  const t = [T(1), T(0.5)];
  eq("multi active", activeGrantedDays(g, TODAY), 15);
  eq("multi remaining", remainingDays(g, t, TODAY), 13.5);
  eq("multi nextExpiry", nextExpiry(g, TODAY), "2027-06-30"); // 有効なうち最も早い
}

// 付与なし
{
  eq("empty remaining", remainingDays([], [], TODAY), 0);
  eq("empty nextExpiry", nextExpiry([], TODAY), null);
}

console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILED`);
if (failed) process.exit(1);
