-- ============================================================
-- プラットフォーム管理者（小原健太さん）の初期作成SQL
-- ============================================================
-- 【手順】
-- 1. ローカルPCのターミナルで以下を実行してパスワードハッシュを生成：
--      cd rakuraku-kintai
--      node scripts/hash-password.mjs "Rakurakukintai 2026@"
--
-- 2. 出力された scrypt$... の長い文字列をコピー
--
-- 3. 下記の <ここにハッシュを貼り付け> をその文字列で置き換え
--
-- 4. このSQLをSupabase の SQL Editor で実行
-- ============================================================

insert into super_admins (email, password_hash, full_name)
values (
  'biccuri5086@gmail.com',
  '<ここにハッシュを貼り付け>',
  '小原 健太'
)
on conflict (email) do update
  set password_hash = excluded.password_hash,
      full_name = excluded.full_name;

-- 確認
select id, email, full_name, is_active, created_at
from super_admins;
