-- ============================================================
-- ラクラク勤怠 ステージング用 スキーマ一括作成（staging-bootstrap）
-- ============================================================
-- 使い方：新しいSupabase(検証用)プロジェクトの SQL Editor に全部貼って Run。
-- 本番と同じ依存順で、各マイグレーションを1本にまとめたもの。すべて if not exists 等のガード付き＝空DBに安全・再実行可。
-- ※ スキーマのみ。ログイン用アカウント(super_admin/admin)は含まない（別途 seed が必要）。
-- ============================================================

create extension if not exists pgcrypto;


-- ===================================================================
-- ▼▼▼ DB_SCHEMA.sql ▼▼▼
-- ===================================================================
-- ラクラク勤怠: Supabaseテーブル定義 v2
-- Supabase の SQL Editor にそのまま貼り付けて実行してください

-- ユーザープロファイルテーブル（電話番号登録）
create table if not exists user_profiles (
  user_id text primary key,
  display_name text not null,
  phone text not null,
  created_at timestamptz not null default now()
);

-- 打刻記録テーブル（GPS付き）
create table if not exists attendance (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  user_name text not null,
  type text not null check (type in ('clock_in', 'clock_out')),
  timestamp timestamptz not null default now(),
  lat double precision,
  lng double precision,
  gps_accuracy double precision
);

create index if not exists idx_attendance_user_ts on attendance (user_id, timestamp desc);

-- コンディション報告テーブル
create table if not exists condition_reports (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  score integer not null check (score between 1 and 5),
  comment text,
  reported_at timestamptz not null default now()
);

create index if not exists idx_condition_user on condition_reports (user_id, reported_at desc);

-- Row Level Security
alter table user_profiles enable row level security;
alter table attendance enable row level security;
alter table condition_reports enable row level security;

-- 【重要】ここには開発用の全許可ポリシー(dev_allow_all_*)を書かない。
-- 本アプリは常に service_role 経由でのみDBに触れる（アプリ側でテナント分離を担保）。
-- anon キーはブラウザに露出するため、ポリシーを1つでも作ると全社のスタッフ情報・
-- 打刻・コンディションが誰でも読める状態になる。
-- 正しい状態＝「RLS 有効 かつ ポリシー0件」（service_role だけが通る）。
-- 以前ここで作っていた dev_allow_all_* は、このファイル後半で drop policy している。

-- 既存の attendance テーブルにGPS列を追加する場合（テーブルが既に存在する場合のみ実行）
-- alter table attendance add column if not exists lat double precision;
-- alter table attendance add column if not exists lng double precision;
-- alter table attendance add column if not exists gps_accuracy double precision;

-- ===================================================================
-- ▼▼▼ SUPABASE_RUN_ALL.sql ▼▼▼
-- ===================================================================
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

-- ===================================================================
-- ▼▼▼ SUPABASE_ADD_AUDIT_LOG.sql ▼▼▼
-- ===================================================================
-- ============================================================
-- 監査ログテーブル追加（2FA・監査ログ機能の有効化）
-- ============================================================
-- 管理者の操作履歴（ログイン・閲覧等）を記録するテーブルを作成します。
-- Supabase SQL Editor にそのまま貼り付けて実行してください。
-- ============================================================

create table if not exists admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  admin_user_id text,
  action text not null,
  details jsonb,
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists idx_admin_audit_log_created_at
  on admin_audit_log(created_at desc);

-- RLS有効化（service_roleのみアクセス可能）
alter table admin_audit_log enable row level security;

-- 古い開発用ポリシーが残っていれば削除
drop policy if exists "dev_allow_all_audit" on admin_audit_log;

-- ポリシーは作成しない（=service_role以外完全拒否）

-- 確認
select tablename, rowsecurity
from pg_tables
where schemaname = 'public' and tablename = 'admin_audit_log';

-- ===================================================================
-- ▼▼▼ RATE_LIMIT_TABLE.sql ▼▼▼
-- ===================================================================
-- ============================================================
-- rate_limits テーブル: ログイン試行のレート制限を永続化
-- ============================================================
-- Vercel serverless はインスタンスごとに別メモリのため、
-- 旧 in-memory 版ではブルートフォース対策として不完全だった。
-- このテーブルで「IP×用途」単位で試行回数を集計する。
--
-- 実行方法:
--   1. Supabase の SQL Editor で New query
--   2. このファイルを丸ごとコピペして Run
--
-- 冪等: 何度実行しても重複は作られない（IF NOT EXISTS / OR REPLACE）。
-- ============================================================

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  reset_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_reset_at ON rate_limits(reset_at);

-- RLS: service_role からのみアクセス可能（一般ユーザーは触らせない）
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;

