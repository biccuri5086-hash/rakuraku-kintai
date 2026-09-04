// pay_rules 管理画面のAPI（effective/preview/schedule）が共有するDB読み取りヘルパー。
// 純粋関数ではなく Supabase に依存するため payRules.ts とは分けている。

import type { SupabaseClient } from "@supabase/supabase-js";
import { rowToPayRule, resolvePayRuleChain, PayRuleChainLink } from "./payRules";

export type EffectiveRateResult = {
  assignment: { id: string; clientId: string | null; hourlyRate: number | null };
  chain: PayRuleChainLink[];
  resolvedHourlyRate: number | null;
};

/**
 * 指定した契約(assignment)について、指定日時点で実際に効いているルール（継承チェーン）を求める。
 * assignments.hourly_rate へのフォールバックも含めた最終的な時給を resolvedHourlyRate に返す。
 * 契約が見つからない/他社のものであれば null を返す。
 */
export async function resolveEffectiveForAssignment(
  supabase: SupabaseClient,
  companyId: string,
  assignmentId: string,
  date: string
): Promise<EffectiveRateResult | null> {
  const { data: assignment, error: aErr } = await supabase
    .from("assignments")
    .select("id, client_id, hourly_rate")
    .eq("company_id", companyId)
    .eq("id", assignmentId)
    .maybeSingle();
  if (aErr) throw aErr;
  if (!assignment) return null;

  const { data: ruleRows, error: rErr } = await supabase
    .from("pay_rules")
    .select("*")
    .eq("company_id", companyId)
    .or(`assignment_id.eq.${assignmentId},client_id.eq.${assignment.client_id},scope.eq.company`);
  if (rErr) throw rErr;

  const rules = (ruleRows ?? []).map(rowToPayRule);
  const target = { companyId, clientId: assignment.client_id as string | null, assignmentId };
  const chain = resolvePayRuleChain(date, target, rules);
  const winner = chain.find((l) => l.isWinner)?.rule ?? null;
  const fallback = assignment.hourly_rate != null ? Number(assignment.hourly_rate) : null;

  return {
    assignment: { id: assignment.id as string, clientId: assignment.client_id as string | null, hourlyRate: fallback },
    chain,
    resolvedHourlyRate: winner?.baseHourlyRate ?? fallback,
  };
}
