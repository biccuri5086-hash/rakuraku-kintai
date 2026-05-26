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