-- 既存ポリシーがあれば削除して作り直し（冪等性確保）
DROP POLICY IF EXISTS "service_role_only" ON rate_limits;
CREATE POLICY "service_role_only" ON rate_limits
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 期限切れエントリの定期削除関数（Cron Job または手動で呼ぶ）
CREATE OR REPLACE FUNCTION purge_expired_rate_limits()
RETURNS INTEGER AS $$
DECLARE
  deleted INTEGER;
BEGIN
  DELETE FROM rate_limits WHERE reset_at < now() - INTERVAL '1 hour';
  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN deleted;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON TABLE rate_limits IS 'ログイン等のレート制限カウンタ。key 形式: "admin:<ip>" / "superadmin:<ip>"';

-- ===================================================================
-- ▼▼▼ MULTITENANT_MIGRATION.sql ▼▼▼
-- ===================================================================
-- ============================================================
-- ラクラク勤怠 マルチテナント化 マイグレーション
-- ============================================================
-- このSQLは Supabase の SQL Editor で1回だけ実行してください。
-- 既存データは「ラクラク勤怠株式会社」テナントに自動移行されます。
-- ============================================================
-- 実行前に必ず Database → Backups で手動バックアップを取ること
-- ============================================================


-- ============================================================
-- STEP 1：拡張機能の確認
-- ============================================================
create extension if not exists pgcrypto;


-- ============================================================
-- STEP 2：companies テーブル（テナント=派遣会社マスタ）
-- ============================================================
create table if not exists companies (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  invite_code     text unique not null,
  plan            text not null default 'standard'
                  check (plan in ('standard', 'pro', 'enterprise')),
  status          text not null default 'active'
                  check (status in ('active', 'trial', 'suspended', 'cancelled')),
  trial_ends_at   timestamptz,
  contact_name    text,
  contact_email   text,
  contact_phone   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_companies_status on companies(status);
create index if not exists idx_companies_invite on companies(invite_code);


-- ============================================================
-- STEP 3：tenant_settings テーブル（会社ごとの機能フラグ）
-- ============================================================
create table if not exists tenant_settings (
  company_id              uuid primary key references companies(id) on delete cascade,
  feature_condition       boolean not null default true,
  feature_gps             boolean not null default true,
  feature_alert           boolean not null default false,
  feature_monthly_report  boolean not null default false,
  feature_multi_site      boolean not null default false,
  feature_ai_risk_score   boolean not null default false,
  comment_required        boolean not null default false,
  max_staff_count         integer,
  updated_at              timestamptz not null default now()
);


-- ============================================================
-- STEP 4：admins テーブル（テナント管理者）
-- ============================================================
-- メール+パスワード認証用。1管理者=1社所属。
create table if not exists admins (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id) on delete cascade,
  email           text not null,
  password_hash   text not null,
  full_name       text not null,
  totp_secret     text,
  is_active       boolean not null default true,
  last_login_at   timestamptz,
  created_at      timestamptz not null default now(),
  unique(company_id, email)
);

create index if not exists idx_admins_email on admins(email);
create index if not exists idx_admins_company on admins(company_id);


-- ============================================================
-- STEP 5：super_admins テーブル（プラットフォーム管理者）
-- ============================================================
-- 小原さん専用。テナントを管理する役割。
create table if not exists super_admins (
  id              uuid primary key default gen_random_uuid(),
  email           text unique not null,
  password_hash   text not null,
  full_name       text not null,
  totp_secret     text,
  is_active       boolean not null default true,
  last_login_at   timestamptz,
  created_at      timestamptz not null default now()
);


-- ============================================================
-- STEP 6：admin_audit_log を拡張（テナント情報を追加）
-- ============================================================
-- 既存テーブルが無い場合は作成、ある場合はカラム追加
create table if not exists admin_audit_log (
  id              uuid primary key default gen_random_uuid(),
  action          text not null,
  details         jsonb,
  ip_address      text,
  user_agent      text,
  created_at      timestamptz not null default now()
);

alter table admin_audit_log
  add column if not exists company_id  uuid references companies(id);
alter table admin_audit_log
  add column if not exists actor_type  text check (actor_type in ('super_admin', 'admin', 'staff', 'system'));
alter table admin_audit_log
  add column if not exists actor_id    text;

create index if not exists idx_audit_company on admin_audit_log(company_id, created_at desc);
create index if not exists idx_audit_action  on admin_audit_log(action, created_at desc);


-- ============================================================
-- STEP 7：既存テーブルに company_id を追加
-- ============================================================
alter table user_profiles
  add column if not exists company_id uuid references companies(id);
alter table attendance
  add column if not exists company_id uuid references companies(id);
alter table condition_reports
  add column if not exists company_id uuid references companies(id);


-- ============================================================
-- STEP 8：初期テナント「ラクラク勤怠株式会社」を作成
-- ============================================================
-- 既存のテストデータをここに紐付けます。
do $$
declare
    default_company_id uuid;
