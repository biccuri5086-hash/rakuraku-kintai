-- ============================================================
-- ラクラク勤怠: 案A(限定カギ方式) — service_role一本からの多層防御追加
-- ============================================================
-- 背景:
--   今までの唯一の防御は「各APIがcompany_idでフィルタする」というアプリ層のチェック
--   (scripts/tenant_isolation_test.tsが静的検査)だけだった。service_roleはRLSを
--   常にバイパスするため、RLSポリシーをいくら書いても効いていなかった(0006参照)。
--
--   このマイグレーションは、service_roleとは別に「company_idクレーム付きの署名済み
--   JWTでしかログインできず、かつその会社のデータしか触れない」専用ロール app_tenant
--   を新設する。src/lib/tenant-jwt.ts / src/lib/supabase-tenant.ts が発行するJWTの
--   company_idクレームをRLSが検証する。
--
--   アプリ層のチェックを置き換えるものではない。あくまで「アプリのコードにcompany_id
--   フィルタの書き忘れがあっても、DB側が物理的に他社データへのアクセスをブロックする」
--   保険。既存のservice_role経路・RLSポリシー0件の原則(0006)はそのまま維持する。
--
-- 対象テーブル: scripts/tenant_isolation_test.ts の TENANT 定数と揃えてある
--   (= 実際に src/app/api/admin/** が触れているテナントスコープテーブル)。
--   admins / companies / compliance_settings / paid_leave_grants / paid_leave_takings は
--   このマイグレーションの対象外(現時点でapp_tenant経路に載せ替えていないため)。
--   載せ替えが進んだら、この一覧とtenant_isolation_test.tsの両方を更新すること。
--
-- 冪等。何度流しても安全。
-- ============================================================

-- 1) app_tenant ロールを作成(nologin: PostgRESTがauthenticator経由でSET ROLEする専用ロールで、
--    このロール自身のパスワードでの直接ログインは許可しない)
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_tenant') then
    create role app_tenant nologin noinherit;
  end if;
end $$;

-- PostgRESTは authenticator ロールで接続し、JWTの role クレームに応じて
-- SET ROLE する。そのために authenticator が app_tenant のメンバーである必要がある。
grant app_tenant to authenticator;

grant usage on schema public to app_tenant;

-- 2) JWTクレームからcompany_idを安全に取り出すヘルパー。
--    クレームが無い/壊れている/company_idが無い場合は必ずnullを返す(フェイルクローズ)。
--    nullを返せば "company_id = app_tenant_company_id()" はどの行にも一致しないため、
--    パース失敗が「全部見える」ではなく「何も見えない」側に倒れる。
create or replace function app_tenant_company_id()
returns uuid
language plpgsql
stable
as $$
declare
  claims text;
  cid text;
begin
  claims := current_setting('request.jwt.claims', true);
  if claims is null or claims = '' then
    return null;
  end if;
  cid := (claims::json ->> 'company_id');
  if cid is null or cid = '' then
    return null;
  end if;
  return cid::uuid;
exception when others then
  return null;
end;
$$;

-- 3) 対象テーブルごとに: app_tenantへの権限付与 + company_idスコープのRLSポリシー
--    権限は「そのテーブルに対してapp_tenant経由で本当に必要な操作」だけに絞る
--    (ノア指摘：最小権限。特に admin_audit_log は改ざん耐性のためUPDATE/DELETEを渡さない)。
do $$
declare
  t text;
  -- 通常のテナントテーブル：CRUD全部が必要(既存のadmin CRUDルートの操作に対応)
  full_crud_tables text[] := array[
    'user_profiles', 'attendance', 'condition_reports', 'clients', 'assignments', 'shifts',
    'timesheets', 'timesheet_entries', 'payroll_exports', 'company_payroll_settings',
    'compliance_acks', 'company_subscription'
  ];
  -- 監査ログ：追記のみ許可。app_tenant経由でのUPDATE/DELETEは許可しない
  -- (改ざん・証跡削除を、たとえ管理者向けAPIのバグ経由でも起こせないようにする)。
  append_only_tables text[] := array['admin_audit_log'];
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

  foreach t in array append_only_tables loop
    if to_regclass(format('public.%I', t)) is null then
      raise notice 'skip (table not found): %', t;
      continue;
    end if;

    execute format('grant select, insert on table public.%I to app_tenant', t);

    execute format('drop policy if exists app_tenant_company_scope_select on public.%I', t);
    execute format(
      'create policy app_tenant_company_scope_select on public.%I
         for select
         to app_tenant
         using (company_id = app_tenant_company_id())',
      t
    );

    execute format('drop policy if exists app_tenant_company_scope_insert on public.%I', t);
    execute format(
      'create policy app_tenant_company_scope_insert on public.%I
         for insert
         to app_tenant
         with check (company_id = app_tenant_company_id())',
      t
    );

    raise notice 'app_tenant RLSポリシー(追記のみ)を設定: %', t;
  end loop;
end $$;

-- ============================================================
-- 適用後の確認(Supabase SQL Editor で実行)
--
--   -- app_tenant のポリシーが対象テーブル数ぶん存在するか(13件であること)
--   select tablename, policyname from pg_policies
--   where schemaname = 'public' and 'app_tenant' = any(roles);
--
--   -- authenticator が app_tenant を継承できるか
--   select pg_has_role('authenticator', 'app_tenant', 'member');
--
--   -- anon/authenticated には相変わらず何も付与されていないこと(0006の原則を壊していないか)
--   select tablename, policyname, roles from pg_policies
--   where schemaname = 'public'
--     and roles && array['anon','authenticated']::name[];
-- ============================================================
