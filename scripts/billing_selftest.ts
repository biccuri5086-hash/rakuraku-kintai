// Phase D 課金ロジックの自己テスト。
import { estimateMonthly, getPlan, isPlanId, rowToSubscription, statusForPlan } from "../src/lib/billing/plans";

let failed = 0;
function eq(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failed++; console.log(`FAIL ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
  else console.log(`ok   ${name}`);
}

eq("starter 50名", estimateMonthly("starter", 50), 7500);
eq("standard 100名", estimateMonthly("standard", 100), 20000);
eq("enterprise = 見積(null)", estimateMonthly("enterprise", 100), null);
eq("free = 0", estimateMonthly("free", 30), 0);
eq("getPlan standard name", getPlan("standard").name, "スタンダードプラン");
eq("isPlanId ok", isPlanId("starter"), true);
eq("isPlanId ng", isPlanId("gold"), false);
eq("statusForPlan free", statusForPlan("free"), "free");
eq("statusForPlan standard", statusForPlan("standard"), "active");
eq("rowToSubscription fallback", rowToSubscription({}).plan, "trial");
eq("rowToSubscription active", rowToSubscription({ plan: "standard", status: "active" }).status, "active");

console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILED`);
if (failed) process.exit(1);
