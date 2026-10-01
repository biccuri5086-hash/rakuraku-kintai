// トライアル終了の事前通知（純粋関数・フレームワーク非依存）。
// 終了7日前から「続ける／やめる」を選べる表示を出す。判定をここ1箇所に集約し、
// 画面・API・tenant-context(利用停止判定)から同じ関数を呼ぶ。

export const NOTICE_DAYS = 7;
const DAY_MS = 86_400_000;

export type TrialDecision = "continue" | "stop";
export type TrialPhase = "none" | "upcoming" | "expired";

export interface TrialNotice {
  phase: TrialPhase;
  daysLeft: number | null; // 終了まで残り日数（切り上げ）。expired は 0
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
  const none: TrialNotice = { phase: "none", daysLeft: null, endsAt: trialEndsAt ?? null, decision: dec };
  if (companyStatus !== "trial" || !trialEndsAt || paidPlanActive) return none;
  const end = Date.parse(trialEndsAt);
  if (Number.isNaN(end)) return none;
  const diff = end - now.getTime();
  if (diff <= 0) return { phase: "expired", daysLeft: 0, endsAt: trialEndsAt, decision: dec };
  const daysLeft = Math.ceil(diff / DAY_MS);
  if (daysLeft > NOTICE_DAYS) return none;
  return { phase: "upcoming", daysLeft, endsAt: trialEndsAt, decision: dec };
}

// 「やめる」を選んだ会社は、トライアル終了日を過ぎたら利用停止にする。
// 選択しなかった会社・「続ける」を選んだ会社は止めない（誤って顧客を止めないため）。
export function isTrialStopped(
  companyStatus: string | null | undefined,
  trialEndsAt: string | null | undefined,
  decision: unknown,
  now: Date = new Date()
): boolean {
  if (companyStatus !== "trial" || decision !== "stop" || !trialEndsAt) return false;
  const end = Date.parse(trialEndsAt);
  return !Number.isNaN(end) && end <= now.getTime();
}
