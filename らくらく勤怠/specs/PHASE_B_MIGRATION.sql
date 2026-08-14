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
