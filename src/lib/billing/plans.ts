// Phase D 課金：プラン定義と概算（純粋・フレームワーク非依存）。
// 料金は らくらく勤怠/sales/02_料金プラン.md に準拠（スタッフ数×単価・30日トライアル）。
// ※ 決済（Stripe等）は本フェーズ対象外。プラン管理・概算・上限判定まで。

export type PlanId = "trial" | "free" | "starter" | "standard" | "enterprise";
export type SubStatus = "trial" | "active" | "free";

export interface Plan {
  id: PlanId;
  name: string;
  unitPrice: number | null; // 1スタッフあたり月額（円）。null=要見積 or 無料
  maxStaff: number | null; // 上限（null=無制限）
  features: string[];
  note?: string;
}

export const PLANS: Plan[] = [
  {
    id: "trial", name: "無料トライアル", unitPrice: 0, maxStaff: null,
    features: ["全機能", "スタッフ数無制限", "30日間"],
    note: "契約・カード登録不要。期間終了後は無料プラン（打刻のみ）へ移行。",
  },
  {
    id: "free", name: "無料プラン", unitPrice: 0, maxStaff: null,
    features: ["1タップ打刻", "GPS打刻記録"],
    note: "トライアル終了後の既定。打刻機能のみ継続。",
  },
  {
    id: "starter", name: "スタータープラン", unitPrice: 150, maxStaff: null,
    features: ["1タップ打刻", "コンディション報告", "管理ダッシュボード", "GPS打刻", "メールサポート"],
  },
  {
    id: "standard", name: "スタンダードプラン", unitPrice: 200, maxStaff: null,
    features: ["スターターの全機能", "コンディションアラート通知", "月次レポート/CSV", "複数現場・部署管理", "チャットサポート"],
    note: "推奨。初期費用0円。",
  },
  {
    id: "enterprise", name: "エンタープライズプラン", unitPrice: null, maxStaff: null,
    features: ["全機能", "AI離職リスクスコア（開発予定）", "既存システム連携", "専任サポート", "訪問導入"],
    note: "要お見積り（目安：100名以上）。",
  },
];

export function getPlan(id: PlanId): Plan {
  return PLANS.find((p) => p.id === id) ?? PLANS[0];
}

export function isPlanId(v: unknown): v is PlanId {
  return typeof v === "string" && PLANS.some((p) => p.id === v);
}

// 月額概算（unitPrice が数値なら staff×単価、null なら見積扱いで null）
export function estimateMonthly(planId: PlanId, staffCount: number): number | null {
  const p = getPlan(planId);
  if (p.unitPrice == null) return null;
  return p.unitPrice * Math.max(0, staffCount);
}

export interface Subscription {
  plan: PlanId;
  status: SubStatus;
  trialEndsOn: string | null;
  startedAt: string | null;
}

export const DEFAULT_SUBSCRIPTION: Subscription = {
  plan: "trial",
  status: "trial",
  trialEndsOn: null,
  startedAt: null,
};

export function rowToSubscription(row: Record<string, unknown>): Subscription {
  const plan = isPlanId(row.plan) ? row.plan : "trial";
  const status: SubStatus = row.status === "active" ? "active" : row.status === "free" ? "free" : "trial";
  return {
    plan,
    status,
    trialEndsOn: typeof row.trial_ends_on === "string" ? row.trial_ends_on : null,
    startedAt: typeof row.started_at === "string" ? row.started_at : null,
  };
}

// プラン選択時のステータス（free→free、trial→trial、それ以外→active）
export function statusForPlan(planId: PlanId): SubStatus {
  if (planId === "free") return "free";
  if (planId === "trial") return "trial";
  return "active";
}
