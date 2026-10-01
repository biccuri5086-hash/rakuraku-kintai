import { trialNotice, isTrialStopped } from "../src/lib/billing/trial-notice";

let failed = 0;
function eq(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failed++; console.log(`FAIL ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
  else console.log(`ok   ${name}`);
}

const now = new Date("2026-10-01T00:00:00Z");
const inDays = (d: number) => new Date(now.getTime() + d * 86400000).toISOString();

eq("8日前は出さない", trialNotice("trial", inDays(8), null, false, now).phase, "none");
eq("7日前から出す", trialNotice("trial", inDays(7), null, false, now).phase, "upcoming");
eq("残り日数(切り上げ)", trialNotice("trial", inDays(2.2), null, false, now).daysLeft, 3);
eq("当日(残り数時間)は1日", trialNotice("trial", new Date(now.getTime() + 3600000).toISOString(), null, false, now).daysLeft, 1);
eq("期限切れ", trialNotice("trial", inDays(-1), null, false, now).phase, "expired");
eq("契約中は出さない", trialNotice("trial", inDays(3), null, true, now).phase, "none");
eq("trial以外は出さない", trialNotice("active", inDays(3), null, false, now).phase, "none");
eq("終了日未設定は出さない", trialNotice("trial", null, null, false, now).phase, "none");
eq("不正な日付は出さない", trialNotice("trial", "xx", null, false, now).phase, "none");
eq("選択済みを返す", trialNotice("trial", inDays(3), "stop", false, now).decision, "stop");
eq("不正な選択は無視", trialNotice("trial", inDays(3), "zzz", false, now).decision, null);

eq("stop+期限後は停止", isTrialStopped("trial", inDays(-1), "stop", now), true);
eq("stop+期限前は停止しない", isTrialStopped("trial", inDays(1), "stop", now), false);
eq("continueは停止しない", isTrialStopped("trial", inDays(-1), "continue", now), false);
eq("未選択は停止しない", isTrialStopped("trial", inDays(-1), null, now), false);
eq("active会社は停止しない", isTrialStopped("active", inDays(-1), "stop", now), false);

console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILED`);
if (failed) process.exit(1);
