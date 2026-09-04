-- ============================================================
-- staging スキーマ用：運営者(superadmin)アカウントの作成
-- ============================================================
-- 本番の SUPERADMIN_SEED.sql とは別に、staging 専用のテストアカウントを作る。
-- 本番の運営者アカウント（実名・実メール）とは意図的に分けている。
--
-- ログイン情報（テスト用。本番とは無関係）:
--   画面: /superadmin/login
--   メール: staging-test@example.com
--   パスワード: StagingTest2026!
--
-- 【手順】
-- 1. Supabase SQL Editor で、このファイルの中身をそのまま実行する
--    （先頭の set search_path で staging スキーマを指定済み）
-- ============================================================

set search_path to staging;

insert into super_admins (email, password_hash, full_name)
values (
  'staging-test@example.com',
  'scrypt$16384$34150c2af46742bc5a588ccd7deb3943$59be4a5e9ef4acf18e334d17690d3ff17a30ffa441cbd7bd2d8b1eeca4051167fa60fbdda49c90f6ec4990f4f34f7f773d72170ff7d3813d6e642ea64227ae5e',
  'Staging Test Admin'
)
on conflict (email) do update
  set password_hash = excluded.password_hash,
      full_name = excluded.full_name;

-- 確認
select id, email, full_name, is_active, created_at
from super_admins;
