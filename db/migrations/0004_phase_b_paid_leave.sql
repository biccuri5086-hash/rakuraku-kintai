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
