-- Provision group codes and memberships through authenticated, role-checked RPCs.
create or replace function public.create_mindledger_group(
  p_name text, p_kind text, p_grade text default null
) returns table(group_id uuid, invite_code text)
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_segment text;
  v_name text;
  v_group uuid;
  v_code text;
  v_member_role text;
begin
  if v_user is null then raise exception 'Sign in to create a group.' using errcode = '42501'; end if;
  select profile->>'role', profile->>'segment', profile->>'name'
    into v_role, v_segment, v_name from public.profile_documents where user_id = v_user;
  if v_role not in ('Parent','Teacher','HR Manager/Admin') or
     (p_kind = 'family' and (v_role <> 'Parent' or v_segment <> 'Home')) or
     (p_kind = 'class' and (v_role <> 'Teacher' or v_segment <> 'School')) or
     (p_kind = 'company' and (v_role <> 'HR Manager/Admin' or v_segment <> 'Corporate')) or
     p_kind not in ('family','class','company') then
    raise exception 'Your account role does not match this group type.' using errcode = '22023';
  end if;
  insert into public.profiles(id, display_name, segment, role)
    values(v_user, coalesce(nullif(v_name,''), 'Member'), v_segment, v_role)
    on conflict(id) do update set display_name=excluded.display_name, segment=excluded.segment, role=excluded.role;
  insert into public.groups(name,kind,owner_id,grade)
    values(trim(p_name),p_kind,v_user,nullif(trim(p_grade),'')) returning id into v_group;
  insert into public.group_memberships(group_id,user_id,role) values(v_group,v_user,v_role);
  v_code := upper(case p_kind when 'family' then 'FAM' when 'company' then 'TEAM' else 'CLASS' end) || '-' || upper(encode(extensions.gen_random_bytes(3),'hex'));
  v_member_role := case p_kind when 'family' then 'Child' when 'company' then 'Worker' else 'Student' end;
  insert into public.group_invites(group_id,invite_hash,intended_role,created_by,expires_at,uses_remaining)
    values(v_group,encode(extensions.digest(convert_to(v_code,'UTF8'),'sha256'),'hex'),v_member_role,v_user,now()+interval '5 years',1000);
  return query select v_group,v_code;
end;
$$;

create or replace function public.join_mindledger_group(
  p_code text, p_role text, p_segment text, p_name text, p_age smallint default null
) returns table(group_id uuid, group_name text)
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_invite public.group_invites%rowtype;
  v_group public.groups%rowtype;
begin
  if v_user is null then raise exception 'Sign in to join a group.' using errcode = '42501'; end if;
  select * into v_invite from public.group_invites
   where invite_hash=encode(extensions.digest(convert_to(upper(trim(p_code)),'UTF8'),'sha256'),'hex')
     and expires_at>now() and uses_remaining>0 for update;
  if not found then raise exception 'That group code was not found or has expired.' using errcode = '22023'; end if;
  select * into v_group from public.groups where id=v_invite.group_id;
  if p_role <> v_invite.intended_role or
     (v_group.kind='family' and p_segment<>'Home') or
     (v_group.kind='company' and p_segment<>'Corporate') or
     (v_group.kind='class' and p_segment<>'School') or
     (p_role='Child' and (p_age is null or p_age not between 5 and 18)) then
    raise exception 'The code does not match this account type.' using errcode = '22023';
  end if;
  insert into public.profiles(id,display_name,segment,role,age)
    values(v_user,trim(p_name),p_segment,p_role,p_age)
    on conflict(id) do update set display_name=excluded.display_name,segment=excluded.segment,role=excluded.role,age=excluded.age;
  insert into public.group_memberships(group_id,user_id,role) values(v_group.id,v_user,p_role)
    on conflict(group_id,user_id) do nothing;
  update public.group_invites set uses_remaining=uses_remaining-1 where id=v_invite.id;
  return query select v_group.id,v_group.name;
end;
$$;

-- Managers can see the group roster and safe learning metrics, never passwords,
-- email addresses, answers, or private reflections.
create or replace function public.group_member_learning_data(target_group uuid)
returns table(member_id uuid, display_name text, role text, age smallint, safe_profile jsonb, safe_sessions jsonb)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.can_manage_group(target_group) then
    raise exception 'Not authorized to view this group.' using errcode = '42501';
  end if;
  return query
    select p.id, p.display_name, gm.role, p.age,
      jsonb_build_object(
        'skills', coalesce(d.profile->'skills','{}'::jsonb),
        'credits', coalesce(d.profile->'credits','0'::jsonb),
        'xp', coalesce(d.profile->'xp','0'::jsonb)
      ),
      coalesce((select jsonb_agg(jsonb_build_object(
        'id', session->>'id', 'userId', p.id, 'type', session->>'type', 'skill', session->>'skill',
        'score', case when (session->>'score') ~ '^[0-9]{1,3}$' then (session->>'score')::integer else 0 end,
        'date', session->>'date',
        'durationMinutes', case when (session->>'durationMinutes') ~ '^[0-9]{1,4}$' then least((session->>'durationMinutes')::integer,1440) else 0 end,
        'title', coalesce(session->>'title','Practice'), 'gameId', session->>'gameId',
        'completed', session->>'completed' is distinct from 'false'
      )) from jsonb_array_elements(coalesce(d.profile->'sessions','[]'::jsonb)) as item(session)), '[]'::jsonb)
    from public.group_memberships gm
    join public.profiles p on p.id=gm.user_id
    left join public.profile_documents d on d.user_id=p.id
    where gm.group_id=target_group
    order by p.display_name;
end;
$$;

revoke all on function public.create_mindledger_group(text,text,text) from public, anon;
revoke all on function public.join_mindledger_group(text,text,text,text,smallint) from public, anon;
grant execute on function public.create_mindledger_group(text,text,text) to authenticated;
grant execute on function public.join_mindledger_group(text,text,text,text,smallint) to authenticated;
revoke all on function public.group_member_learning_data(uuid) from public, anon;
grant execute on function public.group_member_learning_data(uuid) to authenticated;
