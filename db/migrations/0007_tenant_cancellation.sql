-- ============================================================
-- ラクラク勤怠: テナント解約の自動化(論理削除30日 → 自動物理削除)
-- ============================================================
-- 設計: らくらく勤怠/specs/テナント削除自動化_設計.md
-- ハヤト(セキュリティ監査)・ノア(アクセス統制)のダブルチェック済み。
--
-- 目的:
--   1. companies.status を 'cancelled' にした日時を記録する(cancelled_at)。
--   2. 解約から30日経過した会社を、毎晩 pg_cron が自動で物理削除する
--      (companies を消せば on delete cascade で子テーブルも全て消える設計は既存)。
--   3. 削除の実行結果を admin_audit_log に記録する。
--
-- セキュリティ上の注意(ハヤト指摘):
--   PostgreSQLの関数はデフォルトでPUBLICにEXECUTE権限が付与されるため、
--   何も指定しないとSupabaseのPostgREST経由(/rest/v1/rpc/...)でanonキーだけで
--   誰でも呼び出せてしまう。このマイグレーションで明示的に権限を剥奪する。
--   既存の purge_expired_rate_limits() も同じ穴があったため、ついでに塞ぐ。
--
-- 冪等。何度流しても安全。
-- ============================================================

-- 1) 解約日時を記録する列を追加
alter table companies add column if not exists cancelled_at timestamptz;
create index if not exists idx_companies_cancelled_at on companies(cancelled_at)
  where cancelled_at is not null;

-- 2) pg_cron 拡張を有効化
--    ※ Supabaseプロジェクトのプラン/設定によっては失敗することがある。
--      失敗した場合はこのマイグレーション全体がロールバックされるため安全
--      (scripts/migrate.mjs は1ファイル=1トランザクション)。
--      その場合はVercel Cron方式へのフォールバックを検討する。
create extension if not exists pg_cron;

-- 3) 解約から30日経過した会社を物理削除する関数
create or replace function purge_cancelled_companies()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  rec record;
  purged integer := 0;
begin
  for rec in
    select id, name from companies
    where status = 'cancelled'
      and cancelled_at is not null
      and cancelled_at <= now() - interval '30 days'
  loop
    begin
      -- 削除前に記録する。company_id は削除後 on delete set null で
      -- 外れるため、company_name を details に退避しておく。
      insert into admin_audit_log (action, details, actor_type)
      values (
        'system_company_purge',
        jsonb_build_object('company_id', rec.id, 'company_name', rec.name, 'purged_at', now()),
        'system'
      );

      delete from companies where id = rec.id; -- 子テーブルは on delete cascade で自動削除
      purged := purged + 1;
    exception when others then
      -- 1社の失敗が他社の処理を止めないよう、この会社だけロールバックして次へ進む。
      insert into admin_audit_log (action, details, actor_type)
      values (
        'system_company_purge_failed',
        jsonb_build_object('company_id', rec.id, 'error', sqlerrm),
        'system'
      );
    end;
  end loop;
  return purged;
end;
$$;

-- PUBLIC / anon / authenticated からの直接呼び出し(PostgRESTのRPC経由含む)を禁止。
-- pg_cron はスケジューラ内部(このマイグレーションを実行した特権ロール)から実行するため、
-- この権限剥奪の影響を受けない。
revoke execute on function purge_cancelled_companies() from public;
revoke execute on function purge_cancelled_companies() from anon;
revoke execute on function purge_cancelled_companies() from authenticated;

-- 4) 毎日 深夜3:00 JST (= 18:00 UTC) に実行するスケジュールを登録(冪等)
do $$
begin
  if exists (select 1 from cron.job where jobname = 'purge_cancelled_companies_daily') then
    perform cron.unschedule('purge_cancelled_companies_daily');
  end if;

  perform cron.schedule(
    'purge_cancelled_companies_daily',
    '0 18 * * *',
    $cron$select purge_cancelled_companies();$cron$
  );
end $$;

-- ============================================================
-- 5) 既存の同種の穴を同時に塞ぐ(ハヤト指摘・推奨対応)
--    purge_expired_rate_limits() も同じくEXECUTE権限がPUBLICに開放されたままだった。
-- ============================================================
revoke execute on function purge_expired_rate_limits() from public;
revoke execute on function purge_expired_rate_limits() from anon;
revoke execute on function purge_expired_rate_limits() from authenticated;

-- ============================================================
-- 適用後の確認(Supabase SQL Editor で実行)
--
--   -- スケジュールが登録されているか
--   select jobname, schedule, active from cron.job
--   where jobname = 'purge_cancelled_companies_daily';
--
--   -- 関数のEXECUTE権限が anon/authenticated/PUBLIC に残っていないか(0行が正常)
--   select routine_name, grantee, privilege_type
--   from information_schema.routine_privileges
--   where routine_name in ('purge_cancelled_companies', 'purge_expired_rate_limits')
--     and grantee in ('anon', 'authenticated', 'PUBLIC');
--
--   -- 手動で1回動かして確認したい場合(対象が無ければ 0 が返る)
--   select purge_cancelled_companies();
-- ============================================================