begin
    -- 既に存在する場合はそのIDを使う
    select id into default_company_id
    from companies
    where name = 'ラクラク勤怠株式会社'
    limit 1;

    if default_company_id is null then
        insert into companies (name, invite_code, plan, status, contact_name, contact_email, contact_phone)
        values (
            'ラクラク勤怠株式会社',
            'RAKURAKU_INTERNAL_' || substr(md5(random()::text), 1, 8),
            'enterprise',
            'active',
            '小原 健太',
            'biccuri5086@gmail.com',
            '080-9895-7770'
        )
        returning id into default_company_id;

        -- 全機能ONで設定
        insert into tenant_settings (
            company_id,
            feature_condition, feature_gps, feature_alert,
            feature_monthly_report, feature_multi_site, feature_ai_risk_score
        ) values (
            default_company_id,
            true, true, true, true, true, true
        );

        raise notice '初期テナント作成完了: ラクラク勤怠株式会社 (%)', default_company_id;
    else
        raise notice '初期テナント既存: ラクラク勤怠株式会社 (%)', default_company_id;
    end if;

    -- 既存データを初期テナントに紐付け
    update user_profiles     set company_id = default_company_id where company_id is null;
    update attendance        set company_id = default_company_id where company_id is null;
    update condition_reports set company_id = default_company_id where company_id is null;

    raise notice '既存データを初期テナントに紐付け完了';
end $$;


-- ============================================================
-- STEP 9：company_id を NOT NULL に変更（孤児データの予防）
-- ============================================================
alter table user_profiles     alter column company_id set not null;
alter table attendance        alter column company_id set not null;
alter table condition_reports alter column company_id set not null;


-- ============================================================
-- STEP 10：テナント横断インデックス（パフォーマンス用）
-- ============================================================
create index if not exists idx_user_profiles_company    on user_profiles(company_id);
create index if not exists idx_attendance_company_ts    on attendance(company_id, timestamp desc);
create index if not exists idx_condition_company_ts     on condition_reports(company_id, reported_at desc);

-- 同一会社内では電話番号ユニーク（会社をまたぐ重複はOK）
create unique index if not exists uniq_user_profiles_company_phone
  on user_profiles(company_id, phone)
  where phone is not null;


-- ============================================================
-- STEP 11：RLS（行レベルセキュリティ）の継続
-- ============================================================
-- service_role キーを使うNext.jsサーバーからのみアクセス可能。
-- フロントエンドから直接DBアクセスは引き続き不可。
alter table companies         enable row level security;
alter table tenant_settings   enable row level security;
alter table admins            enable row level security;
alter table super_admins      enable row level security;
alter table admin_audit_log   enable row level security;
alter table user_profiles     enable row level security;
alter table attendance        enable row level security;
alter table condition_reports enable row level security;

-- 開発用ポリシーがあれば全て削除（service_roleのみアクセス可にする）
drop policy if exists "dev_allow_all_profiles"   on user_profiles;
drop policy if exists "dev_allow_all_attendance" on attendance;
drop policy if exists "dev_allow_all_condition"  on condition_reports;


-- ============================================================
-- STEP 12：updated_at 自動更新トリガー
-- ============================================================
create or replace function trigger_set_updated_at()
returns trigger as $$
begin
    new.updated_at = now();
    return new;
end;
$$ language plpgsql;

drop trigger if exists set_updated_at on companies;
create trigger set_updated_at
  before update on companies
  for each row execute function trigger_set_updated_at();

drop trigger if exists set_updated_at on tenant_settings;
create trigger set_updated_at
  before update on tenant_settings
  for each row execute function trigger_set_updated_at();


-- ============================================================
-- 確認クエリ
-- ============================================================

-- 1) 全テナント一覧
select
    c.id,
    c.name,
    c.plan,
    c.status,
    c.invite_code,
    (select count(*) from user_profiles where company_id = c.id) as staff_count
from companies c
order by c.created_at;

-- 2) RLS が全テーブルで有効か
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in (
    'companies', 'tenant_settings', 'admins', 'super_admins',
    'admin_audit_log', 'user_profiles', 'attendance', 'condition_reports'
  )
order by tablename;

-- 3) ポリシーが0件であることを確認（service_roleのみアクセス可）
select tablename, policyname
from pg_policies
where schemaname = 'public';

-- 4) company_id NOT NULL になっているか
select column_name, is_nullable
from information_schema.columns
where table_name in ('user_profiles', 'attendance', 'condition_reports')
  and column_name = 'company_id';


-- ============================================================
-- 期待される最終状態：
--   ・companies に「ラクラク勤怠株式会社」が1行
--   ・RLS が8テーブル全てで true
--   ・policyname が0行（service_roleのみアクセス可）
--   ・user_profiles / attendance / condition_reports の
--     company_id が NOT NULL（is_nullable = NO）
-- ============================================================

