-- 0001 Security lockdown
-- Before this, every policy applied to the PUBLIC role, and almost all business rows have
-- user_id = NULL, so anyone holding the public (anon) key could read and change clients,
-- transactions, payments, products and liabilities without logging in. employees and
-- inventory_items had RLS switched off entirely.
--
-- Model after this migration: Promed is one company. Only logged-in *members* (listed in
-- app_members) see company data; each existing rule (own rows + shared NULL rows) still
-- applies on top. Strangers who sign up get an account but see nothing.

create table if not exists public.app_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'staff' check (role in ('owner', 'staff', 'compliance')),
  created_at timestamptz not null default now()
);
alter table public.app_members enable row level security;

-- Seed: every account that exists today is a member. The Telegram-linked account is the owner.
insert into public.app_members (user_id, role)
select u.id,
       case
         when u.id = 'bb88be0d-6696-4d62-9628-c4e6825f911c' then 'owner'
         when coalesce(u.raw_user_meta_data->>'role', u.raw_app_meta_data->>'role') = 'compliance_only' then 'compliance'
         else 'staff'
       end
from auth.users u
on conflict (user_id) do nothing;

create or replace function public.is_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.app_members m where m.user_id = auth.uid())
$$;
revoke all on function public.is_member() from public, anon;
grant execute on function public.is_member() to authenticated, service_role;

drop policy if exists app_members_select on public.app_members;
create policy app_members_select on public.app_members for select to authenticated
  using (user_id = auth.uid() or public.is_member());

-- Rewrite every existing policy on public tables: authenticated only, and member required.
do $$
declare
  p record;
  q text;
  c text;
begin
  for p in
    select pol.polname, cls.relname, pol.polcmd::text as cmd,
           pg_get_expr(pol.polqual, pol.polrelid) as qual,
           pg_get_expr(pol.polwithcheck, pol.polrelid) as chk
    from pg_policy pol
    join pg_class cls on cls.oid = pol.polrelid
    join pg_namespace n on n.oid = cls.relnamespace
    where n.nspname = 'public'
      and cls.relname <> 'app_members'
  loop
    if coalesce(p.qual, '') like '%is_member()%' or coalesce(p.chk, '') like '%is_member()%' then
      continue;
    end if;
    q := 'public.is_member()' || case when p.qual is not null then ' and (' || p.qual || ')' else '' end;
    c := 'public.is_member()' || case when p.chk is not null then ' and (' || p.chk || ')' else '' end;
    if p.cmd in ('r', 'd') then
      execute format('alter policy %I on public.%I to authenticated using (%s)', p.polname, p.relname, q);
    elsif p.cmd = 'a' then
      execute format('alter policy %I on public.%I to authenticated with check (%s)', p.polname, p.relname, c);
    else
      execute format('alter policy %I on public.%I to authenticated using (%s) with check (%s)', p.polname, p.relname, q, c);
    end if;
  end loop;
end $$;

-- Tables that had no protection at all.
alter table public.employees enable row level security;
drop policy if exists employees_members on public.employees;
create policy employees_members on public.employees for all to authenticated
  using (public.is_member()) with check (public.is_member());

alter table public.inventory_items enable row level security;
drop policy if exists inventory_items_members on public.inventory_items;
create policy inventory_items_members on public.inventory_items for all to authenticated
  using (public.is_member()) with check (public.is_member());

-- Storage: compliance files readable/deletable by members only (was: any logged-in account).
do $$
declare p record;
begin
  for p in
    select pol.polname, pol.polcmd::text as cmd,
           pg_get_expr(pol.polqual, pol.polrelid) as qual,
           pg_get_expr(pol.polwithcheck, pol.polrelid) as chk
    from pg_policy pol where pol.polrelid = 'storage.objects'::regclass
  loop
    if coalesce(p.qual, '') like '%is_member()%' or coalesce(p.chk, '') like '%is_member()%' then continue; end if;
    if p.cmd in ('r', 'd') then
      execute format('alter policy %I on storage.objects using (%s)', p.polname,
        'public.is_member()' || case when p.qual is not null then ' and (' || p.qual || ')' else '' end);
    elsif p.cmd = 'a' then
      execute format('alter policy %I on storage.objects with check (%s)', p.polname,
        'public.is_member()' || case when p.chk is not null then ' and (' || p.chk || ')' else '' end);
    else
      execute format('alter policy %I on storage.objects using (%s) with check (%s)', p.polname,
        'public.is_member()' || case when p.qual is not null then ' and (' || p.qual || ')' else '' end,
        'public.is_member()' || case when p.chk is not null then ' and (' || p.chk || ')' else '' end);
    end if;
  end loop;
end $$;

-- Functions: nobody anonymous may call anything in public.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated, service_role', f.sig);
  end loop;
end $$;
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon;
