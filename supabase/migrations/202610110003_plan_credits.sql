-- Demo plan entitlements and server-enforced daily AI usage.
-- Plan checkout is intentionally mocked until a payment provider is connected.
create table if not exists public.user_entitlements (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan_id text not null default 'home-free',
  credits integer not null default 0 check (credits >= 0),
  updated_at timestamptz not null default now(),
  check (plan_id in ('home-free','home-plus','home-family','school-pilot','school-standard','school-plus','school-institution','corporate-team','corporate-business','corporate-enterprise'))
);
alter table public.user_entitlements enable row level security;
revoke all on public.user_entitlements from anon, authenticated;
grant select on public.user_entitlements to authenticated;
create policy "users read their entitlements" on public.user_entitlements for select to authenticated using (user_id = (select auth.uid()));

create table if not exists public.ai_daily_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_day date not null default (timezone('utc', now()))::date,
  used_queries integer not null default 0 check (used_queries >= 0),
  bonus_queries_remaining integer not null default 0 check (bonus_queries_remaining >= 0),
  primary key (user_id, usage_day)
);
alter table public.ai_daily_usage enable row level security;
revoke all on public.ai_daily_usage from anon, authenticated;
grant select on public.ai_daily_usage to authenticated;
create policy "users read their AI usage" on public.ai_daily_usage for select to authenticated using (user_id = (select auth.uid()));

create table if not exists public.think_credit_events (
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id text not null,
  amount integer not null check (amount <> 0 and amount >= -100 and amount <= 20),
  created_at timestamptz not null default now(),
  primary key (user_id, event_id)
);
alter table public.think_credit_events enable row level security;
revoke all on public.think_credit_events from anon, authenticated;
grant select on public.think_credit_events to authenticated;
create policy "users read their credit events" on public.think_credit_events for select to authenticated using (user_id = (select auth.uid()));

create or replace function public.activate_demo_plan(p_plan_id text)
returns table(plan_id text, credits integer)
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_credits integer;
begin
  if v_user is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_plan_id not in ('home-free','home-plus','home-family','school-pilot','school-standard','school-plus','school-institution','corporate-team','corporate-business','corporate-enterprise') then
    raise exception 'Unknown plan' using errcode = '22023';
  end if;
  insert into public.user_entitlements(user_id,plan_id,credits)
  values (v_user,p_plan_id,coalesce((select nullif(profile->>'credits','')::integer from public.profile_documents where user_id=v_user),0))
  on conflict(user_id) do update set plan_id=excluded.plan_id,updated_at=now();
  update public.profile_documents d set profile=jsonb_set(coalesce(d.profile,'{}'::jsonb),'{planId}',to_jsonb(p_plan_id),true),updated_at=now() where d.user_id=v_user;
  select e.credits into v_credits from public.user_entitlements e where e.user_id=v_user;
  return query select p_plan_id,v_credits;
end $$;
revoke all on function public.activate_demo_plan(text) from public, anon;
grant execute on function public.activate_demo_plan(text) to authenticated;

create or replace function public.award_think_credits(p_event_id text,p_amount integer)
returns integer
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_balance integer;
begin
  if v_user is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_event_id is null or length(p_event_id) not between 1 and 200 or p_amount not between 1 and 20 then raise exception 'Invalid credit reward' using errcode = '22023'; end if;
  insert into public.user_entitlements(user_id,plan_id,credits) values(v_user,'home-free',0) on conflict(user_id) do nothing;
  insert into public.think_credit_events(user_id,event_id,amount) values(v_user,p_event_id,p_amount) on conflict do nothing;
  if found then update public.user_entitlements e set credits=e.credits+p_amount,updated_at=now() where e.user_id=v_user; end if;
  select e.credits into v_balance from public.user_entitlements e where e.user_id=v_user;
  update public.profile_documents d set profile=jsonb_set(coalesce(d.profile,'{}'::jsonb),'{credits}',to_jsonb(v_balance),true),updated_at=now() where d.user_id=v_user;
  return v_balance;
end $$;
revoke all on function public.award_think_credits(text,integer) from public, anon;
grant execute on function public.award_think_credits(text,integer) to authenticated;

