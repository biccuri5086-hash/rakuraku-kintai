-- ============================================================
-- staging スキーマ用：pay-rules 画面などを動作確認するためのテストデータ
-- ============================================================
-- LINEでの実登録なしに「スタッフ・派遣先・契約」を1件ずつ作る。
-- assignments.user_id は user_profiles への外部キー制約が無いため、
-- こうしたダミーのuser_idでも管理画面上は普通のスタッフとして扱われる。
--
-- 【手順】
-- 1. まず /superadmin で会社(company)を1つ作成しておくこと（このSQLはその会社に紐付ける）
-- 2. このファイルをそのままSQL Editorで実行する
-- ============================================================

set search_path to staging;

-- 対象の会社（最初に作った1社を使う。複数社あるなら company_id を直接指定して書き換えること）
do $$
declare
  v_company_id uuid;
  v_client_id  uuid;
begin
  select id into v_company_id from companies order by created_at asc limit 1;
  if v_company_id is null then
    raise exception '会社が1件もありません。先に /superadmin で会社を作成してください。';
  end if;

  -- テスト用スタッフ（LINE未連携のダミー）
  insert into user_profiles (user_id, display_name, full_name, phone, company_id, status)
  values ('test-staff-001', 'テスト太郎', 'テスト太郎', '09000000000', v_company_id, 'active')
  on conflict (user_id) do update
    set company_id = excluded.company_id,
        status = excluded.status;

  insert into user_profiles (user_id, display_name, full_name, phone, company_id, status)
  values ('test-staff-002', 'テスト花子', 'テスト花子', '09000000001', v_company_id, 'active')
  on conflict (user_id) do update
    set company_id = excluded.company_id,
        status = excluded.status;

  -- テスト用派遣先
  insert into clients (company_id, name, workplace_name, address)
  values (v_company_id, 'テスト派遣先A', 'テスト工場', '東京都テスト区1-1-1')
  returning id into v_client_id;

  -- テスト太郎をテスト派遣先Aに配属（時給1200円）
  insert into assignments (company_id, user_id, client_id, type, start_date, hourly_rate, status)
  values (v_company_id, 'test-staff-001', v_client_id, 'ongoing', current_date - 30, 1200, 'active');

  raise notice 'テストデータ投入完了: company_id=%, client_id=%', v_company_id, v_client_id;
end $$;

-- 確認
select a.id as assignment_id, u.display_name as staff, c.name as client, a.hourly_rate, a.start_date
from staging.assignments a
join staging.user_profiles u on u.user_id = a.user_id
join staging.clients c on c.id = a.client_id;
