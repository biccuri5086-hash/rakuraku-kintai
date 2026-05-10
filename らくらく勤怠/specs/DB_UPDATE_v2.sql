-- ★これだけ実行してください（Supabase SQL Editor に貼り付けてRunを押す）
-- 既存テーブルは壊れません。新しいテーブルの追加とGPS列の追加のみです。

-- 1. ユーザープロファイルテーブル（新規追加）
create table if not exists user_profiles (
  user_id text primary key,
  display_name text not null,
  phone text not null,
  created_at timestamptz not null default now()
);

alter table user_profiles enable row level security;
create policy "dev_allow_all_profiles" on user_profiles for all using (true) with check (true);

-- 2. attendance テーブルにGPS列を追加
alter table attendance add column if not exists lat double precision;
alter table attendance add column if not exists lng double precision;
alter table attendance add column if not exists gps_accuracy double precision;
