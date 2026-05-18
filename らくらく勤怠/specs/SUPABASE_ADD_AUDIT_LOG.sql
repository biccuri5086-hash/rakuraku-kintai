-- ============================================================
-- 監査ログテーブル追加（2FA・監査ログ機能の有効化）
-- ============================================================
-- 管理者の操作履歴（ログイン・閲覧等）を記録するテーブルを作成します。
-- Supabase SQL Editor にそのまま貼り付けて実行してください。
-- ============================================================

create table if not exists admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  admin_user_id text,
  action text not null,
  details jsonb,
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists idx_admin_audit_log_created_at
  on admin_audit_log(created_at desc);

-- RLS有効化（service_roleのみアクセス可能）
alter table admin_audit_log enable row level security;

-- 古い開発用ポリシーが残っていれば削除
drop policy if exists "dev_allow_all_audit" on admin_audit_log;

-- ポリシーは作成しない（=service_role以外完全拒否）

-- 確認
select tablename, rowsecurity
from pg_tables
where schemaname = 'public' and tablename = 'admin_audit_log';