create or replace function public.spend_think_credits(p_event_id text,p_amount integer)
returns integer
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_balance integer;
begin
  if v_user is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_event_id is null or length(p_event_id) not between 1 and 200 or p_amount not between 1 and 20 then raise exception 'Invalid credit spend' using errcode = '22023'; end if;
  insert into public.user_entitlements(user_id,plan_id,credits) values(v_user,'home-free',0) on conflict(user_id) do nothing;
  select e.credits into v_balance from public.user_entitlements e where e.user_id=v_user for update;
  if v_balance<p_amount then raise exception 'Not enough Think Credits' using errcode = '22023'; end if;
  insert into public.think_credit_events(user_id,event_id,amount) values(v_user,p_event_id,-p_amount) on conflict do nothing;
  if found then update public.user_entitlements e set credits=e.credits-p_amount,updated_at=now() where e.user_id=v_user returning e.credits into v_balance; end if;
  update public.profile_documents d set profile=jsonb_set(coalesce(d.profile,'{}'::jsonb),'{credits}',to_jsonb(v_balance),true),updated_at=now() where d.user_id=v_user;
  return v_balance;
end $$;
revoke all on function public.spend_think_credits(text,integer) from public, anon;
grant execute on function public.spend_think_credits(text,integer) to authenticated;

drop function if exists public.consume_ai_query();
create function public.consume_ai_query()
returns table(allowed boolean,base_queries integer,daily_cap integer,plan_max integer,used_queries integer,queries_left integer,credits integer,plan_id text)
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid(); v_plan text; v_credits integer; v_base integer; v_cap integer; v_used integer; v_bonus integer; v_allowance integer;
begin
  if v_user is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  insert into public.user_entitlements(user_id,plan_id,credits)
  values (
    v_user,
    coalesce((select profile->>'planId' from public.profile_documents where user_id=v_user),'home-free'),
    coalesce((select nullif(profile->>'credits','')::integer from public.profile_documents where user_id=v_user),0)
  ) on conflict(user_id) do nothing;
  select e.plan_id,e.credits into v_plan,v_credits from public.user_entitlements e where e.user_id=v_user for update;
  if v_plan in ('home-free','school-pilot') then v_base:=10;v_cap:=case when v_plan='school-pilot' then 25 else 20 end;
  elsif v_plan='home-plus' then v_base:=20;v_cap:=60;
  elsif v_plan='home-family' then v_base:=30;v_cap:=100;
  elsif v_plan='school-standard' then v_base:=15;v_cap:=50;
  elsif v_plan='school-plus' then v_base:=20;v_cap:=80;
  elsif v_plan='corporate-team' then v_base:=20;v_cap:=80;
  elsif v_plan='corporate-business' then v_base:=30;v_cap:=120;
  elsif v_plan='school-institution' then v_base:=20;v_cap:=100;
  else v_base:=30;v_cap:=120; end if;
  insert into public.ai_daily_usage(user_id,usage_day) values(v_user,(timezone('utc',now()))::date) on conflict(user_id,usage_day) do nothing;
  select u.used_queries,u.bonus_queries_remaining into v_used,v_bonus from public.ai_daily_usage u where u.user_id=v_user and u.usage_day=(timezone('utc',now()))::date for update;
  if v_used>=v_cap then return query select false,v_base,v_cap,v_cap,v_used,0,v_credits,v_plan;return;end if;
  if v_used>=v_base then
    if v_bonus>0 then update public.ai_daily_usage set bonus_queries_remaining=bonus_queries_remaining-1 where user_id=v_user and usage_day=(timezone('utc',now()))::date;v_bonus:=v_bonus-1;
    elsif v_credits>0 then
      update public.user_entitlements set credits=credits-1,updated_at=now() where user_id=v_user returning user_entitlements.credits into v_credits;
      update public.ai_daily_usage set bonus_queries_remaining=1 where user_id=v_user and usage_day=(timezone('utc',now()))::date;
      v_bonus:=1;
      update public.profile_documents d set profile=jsonb_set(coalesce(d.profile,'{}'::jsonb),'{credits}',to_jsonb(v_credits),true),updated_at=now() where d.user_id=v_user;
    else return query select false,v_base,greatest(v_used,least(v_cap,v_base+v_credits*2)),v_cap,v_used,0,v_credits,v_plan;return;
    end if;
  end if;
  update public.ai_daily_usage set used_queries=used_queries+1 where user_id=v_user and usage_day=(timezone('utc',now()))::date returning ai_daily_usage.used_queries into v_used;
  v_allowance:=least(v_cap,greatest(v_base,v_used)+v_bonus+v_credits*2);
  return query select true,v_base,v_allowance,v_cap,v_used,greatest(0,v_allowance-v_used),v_credits,v_plan;
end $$;
revoke all on function public.consume_ai_query() from public, anon;
grant execute on function public.consume_ai_query() to authenticated;
