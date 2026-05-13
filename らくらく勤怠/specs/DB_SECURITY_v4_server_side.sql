-- =============================================================
-- ラクラク勤怠 RLS v4：サーバーサイドAPI経由のみ許可
-- =============================================================
-- 方針：
--   - フロントエンド（anon key）からは Supabase に直接アクセスできない
--   - すべての DB 操作は Next.js API ルート経由（service_role_key を使用）
--   - service_role は RLS をバイパスするので個別ポリシー不要
--
-- 実行前に Vercel に環境変数 SUPABASE_SERVICE_ROLE_KEY を設定してください
-- =============================================================

-- ---------- STEP 1: 管理者ロール列を追加 ----------
alter table user_profiles
  add column if not exists role text not null default 'staff'
  check (role in ('staff', 'admin'));

-- ---------- STEP 2: 自分のLINE UIDを管理者に設定 ----------
-- ↓ 'YOUR_LINE_UID_HERE' を実際のLINE UIDに置き換えてください
-- update user_profiles set role = 'admin' where user_id = 'YOUR_LINE_UID_HERE';

-- ---------- STEP 3: 旧開発用ポリシーを削除 ----------
drop policy if exists "dev_allow_all_profiles"     on user_profiles;
drop policy if exists "dev_allow_all_attendance"   on attendance;
drop policy if exists "dev_allow_all_condition"    on condition_reports;

-- すでに v3 で作成されている可能性のあるポリシーも念のため削除
drop policy if exists "staff_own_profile"           on user_profiles;
drop policy if exists "staff_own_attendance_insert" on attendance;
drop policy if exists "staff_read_own_attendance"   on attendance;
drop policy if exists "admin_update_attendance"     on attendance;
drop policy if exists "staff_own_condition_insert"  on condition_reports;
drop policy if exists "staff_read_own_condition"    on condition_reports;

-- ---------- STEP 4: RLS を必ず有効化 ----------
alter table user_profiles      enable row level security;
alter table attendance         enable row level security;
alter table condition_reports  enable row level security;

-- ---------- STEP 5: ポリシーを作成しない（=すべて拒否） ----------
-- RLS有効＋ポリシーなし＝ anon/authenticated は何もできない
-- service_role は RLS をバイパスするので Next.js API から自由に操作可能

-- ---------- 確認用クエリ ----------
-- 以下を実行して、3つのテーブルが「rls enabled = true」「policies 0件」になっていれば成功
--
-- select tablename, rowsecurity from pg_tables
-- where schemaname = 'public' and tablename in ('user_profiles', 'attendance', 'condition_reports');
--
-- select tablename, policyname from pg_policies
-- where schemaname = 'public' and tablename in ('user_profiles', 'attendance', 'condition_reports');
