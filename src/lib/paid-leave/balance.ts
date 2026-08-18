// 有給残高の計算（純粋関数）。API・テストの両方から使う。
// 残(有効) = Σ(失効していない付与) − Σ(取得)。失効消化の厳密な充当は行わない管理補助。

export type LeaveGrant = { granted_days: number; expires_on: string; grant_date?: string };
export type LeaveTaking = { days: number };

// 失効していない付与（expires_on >= today）の合計日数
export function activeGrantedDays(grants: LeaveGrant[], today: string): number {
  return grants
    .filter((g) => g.expires_on >= today)
    .reduce((s, g) => s + Number(g.granted_days), 0);
}

// 取得（消化）の合計日数
export function takenDays(takings: LeaveTaking[]): number {
  return takings.reduce((s, t) => s + Number(t.days), 0);
}

// 残（有効）＝ 有効付与 − 取得。小数第1位で丸め（半休対応）。
export function remainingDays(grants: LeaveGrant[], takings: LeaveTaking[], today: string): number {
  return Math.round((activeGrantedDays(grants, today) - takenDays(takings)) * 10) / 10;
}

// 直近の失効予定日（有効な付与のうち最も早い expires_on）。無ければ null。
export function nextExpiry(grants: LeaveGrant[], today: string): string | null {
  return (
    grants
      .filter((g) => g.expires_on >= today)
      .map((g) => g.expires_on)
      .sort()[0] ?? null
  );
}
