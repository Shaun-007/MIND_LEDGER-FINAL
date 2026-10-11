-- Daily credit wallet, fixed AI response cap, challenge rewards and Critical Mode.
alter table public.user_entitlements alter column credits set default 100;
alter table public.user_entitlements add column if not exists credit_day date not null default (timezone('utc',now()))::date;
alter table public.user_entitlements add column if not exists critical_mode_last_activated date;
alter table public.think_credit_events drop constraint if exists think_credit_events_amount_check;
alter table public.think_credit_events add constraint think_credit_events_amount_check check (amount between -1000 and 1000 and amount<>0);
update public.user_entitlements set credits=100,credit_day=(timezone('utc',now()))::date
  where credits=0 and not exists(select 1 from public.think_credit_events e where e.user_id=user_entitlements.user_id);

create table if not exists public.challenge_credit_claims (
  user_id uuid not null references auth.users(id) on delete cascade,
  challenge_id text not null,
  awarded_at timestamptz not null default now(),
  primary key(user_id,challenge_id)
);
alter table public.challenge_credit_claims enable row level security;
revoke all on public.challenge_credit_claims from anon,authenticated;

create or replace function public.get_think_credit_status()
returns table(credits integer,daily_grant integer,challenge_rewards integer,cooldown_until timestamptz,critical_mode_available_at date)
language plpgsql security definer set search_path = '' as $$
declare v_user uuid:=auth.uid();v_today date:=(timezone('utc',now()))::date;v_grant integer;v_last date;v_balance integer;v_count integer;v_cooldown timestamptz;
begin
 if v_user is null then raise exception 'Authentication required' using errcode='42501';end if;
 insert into public.user_entitlements(user_id,plan_id,credits) values(v_user,'home-free',100) on conflict(user_id) do nothing;
 select critical_mode_last_activated into v_last from public.user_entitlements where user_id=v_user for update;
 if v_last is not null and v_today>v_last+4 then v_grant:=100;
 elsif v_last is not null and v_today>v_last then v_grant:=80;
 else v_grant:=100;end if;
 update public.user_entitlements set credits=case when credit_day<v_today then v_grant else credits end,credit_day=greatest(credit_day,v_today),updated_at=now()
   where user_id=v_user returning credits into v_balance;
 select count(*)::integer,max(awarded_at) into v_count,v_cooldown from public.challenge_credit_claims where user_id=v_user and awarded_at>now()-interval '24 hours';
 if v_count<5 then v_cooldown:=null;end if;
 return query select v_balance,case when v_last is not null and v_today between v_last+1 and v_last+4 then 80 else 100 end,v_count,v_cooldown,case when v_last is null then v_today else v_last+5 end;
end $$;
revoke all on function public.get_think_credit_status() from public,anon;
grant execute on function public.get_think_credit_status() to authenticated;

create or replace function public.activate_critical_mode()
returns table(credits integer,critical_mode_available_at date)
language plpgsql security definer set search_path = '' as $$
declare v_user uuid:=auth.uid();v_today date:=(timezone('utc',now()))::date;v_balance integer;v_last date;
begin
 if v_user is null then raise exception 'Authentication required' using errcode='42501';end if;
 insert into public.user_entitlements(user_id,plan_id,credits) values(v_user,'home-free',100) on conflict(user_id) do nothing;
 perform public.get_think_credit_status();
 select credits,critical_mode_last_activated into v_balance,v_last from public.user_entitlements where user_id=v_user for update;
 if v_last is not null and v_today<v_last+5 then raise exception 'Critical Mode is cooling down until %',v_last+5 using errcode='22023';end if;
 update public.user_entitlements set credits=credits+80,critical_mode_last_activated=v_today,updated_at=now() where user_id=v_user returning user_entitlements.credits into v_balance;
 update public.profile_documents set profile=jsonb_set(coalesce(profile,'{}'::jsonb),'{credits}',to_jsonb(v_balance),true),updated_at=now() where user_id=v_user;
 insert into public.think_credit_events(user_id,event_id,amount) values(v_user,'critical-mode:'||v_today::text,80) on conflict do nothing;
 return query select v_balance,v_today+5;
end $$;
revoke all on function public.activate_critical_mode() from public,anon;
grant execute on function public.activate_critical_mode() to authenticated;

