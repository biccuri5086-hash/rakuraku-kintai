-- ============================================================
-- pay_rules の「改定予約」確定処理をアトミックに行う関数
-- ============================================================
-- 背景：改定予約は「今開いている行のeffective_toを切る」+「新しい行をINSERTする」の
-- 2手順から成る。Supabase-js から素朴に2回呼ぶと、間に競合が入った場合に
-- 片方だけ成功する余地が残る。Postgres関数として1トランザクションにまとめる。
-- 冪等。何度流しても安全（create or replace）。

create or replace function fn_schedule_pay_rule(
  p_company_id        uuid,
  p_scope              text,
  p_client_id          uuid,
  p_assignment_id      uuid,
  p_effective_from     date,
  p_base_hourly_rate   integer,
  p_overtime_rate      numeric,
  p_overtime60_rate    numeric,
  p_night_rate         numeric,
  p_holiday_rate       numeric
) returns table(new_rule_id uuid, closed_rule_id uuid)
language plpgsql
as $$
declare
  v_open_id uuid;
  v_new_id  uuid;
begin
  if p_scope not in ('company', 'client', 'assignment') then
    raise exception 'invalid scope: %', p_scope;
  end if;
  if p_scope = 'client' and p_client_id is null then
    raise exception 'client_id is required for scope=client';
  end if;
  if p_scope = 'assignment' and p_assignment_id is null then
    raise exception 'assignment_id is required for scope=assignment';
  end if;

  -- 対象スコープで「今開いている」行(effective_to is null)を1件だけ探して閉じる。
  select id into v_open_id
    from pay_rules
   where company_id = p_company_id
     and scope = p_scope
     and effective_to is null
     and (p_scope <> 'client'     or client_id = p_client_id)
     and (p_scope <> 'assignment' or assignment_id = p_assignment_id)
     and (p_scope <> 'company'    or (client_id is null and assignment_id is null))
   limit 1;

  if v_open_id is not null then
    if (select effective_from from pay_rules where id = v_open_id) >= p_effective_from then
      raise exception 'new effective_from must be after the currently open rule''s effective_from';
    end if;
    update pay_rules set effective_to = p_effective_from, updated_at = now() where id = v_open_id;
  end if;

  insert into pay_rules (
    company_id, scope, client_id, assignment_id, effective_from, effective_to,
    base_hourly_rate, overtime_rate, overtime60_rate, night_rate, holiday_rate
  ) values (
    p_company_id, p_scope,
    case when p_scope = 'client' then p_client_id else null end,
    case when p_scope = 'assignment' then p_assignment_id else null end,
    p_effective_from, null,
    p_base_hourly_rate, p_overtime_rate, p_overtime60_rate, p_night_rate, p_holiday_rate
  )
  returning id into v_new_id;

  return query select v_new_id, v_open_id;
end;
$$;


-- ============================================================
-- 「予約中」（未開始）の改定を取消す関数
-- ============================================================
-- 予約(future)を削除するだけだと、その予約が閉じた直前の行(effective_to)が
-- 閉じられたままになり、予約の開始予定日以降どのルールも効かない空白期間が
-- できてしまう。取消時は、直前に閉じた行があれば effective_to を null に戻す
-- （＝改定予約前の状態に完全に戻す）。
create or replace function fn_cancel_pay_rule(
  p_company_id uuid,
  p_rule_id    uuid
) returns void
language plpgsql
as $$
declare
  v_rule record;
begin
  select * into v_rule from pay_rules where id = p_rule_id and company_id = p_company_id;
  if not found then
    raise exception 'pay_rule not found';
  end if;
  if v_rule.effective_from <= current_date then
    raise exception 'cannot cancel a rule that has already started';
  end if;

  -- この予約によって effective_to が閉じられた行があれば再オープンする
  update pay_rules
     set effective_to = null, updated_at = now()
   where company_id = p_company_id
     and scope = v_rule.scope
     and effective_to = v_rule.effective_from
     and (v_rule.scope <> 'client'     or client_id = v_rule.client_id)
     and (v_rule.scope <> 'assignment' or assignment_id = v_rule.assignment_id)
     and (v_rule.scope <> 'company'    or (client_id is null and assignment_id is null));

  delete from pay_rules where id = p_rule_id and company_id = p_company_id;
end;
$$;
