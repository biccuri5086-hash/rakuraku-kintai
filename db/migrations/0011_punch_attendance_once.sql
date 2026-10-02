-- 打刻の二重登録防止（additive・再実行安全）。
-- 同じスタッフが同じ種類の打刻を短時間に2回送ると、アプリ側の「直近を読んで判定→登録」の
-- 間をすり抜けて両方登録されていた。ここでスタッフ単位に排他ロックを取り、
-- 直近 p_window_seconds 秒以内に同種の打刻があれば登録せず null を返す。
-- 既存データの形は変えない（制約・列の追加なし）。
create or replace function punch_attendance_once(
  p_user_id        text,
  p_user_name      text,
  p_company_id     uuid,
  p_type           text,
  p_window_seconds integer default 5
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_type not in ('clock_in', 'clock_out') then
    raise exception 'invalid punch type: %', p_type;
  end if;

  -- 同じスタッフの打刻を直列化する（トランザクション終了で自動解放）。
  perform pg_advisory_xact_lock(hashtextextended('punch:' || p_user_id, 0));

  if exists (
    select 1 from attendance
    where user_id = p_user_id
      and company_id = p_company_id
      and type = p_type
      and "timestamp" > now() - make_interval(secs => p_window_seconds)
  ) then
    return null;
  end if;

  insert into attendance (user_id, user_name, type, "timestamp", company_id)
  values (p_user_id, p_user_name, p_type, now(), p_company_id)
  returning id into v_id;

  return v_id;
end;
$$;

-- service_role（アプリのサーバー）だけが呼べる。anon / authenticated からは呼べない。
revoke execute on function punch_attendance_once(text, text, uuid, text, integer) from public;
revoke execute on function punch_attendance_once(text, text, uuid, text, integer) from anon;
revoke execute on function punch_attendance_once(text, text, uuid, text, integer) from authenticated;
grant  execute on function punch_attendance_once(text, text, uuid, text, integer) to service_role;
