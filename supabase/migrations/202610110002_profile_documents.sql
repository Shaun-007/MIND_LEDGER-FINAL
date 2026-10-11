-- Per-account profile snapshots allow a user to continue on another device.
-- Supabase Auth owns identity; this table contains no passwords or service keys.
create table if not exists public.profile_documents (
  user_id uuid primary key references auth.users(id) on delete cascade,
  profile jsonb not null check (jsonb_typeof(profile) = 'object'),
  transactions jsonb not null default '[]'::jsonb check (jsonb_typeof(transactions) = 'array'),
  updated_at timestamptz not null default now()
);

alter table public.profile_documents enable row level security;
revoke all on public.profile_documents from anon, authenticated;
grant select, insert, update on public.profile_documents to authenticated;

create policy "account owner reads their profile document"
  on public.profile_documents for select to authenticated
  using (user_id = (select auth.uid()));
create policy "account owner creates their profile document"
  on public.profile_documents for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "account owner updates their profile document"
  on public.profile_documents for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
