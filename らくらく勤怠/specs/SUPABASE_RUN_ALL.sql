-- ============================================================
-- ラクラク勤怠 Supabase セットアップ 完全版（一括実行可能）
-- ============================================================
-- 【書き換える箇所は2つだけ】
--   ↓ 5行目と6行目の値をあなたの情報に書き換えてからRUN
-- ============================================================

-- ★★★ ここを書き換えてください ★★★
-- MY_UID:  自分のLINE UID（Uで始まる長い文字列）
-- MY_NAME: 自分の本名

-- ※ DO ブロック内で再宣言するので、ここでの宣言は不要


-- ============================================================
-- STEP 1：カラム追加（role と full_name）
-- ============================================================
alter table user_profiles
  add column if not exists role text not null default 'staff'
  check (role in ('staff', 'admin'));

alter table user_profiles
  add column if not exists full_name text;


-- ============================================================
-- STEP 2：誤って追加したユニーク制約があれば削除
-- ============================================================
-- （オーナーは複数アカウント可能にするのでDB側ユニーク制約は不要）
alter table user_profiles
  drop constraint if exists user_profiles_phone_unique;


-- ============================================================
-- STEP 3：重複アカウントを自動統合
-- ============================================================
-- 同じ電話番号で複数アカウントがある場合：
--   - 新しい方（created_at が後）にデータを引き継ぐ
--   - 古い方を削除する
-- ※ 重複がなければ自動的にスキップされます
do $$
declare
    dup_phone text;
    old_uid text;
    new_uid text;
    attendance_count int;
    condition_count int;
begin
    for dup_phone in
        select phone from user_profiles
        where phone is not null
        group by phone
        having count(*) > 1
    loop
        select user_id into old_uid
        from user_profiles where phone = dup_phone
        order by created_at asc nulls last limit 1;

        select user_id into new_uid
        from user_profiles where phone = dup_phone
        order by created_at desc nulls last limit 1;

        raise notice '重複統合: phone=% old=% -> new=%', dup_phone, old_uid, new_uid;

        update attendance set user_id = new_uid where user_id = old_uid;
        get diagnostics attendance_count = row_count;

        update condition_reports set user_id = new_uid where user_id = old_uid;
        get diagnostics condition_count = row_count;

        delete from user_profiles where user_id = old_uid;

        raise notice '  → 打刻 % 件, コンディション % 件 移行', attendance_count, condition_count;
    end loop;
    raise notice '重複統合 完了';
end $$;


-- ============================================================
-- STEP 4：自分を管理者に＋本名を設定
-- ============================================================
-- ★★★ 'U_あなたのUID' と 'あなたの本名' を書き換えてください ★★★
update user_profiles
set
  role = 'admin',
  full_name = 'あなたの本名'                   -- ← 書き換え
where user_id = 'U_あなたのUID_ここに貼り付け'; -- ← 書き換え


-- ============================================================
-- STEP 5：RLS（行レベルセキュリティ）本番化
-- ============================================================
-- フロントのanon keyからの直接DBアクセスを完全にブロック。
-- 以後すべてのDB操作は Next.js のサーバーサイドAPI経由のみ。

drop policy if exists "dev_allow_all_profiles"      on user_profiles;
drop policy if exists "dev_allow_all_attendance"    on attendance;
drop policy if exists "dev_allow_all_condition"     on condition_reports;
drop policy if exists "staff_own_profile"           on user_profiles;
drop policy if exists "staff_own_attendance_insert" on attendance;
drop policy if exists "staff_read_own_attendance"   on attendance;
drop policy if exists "admin_update_attendance"     on attendance;
drop policy if exists "staff_own_condition_insert"  on condition_reports;
drop policy if exists "staff_read_own_condition"    on condition_reports;

alter table user_profiles     enable row level security;
alter table attendance        enable row level security;
alter table condition_reports enable row level security;


-- ============================================================
-- 最終確認（3つのクエリで結果チェック）
-- ============================================================

-- 1) すべてのユーザー状態を表示
select user_id, display_name, full_name, phone, role
from user_profiles
order by created_at desc nulls last;

-- 2) RLS が3テーブルすべてで有効か確認（rowsecurity=true が3行）
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in ('user_profiles', 'attendance', 'condition_reports');

-- 3) ポリシーが0件であることを確認
select tablename, policyname
from pg_policies
where schemaname = 'public'
  and tablename in ('user_profiles', 'attendance', 'condition_reports');

-- ============================================================
-- 期待される最終状態：
--   ・自分の行の role が 'admin'、full_name に本名が入っている
--   ・rowsecurity が3行とも true
--   ・policyname の結果が0行
-- ============================================================