-- ===================================================================
-- ▼▼▼ MULTITENANT_FIX_CASCADE.sql ▼▼▼
-- ===================================================================
-- ============================================================
-- マルチテナント FK制約 修正パッチ
-- ============================================================
-- 目的：テナント(companies)削除時に子テーブルが拒否しないよう設定し直す
--
-- 設計：
--   - user_profiles / attendance / condition_reports / tenant_settings / admins
--     → CASCADE（会社が消えたら子データも消す）
--   - admin_audit_log
--     → SET NULL（監査履歴は会社が消えても保持する。compliance目的）
--
-- 冪等：何度実行しても同じ結果になります
-- ============================================================

-- admin_audit_log: SET NULL に作り直す
alter table admin_audit_log
  drop constraint if exists admin_audit_log_company_id_fkey;
alter table admin_audit_log
  add constraint admin_audit_log_company_id_fkey
  foreign key (company_id) references companies(id) on delete set null;

-- user_profiles: CASCADE に作り直す
alter table user_profiles
  drop constraint if exists user_profiles_company_id_fkey;
alter table user_profiles
  add constraint user_profiles_company_id_fkey
  foreign key (company_id) references companies(id) on delete cascade;

-- attendance: CASCADE に作り直す
alter table attendance
  drop constraint if exists attendance_company_id_fkey;
alter table attendance
  add constraint attendance_company_id_fkey
  foreign key (company_id) references companies(id) on delete cascade;

-- condition_reports: CASCADE に作り直す
alter table condition_reports
  drop constraint if exists condition_reports_company_id_fkey;
alter table condition_reports
  add constraint condition_reports_company_id_fkey
  foreign key (company_id) references companies(id) on delete cascade;


-- ============================================================
-- 確認クエリ
-- ============================================================
-- delete_rule が以下の通りになっていればOK：
--   admin_audit_log_company_id_fkey      → SET NULL
--   attendance_company_id_fkey           → CASCADE
--   condition_reports_company_id_fkey    → CASCADE
--   user_profiles_company_id_fkey        → CASCADE
--   admins_company_id_fkey               → CASCADE  （既存）
--   tenant_settings_company_id_fkey      → CASCADE  （既存）
select
  tc.constraint_name,
  tc.table_name,
  rc.delete_rule
from information_schema.table_constraints tc
join information_schema.referential_constraints rc
  on tc.constraint_name = rc.constraint_name
where tc.constraint_type = 'FOREIGN KEY'
  and tc.table_schema = 'public'
  and tc.constraint_name like '%company_id_fkey'
order by tc.table_name;

-- ===================================================================
-- ▼▼▼ PHONE_ENCRYPTION_MIGRATION.sql ▼▼▼
-- ===================================================================
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

-- ===================================================================
-- ▼▼▼ PHASE_A_DISPATCH_MIGRATION.sql ▼▼▼
-- ===================================================================
-- ============================================================
-- ラクラク勤怠 Phase A：派遣モデル（派遣先・契約・シフト）マイグレーション
-- ============================================================
-- Supabase の SQL Editor で1回だけ実行してください。
-- 実行前に必ず Database → Backups で手動バックアップを取ること。
-- すべて additive（既存の打刻データ・単発運用を壊さない）。
-- 設計書：specs/PHASE_A_派遣モデル設計.md
-- ============================================================


-- ============================================================
-- STEP 1：clients テーブル（派遣先）
-- ============================================================
create table if not exists clients (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id) on delete cascade,
  name            text not null,                 -- 派遣先企業名
  workplace_name  text,                          -- 就業場所名
  address         text,
  contact_name    text,
  contact_phone   text,
  teishokubi      date,                           -- 抵触日（Phase Cで使用。今はnull可）
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_clients_company on clients(company_id);


