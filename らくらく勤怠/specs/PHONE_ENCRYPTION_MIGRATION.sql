-- ============================================================
-- 電話番号の暗号化対応：user_profiles に phone_hash カラム追加
-- ============================================================
-- 目的:
--   - user_profiles.phone を平文 → AES-256-GCM 暗号化文字列に切り替え
--   - 重複チェック・検索用に HMAC-SHA256 ハッシュ列を別途持つ
--
-- 実行方法:
--   1. 事前に Supabase で Manual Backup を取る
--   2. SQL Editor で New query → このファイル丸ごとコピペ → Run
--   3. その後、scripts/migrate-phone-encryption.mjs を実行してデータを変換
--
-- 冪等: 何度実行しても OK（IF NOT EXISTS）。
-- ============================================================

-- phone カラムを暗号化文字列にも対応できる長さに拡張
ALTER TABLE user_profiles
  ALTER COLUMN phone TYPE TEXT;

-- phone_hash カラム追加（HMAC-SHA256 base64url）
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS phone_hash TEXT;

-- 重複チェック高速化のためインデックス（同一会社内でユニーク）
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_profiles_company_phone_hash
  ON user_profiles(company_id, phone_hash)
  WHERE phone_hash IS NOT NULL;

COMMENT ON COLUMN user_profiles.phone IS '暗号化済み電話番号（v1:iv:enc:tag 形式）。アプリ側で復号する。';
COMMENT ON COLUMN user_profiles.phone_hash IS 'HMAC-SHA256(phone) base64url。重複チェック・検索用。';
