-- MindLedger shared account and progress schema for Supabase PostgreSQL.
-- Authentication secrets stay in Supabase Auth. Do not add passwords here.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 120),
  kind text not null check (kind in ('family', 'company', 'class')),
  owner_id uuid not null references auth.users(id) on delete restrict,
  grade text,
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (length(trim(display_name)) between 1 and 100),
  segment text not null check (segment in ('Personal', 'Home', 'Corporate', 'School')),
  role text not null check (role in ('Individual', 'Parent', 'Child', 'HR Manager/Admin', 'Worker', 'Teacher', 'Student')),
  age smallint check (age is null or age between 5 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((segment = 'Personal' and role = 'Individual')
      or (segment = 'Home' and role in ('Parent', 'Child'))
      or (segment = 'Corporate' and role in ('HR Manager/Admin', 'Worker'))
      or (segment = 'School' and role in ('Teacher', 'Student')))
);

create table if not exists public.group_memberships (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('Parent', 'Child', 'HR Manager/Admin', 'Worker', 'Teacher', 'Student')),
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create table if not exists public.group_invites (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  invite_hash text not null unique,
  intended_role text not null check (intended_role in ('Parent', 'Child', 'HR Manager/Admin', 'Worker', 'Teacher', 'Student')),
  created_by uuid not null references public.profiles(id) on delete restrict,
  expires_at timestamptz not null,
  uses_remaining integer not null default 1 check (uses_remaining >= 0),
  created_at timestamptz not null default now()
);

-- The only shared content from a completed activity is its score and safe metadata.
-- Response text/reflections are deliberately kept in a separate, owner-only table.
create table if not exists public.activity_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid references public.groups(id) on delete set null,
  activity_type text not null check (activity_type in ('mission', 'focus', 'break', 'game')),
  skill text check (skill is null or skill in ('Memory', 'Reasoning', 'Writing', 'Creativity', 'Focus')),
  title text not null check (length(title) <= 160),
  game_id text,
  score smallint not null check (score between 0 and 100),
  duration_minutes smallint not null default 0 check (duration_minutes between 0 and 1440),
  difficulty smallint check (difficulty is null or difficulty between 1 and 10),
  measurements jsonb not null default '{}'::jsonb check (jsonb_typeof(measurements) = 'object'),
  completed boolean not null default true,
  idempotency_key text not null,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);
create index if not exists activity_sessions_user_time_idx on public.activity_sessions(user_id, occurred_at desc);
create index if not exists activity_sessions_group_time_idx on public.activity_sessions(group_id, occurred_at desc);

create table if not exists public.private_reflections (
  session_id uuid primary key references public.activity_sessions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  response_text text,
  reflection_text text,
  created_at timestamptz not null default now(),
  check (response_text is null or length(response_text) <= 12000),
  check (reflection_text is null or length(reflection_text) <= 4000)
);

create table if not exists public.skill_stats (
  user_id uuid not null references public.profiles(id) on delete cascade,
  skill text not null check (skill in ('Memory', 'Reasoning', 'Writing', 'Creativity', 'Focus')),
  observed_debt smallint not null default 0 check (observed_debt between 0 and 100),
  practiced_repayment smallint not null default 0 check (practiced_repayment between 0 and 100),
  updated_at timestamptz not null default now(),
  primary key (user_id, skill)
);

-- Append-only ledgers make XP and credit awards auditable and idempotent across devices.
create table if not exists public.xp_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  session_id uuid references public.activity_sessions(id) on delete set null,
  source_key text not null,
  amount integer not null check (amount between 0 and 10000),
  reason text not null check (length(reason) <= 160),
  awarded_at timestamptz not null default now(),
  unique (user_id, source_key)
);

create table if not exists public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  session_id uuid references public.activity_sessions(id) on delete set null,
  source_key text not null,
  amount integer not null check (amount between -10000 and 10000 and amount <> 0),
  reason text not null check (length(reason) <= 160),
  recorded_at timestamptz not null default now(),
  unique (user_id, source_key)
);

create or replace function public.is_group_member(target_group uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.group_memberships gm where gm.group_id = target_group and gm.user_id = auth.uid());
$$;

create or replace function public.can_manage_group(target_group uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.groups g where g.id = target_group and g.owner_id = auth.uid())
    or exists(select 1 from public.group_memberships gm where gm.group_id = target_group and gm.user_id = auth.uid() and gm.role in ('Parent', 'HR Manager/Admin', 'Teacher'));
$$;

