// Phase C 派遣法コンプラ：抵触日アラート／管理台帳の型（純粋・フレームワーク非依存）。
// 設計：らくらく勤怠/specs/PHASE_A_派遣モデル設計.md §6（Phase C）

export type ComplianceLevel = "ok" | "warn" | "expired" | "unknown";

// clients から読む（Phase C マイグレーション前は teishokubi のみ存在。他は undefined でも動く）
export interface ClientRec {
  id: string;
  name: string;
  teishokubi?: string | null; // 事業所抵触日（既存列）
  dispatch_start_date?: string | null; // 受入開始日（Phase Cで追加。抵触日未設定時に +3年で算出）
  teishokubi_extended_until?: string | null; // 意見聴取による延長後の抵触日（Phase Cで追加）
}

export interface AssignmentRec {
  id: string;
  user_id: string;
  client_id: string | null;
  type: string; // spot / ongoing
  start_date: string; // YYYY-MM-DD
  end_date?: string | null;
  job_content?: string | null;
  org_unit?: string | null; // 組織単位（Phase Cで追加。個人単位3年の判定に使う）
}

export interface StaffRec {
  user_id: string;
  display_name: string;
}

export interface ComplianceAlert {
  scope: "office" | "individual"; // 事業所単位 / 個人単位
  level: ComplianceLevel;
  client_id: string | null;
  client_name: string;
  staff_id?: string;
  staff_name?: string;
  org_unit?: string | null;
  limitDate: string | null; // 抵触日
  daysRemaining: number | null; // 抵触日までの残り日数（マイナス=超過）
  basis: string; // 算出根拠
}

export interface LedgerRow {
  staff_id: string;
  staff_name: string;
  client_name: string;
  org_unit: string | null;
  job_content: string | null;
  type: string;
  start_date: string;
  end_date: string | null;
  individualLimit: string | null; // 個人抵触日
  officeLimit: string | null; // 事業所抵触日
}
