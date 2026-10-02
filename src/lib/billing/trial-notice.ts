// トライアル終了の事前通知（純粋関数・フレームワーク非依存）。
// 終了7日前から「続ける／やめる」を選べる表示を出す。判定をここ1箇所に集約し、
// 画面・API・tenant-context(利用停止判定)から同じ関数を呼ぶ。

export const NOTICE_DAYS = 7;
// 終了日を過ぎても使える猶予日数。この間に有料プランを選べば止まらない。
export const GRACE_DAYS = 7;
const DAY_MS = 86_400_000;

export type TrialDecision = "continue" | "stop";
export type TrialPhase = "none" | "upcoming" | "expired";

export interface TrialNotice {
  phase: TrialPhase;
  daysLeft: number | null; // 終了まで残り日数（切り上げ）。expired は 0
  graceDaysLeft: number | null; // expired のとき、自動停止までの残り日数（切り上げ）
  endsAt: string | null; // ISO
  decision: TrialDecision | null;
}

export function isTrialDecision(v: unknown): v is TrialDecision {
  return v === "continue" || v === "stop";
}

// companyStatus: companies.status、paidPlanActive: company_subscription が有料プランで契約中か。
export function trialNotice(
  companyStatus: string | null | undefined,
  trialEndsAt: string | null | undefined,
  decision: unknown,
  paidPlanActive: boolean,
  now: Date = new Date()
): TrialNotice {
  const dec = isTrialDecision(decision) ? decision : null;
  const none: TrialNotice = { phase: "none", daysLeft: null, graceDaysLeft: null, endsAt: trialEndsAt ?? null, decision: dec };
  if (companyStatus !== "trial" || !trialEndsAt || paidPlanActive) return none;
  const end = Date.parse(trialEndsAt);
  if (Number.isNaN(end)) return none;
  const diff = end - now.getTime();
  if (diff <= 0) {
    const graceDaysLeft = Math.max(0, Math.ceil((end + GRACE_DAYS * DAY_MS - now.getTime()) / DAY_MS));
    return { phase: "expired", daysLeft: 0, graceDaysLeft, endsAt: trialEndsAt, decision: dec };
  }
  const daysLeft = Math.ceil(diff / DAY_MS);
  if (daysLeft > NOTICE_DAYS) return none;
  return { phase: "upcoming", daysLeft, graceDaysLeft: null, endsAt: trialEndsAt, decision: dec };
}

// トライアル終了後の自動停止。
//  - 「やめる」を選んだ会社：終了日を過ぎたら停止
//  - 選択なし／「続ける」だけで有料プランに未契約の会社：終了日から猶予 GRACE_DAYS 日後に停止
//  - 有料プラン契約済み（paidPlanActive）の会社は止めない
export function isTrialLapsed(
  companyStatus: string | null | undefined,
  trialEndsAt: string | null | undefined,
  decision: unknown,
  paidPlanActive: boolean,
  now: Date = new Date()
): boolean {
  if (companyStatus !== "trial" || !trialEndsAt || paidPlanActive) return false;
  const end = Date.parse(trialEndsAt);
  if (Number.isNaN(end)) return false;
  const stopAt = decision === "stop" ? end : end + GRACE_DAYS * DAY_MS;
  return stopAt <= now.getTime();
}
