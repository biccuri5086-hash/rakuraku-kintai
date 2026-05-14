-- ============================================================
-- ラクラク勤怠 マイグレーション：本名カラム追加＋電話番号ユニーク制約
-- ============================================================
-- 実行手順：
--   1. まず STEP A の重複チェックを実行
--   2. 重複があれば STEP B で削除（複数ある電話番号のうち、古い方を削除）
--   3. STEP C で本名カラム追加＋ユニーク制約追加
-- ============================================================

-- ---------- STEP A：電話番号の重複チェック ----------
-- このSQLを実行して、結果に何か表示されたら STEP B が必要
select phone, count(*) as duplicate_count, array_agg(user_id) as user_ids
from user_profiles
where phone is not null
group by phone
having count(*) > 1;

-- ---------- STEP B：重複アカウントを削除（必要な場合のみ） ----------
-- 例：もし「09012345678」が2アカウントで使われていた場合
-- 古い方を消す（または使われていない方）
-- ↓ 必要に応じてコメントアウトを外して実行
-- delete from user_profiles where user_id = 'U削除したい方のUID';

-- ---------- STEP C：本名カラム追加＋電話番号ユニーク制約 ----------
-- 本名カラム
alter table user_profiles
  add column if not exists full_name text;

-- 電話番号にユニーク制約（重複登録防止）
-- ※ STEP A で重複が残っていると失敗します
alter table user_profiles
  drop constraint if exists user_profiles_phone_unique;
alter table user_profiles
  add constraint user_profiles_phone_unique unique (phone);

-- ---------- STEP D：オーナー様自身の本名を設定 ----------
-- ↓ 自分のLINE UIDと本名で書き換えて実行
update user_profiles
set full_name = '山田 太郎'   -- ← 実際の本名に書き換え
where user_id = 'U....';      -- ← 自分のLINE UID

-- ---------- 確認 ----------
select user_id, display_name, full_name, phone, role from user_profiles;
