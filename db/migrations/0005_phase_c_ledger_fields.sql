-- ============================================================
-- ラクラク勤怠 Phase C：派遣元管理台帳(法37条) 記載事項の拡充
-- ============================================================
-- すべて additive（既存データ非破壊）。RLSは有効・ポリシー無し＝service_role のみ。
-- 目的：ミオ一次レビューで「中」判定だった「管理台帳の法定記載事項不足」を埋める。
--   会社単位：派遣元責任者・苦情申出先・待遇決定方式（労使協定/均等均衡）
--   派遣先単位：派遣先責任者
--   スタッフ単位：無期/有期区分・社会保険加入状況
-- ※ 就業日時は shifts、業務内容/組織単位/期間/抵触日は既存で対応済み。
-- ============================================================


-- STEP 1：会社単位のコンプラ設定
create table if not exists compliance_settings (
  company_id        uuid primary key references companies(id) on delete cascade,
  agency_manager    text,   -- 派遣元責任者
  complaint_contact text,   -- 苦情の申出先・処理担当
  wage_method       text check (wage_method in ('roushi','kinto')), -- 待遇決定：労使協定方式/均等均衡方式
  updated_at        timestamptz not null default now()
);

alter table compliance_settings enable row level security;


-- STEP 2：派遣先（clients）に派遣先責任者
alter table clients add column if not exists dispatch_manager text;


-- STEP 3：スタッフ（user_profiles）に無期/有期・社保加入状況
-- employment_type: 'indefinite'(無期) / 'fixed'(有期)
-- social_insurance: 'enrolled'(加入) / 'not_enrolled'(未加入) / 'exempt'(対象外)
alter table user_profiles add column if not exists employment_type text
  check (employment_type in ('indefinite','fixed'));
alter table user_profiles add column if not exists social_insurance text
  check (social_insurance in ('enrolled','not_enrolled','exempt'));


-- STEP 4：updated_at トリガ（既存の共通関数を利用）
create or replace function trigger_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_updated_at on compliance_settings;
create trigger set_updated_at before update on compliance_settings
  for each row execute function trigger_set_updated_at();


-- ============================================================
-- 完了。すべて if not exists のため再実行安全。ロールバックは追加列/テーブルの drop のみ。
-- ============================================================