-- ============================================================
-- STEP 2：assignments テーブル（契約/アサイン）
-- ============================================================
-- 単発＝type 'spot'（1日・start=end）／中長期＝type 'ongoing'（期間・複数シフト）
create table if not exists assignments (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id) on delete cascade,
  user_id         text not null,                  -- user_profiles.user_id（text PK）に対応
  client_id       uuid not null references clients(id) on delete cascade,
  type            text not null default 'spot'
                  check (type in ('spot', 'ongoing')),
  start_date      date not null,
  end_date        date,                           -- null=当日単発 or 期間未定
  job_content     text,
  hourly_rate     integer,                        -- 時給（円）
  status          text not null default 'active'
                  check (status in ('planned', 'active', 'ended')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_assignments_company on assignments(company_id);
create index if not exists idx_assignments_user    on assignments(user_id);
create index if not exists idx_assignments_client  on assignments(client_id);


-- ============================================================
-- STEP 3：shifts テーブル（シフト）
-- ============================================================
-- 単発＝assignmentに1件／中長期＝複数件（シフト表）
create table if not exists shifts (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id) on delete cascade,
  assignment_id   uuid not null references assignments(id) on delete cascade,
  work_date       date not null,
  start_time      time,
  end_time        time,
  break_minutes   integer not null default 0,
  status          text not null default 'planned'
                  check (status in ('planned', 'confirmed', 'done', 'absent')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_shifts_company    on shifts(company_id);
create index if not exists idx_shifts_assignment on shifts(assignment_id);
create index if not exists idx_shifts_date       on shifts(work_date);


-- ============================================================
-- STEP 4：attendance に紐づけ列を追加（非破壊・nullable）
-- ============================================================
-- 既存の打刻はそのまま動く。新しい運用でどのシフト/契約の打刻かを記録する。
alter table attendance add column if not exists shift_id      uuid references shifts(id) on delete set null;
alter table attendance add column if not exists assignment_id uuid references assignments(id) on delete set null;

create index if not exists idx_attendance_shift      on attendance(shift_id);
create index if not exists idx_attendance_assignment on attendance(assignment_id);


-- ============================================================
-- STEP 5：Row Level Security（既存方針を踏襲）
-- ============================================================
-- service_role キーを使うNext.jsサーバーからのみアクセス可能。
-- 許可ポリシーは作らない（＝service_roleのみ。フロントから直接DBアクセス不可）。
alter table clients     enable row level security;
alter table assignments enable row level security;
alter table shifts      enable row level security;


-- ============================================================
-- STEP 6：updated_at 自動更新トリガー
-- ============================================================
-- trigger_set_updated_at() は既存マイグレーションで作成済み。無い環境向けに冪等定義。
create or replace function trigger_set_updated_at()
returns trigger as $$
begin
    new.updated_at = now();
    return new;
end;
$$ language plpgsql;

drop trigger if exists set_updated_at on clients;
create trigger set_updated_at before update on clients
  for each row execute function trigger_set_updated_at();

drop trigger if exists set_updated_at on assignments;
create trigger set_updated_at before update on assignments
  for each row execute function trigger_set_updated_at();

drop trigger if exists set_updated_at on shifts;
create trigger set_updated_at before update on shifts
  for each row execute function trigger_set_updated_at();


-- ============================================================
-- 確認クエリ
-- ============================================================
-- select table_name from information_schema.tables
--   where table_name in ('clients','assignments','shifts') order by table_name;
-- select column_name from information_schema.columns
--   where table_name='attendance' and column_name in ('shift_id','assignment_id');

-- ===================================================================
-- ▼▼▼ db/migrations/0001_phase_b_payroll.sql ▼▼▼
-- ===================================================================
-- ============================================================
-- ラクラク勤怠 Phase B：給与集計・エクスポート マイグレーション【案・未実行】
-- ============================================================
-- ⚠️ これは案です。実行前に必ず：
--   1) ハヤト（security-auditor）・ノア（security-guardian）のダブルチェック
--   2) オーナー承認（rules.md Rule 1）
--   3) Supabase の Database → Backups で手動バックアップ
-- すべて additive（既存の打刻データ・単発運用・Phase A を壊さない）。
-- 設計書：specs/PHASE_B_給与エクスポート要件.md
-- ============================================================


-- ============================================================
-- STEP 1：company_payroll_settings（会社ごとの集計ルール・管理者が設定）
-- ============================================================
create table if not exists company_payroll_settings (
  company_id             uuid primary key references companies(id) on delete cascade,
  closing_day            int  not null default 31,   -- 締め日（末日=31, 20日締=20）。管理者設定
  week_start             int  not null default 1
                         check (week_start between 0 and 6),   -- 0=日,1=月...
  holiday_mode           text not null default 'weekly_fixed'
                         check (holiday_mode in ('weekly_fixed','shift')),
  prescribed_off_dows    int[] not null default '{0,6}',       -- 所定休日の曜日（日,土）
  statutory_holiday_dow  int  not null default 0
                         check (statutory_holiday_dow between 0 and 6),  -- 法定休日曜日（既定=日）
  shift_statutory_rule   text not null default 'weekly_auto'
                         check (shift_statutory_rule in ('weekly_auto','fixed_dow')),
  round_unit_min         int  not null default 1
                         check (round_unit_min in (1,5,15,60)),  -- 丸め単位（4種のみ）
  round_scope            text not null default 'month'
                         check (round_scope in ('month','day')),  -- 既定=月合計に丸め
  round_mode             text not null default 'up'
                         check (round_mode in ('up','nearest')),  -- 切り捨て一方向は許可しない
  overtime_rate          numeric(4,2) not null default 1.25,
  overtime60_rate        numeric(4,2) not null default 1.50,  -- 月60時間超の時間外
  night_rate             numeric(4,2) not null default 1.25,
  holiday_rate           numeric(4,2) not null default 1.35,
  -- みなし休憩：実働分の閾値→控除分。既定 6h超45分 / 8h超60分
  deemed_break_json      jsonb not null default '[{"over_min":360,"break_min":45},{"over_min":480,"break_min":60}]',
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);


