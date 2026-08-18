-- ============================================================
-- ラクラク勤怠 Phase C：派遣法コンプラ マイグレーション【案・未実行】
-- ============================================================
-- ⚠️ 実行前に：ハヤト/ノアのダブルチェック → オーナー承認（rules.md Rule 1）→ Supabase手動バックアップ。
-- すべて additive（既存の派遣先/契約データを壊さない）。Phase A/B と同じ流儀。
-- 設計：specs/PHASE_A_派遣モデル設計.md §6 / 抵触日・3年ルール
-- ============================================================


-- ============================================================
-- STEP 1：clients に抵触日算出用の列を追加（非破壊・nullable）
-- ============================================================
-- dispatch_start_date：派遣受入開始日。teishokubi 未設定時に +3年で事業所抵触日を自動算出する。
-- teishokubi_extended_until：意見聴取による延長後の抵触日（設定時はこちらを優先）。
alter table clients add column if not exists dispatch_start_date       date;
alter table clients add column if not exists teishokubi_extended_until date;


-- ============================================================
-- STEP 2：assignments に組織単位を追加（個人単位3年の判定に使用）
-- ============================================================
alter table assignments add column if not exists org_unit text;


-- ============================================================
-- STEP 3：compliance_acks（抵触日アラートの確認・対応記録）
-- ============================================================
create table if not exists compliance_acks (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references companies(id) on delete cascade,
  scope            text not null check (scope in ('office','individual')),
  client_id        uuid,                 -- 対象派遣先（任意）
  user_id          text,                 -- 対象スタッフ（個人単位のとき）
  org_unit         text,
  limit_date       date,                 -- 対応時点の抵触日
  note             text,                 -- 対応メモ（延長手続き済み等）
  acknowledged_by  text,                 -- 対応した管理者
  acknowledged_at  timestamptz not null default now()
);

create index if not exists idx_compliance_acks_company on compliance_acks(company_id, acknowledged_at desc);


-- ============================================================
-- STEP 4：Row Level Security（既存方針を踏襲＝service_role のみ）
-- ============================================================
-- 許可ポリシーは作らない（フロントから直接DBアクセス不可。Next.jsサーバーの service_role のみ）。
alter table compliance_acks enable row level security;


-- ============================================================
-- 完了。すべて if not exists のため再実行安全。ロールバックは追加列/テーブルの drop のみ。
-- ============================================================