create or replace function public.award_challenge_credits(p_challenge_id text)
returns table(awarded boolean,credits integer,rewards_in_24h integer,cooldown_until timestamptz)
language plpgsql security definer set search_path = '' as $$
declare v_user uuid:=auth.uid();v_today date:=(timezone('utc',now()))::date;v_count integer;v_balance integer;v_latest timestamptz;v_day_grant integer;v_last date;
begin
 if v_user is null then raise exception 'Authentication required' using errcode='42501';end if;
 if p_challenge_id is null or length(p_challenge_id) not between 1 and 200 then raise exception 'Invalid challenge id' using errcode='22023';end if;
 insert into public.user_entitlements(user_id,plan_id,credits) values(v_user,'home-free',100) on conflict(user_id) do nothing;
 perform public.get_think_credit_status();
 select credits,critical_mode_last_activated into v_balance,v_last from public.user_entitlements where user_id=v_user for update;
 select count(*)::integer,max(awarded_at) into v_count,v_latest from public.challenge_credit_claims where user_id=v_user and awarded_at>now()-interval '24 hours';
 if exists(select 1 from public.challenge_credit_claims where user_id=v_user and challenge_id=p_challenge_id) then
   return query select false,v_balance,v_count,case when v_count>=5 then v_latest+interval '24 hours' else null end;return;
 end if;
 if v_count>=5 then return query select false,v_balance,v_count,v_latest+interval '24 hours';return;end if;
 insert into public.challenge_credit_claims(user_id,challenge_id) values(v_user,p_challenge_id);
 update public.user_entitlements set credits=credits+10,updated_at=now() where user_id=v_user returning user_entitlements.credits into v_balance;
 update public.profile_documents set profile=jsonb_set(coalesce(profile,'{}'::jsonb),'{credits}',to_jsonb(v_balance),true),updated_at=now() where user_id=v_user;
 insert into public.think_credit_events(user_id,event_id,amount) values(v_user,'challenge:'||p_challenge_id,10) on conflict do nothing;
 select count(*)::integer,max(awarded_at) into v_count,v_latest from public.challenge_credit_claims where user_id=v_user and awarded_at>now()-interval '24 hours';
 return query select true,v_balance,v_count,case when v_count>=5 then v_latest+interval '24 hours' else null end;
end $$;
revoke all on function public.award_challenge_credits(text) from public,anon;
grant execute on function public.award_challenge_credits(text) to authenticated;

-- Each daily refill grants 100 credits (20 base responses); earned/critical credits
-- add more responses while the wallet has a balance.
create or replace function public.consume_ai_query()
returns table(allowed boolean,base_queries integer,daily_cap integer,plan_max integer,used_queries integer,queries_left integer,credits integer,plan_id text)
language plpgsql security definer set search_path = '' as $$
declare v_user uuid:=auth.uid();v_plan text;v_credits integer;v_used integer;v_allowance integer;
begin
 if v_user is null then raise exception 'Authentication required' using errcode='42501';end if;
 insert into public.user_entitlements(user_id,plan_id,credits) values(v_user,'home-free',100) on conflict(user_id) do nothing;
 perform public.get_think_credit_status();
 select plan_id,credits into v_plan,v_credits from public.user_entitlements where user_id=v_user for update;
 insert into public.ai_daily_usage(user_id,usage_day) values(v_user,(timezone('utc',now()))::date) on conflict(user_id,usage_day) do nothing;
 select used_queries into v_used from public.ai_daily_usage where user_id=v_user and usage_day=(timezone('utc',now()))::date for update;
 if v_credits<5 then
   return query select false,20,v_used,100,v_used,0,v_credits,v_plan;return;
 end if;
 update public.user_entitlements set credits=credits-5,updated_at=now() where user_id=v_user returning user_entitlements.credits into v_credits;
 update public.ai_daily_usage set used_queries=used_queries+1 where user_id=v_user and usage_day=(timezone('utc',now()))::date returning ai_daily_usage.used_queries into v_used;
 update public.profile_documents set profile=jsonb_set(coalesce(profile,'{}'::jsonb),'{credits}',to_jsonb(v_credits),true),updated_at=now() where user_id=v_user;
 insert into public.think_credit_events(user_id,event_id,amount) values(v_user,'ai-response:'||(timezone('utc',now()))::date::text||':'||v_used,-5) on conflict do nothing;
 v_allowance:=v_used+(v_credits/5);
 return query select true,20,v_allowance,100,v_used,v_credits/5,v_credits,v_plan;
end $$;
revoke all on function public.consume_ai_query() from public,anon;
grant execute on function public.consume_ai_query() to authenticated;
