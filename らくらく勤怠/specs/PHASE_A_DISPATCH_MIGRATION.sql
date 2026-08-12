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
