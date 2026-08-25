-- ============================================================
-- ラクラク勤怠 セキュリティ強化：RLS の取りこぼしを塞ぐ
-- ============================================================
-- 本アプリは常に service_role 経由でのみDBに触れ、テナント分離はアプリ側で担保している。
-- したがって正しい状態は「全テーブルで RLS 有効 かつ anon/public 向けポリシー0件」
-- ＝ service_role だけが通る、である。
-- anon キーはブラウザに露出するため、anon に許可を出すポリシーが1つでも残っていると
-- 外部から読まれる。TO service_role を明示したポリシー（rate_limits の service_role_only）は
-- anon の対象外なので残っていて問題ない。
--
-- このマイグレーションは冪等。何度流しても安全。
-- ============================================================

-- 1) 初期セットアップ時代の開発用ポリシーが本番に残っていた場合に備えて確実に削除する
drop policy if exists "dev_allow_all_profiles"   on user_profiles;
drop policy if exists "dev_allow_all_attendance" on attendance;
drop policy if exists "dev_allow_all_condition"  on condition_reports;
drop policy if exists "dev_allow_all_audit"      on admin_audit_log;

-- 2) RLS が未設定だったテーブルを塞ぐ
--    schema_migrations は適用済みマイグレーション名（＝スキーマの変遷）が読めてしまうため。
alter table schema_migrations enable row level security;

-- 3) 全テーブルで RLS を有効化（既に有効なら no-op）
do $$
declare t record;
begin
  for t in
    select tablename from pg_tables
    where schemaname = 'public' and rowsecurity = false
  loop
    execute format('alter table public.%I enable row level security', t.tablename);
    raise notice 'RLS を有効化: %', t.tablename;
  end loop;
end $$;

-- ============================================================
-- 適用後の確認（Supabase SQL Editor で実行し、どちらも0行なら正常）
--
--   -- RLS が無効なテーブル（0行であること）
--   select tablename from pg_tables
--   where schemaname = 'public' and rowsecurity = false;
--
--   -- anon / public に許可を出しているポリシー（0行であること）
--   select tablename, policyname, roles from pg_policies
--   where schemaname = 'public'
--     and roles && array['anon','public','authenticated']::name[];
--
--   注) 全ポリシーを一覧すると rate_limits の "service_role_only" が1件出るが、
--       これは TO service_role のため anon からは読めず、正常な状態である。
-- ============================================================
