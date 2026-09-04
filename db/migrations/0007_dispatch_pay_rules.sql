-- ============================================================
-- Phase E: 派遣先ごとの賃率版管理（pay_rules）・打刻の冪等化・現場紐付け
-- ============================================================
-- 背景（らくらく勤怠/specs/ARCH_商用インフラ設計_v1.md 3章 参照）:
--   - 給与計算が assignments.hourly_rate を「スタッフに1件」しか採用しておらず、
--     同月に複数派遣先を掛け持ちすると片方の時給で全時間が計算されるバグがある。
--   - 打刻に通信リトライ時の重複防止キーが無い。
--   - 打刻がどの現場のものか（shift_id/assignment_id）を書き込んでいない。
-- このマイグレーションは冪等。何度流しても安全。
-- ============================================================

-- ============================================================
-- STEP 1: pay_rules（賃率・計算ルールの版管理）
-- ============================================================
-- scope='company'    … 会社全体の既定ルール（company_payroll_settings 相当）
-- scope='client'     … 派遣先単位で残業ルール等を上書き
-- scope='assignment' … 契約単位（基本は時給のみ。ルールは client/company にフォールバック）
create table if not exists pay_rules (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references companies(id) on delete cascade,

  scope                 text not null check (scope in ('company', 'client', 'assignment')),
  client_id             uuid references clients(id) on delete cascade,
  assignment_id         uuid references assignments(id) on delete cascade,

  -- 有効期間（版管理）。effective_to が null = 現在も有効。
  effective_from        date not null,
  effective_to          date,

  base_hourly_rate      integer,
  overtime_rate         numeric(4,2) not null default 1.25,
  overtime60_rate       numeric(4,2) not null default 1.50,
  night_rate            numeric(4,2) not null default 1.25,
  holiday_rate          numeric(4,2) not null default 1.35,

  prescribed_daily_min  integer,
  deemed_break_json     jsonb not null default '[{"over_min":360,"break_min":45},{"over_min":480,"break_min":60}]',
  round_unit_min        integer not null default 1 check (round_unit_min in (1,5,15,60)),
  round_scope           text not null default 'month' check (round_scope in ('month','day')),
  round_mode             text not null default 'up' check (round_mode in ('up','nearest')),

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint pay_rules_scope_check check (
    (scope = 'company'    and client_id is null     and assignment_id is null) or
    (scope = 'client'     and client_id is not null and assignment_id is null) or
    (scope = 'assignment' and assignment_id is not null)
  ),
  constraint pay_rules_effective_check check (effective_to is null or effective_to > effective_from)
);

create index if not exists idx_pay_rules_company    on pay_rules(company_id);
create index if not exists idx_pay_rules_client     on pay_rules(client_id) where client_id is not null;
create index if not exists idx_pay_rules_assignment on pay_rules(assignment_id) where assignment_id is not null;

-- 同一スコープ・同一対象で有効期間が重なるルールを作れないようにする
create extension if not exists btree_gist;

alter table pay_rules add column if not exists effective_range daterange
  generated always as (daterange(effective_from, effective_to, '[)')) stored;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'pay_rules_no_overlap'
  ) then
    alter table pay_rules add constraint pay_rules_no_overlap
      exclude using gist (
        company_id with =,
        coalesce(client_id, '00000000-0000-0000-0000-000000000000'::uuid) with =,
        coalesce(assignment_id, '00000000-0000-0000-0000-000000000000'::uuid) with =,
        effective_range with &&
      );
  end if;
end $$;

alter table pay_rules enable row level security;


-- ============================================================
-- STEP 2: attendance — 冪等キー・現場紐付け
-- ============================================================
alter table attendance add column if not exists idempotency_key uuid;
-- 部分ユニークインデックス：null は何件あっても衝突させない（未対応クライアント互換）
create unique index if not exists idx_attendance_idempotency_key
  on attendance(idempotency_key) where idempotency_key is not null;

alter table attendance add column if not exists client_id uuid references clients(id) on delete set null;
alter table attendance add column if not exists resolved_by text
  check (resolved_by in ('shift_match', 'location_match', 'manual', 'unresolved'));
alter table attendance add column if not exists deleted_at timestamptz;

create index if not exists idx_attendance_client on attendance(client_id);


-- ============================================================
-- STEP 3: timesheet_entries — 確定時に適用したルールをスナップショット
-- ============================================================
-- 締め後に pay_rules を改定しても、確定済みの金額が動かないようにするため。
alter table timesheet_entries add column if not exists applied_pay_rule_id     uuid references pay_rules(id);
alter table timesheet_entries add column if not exists applied_hourly_rate    integer;
alter table timesheet_entries add column if not exists applied_overtime_rate  numeric(4,2);
alter table timesheet_entries add column if not exists applied_night_rate     numeric(4,2);
alter table timesheet_entries add column if not exists applied_holiday_rate   numeric(4,2);


-- ============================================================
-- STEP 4: attendance_corrections（打刻修正の追記専用ログ）
-- ============================================================
-- attendance は物理削除・直接上書きせず、修正はここに追記する方針にする。
create table if not exists attendance_corrections (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references companies(id) on delete cascade,
  attendance_id  uuid not null references attendance(id) on delete cascade,
  before_json    jsonb not null,
  after_json     jsonb not null,
  reason         text not null,
  corrected_by   text not null,
  corrected_at   timestamptz not null default now()
);

create index if not exists idx_attendance_corrections_attendance on attendance_corrections(attendance_id);
create index if not exists idx_attendance_corrections_company    on attendance_corrections(company_id);

alter table attendance_corrections enable row level security;
