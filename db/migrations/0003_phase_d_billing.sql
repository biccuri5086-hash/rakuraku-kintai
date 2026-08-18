-- ============================================================
-- ラクラク勤怠 Phase D：課金（プラン管理）マイグレーション【案・未実行】
-- ============================================================
-- ⚠️ 実行前に：ハヤト/ノアのダブルチェック → オーナー承認（rules.md Rule 1）→ Supabase手動バックアップ。
-- すべて additive（既存を壊さない）。決済（Stripe等）は本フェーズ対象外＝プラン状態の保持のみ。
-- 料金体系：らくらく勤怠/sales/02_料金プラン.md（スタッフ数×単価）
-- ============================================================


-- ============================================================
-- STEP 1：company_subscription（会社ごとの契約プラン）
-- ============================================================
create table if not exists company_subscription (
  company_id    uuid primary key references companies(id) on delete cascade,
  plan          text not null default 'trial'
                check (plan in ('trial','free','starter','standard','enterprise')),
  status        text not null default 'trial'
                check (status in ('trial','active','free')),
  trial_ends_on date,                         -- トライアル終了日（任意）
  started_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);


-- ============================================================
-- STEP 2：Row Level Security（既存方針＝service_role のみ）
-- ============================================================
alter table company_subscription enable row level security;


-- ============================================================
-- STEP 3：updated_at 自動更新トリガー（既存 trigger_set_updated_at() を流用）
-- ============================================================
create or replace function trigger_set_updated_at()
returns trigger as $$
begin
    new.updated_at = now();
    return new;
end;
$$ language plpgsql;

drop trigger if exists set_updated_at on company_subscription;
create trigger set_updated_at before update on company_subscription
  for each row execute function trigger_set_updated_at();


-- ============================================================
-- 完了。if not exists のため再実行安全。ロールバックは drop table のみ。
-- ============================================================
