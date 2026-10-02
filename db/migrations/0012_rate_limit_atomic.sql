-- ログイン試行回数を「1回のSQLで数える」関数（additive・再実行安全）。
-- 従来は「読む → 判定 → 失敗後に別途 +1」の3手順だったため、同時に大量のリクエストを
-- 送ると全部が「上限前」の状態で判定を通り抜け、上限を超えて試せた。
-- ここでは試行の入口で +1 と判定を同時に行う（行ロックで直列化される）。
create or replace function rate_limit_consume(
  p_key            text,
  p_max            integer,
  p_window_seconds integer
)
returns table (allowed boolean, remaining integer, reset_in_sec integer)
language plpgsql
set search_path = public
as $$
declare
  v_count integer;
  v_reset timestamptz;
begin
  insert into rate_limits (key, count, reset_at, updated_at)
  values (p_key, 1, now() + make_interval(secs => p_window_seconds), now())
  on conflict (key) do update set
    count      = case when rate_limits.reset_at < now() then 1 else rate_limits.count + 1 end,
    reset_at   = case when rate_limits.reset_at < now()
                      then now() + make_interval(secs => p_window_seconds)
                      else rate_limits.reset_at end,
    updated_at = now()
  returning rate_limits.count, rate_limits.reset_at into v_count, v_reset;

  allowed      := v_count <= p_max;
  remaining    := greatest(p_max - v_count, 0);
  reset_in_sec := greatest(ceil(extract(epoch from (v_reset - now())))::integer, 0);
  return next;
end;
$$;

-- 失敗ではなかった試行（2FAコードの入力待ちなど）の分を戻す。
create or replace function rate_limit_release(p_key text)
returns void
language sql
set search_path = public
as $$
  update rate_limits
     set count = greatest(count - 1, 0), updated_at = now()
   where key = p_key and reset_at >= now();
$$;

-- service_role（アプリのサーバー）だけが呼べる。
revoke execute on function rate_limit_consume(text, integer, integer) from public;
revoke execute on function rate_limit_consume(text, integer, integer) from anon;
revoke execute on function rate_limit_consume(text, integer, integer) from authenticated;
grant  execute on function rate_limit_consume(text, integer, integer) to service_role;
revoke execute on function rate_limit_release(text) from public;
revoke execute on function rate_limit_release(text) from anon;
revoke execute on function rate_limit_release(text) from authenticated;
grant  execute on function rate_limit_release(text) to service_role;
