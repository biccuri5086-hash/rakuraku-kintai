-- ============================================================
-- ラクラク勤怠: 案A(限定カギ方式)の対象拡大 — フォローアップ分
-- ============================================================
-- 0008で「scripts/tenant_isolation_test.tsのTENANT定数と同じ13テーブル」に絞ったが、
-- 実際には admin向けAPIがそれ以外にも company_id スコープで触っているテーブルがあった
-- (ハヤト指摘の抜け穴)。ここで追いつかせる。対象:
--   paid_leave_grants / paid_leave_takings / compliance_settings / tenant_settings
--     → company_idカラムを持つ通常のテナントテーブル。0008と同じCRUDパターン。
--   admins
--     → company_idカラムを持つ(unique(company_id, email))。0008と同じCRUDパターンで足りる。
--       ただしログイン処理(src/app/api/admin/login/route.ts)はメールだけでの
--       全社横断検索が必要なため、意図的にservice_roleのまま(app_tenant経路には載せない)。
--   companies
--     → company_idカラムが無く、id自体がテナントの識別子という特殊な形。
--       専用のポリシーを書く。admin向けAPIはcompaniesをINSERT/DELETEしない
--       (会社の作成・削除は運営者専用/pg_cronの領分)ため、SELECT/UPDATEのみ許可する。
--
-- あわせて company_subscription への DELETE 権限を剥奪する(ノア指摘：
-- billing/route.ts はSELECT/UPSERTしかせず、DELETEは不要だった。0008では
-- 一律CRUDを付与してしまっていたため、ここで最小権限に絞り直す)。
--
-- 冪等。何度流しても安全。
-- ============================================================

-- 1) 通常パターンのテーブル(company_idカラムを持つ)
do $$
declare
  t text;
  full_crud_tables text[] := array[
    'paid_leave_grants', 'paid_leave_takings', 'compliance_settings', 'tenant_settings', 'admins'
  ];
begin
  foreach t in array full_crud_tables loop
    if to_regclass(format('public.%I', t)) is null then
      raise notice 'skip (table not found): %', t;
      continue;
    end if;

    execute format('grant select, insert, update, delete on table public.%I to app_tenant', t);

    execute format('drop policy if exists app_tenant_company_scope on public.%I', t);
    execute format(
      'create policy app_tenant_company_scope on public.%I
         for all
         to app_tenant
         using (company_id = app_tenant_company_id())
         with check (company_id = app_tenant_company_id())',
      t
    );

    raise notice 'app_tenant RLSポリシー(CRUD)を設定: %', t;
  end loop;
end $$;

-- 2) companies: company_idカラムが無く、idそのものがテナント識別子。
--    現時点で /api/admin/** が companies を書き換えることは無い(SELECTのみ)ため、
--    ハヤト指摘により最小権限としてSELECTのみ付与する。会社のstatus/planといった
--    運営判断に関わる列を、将来の実装ミスでapp_tenant経由から書き換え可能にしない
--    ため。将来、顧客の自己サービス設定機能などでUPDATEが必要になったら、
--    列を絞ったGRANT(例: grant update (contact_name, contact_email) ...)を
--    別マイグレーションで追加すること(status/planは対象に含めない)。
do $$
begin
  if to_regclass('public.companies') is not null then
    grant select on table public.companies to app_tenant;

    drop policy if exists app_tenant_own_company_scope on public.companies;
    create policy app_tenant_own_company_scope on public.companies
      for select
      to app_tenant
      using (id = app_tenant_company_id());

    -- 万一過去に本マイグレーションの旧版でUPDATEを付与していた場合に備え、明示的に剥奪(冪等)。
    revoke update on table public.companies from app_tenant;
    drop policy if exists app_tenant_own_company_update on public.companies;

    raise notice 'app_tenant RLSポリシー(SELECTのみ)を設定: companies';
  end if;
end $$;

-- 3) company_subscription: DELETE権限は不要だったので剥奪(最小権限に是正)。
--    権限が元々無い状態でrevokeしてもエラーにならない(冪等)。
revoke delete on table public.company_subscription from app_tenant;

-- ============================================================
-- 適用後の確認(Supabase SQL Editor で実行)
--
--   select tablename, policyname, cmd from pg_policies
--   where schemaname = 'public' and 'app_tenant' = any(roles)
--   order by tablename;
--
--   -- company_subscriptionにDELETE権限が残っていないこと(0行が正常)
--   select grantee, privilege_type from information_schema.role_table_grants
--   where table_name = 'company_subscription' and grantee = 'app_tenant' and privilege_type = 'DELETE';
-- ============================================================
