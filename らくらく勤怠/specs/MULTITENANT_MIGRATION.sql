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
