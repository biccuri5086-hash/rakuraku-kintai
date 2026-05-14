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
-- STEP 4：（削除）電話番号ユニーク制約はDB側では設けません
-- ============================================================
-- オーナー様は管理者として複数アカウントを使えるようにしておくため、
-- DB側でのユニーク制約は設けません。
-- 代わりに登録API（/api/me/register）が以下のルールで動作：
--   ・既存アカウントが admin → 登録許可
--   ・既存アカウントが staff → 登録拒否
-- これで「staff の二重登録」だけ防ぎ「admin の複数アカウント」は許可されます。

-- 既に追加してしまった場合は以下で削除
alter table user_profiles
  drop constraint if exists user_profiles_phone_unique;


-- ============================================================
-- STEP 5：重複アカウントの統合（STEP 2 で重複が見つかった場合のみ実行）
-- ============================================================
-- 古いアカウントのデータ（打刻・コンディション報告）を
-- 新しいアカウントに引き継いでから、古いアカウントを削除します。
-- 詳細スクリプト：specs/SUPABASE_MERGE_DUPLICATE.sql 参照

-- target_phone を重複している電話番号に書き換えて実行
do $$
declare
    target_phone text := '08098957770';  -- ← 重複している電話番号に書き換え
    old_uid text;
    new_uid text;
    attendance_count int;
    condition_count int;
begin
    select user_id into old_uid
    from user_profiles where phone = target_phone
    order by created_at asc nulls last limit 1;

    select user_id into new_uid
    from user_profiles where phone = target_phone
    order by created_at desc nulls last limit 1;

    if old_uid is null or old_uid = new_uid then
        raise notice '重複なし、または対象なし';
        return;
    end if;

    raise notice '統合: old=% → new=%', old_uid, new_uid;
    update attendance set user_id = new_uid where user_id = old_uid;
    get diagnostics attendance_count = row_count;
    update condition_reports set user_id = new_uid where user_id = old_uid;
    get diagnostics condition_count = row_count;
    delete from user_profiles where user_id = old_uid;
    raise notice '完了：打刻 % 件, コンディション % 件 移行', attendance_count, condition_count;
end $$;


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
