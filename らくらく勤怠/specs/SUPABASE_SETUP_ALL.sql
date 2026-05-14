-- ============================================================
-- ラクラク勤怠 Supabase セットアップ 一括SQL
-- ============================================================
-- 実行順に上から下まで、ブロック単位で実行してください。
-- 必ず STEP 0 → STEP 1 → ... → STEP 6 の順番で実行すること。
--
-- 【オーナー様が書き換える必要がある箇所】
--   1. STEP 3 の「あなたのLINE UID」（U で始まる33文字程度）
--   2. STEP 3 の「あなたの本名」
--   3. STEP 5 の「削除したいUID」（重複アカウントがあれば）
-- ============================================================


-- ============================================================
-- STEP 0：現在の状態確認（READ ONLY・安全）
-- ============================================================
-- 既存テーブル・カラム・データを確認します。
-- ここで予想と違うことが起きていたら以降の手順を中断してご連絡ください。

select user_id, display_name, phone from user_profiles;


-- ============================================================
-- STEP 1：カラム追加（role と full_name）
-- ============================================================
-- 管理者ロール用のカラムと、本名用のカラムを追加します。
-- 既に追加済みの場合はスキップされます（if not exists のおかげ）。

alter table user_profiles
  add column if not exists role text not null default 'staff'
  check (role in ('staff', 'admin'));

alter table user_profiles
  add column if not exists full_name text;


-- ============================================================
-- STEP 2：電話番号の重複チェック
-- ============================================================
-- 同じ電話番号で複数アカウントが登録されているか確認します。
-- 結果に行が出たら STEP 5 で削除が必要、空なら STEP 5 は飛ばしてOK。

select
  phone,
  count(*) as duplicate_count,
  array_agg(user_id) as duplicate_user_ids,
  array_agg(display_name) as duplicate_names
from user_profiles
where phone is not null
group by phone
having count(*) > 1;


-- ============================================================
-- STEP 3：自分（オーナー様）を管理者に＋本名を設定
-- ============================================================
-- ↓↓↓ 2か所書き換えてください ↓↓↓
--   ・'U_あなたのLINE_UID_ここに貼り付け'  →  実際のUID
--   ・'あなたの本名'                        →  実際の本名

update user_profiles
set
  role = 'admin',
  full_name = 'あなたの本名'
where user_id = 'U_あなたのLINE_UID_ここに貼り付け';

-- 確認：自分の行で role='admin' と full_name が入っていればOK
select user_id, display_name, full_name, phone, role
from user_profiles
where role = 'admin';


-- ============================================================
-- STEP 4：電話番号にユニーク制約を追加
-- ============================================================
-- 同じ電話番号で複数アカウント登録できないようにします。
-- ※ STEP 2 で重複が見つかった場合、STEP 5 で削除してからこのSTEPを実行してください
-- ※ 重複が残っているとこのSTEPは失敗します

alter table user_profiles
  drop constraint if exists user_profiles_phone_unique;

alter table user_profiles
  add constraint user_profiles_phone_unique unique (phone);


-- ============================================================
-- STEP 5：重複アカウント削除（STEP 2 で重複が見つかった場合のみ実行）
-- ============================================================
-- ↓↓↓ 削除したい方のUIDを書き換えて実行してください ↓↓↓
-- ※ どちらが「正しいアカウント」か慎重に判断してください
-- ※ 重複がなければこのSTEPはスキップ

-- delete from user_profiles where user_id = 'U_削除したい方のUID';

-- 削除後、STEP 4 のユニーク制約追加を再度実行してください


-- ============================================================
-- STEP 6：RLS（行レベルセキュリティ）を本番化
-- ============================================================
-- フロントエンドのanon keyからの直接アクセスを完全にブロックします。
-- 全てのDB操作は Next.js のサーバーサイドAPI経由（service_role）に統一されます。
--
-- ⚠️ このSTEPを実行する前に、Vercelに SUPABASE_SERVICE_ROLE_KEY が設定済みで
--    アプリが動作することを確認してから実行してください。

-- 旧開発用ポリシーを削除（既に削除済みでもエラーにならない）
drop policy if exists "dev_allow_all_profiles"     on user_profiles;
drop policy if exists "dev_allow_all_attendance"   on attendance;
drop policy if exists "dev_allow_all_condition"    on condition_reports;
drop policy if exists "staff_own_profile"           on user_profiles;
drop policy if exists "staff_own_attendance_insert" on attendance;
drop policy if exists "staff_read_own_attendance"   on attendance;
drop policy if exists "admin_update_attendance"     on attendance;
drop policy if exists "staff_own_condition_insert"  on condition_reports;
drop policy if exists "staff_read_own_condition"    on condition_reports;

-- RLSを全テーブルで有効化
alter table user_profiles      enable row level security;
alter table attendance         enable row level security;
alter table condition_reports  enable row level security;

-- ポリシーは作成しない（=全拒否）
-- service_role は RLS をバイパスするので、Next.js API ルートからは自由にアクセス可能。
-- anon キー（フロントエンドが持っているもの）からは何も読めない・書けない状態になる。


-- ============================================================
-- 最終確認
-- ============================================================

-- 1) 全ユーザーの状態を表示
select user_id, display_name, full_name, phone, role
from user_profiles
order by created_at desc nulls last;

-- 2) RLSが3テーブルすべてで有効になっているか確認（rowsecurity=true が3行）
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in ('user_profiles', 'attendance', 'condition_reports');

-- 3) ポリシーが0件であることを確認（=サービスロール以外は完全拒否）
select tablename, policyname
from pg_policies
where schemaname = 'public'
  and tablename in ('user_profiles', 'attendance', 'condition_reports');

-- ============================================================
-- セットアップ完了！
-- ============================================================