-- ============================================================
-- STEP 2：timesheets（月次締めヘッダ：スタッフ×対象月）
-- ============================================================
create table if not exists timesheets (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references companies(id) on delete cascade,
  user_id        text not null,               -- user_profiles.user_id（text PK）に対応
  period_ym      text not null,               -- 対象年月 'YYYY-MM'（締め日で区切る）
  work_min       int  not null default 0,     -- 実働（法定内）
  overtime_min   int  not null default 0,     -- 法定外残業
  night_min      int  not null default 0,     -- 深夜
  holiday_min    int  not null default 0,     -- 法定休日労働
  estimated_pay  integer,                     -- 概算給与（円・確認用。正式計算ではない）
  status         text not null default 'draft'
                 check (status in ('draft','confirmed')),
  confirmed_at   timestamptz,
  confirmed_by   text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (company_id, user_id, period_ym)     -- 二重締め防止
);

create index if not exists idx_timesheets_company on timesheets(company_id);
create index if not exists idx_timesheets_period  on timesheets(company_id, period_ym);


-- ============================================================
-- STEP 3：timesheet_entries（日次明細：締めの内訳・監査用）
-- ============================================================
create table if not exists timesheet_entries (
  id             uuid primary key default gen_random_uuid(),
  timesheet_id   uuid not null references timesheets(id) on delete cascade,
  company_id     uuid not null references companies(id) on delete cascade,
  work_date      date not null,
  assignment_id  uuid references assignments(id) on delete set null,
  client_id      uuid references clients(id)     on delete set null,
  shift_id       uuid references shifts(id)      on delete set null,
  in_at          timestamptz,                 -- 採用した出勤打刻
  out_at         timestamptz,                 -- 採用した退勤打刻
  work_min       int not null default 0,
  overtime_min   int not null default 0,
  night_min      int not null default 0,
  holiday_min    int not null default 0,
  flags          text[] not null default '{}',  -- 例 {missing_punch, needs_review}
  created_at     timestamptz not null default now()
);

create index if not exists idx_ts_entries_ts      on timesheet_entries(timesheet_id);
create index if not exists idx_ts_entries_company on timesheet_entries(company_id);
create index if not exists idx_ts_entries_date    on timesheet_entries(company_id, work_date);


-- ============================================================
-- STEP 4：payroll_exports（エクスポート監査ログ）
-- ============================================================
create table if not exists payroll_exports (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id) on delete cascade,
  period_ym    text not null,
  scope        text not null default 'payroll'
               check (scope in ('payroll','client_report')),
  format       text not null default 'csv_generic',   -- csv_generic / freee / mfc / obic ...
  row_count    int  not null default 0,
  created_by   text,
  created_at   timestamptz not null default now()
);

create index if not exists idx_payroll_exports_company on payroll_exports(company_id, period_ym);


-- ============================================================
-- STEP 5：Row Level Security（既存方針を踏襲＝service_role のみ）
-- ============================================================
-- 許可ポリシーは作らない（フロントから直接DBアクセス不可。Next.jsサーバーの service_role のみ）。
alter table company_payroll_settings enable row level security;
alter table timesheets               enable row level security;
alter table timesheet_entries        enable row level security;
alter table payroll_exports          enable row level security;


-- ============================================================
-- STEP 6：updated_at 自動更新トリガー（既存 trigger_set_updated_at() を流用）
-- ============================================================
create or replace function trigger_set_updated_at()
returns trigger as $$
begin
    new.updated_at = now();
    return new;
end;
$$ language plpgsql;

drop trigger if exists set_updated_at on company_payroll_settings;
create trigger set_updated_at before update on company_payroll_settings
  for each row execute function trigger_set_updated_at();

drop trigger if exists set_updated_at on timesheets;
create trigger set_updated_at before update on timesheets
  for each row execute function trigger_set_updated_at();

-- ============================================================
-- 完了。ロールバック用に各 create は if not exists のため再実行安全。
-- ============================================================

-- ===================================================================
-- ▼▼▼ db/migrations/0002_phase_c_compliance.sql ▼▼▼
-- ===================================================================
-- ============================================================
-- ラクラク勤怠 Phase C：派遣法コンプラ マイグレーション【案・未実行】
-- ============================================================
-- ⚠️ 実行前に：ハヤト/ノアのダブルチェック → オーナー承認（rules.md Rule 1）→ Supabase手動バックアップ。
-- すべて additive（既存の派遣先/契約データを壊さない）。Phase A/B と同じ流儀。
-- 設計：specs/PHASE_A_派遣モデル設計.md §6 / 抵触日・3年ルール
-- ============================================================