alter table public.profiles enable row level security;
alter table public.groups enable row level security;
alter table public.group_memberships enable row level security;
alter table public.group_invites enable row level security;
alter table public.activity_sessions enable row level security;
alter table public.private_reflections enable row level security;
alter table public.skill_stats enable row level security;
alter table public.xp_ledger enable row level security;
alter table public.credit_ledger enable row level security;

drop policy if exists "profile owner reads self" on public.profiles;
create policy "profile owner reads self" on public.profiles for select to authenticated
  using (id = (select auth.uid()));
drop policy if exists "profile owner edits basic details" on public.profiles;
create policy "profile owner edits basic details" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
drop policy if exists "group members read group" on public.groups;
create policy "group members read group" on public.groups for select to authenticated
  using (public.is_group_member(id));
drop policy if exists "group owner updates group" on public.groups;
create policy "group owner updates group" on public.groups for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
drop policy if exists "authenticated owners create groups" on public.groups;
create policy "authenticated owners create groups" on public.groups for insert to authenticated
  with check (owner_id = (select auth.uid()));
drop policy if exists "members read own membership or managers read roster" on public.group_memberships;
create policy "members read own membership or managers read roster" on public.group_memberships for select to authenticated
  using (user_id = (select auth.uid()) or public.can_manage_group(group_id));
drop policy if exists "managers add memberships" on public.group_memberships;
create policy "managers add memberships" on public.group_memberships for insert to authenticated
  with check (public.can_manage_group(group_id));
drop policy if exists "managers remove memberships" on public.group_memberships;
create policy "managers remove memberships" on public.group_memberships for delete to authenticated
  using (public.can_manage_group(group_id));
drop policy if exists "managers manage invites" on public.group_invites;
create policy "managers manage invites" on public.group_invites for all to authenticated
  using (public.can_manage_group(group_id)) with check (public.can_manage_group(group_id));
drop policy if exists "member owns activity" on public.activity_sessions;
create policy "member owns activity" on public.activity_sessions for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "member owns private reflections" on public.private_reflections;
create policy "member owns private reflections" on public.private_reflections for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "member owns skill stats" on public.skill_stats;
create policy "member owns skill stats" on public.skill_stats for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "member reads own xp ledger" on public.xp_ledger;
create policy "member reads own xp ledger" on public.xp_ledger for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists "member reads own credit ledger" on public.credit_ledger;
create policy "member reads own credit ledger" on public.credit_ledger for select to authenticated
  using (user_id = (select auth.uid()));

-- Profile roles, segment, group membership, and balances must be provisioned by
-- a trusted server flow; a user cannot grant themselves supervisor permissions.
revoke insert, update, delete on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (display_name, age) on public.profiles to authenticated;

-- Do not grant direct client writes to reward ledgers. A trusted, authenticated RPC
-- should insert activity and reward entries in one transaction after server validation.
revoke insert, update, delete on public.groups, public.profiles, public.group_memberships,
  public.group_invites, public.activity_sessions, public.private_reflections,
  public.skill_stats, public.xp_ledger, public.credit_ledger from anon, authenticated;
grant select on public.groups, public.profiles, public.group_memberships, public.group_invites,
  public.activity_sessions, public.private_reflections, public.skill_stats,
  public.xp_ledger, public.credit_ledger to authenticated;
grant update (display_name, age) on public.profiles to authenticated;

-- A restricted dashboard RPC exposes only aggregate activity, never responses,
-- reflections, email, or full private session records.
create or replace function public.group_activity_summary(target_group uuid)
returns table(member_id uuid, activity_day date, skill text, activity_count bigint, average_score numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.can_manage_group(target_group) then
    raise exception 'Not authorized to view this group summary' using errcode = '42501';
  end if;
  return query
    select a.user_id, (a.occurred_at at time zone 'UTC')::date, a.skill, count(*), round(avg(a.score), 1)
    from public.activity_sessions a
    join public.group_memberships gm on gm.group_id = target_group and gm.user_id = a.user_id
    where a.group_id = target_group and a.completed
    group by a.user_id, (a.occurred_at at time zone 'UTC')::date, a.skill;
end;
$$;
revoke all on function public.group_activity_summary(uuid) from public, anon;
grant execute on function public.group_activity_summary(uuid) to authenticated;

create or replace function public.group_roster(target_group uuid)
returns table(member_id uuid, display_name text, role text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.can_manage_group(target_group) then
    raise exception 'Not authorized to view this group roster' using errcode = '42501';
  end if;
  return query
    select p.id, p.display_name, gm.role
    from public.group_memberships gm
    join public.profiles p on p.id = gm.user_id
    where gm.group_id = target_group
    order by p.display_name;
end;
$$;
revoke all on function public.group_roster(uuid) from public, anon;
grant execute on function public.group_roster(uuid) to authenticated;
