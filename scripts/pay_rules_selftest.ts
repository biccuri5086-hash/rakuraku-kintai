// pay_rules 解決ロジックの自己テスト（純粋関数の検証）。
// 実行方法は payroll_selftest.ts と同様（package.json の test スクリプト経由）。

import { resolvePayRule, PayRuleRow } from "../src/lib/payroll/payRules";

let failed = 0;
function eq(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failed++; console.log(`FAIL ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
  else console.log(`ok   ${name}`);
}

const COMPANY = "company-1";
const CLIENT_A = "client-a";
const CLIENT_B = "client-b";
const ASSIGN_A = "assign-a"; // COMPANY所属・CLIENT_A
const ASSIGN_B = "assign-b"; // COMPANY所属・CLIENT_B

function rule(partial: Partial<PayRuleRow> & { id: string }): PayRuleRow {
  return {
    companyId: COMPANY,
    scope: "company",
    clientId: null,
    assignmentId: null,
    effectiveFrom: "2020-01-01",
    effectiveTo: null,
    baseHourlyRate: null,
    overtimeRate: 1.25,
    overtime60Rate: 1.5,
    nightRate: 1.25,
    holidayRate: 1.35,
    ...partial,
  };
}

// --- 単一会社ルールのみ ---
{
  const rules = [rule({ id: "company-default", overtimeRate: 1.25 })];
  const r = resolvePayRule("2026-06-01", { companyId: COMPANY, clientId: CLIENT_A, assignmentId: ASSIGN_A }, rules);
  eq("company-only fallback", r?.id, "company-default");
}

// --- 掛け持ち：assignment スコープが優先される（本題のバグ修正の核） ---
{
  const rules = [
    rule({ id: "company-default", baseHourlyRate: 1000 }),
    rule({ id: "assign-a-rate", scope: "assignment", assignmentId: ASSIGN_A, baseHourlyRate: 1200 }),
    rule({ id: "assign-b-rate", scope: "assignment", assignmentId: ASSIGN_B, baseHourlyRate: 1500 }),
  ];
  const forA = resolvePayRule("2026-06-01", { companyId: COMPANY, clientId: CLIENT_A, assignmentId: ASSIGN_A }, rules);
  const forB = resolvePayRule("2026-06-01", { companyId: COMPANY, clientId: CLIENT_B, assignmentId: ASSIGN_B }, rules);
  eq("dual-assignment A picks own rate", forA?.baseHourlyRate, 1200);
  eq("dual-assignment B picks own rate", forB?.baseHourlyRate, 1500);
}

// --- client スコープは assignment より弱いが company より強い ---
{
  const rules = [
    rule({ id: "company-default", overtimeRate: 1.25 }),
    rule({ id: "client-a-rule", scope: "client", clientId: CLIENT_A, overtimeRate: 1.30 }),
  ];
  const r = resolvePayRule("2026-06-01", { companyId: COMPANY, clientId: CLIENT_A, assignmentId: ASSIGN_A }, rules);
  eq("client overrides company", r?.id, "client-a-rule");
}

// --- 有効期間の版管理：改定前後で正しいルールが選ばれる ---
{
  const rules = [
    rule({ id: "assign-a-old", scope: "assignment", assignmentId: ASSIGN_A, effectiveFrom: "2026-01-01", effectiveTo: "2026-06-01", baseHourlyRate: 1200 }),
    rule({ id: "assign-a-new", scope: "assignment", assignmentId: ASSIGN_A, effectiveFrom: "2026-06-01", effectiveTo: null, baseHourlyRate: 1300 }),
  ];
  const before = resolvePayRule("2026-05-31", { companyId: COMPANY, clientId: CLIENT_A, assignmentId: ASSIGN_A }, rules);
  const after = resolvePayRule("2026-06-01", { companyId: COMPANY, clientId: CLIENT_A, assignmentId: ASSIGN_A }, rules);
  eq("before rate change", before?.baseHourlyRate, 1200);
  eq("on/after rate change", after?.baseHourlyRate, 1300);
}

// --- 確定済みの過去分は改定後も再計算しない（＝呼び出し側が過去日付を渡せば旧ルールのまま） ---
{
  const rules = [
    rule({ id: "assign-a-old", scope: "assignment", assignmentId: ASSIGN_A, effectiveFrom: "2026-01-01", effectiveTo: "2026-06-01", baseHourlyRate: 1200 }),
    rule({ id: "assign-a-new", scope: "assignment", assignmentId: ASSIGN_A, effectiveFrom: "2026-06-01", effectiveTo: null, baseHourlyRate: 1300 }),
  ];
  const past = resolvePayRule("2026-03-15", { companyId: COMPANY, clientId: CLIENT_A, assignmentId: ASSIGN_A }, rules);
  eq("past confirmed period keeps old rate", past?.baseHourlyRate, 1200);
}

// --- 該当ルールが無い ---
{
  const r = resolvePayRule("2026-06-01", { companyId: COMPANY, clientId: null, assignmentId: null }, []);
  eq("no rule -> null", r, null);
}

// --- 他社のルールは絶対に混ざらない ---
{
  const rules = [rule({ id: "other-company", companyId: "company-2", baseHourlyRate: 9999 })];
  const r = resolvePayRule("2026-06-01", { companyId: COMPANY, clientId: null, assignmentId: null }, rules);
  eq("cross-company isolation", r, null);
}

if (failed > 0) {
  console.log(`\n${failed} 件失敗`);
  process.exit(1);
} else {
  console.log("\n全テスト成功");
}