-- ============================================================
-- STEP 1：clients に抵触日算出用の列を追加（非破壊・nullable）
-- ============================================================
-- dispatch_start_date：派遣受入開始日。teishokubi 未設定時に +3年で事業所抵触日を自動算出する。
-- teishokubi_extended_until：意見聴取による延長後の抵触日（設定時はこちらを優先）。
alter table clients add column if not exists dispatch_start_date       date;
alter table clients add column if not exists teishokubi_extended_until date;


-- ============================================================
-- STEP 2：assignments に組織単位を追加（個人単位3年の判定に使用）
-- ============================================================
alter table assignments add column if not exists org_unit text;


-- ============================================================
-- STEP 3：compliance_acks（抵触日アラートの確認・対応記録）
-- ============================================================
create table if not exists compliance_acks (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references companies(id) on delete cascade,
  scope            text not null check (scope in ('office','individual')),
  client_id        uuid,                 -- 対象派遣先（任意）
  user_id          text,                 -- 対象スタッフ（個人単位のとき）
  org_unit         text,
  limit_date       date,                 -- 対応時点の抵触日
  note             text,                 -- 対応メモ（延長手続き済み等）
  acknowledged_by  text,                 -- 対応した管理者
  acknowledged_at  timestamptz not null default now()
);

create index if not exists idx_compliance_acks_company on compliance_acks(company_id, acknowledged_at desc);


-- ============================================================
-- STEP 4：Row Level Security（既存方針を踏襲＝service_role のみ）
-- ============================================================
-- 許可ポリシーは作らない（フロントから直接DBアクセス不可。Next.jsサーバーの service_role のみ）。
alter table compliance_acks enable row level security;


-- ============================================================
-- 完了。すべて if not exists のため再実行安全。ロールバックは追加列/テーブルの drop のみ。
-- ============================================================

-- ===================================================================
-- ▼▼▼ db/migrations/0003_phase_d_billing.sql ▼▼▼
-- ===================================================================
-- ============================================================
-- ラクラク勤怠 Phase D：課金（プラン管理）マイグレーション【案・未実行】
-- ============================================================
-- ⚠️ 実行前に：ハヤト/ノアのダブルチェック → オーナー承認（rules.md Rule 1）→ Supabase手動バックアップ。
-- すべて additive（既存を壊さない）。決済（Stripe等）は本フェーズ対象外＝プラン状態の保持のみ。
-- 料金体系：らくらく勤怠/sales/02_料金プラン.md（スタッフ数×単価）
-- ============================================================


-- ============================================================
-- STEP 1：company_subscription（会社ごとの契約プラン）
-- ============================================================
create table if not exists company_subscription (
  company_id    uuid primary key references companies(id) on delete cascade,
  plan          text not null default 'trial'
                check (plan in ('trial','free','starter','standard','enterprise')),
  status        text not null default 'trial'
                check (status in ('trial','active','free')),
  trial_ends_on date,                         -- トライアル終了日（任意）
  started_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);


-- ============================================================
-- STEP 2：Row Level Security（既存方針＝service_role のみ）
-- ============================================================
alter table company_subscription enable row level security;


-- ============================================================
-- STEP 3：updated_at 自動更新トリガー（既存 trigger_set_updated_at() を流用）
-- ============================================================
create or replace function trigger_set_updated_at()
returns trigger as $$
begin
    new.updated_at = now();
    return new;
end;
$$ language plpgsql;

drop trigger if exists set_updated_at on company_subscription;
create trigger set_updated_at before update on company_subscription
  for each row execute function trigger_set_updated_at();


-- ============================================================
-- 完了。if not exists のため再実行安全。ロールバックは drop table のみ。
-- ============================================================

-- ===================================================================
-- ▼▼▼ db/migrations/0004_phase_b_paid_leave.sql ▼▼▼
-- ===================================================================
-- ============================================================
-- ラクラク勤怠 Phase B：有給管理 マイグレーション
-- ============================================================
-- すべて additive（既存データを壊さない）。RLSは有効・ポリシー無し＝service_role のみ（既存方針を踏襲）。
-- 位置づけ：付与と取得(消化)を「記録・可視化」する管理補助。正式な法的判断は社労士に委ねる。
-- ============================================================


-- ============================================================
-- STEP 1：paid_leave_grants（有給の付与）
-- ============================================================
-- granted_days：付与日数（半日単位もあり得るので numeric）。
-- expires_on：失効日（通常は付与日+2年）。失効した付与の未消化分は残から外す。
create table if not exists paid_leave_grants (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  user_id       text not null,
  granted_days  numeric(4,1) not null check (granted_days > 0),
  grant_date    date not null,
  expires_on    date not null,
  note          text,
  created_by    text,
  created_at    timestamptz not null default now()
);

create index if not exists idx_pl_grants_company on paid_leave_grants(company_id, user_id);


