-- ============================================================
-- Phase F: スタッフの無効化フラグ・給与再確定の監査対応
-- ============================================================
-- 背景：
--  - me_session Cookie に company_id をキャッシュする改修(0007後のAPI変更)により、
--    「退会/退職させたスタッフの打刻を即座に止める」までの猶予がCookie TTL分
--    (最大30分)発生するようになった。company_id 自体はほぼ変わらないため
--    キャッシュ自体は妥当だが、「このスタッフ/会社は今も有効か」は短い間隔で
--    再確認する必要がある。そのための user_profiles.status を追加する。
--  - 給与の確定(timesheets)は現状 upsert のみで、確定後に再確定すると
--    無言で上書きされ変更履歴が残らない。これは admin_audit_log（既存の
--    汎用監査ログ）に記録することで対応する（新規テーブルは不要）。
-- 冪等。何度流しても安全。

alter table user_profiles add column if not exists status text not null default 'active'
  check (status in ('active', 'inactive'));

create index if not exists idx_user_profiles_status on user_profiles(status);
