// pay_rules 管理画面のバリデーション・継承チェーンの自己テスト。

import { validatePayRuleDraft, computeRateChange } from "../src/lib/payroll/payRuleValidation";
import { resolvePayRuleChain, PayRuleRow } from "../src/lib/payroll/payRules";

let failed = 0;
function eq(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failed++; console.log(`FAIL ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
  else console.log(`ok   ${name}`);
}

const baseDraft = {
  scope: "assignment" as const,
  clientId: null,
  assignmentId: "a1",
  effectiveFrom: "2026-10-01",
  baseHourlyRate: 1300,
  overtimeRate: 1.25,
  overtime60Rate: 1.5,
  nightRate: 1.25,
  holidayRate: 1.35,
};
const TODAY = "2026-09-15";

// --- 正常系 ---
eq("valid draft", validatePayRuleDraft(baseDraft, TODAY), { ok: true });

// --- スコープ整合 ---
eq("assignment scope without id", validatePayRuleDraft({ ...baseDraft, assignmentId: null }, TODAY).ok, false);
eq("client scope without id", validatePayRuleDraft({ ...baseDraft, scope: "client", clientId: null }, TODAY).ok, false);
eq("company scope with clientId set", validatePayRuleDraft({ ...baseDraft, scope: "company", assignmentId: null, clientId: "c1" }, TODAY).ok, false);

// --- 過去日付は拒否 ---
eq("past effectiveFrom rejected", validatePayRuleDraft({ ...baseDraft, effectiveFrom: "2026-01-01" }, TODAY).ok, false);
eq("today is allowed", validatePayRuleDraft({ ...baseDraft, effectiveFrom: TODAY }, TODAY).ok, true);

// --- 時給レンジ ---
eq("hourly rate too low", validatePayRuleDraft({ ...baseDraft, baseHourlyRate: 50 }, TODAY).ok, false);
eq("hourly rate too high", validatePayRuleDraft({ ...baseDraft, baseHourlyRate: 200000 }, TODAY).ok, false);
eq("hourly rate null (overtimeルールのみ変更) is ok", validatePayRuleDraft({ ...baseDraft, baseHourlyRate: null }, TODAY).ok, true);

// --- 割増率レンジ ---
eq("overtimeRate too low", validatePayRuleDraft({ ...baseDraft, overtimeRate: 0.5 }, TODAY).ok, false);
eq("overtimeRate too high", validatePayRuleDraft({ ...baseDraft, overtimeRate: 5 }, TODAY).ok, false);

// --- 変動幅チェック ---
eq("no change -> no confirmation", computeRateChange(1200, 1200).needsConfirmation, false);
eq("+10% -> no confirmation", computeRateChange(1200, 1320).needsConfirmation, false);
eq("+53.8% -> needs confirmation", computeRateChange(1300, 2000).needsConfirmation, true);
eq("-50% exactly -> needs confirmation", computeRateChange(2000, 1000).needsConfirmation, true);
eq("first-time (null current) -> no confirmation", computeRateChange(null, 1500).needsConfirmation, false);

// --- 継承チェーン ---
{
  const rules: PayRuleRow[] = [
    { id: "r-company", companyId: "co1", scope: "company", clientId: null, assignmentId: null, effectiveFrom: "2020-01-01", effectiveTo: null, baseHourlyRate: 1000, overtimeRate: 1.25, overtime60Rate: 1.5, nightRate: 1.25, holidayRate: 1.35 },
    { id: "r-client", companyId: "co1", scope: "client", clientId: "c1", assignmentId: null, effectiveFrom: "2020-01-01", effectiveTo: null, baseHourlyRate: 1200, overtimeRate: 1.25, overtime60Rate: 1.5, nightRate: 1.25, holidayRate: 1.35 },
    { id: "r-assignment", companyId: "co1", scope: "assignment", clientId: null, assignmentId: "a1", effectiveFrom: "2026-09-16", effectiveTo: null, baseHourlyRate: 1300, overtimeRate: 1.25, overtime60Rate: 1.5, nightRate: 1.25, holidayRate: 1.35 },
  ];
  const target = { companyId: "co1", clientId: "c1", assignmentId: "a1" };

  const chainAfter = resolvePayRuleChain("2026-09-20", target, rules);
  eq("chain has 3 links", chainAfter.length, 3);
  eq("assignment wins after its start", chainAfter.find((l) => l.scope === "assignment")?.isWinner, true);
  eq("client not winner (assignment overrides)", chainAfter.find((l) => l.scope === "client")?.isWinner, false);
  eq("company link still shown (not winner)", chainAfter.find((l) => l.scope === "company")?.rule?.id, "r-company");

  // 契約ルールがまだ始まっていない日付では、派遣先ルールが勝つ
  const chainBefore = resolvePayRuleChain("2026-09-01", target, rules);
  eq("client wins before assignment rule starts", chainBefore.find((l) => l.scope === "client")?.isWinner, true);
  eq("assignment shows no rule yet (not started)", chainBefore.find((l) => l.scope === "assignment")?.rule, null);
}

if (failed > 0) {
  console.log(`\n${failed} 件失敗`);
  process.exit(1);
} else {
  console.log("\n全テスト成功");
}
