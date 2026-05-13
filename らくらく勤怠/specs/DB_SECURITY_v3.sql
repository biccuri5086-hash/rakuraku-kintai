-- ラクラク勤怠: セキュリティ強化SQL v3
-- Supabase SQL Editor に貼り付けてRunを押してください
-- ※ 既存の開発用ポリシーを削除して本番用に置き換えます

-- ============================================
-- 1. 管理者ロール追加
-- ============================================
alter table user_profiles add column if not exists role text not null default 'staff'
  check (role in ('staff', 'admin'));

-- 最初の管理者を設定（LINE UIDを実際の値に変更してください）
-- update user_profiles set role = 'admin' where user_id = 'YOUR_LINE_UID_HERE';

-- ============================================
-- 2. user_profiles の RLS を本番用に更新
-- ============================================
drop policy if exists "dev_allow_all_profiles" on user_profiles;

-- スタッフは自分のプロファイルのみ読み書き可能
create policy "staff_own_profile" on user_profiles
  for all using (auth.uid()::text = user_id or
    exists (select 1 from user_profiles where user_id = auth.uid()::text and role = 'admin'));

-- ============================================
-- 3. attendance の RLS を本番用に更新
-- ============================================
drop policy if exists "dev_allow_all_attendance" on attendance;

-- スタッフは自分の打刻のみ書き込み可能
create policy "staff_own_attendance_insert" on attendance
  for insert with check (auth.uid()::text = user_id);

-- スタッフは自分の打刻のみ読み取り可能、管理者は全員分読み取り可能
create policy "staff_read_own_attendance" on attendance
  for select using (
    auth.uid()::text = user_id or
    exists (select 1 from user_profiles where user_id = auth.uid()::text and role = 'admin')
  );

-- 管理者のみ更新可能（GPS情報の後付け更新に使用）
create policy "admin_update_attendance" on attendance
  for update using (
    auth.uid()::text = user_id or
    exists (select 1 from user_profiles where user_id = auth.uid()::text and role = 'admin')
  );

-- ============================================
-- 4. condition_reports の RLS を本番用に更新
-- ============================================
drop policy if exists "dev_allow_all_condition" on condition_reports;

create policy "staff_own_condition_insert" on condition_reports
  for insert with check (auth.uid()::text = user_id);

create policy "staff_read_own_condition" on condition_reports
  for select using (
    auth.uid()::text = user_id or
    exists (select 1 from user_profiles where user_id = auth.uid()::text and role = 'admin')
  );

-- ============================================
-- 注意事項
-- ============================================
-- このSQLを実行する前に、Supabase Authentication の設定で
-- LINE OAuthプロバイダーを有効にする必要があります。
-- 現在のPoC段階では、まず「1. 管理者ロール追加」だけ実行し、
-- 2〜4はSupabase Auth導入後に実行してください。