-- ============================================================
-- STEP 2：paid_leave_takings（有給の取得＝消化）
-- ============================================================
-- days：1日 or 半休(0.5)。
create table if not exists paid_leave_takings (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id) on delete cascade,
  user_id      text not null,
  taken_date   date not null,
  days         numeric(2,1) not null check (days in (0.5, 1.0)),
  note         text,
  created_by   text,
  created_at   timestamptz not null default now()
);

create index if not exists idx_pl_takings_company on paid_leave_takings(company_id, user_id);


-- ============================================================
-- STEP 3：Row Level Security（既存方針＝service_role のみ、許可ポリシーは作らない）
-- ============================================================
alter table paid_leave_grants  enable row level security;
alter table paid_leave_takings enable row level security;


-- ============================================================
-- 完了。すべて if not exists のため再実行安全。ロールバックは drop table のみ。
-- ============================================================

-- ===================================================================
-- ▼▼▼ db/migrations/0005_phase_c_ledger_fields.sql ▼▼▼
-- ===================================================================
-- ============================================================
-- ラクラク勤怠 Phase C：派遣元管理台帳(法37条) 記載事項の拡充
-- ============================================================
-- すべて additive（既存データ非破壊）。RLSは有効・ポリシー無し＝service_role のみ。
-- 目的：ミオ一次レビューで「中」判定だった「管理台帳の法定記載事項不足」を埋める。
--   会社単位：派遣元責任者・苦情申出先・待遇決定方式（労使協定/均等均衡）
--   派遣先単位：派遣先責任者
--   スタッフ単位：無期/有期区分・社会保険加入状況
-- ※ 就業日時は shifts、業務内容/組織単位/期間/抵触日は既存で対応済み。
-- ============================================================


-- STEP 1：会社単位のコンプラ設定
create table if not exists compliance_settings (
  company_id        uuid primary key references companies(id) on delete cascade,
  agency_manager    text,   -- 派遣元責任者
  complaint_contact text,   -- 苦情の申出先・処理担当
  wage_method       text check (wage_method in ('roushi','kinto')), -- 待遇決定：労使協定方式/均等均衡方式
  updated_at        timestamptz not null default now()
);

alter table compliance_settings enable row level security;

-- 追跡テーブルにも RLS（ポリシーは作らない＝service_role のみ）
alter table schema_migrations enable row level security;


-- STEP 2：派遣先（clients）に派遣先責任者
alter table clients add column if not exists dispatch_manager text;


-- STEP 3：スタッフ（user_profiles）に無期/有期・社保加入状況
-- employment_type: 'indefinite'(無期) / 'fixed'(有期)
-- social_insurance: 'enrolled'(加入) / 'not_enrolled'(未加入) / 'exempt'(対象外)
alter table user_profiles add column if not exists employment_type text
  check (employment_type in ('indefinite','fixed'));
alter table user_profiles add column if not exists social_insurance text
  check (social_insurance in ('enrolled','not_enrolled','exempt'));


-- STEP 4：updated_at トリガ（既存の共通関数を利用）
create or replace function trigger_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_updated_at on compliance_settings;
create trigger set_updated_at before update on compliance_settings
  for each row execute function trigger_set_updated_at();


-- ============================================================
-- 完了。すべて if not exists のため再実行安全。ロールバックは追加列/テーブルの drop のみ。
-- ============================================================

-- ===================================================================
-- ▼▼▼ schema_migrations 記録（自動マイグレーションと整合） ▼▼▼
-- ===================================================================
create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now());
insert into schema_migrations(name) values
  ('0001_phase_b_payroll.sql'), ('0002_phase_c_compliance.sql'), ('0003_phase_d_billing.sql'),
  ('0004_phase_b_paid_leave.sql'), ('0005_phase_c_ledger_fields.sql')
on conflict (name) do nothing;
-- 完了。以降は db/migrations/ に 0006 以降を足せば staging にも同じ手順で反映できます。

-- ===================================================================
-- ▼▼▼ 0007_server_sessions.sql ▼▼▼
-- ===================================================================
create table if not exists auth_sessions (
  id                  uuid primary key default gen_random_uuid(),
  actor_type          text not null check (actor_type in ('admin', 'super_admin')),
  actor_id            text not null,
  company_id          uuid,
  token_hash          text not null,
  idle_ttl_seconds    integer not null,
  idle_expires_at     timestamptz not null,
  absolute_expires_at timestamptz not null,
  last_used_at        timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  revoked_at          timestamptz,
  user_agent          text,
  ip                  text,
  prev_token_hash     text,
  rotated_at          timestamptz
);
create index if not exists idx_auth_sessions_actor on auth_sessions (actor_type, actor_id);
create index if not exists idx_auth_sessions_sweep on auth_sessions (absolute_expires_at);
alter table auth_sessions enable row level security;
