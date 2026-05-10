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

-- 開発用ポリシー（全操作許可）
create policy "dev_allow_all_profiles" on user_profiles for all using (true) with check (true);
create policy "dev_allow_all_attendance" on attendance for all using (true) with check (true);
create policy "dev_allow_all_condition" on condition_reports for all using (true) with check (true);

-- 既存の attendance テーブルにGPS列を追加する場合（テーブルが既に存在する場合のみ実行）
-- alter table attendance add column if not exists lat double precision;
-- alter table attendance add column if not exists lng double precision;
-- alter table attendance add column if not exists gps_accuracy double precision;
