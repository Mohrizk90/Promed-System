-- 0004 Agent core: conversations, actions (smart confirm), automatic change capture for undo,
-- safe write operations, and read functions shared by the agent and the screens.
--
-- How a write works:
--   1. agent_stage(kind, summary, payload)  -> pending action (nothing changed yet)
--   2. agent_commit(id)                     -> runs the operation in ONE transaction; every row
--                                              change is captured into agent_changes by triggers
--   3. agent_undo(id)                       -> replays agent_changes backwards (refuses if the
--                                              rows were changed again since, unless forced)

-- ---------------------------------------------------------------------------
-- Tables
create table if not exists public.agent_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.agent_messages (
  id bigserial primary key,
  conversation_id uuid not null references public.agent_conversations(id) on delete cascade,
  message_id text not null,
  role text not null check (role in ('user', 'assistant', 'system')),
  parts jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (conversation_id, message_id)
);

create table if not exists public.agent_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  conversation_id uuid references public.agent_conversations(id) on delete set null,
  kind text not null,
  summary text not null,
  payload jsonb not null,
  preview jsonb,
  status text not null default 'pending' check (status in ('pending', 'applied', 'cancelled', 'undone', 'failed')),
  result jsonb,
  error text,
  voice_text text,
  created_at timestamptz not null default now(),
  applied_at timestamptz,
  undone_at timestamptz
);
create index if not exists agent_actions_user_idx on public.agent_actions(user_id, created_at desc);

create table if not exists public.agent_changes (
  id bigserial primary key,
  action_id uuid not null references public.agent_actions(id) on delete cascade,
  table_name text not null,
  op text not null check (op in ('insert', 'update', 'delete')),
  pk_col text not null,
  pk_val text not null,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);
create index if not exists agent_changes_action_idx on public.agent_changes(action_id, id);

create table if not exists public.agent_memory (
  id serial primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('alias', 'preference', 'fact', 'correction')),
  subject text not null,
  content text not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.agent_settings (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  auto_save_limit numeric(14,2) not null default 5000 check (auto_save_limit >= 0),
  voice_replies boolean not null default false,
  updated_at timestamptz not null default now()
);

-- Which tables the agent may touch, and which columns.
create table if not exists public.agent_table_registry (
  table_name text primary key,
  pk_col text not null,
  label_en text not null,
  label_ar text not null,
  insert_cols text[],          -- null = agent cannot create rows directly
  update_cols text[],          -- null = agent cannot edit
  can_delete boolean not null default false,
  soft_delete boolean not null default false
);

alter table public.agent_conversations enable row level security;
alter table public.agent_messages enable row level security;
alter table public.agent_actions enable row level security;
alter table public.agent_changes enable row level security;
alter table public.agent_memory enable row level security;
alter table public.agent_settings enable row level security;
alter table public.agent_table_registry enable row level security;

drop policy if exists agent_conversations_owner on public.agent_conversations;
create policy agent_conversations_owner on public.agent_conversations for all to authenticated
  using (user_id = auth.uid() and public.is_member()) with check (user_id = auth.uid() and public.is_member());
drop policy if exists agent_messages_owner on public.agent_messages;
create policy agent_messages_owner on public.agent_messages for all to authenticated
  using (exists (select 1 from public.agent_conversations c where c.id = conversation_id and c.user_id = auth.uid()))
  with check (exists (select 1 from public.agent_conversations c where c.id = conversation_id and c.user_id = auth.uid()));
drop policy if exists agent_actions_owner on public.agent_actions;
create policy agent_actions_owner on public.agent_actions for all to authenticated
  using (user_id = auth.uid() and public.is_member()) with check (user_id = auth.uid() and public.is_member());
drop policy if exists agent_changes_owner on public.agent_changes;
create policy agent_changes_owner on public.agent_changes for select to authenticated
  using (exists (select 1 from public.agent_actions a where a.id = action_id and a.user_id = auth.uid()));
drop policy if exists agent_memory_owner on public.agent_memory;
create policy agent_memory_owner on public.agent_memory for all to authenticated
  using (user_id = auth.uid() and public.is_member()) with check (user_id = auth.uid() and public.is_member());
drop policy if exists agent_settings_owner on public.agent_settings;
create policy agent_settings_owner on public.agent_settings for all to authenticated
  using (user_id = auth.uid() and public.is_member()) with check (user_id = auth.uid() and public.is_member());
drop policy if exists agent_table_registry_read on public.agent_table_registry;
create policy agent_table_registry_read on public.agent_table_registry for select to authenticated
  using (public.is_member());

insert into public.agent_table_registry (table_name, pk_col, label_en, label_ar, insert_cols, update_cols, can_delete, soft_delete) values
  ('clients', 'client_id', 'Client', 'عميل', array['client_name','contact_info','address','opening_balance'], array['client_name','contact_info','address','opening_balance'], true, false),
  ('suppliers', 'supplier_id', 'Supplier', 'مورد', array['supplier_name','contact_info','address'], array['supplier_name','contact_info','address'], true, false),
  ('products', 'product_id', 'Product', 'منتج', array['product_name','model','unit_price','unit_cost','eta_item_code','eta_unit_type','eta_item_name'], array['product_name','model','unit_price','unit_cost','eta_item_code','eta_unit_type','eta_item_name'], true, false),
  ('employees', 'employee_id', 'Employee', 'موظف', array['name','contact_info','role','monthly_salary','notes'], array['name','contact_info','role','monthly_salary','notes'], true, false),
  ('inventory_items', 'item_id', 'Inventory item', 'صنف مخزون', array['name','quantity','unit_cost','notes'], array['name','quantity','unit_cost','notes'], true, false),
  ('liabilities', 'id', 'Liability', 'التزام', array['category','description','total_amount','remaining_amount','due_date','notes','recurring'], array['category','description','due_date','notes','recurring'], true, false),
  ('liability_payments', 'id', 'Liability payment', 'دفعة التزام', array['liability_id','payment_amount','payment_date','payment_method','reference_number'], array['payment_date','payment_method','reference_number'], true, false),
  ('client_transactions', 'transaction_id', 'Sale', 'عملية بيع', null, array['status','invoice_number','external_invoice_number','due_date','payment_terms','transaction_date'], true, false),
  ('supplier_transactions', 'transaction_id', 'Purchase', 'عملية شراء', null, array['status','invoice_number','external_invoice_number','due_date','payment_terms','transaction_date'], true, false),
  ('payments', 'payment_id', 'Payment', 'دفعة', null, array['payment_date','payment_method','reference_number'], true, false),
  ('compliance_items', 'id', 'Compliance item', 'بند امتثال', array['title','status','priority','reference_number','description','notes','issue_date','expiry_date','category_id','authority_id'], array['title','status','priority','reference_number','description','notes','issue_date','expiry_date','category_id','authority_id'], false, false),
  ('compliance_item_expenses', 'id', 'Compliance expense', 'مصروف امتثال', array['item_id','expense_type','amount','currency','expense_date','vendor','reference_number','notes'], array['expense_type','amount','expense_date','vendor','reference_number','notes'], true, false),
  ('ledger_entries', 'id', 'Income / expense', 'مصروف / إيراد', null, array['kind','amount','entry_date','category_id','account_id','party_name','client_id','supplier_id','employee_id','description','notes'], true, true),
  ('projects', 'id', 'Project', 'مشروع', array['type_id','name','status','parent_id','client_id','supplier_id','product_id','budget','start_date','end_date','aliases','attributes','notes'], array['type_id','name','status','parent_id','client_id','supplier_id','product_id','budget','start_date','end_date','aliases','attributes','notes'], true, true),
  ('project_types', 'id', 'Project type', 'نوع مشروع', array['key','name_en','name_ar','icon','color','fields'], array['name_en','name_ar','icon','color','fields'], true, true),
  ('categories', 'id', 'Category', 'تصنيف', array['name_en','name_ar','kind','parent_id','aliases'], array['name_en','name_ar','kind','parent_id','aliases'], true, true),
  ('money_accounts', 'id', 'Money account', 'حساب فلوس', array['name','kind','aliases'], array['name','kind','aliases'], true, true),
  ('record_links', 'id', 'Project link', 'ربط بمشروع', array['project_id','record_type','record_id','share_pct'], array['share_pct'], true, false),
  ('boms', 'id', 'Bill of materials', 'قائمة مكونات', array['name','product_id','project_id','notes'], array['name','product_id','project_id','notes'], true, true),
  ('bom_lines', 'id', 'BOM line', 'بند مكونات', array['bom_id','component_product_id','component_name','quantity','unit_cost','notes'], array['component_product_id','component_name','quantity','unit_cost','notes'], true, false)
on conflict (table_name) do update set
  pk_col = excluded.pk_col, label_en = excluded.label_en, label_ar = excluded.label_ar,
  insert_cols = excluded.insert_cols, update_cols = excluded.update_cols,
  can_delete = excluded.can_delete, soft_delete = excluded.soft_delete;

-- ---------------------------------------------------------------------------
-- Change capture: active only while promed.action_id is set (inside agent_commit).
create or replace function public.agent_capture()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  aid text := current_setting('promed.action_id', true);
  old_j jsonb;
  new_j jsonb;
begin
  if aid is null or aid = '' then
    return null;
  end if;
  if tg_op <> 'INSERT' then old_j := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then new_j := to_jsonb(new); end if;
  insert into public.agent_changes (action_id, table_name, op, pk_col, pk_val, before, after)
  values (aid::uuid, tg_table_name, lower(tg_op), tg_argv[0], coalesce(new_j, old_j) ->> tg_argv[0], old_j, new_j);
  return null;
end $$;

do $$
declare r record;
begin
  for r in select table_name, pk_col from public.agent_table_registry union select 'payment_allocations', 'allocation_id' loop
    execute format('drop trigger if exists agent_capture_trg on public.%I', r.table_name);
    execute format('create trigger agent_capture_trg after insert or update or delete on public.%I for each row execute function public.agent_capture(%L)', r.table_name, r.pk_col);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Helpers
create or replace function public.agent_registry(p_table text)
returns public.agent_table_registry
language plpgsql stable as $$
declare r public.agent_table_registry;
begin
  select * into r from public.agent_table_registry where table_name = p_table;
  if not found then raise exception 'The agent cannot work on table "%"', p_table; end if;
  return r;
end $$;

create or replace function public.find_or_create_category(p_name text, p_kind text default 'expense', p_name_ar text default null)
returns integer language plpgsql as $$
declare cid integer;
begin
  select id into cid from public.categories
  where deleted_at is null
    and (public.norm_text(name_en) = public.norm_text(p_name) or public.norm_text(name_ar) = public.norm_text(p_name)
         or public.norm_text(name_ar) = public.norm_text(p_name_ar))
  limit 1;
  if cid is null then
    insert into public.categories (name_en, name_ar, kind) values (p_name, coalesce(p_name_ar, p_name), coalesce(p_kind, 'expense'))
    returning id into cid;
  end if;
  return cid;
end $$;

create or replace function public.find_or_create_account(p_name text, p_kind text default 'other')
returns integer language plpgsql as $$
declare aid integer;
begin
  select id into aid from public.money_accounts
  where deleted_at is null
    and (public.norm_text(name) = public.norm_text(p_name)
         or exists (select 1 from unnest(aliases) a where public.norm_text(a) = public.norm_text(p_name)))
  limit 1;
  if aid is null then
    insert into public.money_accounts (name, kind) values (p_name, coalesce(p_kind, 'other')) returning id into aid;
  end if;
  return aid;
end $$;

create or replace function public.find_or_create_project(p_name text, p_type_key text default 'general')
returns integer language plpgsql as $$
declare pid integer; tid integer;
begin
  select id into pid from public.projects
  where deleted_at is null
    and (public.norm_text(name) = public.norm_text(p_name)
         or exists (select 1 from unnest(aliases) a where public.norm_text(a) = public.norm_text(p_name)))
  limit 1;
  if pid is null then
    select id into tid from public.project_types where key = coalesce(p_type_key, 'general') and deleted_at is null;
    if tid is null then select id into tid from public.project_types where key = 'general'; end if;
    insert into public.projects (type_id, name) values (tid, p_name) returning id into pid;
  end if;
  return pid;
end $$;

create or replace function public.find_or_create_product(p_name text, p_price numeric default 0)
returns integer language plpgsql as $$
declare pid integer;
begin
  select product_id into pid from public.products where public.norm_text(product_name) = public.norm_text(p_name) limit 1;
  if pid is null then
    insert into public.products (product_name, unit_price) values (p_name, greatest(coalesce(p_price, 0), 0)) returning product_id into pid;
  end if;
  return pid;
end $$;

-- ---------------------------------------------------------------------------
-- Generic create / update / delete through the registry
create or replace function public.agent_op_create(p jsonb)
returns jsonb language plpgsql as $$
declare
  r public.agent_table_registry := public.agent_registry(p->>'table');
  vals jsonb := coalesce(p->'values', '{}'::jsonb);
  bad text[];
  cols text;
  res jsonb;
begin
  if r.insert_cols is null then raise exception 'New % records are created with a dedicated tool, not directly', r.label_en; end if;
  if r.table_name = 'liabilities' and not vals ? 'remaining_amount' then
    vals := vals || jsonb_build_object('remaining_amount', vals->'total_amount');
  end if;
  select array_agg(k) into bad from jsonb_object_keys(vals) k where not k = any (r.insert_cols);
  if bad is not null then raise exception 'Fields not allowed on %: %', r.label_en, array_to_string(bad, ', '); end if;
  select string_agg(format('%I', k), ', ') into cols from jsonb_object_keys(vals) k;
  if cols is null then raise exception 'No values given'; end if;
  execute format('insert into public.%I as t (%s) select %s from jsonb_populate_record(null::public.%I, $1) returning to_jsonb(t)',
                 r.table_name, cols, cols, r.table_name)
    into res using vals;
  return jsonb_build_object('table', r.table_name, 'record', res);
end $$;

create or replace function public.agent_op_update(p jsonb)
returns jsonb language plpgsql as $$
declare
  r public.agent_table_registry := public.agent_registry(p->>'table');
  vals jsonb := coalesce(p->'values', '{}'::jsonb);
  bad text[];
  sets text;
  before_row jsonb;
  res jsonb;
begin
  if r.update_cols is null then raise exception '% records cannot be edited by the agent', r.label_en; end if;
  select array_agg(k) into bad from jsonb_object_keys(vals) k where not k = any (r.update_cols);
  if bad is not null then raise exception 'Fields not allowed on %: %', r.label_en, array_to_string(bad, ', '); end if;
  select string_agg(format('%I = r.%I', k, k), ', ') into sets from jsonb_object_keys(vals) k;
  if sets is null then raise exception 'No changes given'; end if;
  execute format('select to_jsonb(t) from public.%I t where t.%I::text = $1', r.table_name, r.pk_col) into before_row using p->>'id';
  if before_row is null then raise exception '% #% was not found', r.label_en, p->>'id'; end if;
  execute format('update public.%I t set %s from jsonb_populate_record(null::public.%I, $1) r where t.%I::text = $2 returning to_jsonb(t)',
                 r.table_name, sets, r.table_name, r.pk_col)
    into res using vals, p->>'id';
  return jsonb_build_object('table', r.table_name, 'before', before_row, 'record', res);
end $$;

create or replace function public.agent_op_delete(p jsonb)
returns jsonb language plpgsql as $$
declare
  r public.agent_table_registry := public.agent_registry(p->>'table');
  res jsonb;
begin
  if not r.can_delete then raise exception '% records cannot be deleted by the agent', r.label_en; end if;
  if r.soft_delete then
    execute format('update public.%I t set deleted_at = now() where t.%I::text = $1 and t.deleted_at is null returning to_jsonb(t)', r.table_name, r.pk_col)
      into res using p->>'id';
  else
    execute format('delete from public.%I t where t.%I::text = $1 returning to_jsonb(t)', r.table_name, r.pk_col)
      into res using p->>'id';
  end if;
  if res is null then raise exception '% #% was not found', r.label_en, p->>'id'; end if;
  return jsonb_build_object('table', r.table_name, 'deleted', res);
end $$;

-- ---------------------------------------------------------------------------
-- Money: expenses / income (several in one go), with categories, accounts and project shares
create or replace function public.agent_op_record_entries(p jsonb)
returns jsonb language plpgsql as $$
declare
  e jsonb;
  l jsonb;
  cat_id integer;
  acc_id integer;
  pid integer;
  eid bigint;
  out_rows jsonb := '[]'::jsonb;
  links_out jsonb;
begin
  if jsonb_typeof(p->'entries') <> 'array' or jsonb_array_length(p->'entries') = 0 then
    raise exception 'No entries to record';
  end if;
  for e in select * from jsonb_array_elements(p->'entries') loop
    if coalesce((e->>'amount')::numeric, 0) <= 0 then raise exception 'Every amount must be more than zero'; end if;
    if e->>'kind' not in ('expense', 'income') then raise exception 'Entry kind must be expense or income'; end if;

    cat_id := nullif(e->>'category_id', '')::integer;
    if cat_id is null and nullif(e->>'new_category', '') is not null then
      cat_id := public.find_or_create_category(e->>'new_category', e->>'kind', e->>'new_category_ar');
    end if;
    acc_id := nullif(e->>'account_id', '')::integer;
    if acc_id is null and nullif(e->>'new_account', '') is not null then
      acc_id := public.find_or_create_account(e->>'new_account');
    end if;

    insert into public.ledger_entries (kind, amount, entry_date, category_id, account_id, party_name,
                                       client_id, supplier_id, employee_id, description, notes, source, voice_text)
    values (e->>'kind', round((e->>'amount')::numeric, 2), coalesce(nullif(e->>'entry_date', '')::date, current_date),
            cat_id, acc_id, nullif(e->>'party_name', ''),
            nullif(e->>'client_id', '')::integer, nullif(e->>'supplier_id', '')::integer, nullif(e->>'employee_id', '')::integer,
            nullif(e->>'description', ''), nullif(e->>'notes', ''), 'agent', nullif(p->>'voice_text', ''))
    returning id into eid;

    links_out := '[]'::jsonb;
    for l in select * from jsonb_array_elements(coalesce(e->'links', '[]'::jsonb)) loop
      pid := nullif(l->>'project_id', '')::integer;
      if pid is null and nullif(l->>'new_project', '') is not null then
        pid := public.find_or_create_project(l->>'new_project', coalesce(l->>'new_project_type', 'general'));
      end if;
      if pid is not null then
        insert into public.record_links (project_id, record_type, record_id, share_pct)
        values (pid, 'ledger_entry', eid, coalesce(nullif(l->>'share_pct', '')::numeric, 100));
        links_out := links_out || jsonb_build_object('project_id', pid, 'share_pct', coalesce(nullif(l->>'share_pct', '')::numeric, 100));
      end if;
    end loop;

    out_rows := out_rows || jsonb_build_object('id', eid, 'kind', e->>'kind', 'amount', round((e->>'amount')::numeric, 2),
                                               'category_id', cat_id, 'account_id', acc_id, 'links', links_out);
  end loop;
  return jsonb_build_object('entries', out_rows);
end $$;

-- Per-invoice paid / remaining for one client, computed exactly like the Clients screen
-- (allocateEntityInvoices): direct payments first, then account payments + opening credit
-- spread oldest-first. The stored paid/remaining columns on old invoices can be stale.
create or replace function public.client_invoice_status(p_client integer)
returns table (tx_id integer, tx_date date, invoice_no text, total numeric, paid numeric, remaining numeric)
language plpgsql stable as $$
declare
  pool numeric := 0;
  ob numeric;
  tx record;
  direct numeric;
  applied numeric;
  due numeric;
  from_pool numeric;
begin
  select coalesce(c.opening_balance, 0) into ob from public.clients c where c.client_id = p_client;
  if ob < 0 then pool := -ob; end if;
  select pool + coalesce(sum(p.payment_amount), 0) into pool
  from public.payments p
  where p.transaction_type = 'client' and p.payment_amount > 0
    and p.client_id = p_client
    and (p.transaction_id is null
         or not exists (select 1 from public.client_transactions ct where ct.transaction_id = p.transaction_id and ct.client_id = p_client));
  for tx in
    select ct.transaction_id, ct.transaction_date, ct.invoice_number, ct.total_amount
    from public.client_transactions ct where ct.client_id = p_client
    order by ct.transaction_date, ct.transaction_id
  loop
    select coalesce(sum(p.payment_amount), 0) into direct
    from public.payments p where p.transaction_type = 'client' and p.transaction_id = tx.transaction_id and p.payment_amount > 0;
    applied := least(tx.total_amount, direct);
    pool := pool + greatest(0, direct - tx.total_amount);
    due := greatest(0, tx.total_amount - applied);
    from_pool := least(due, pool);
    pool := pool - from_pool;
    tx_id := tx.transaction_id; tx_date := tx.transaction_date; invoice_no := tx.invoice_number;
    total := tx.total_amount; paid := applied + from_pool; remaining := greatest(0, tx.total_amount - applied - from_pool);
    return next;
  end loop;
end $$;

-- Client pays on account: one receipt (the authoritative record), shown against the oldest open
-- invoices. Like the Clients screen, writing payment_allocations is best-effort.
create or replace function public.agent_op_client_payment(p jsonb)
returns jsonb language plpgsql as $$
declare
  cid integer := (p->>'client_id')::integer;
  amt numeric := round((p->>'amount')::numeric, 2);
  pid integer;
  left_amt numeric;
  tx record;
  alloc numeric;
  allocs jsonb := '[]'::jsonb;
  a jsonb;
begin
  if cid is null or not exists (select 1 from public.clients where client_id = cid) then raise exception 'Client not found'; end if;
  if amt is null or amt <= 0 then raise exception 'Payment amount must be more than zero'; end if;
  left_amt := amt;
  for tx in select * from public.client_invoice_status(cid) s where s.remaining > 0 order by s.tx_date, s.tx_id loop
    exit when left_amt <= 0;
    alloc := least(tx.remaining, left_amt);
    allocs := allocs || jsonb_build_object('transaction_id', tx.tx_id, 'invoice_number', tx.invoice_no,
                                           'date', tx.tx_date, 'allocated', alloc, 'remaining_after', tx.remaining - alloc);
    left_amt := left_amt - alloc;
  end loop;
  insert into public.payments (client_id, transaction_id, transaction_type, payment_amount, payment_date, payment_method, reference_number)
  values (cid, null, 'client', amt, coalesce(nullif(p->>'payment_date', '')::date, current_date),
          coalesce(nullif(p->>'payment_method', ''), 'cash'), nullif(p->>'reference_number', ''))
  returning payment_id into pid;
  for a in select * from jsonb_array_elements(allocs) loop
    begin
      insert into public.payment_allocations (payment_id, transaction_id, transaction_type, allocated_amount)
      values (pid, (a->>'transaction_id')::integer, 'client', (a->>'allocated')::numeric);
    exception when others then
      null; -- old invoice with inconsistent stored totals: the receipt still counts (same as the UI)
    end;
  end loop;
  return jsonb_build_object('payment_id', pid, 'client_id', cid, 'amount', amt, 'allocations', allocs,
                            'unallocated_credit', greatest(left_amt, 0));
end $$;

-- Paying a supplier: oldest open purchase first, one payment row per purchase (same shape as
-- the Supplier transactions screen); anything left over is kept as an advance on the account.
create or replace function public.agent_op_supplier_payment(p jsonb)
returns jsonb language plpgsql as $$
declare
  sid integer := (p->>'supplier_id')::integer;
  amt numeric := round((p->>'amount')::numeric, 2);
  pdate date := coalesce(nullif(p->>'payment_date', '')::date, current_date);
  method text := coalesce(nullif(p->>'payment_method', ''), 'cash');
  ref text := nullif(p->>'reference_number', '');
  left_amt numeric;
  tx record;
  alloc numeric;
  pid integer;
  rows_out jsonb := '[]'::jsonb;
begin
  if sid is null or not exists (select 1 from public.suppliers where supplier_id = sid) then raise exception 'Supplier not found'; end if;
  if amt is null or amt <= 0 then raise exception 'Payment amount must be more than zero'; end if;
  left_amt := amt;
  for tx in
    select transaction_id, remaining_amount, paid_amount, status, invoice_number, transaction_date
    from public.supplier_transactions
    where supplier_id = sid and remaining_amount > 0
    order by transaction_date, transaction_id
  loop
    exit when left_amt <= 0;
    alloc := least(tx.remaining_amount, left_amt);
    insert into public.payments (supplier_id, transaction_id, transaction_type, payment_amount, payment_date, payment_method, reference_number)
    values (sid, tx.transaction_id, 'supplier', alloc, pdate, method, ref)
    returning payment_id into pid;
    update public.supplier_transactions
    set paid_amount = coalesce(paid_amount, 0) + alloc,
        remaining_amount = remaining_amount - alloc,
        status = case when remaining_amount - alloc <= 0 then (case when status = 'done' then 'done' else 'paid' end)
                      when status in ('paid', 'done') then 'in_progress' else status end
    where transaction_id = tx.transaction_id;
    rows_out := rows_out || jsonb_build_object('payment_id', pid, 'transaction_id', tx.transaction_id,
                                               'invoice_number', tx.invoice_number, 'allocated', alloc);
    left_amt := left_amt - alloc;
  end loop;
  if left_amt > 0 then
    insert into public.payments (supplier_id, transaction_id, transaction_type, payment_amount, payment_date, payment_method, reference_number)
    values (sid, null, 'supplier', left_amt, pdate, method, ref)
    returning payment_id into pid;
    rows_out := rows_out || jsonb_build_object('payment_id', pid, 'transaction_id', null, 'allocated', left_amt, 'advance', true);
  end if;
  return jsonb_build_object('supplier_id', sid, 'amount', amt, 'payments', rows_out, 'advance', greatest(left_amt, 0));
end $$;

-- A sale to a client (an invoice-to-be), matching the Client transactions screen: the first line is
-- the main product, further lines go into line_items; VAT on top, withholding deducted.
create or replace function public.agent_op_record_sale(p jsonb)
returns jsonb language plpgsql as $$
declare
  cid integer := (p->>'client_id')::integer;
  lines jsonb := p->'lines';
  first_line jsonb;
  extras jsonb := '[]'::jsonb;
  l jsonb;
  prod_id integer;
  sub numeric := 0;
  vat_rate numeric := coalesce(nullif(p->>'vat_rate', '')::numeric, 14);
  wht_rate numeric := coalesce(nullif(p->>'wht_rate', '')::numeric, 0);
  vat_amt numeric;
  wht_amt numeric;
  total numeric;
  paid numeric := coalesce(nullif(p->>'paid_now', '')::numeric, 0);
  tid integer;
  st text := coalesce(nullif(p->>'status', ''), 'not_started');
  i integer := 0;
begin
  if cid is null or not exists (select 1 from public.clients where client_id = cid) then raise exception 'Client not found'; end if;
  if jsonb_typeof(lines) <> 'array' or jsonb_array_length(lines) = 0 then raise exception 'A sale needs at least one line'; end if;
  for l in select * from jsonb_array_elements(lines) loop
    if coalesce((l->>'quantity')::numeric, 0) <= 0 or coalesce((l->>'unit_price')::numeric, -1) < 0 then
      raise exception 'Each line needs a quantity above zero and a price';
    end if;
    prod_id := nullif(l->>'product_id', '')::integer;
    if prod_id is null then prod_id := public.find_or_create_product(l->>'product_name', (l->>'unit_price')::numeric); end if;
    sub := sub + round((l->>'quantity')::numeric * (l->>'unit_price')::numeric, 2);
    if i = 0 then
      if (l->>'quantity')::numeric <> trunc((l->>'quantity')::numeric) then raise exception 'The main line quantity must be a whole number'; end if;
      first_line := l || jsonb_build_object('product_id', prod_id);
    else
      extras := extras || jsonb_build_object(
        'product_id', prod_id,
        'product_name', coalesce(l->>'product_name', (select product_name from public.products where product_id = prod_id)),
        'item_name', '', 'item_code', '', 'unit_type', 'EA',
        'quantity', (l->>'quantity')::numeric, 'unit_price', (l->>'unit_price')::numeric,
        'line_total', round((l->>'quantity')::numeric * (l->>'unit_price')::numeric, 2));
    end if;
    i := i + 1;
  end loop;
  sub := round(sub, 2);
  vat_amt := round(sub * vat_rate / 100, 2);
  wht_amt := round(sub * wht_rate / 100, 2);
  total := round(sub + vat_amt - wht_amt, 2);
  if paid < 0 or paid > total then raise exception 'Paid amount must be between 0 and the total (%)', total; end if;
  if paid >= total and total > 0 and st not in ('done') then st := 'paid'; end if;

  insert into public.client_transactions (client_id, product_id, quantity, unit_price, total_amount, paid_amount, remaining_amount,
      transaction_date, status, invoice_number, line_items, subtotal_amount, vat_rate, vat_amount, wht_rate, wht_amount)
  values (cid, (first_line->>'product_id')::integer, (first_line->>'quantity')::integer, (first_line->>'unit_price')::numeric,
      total, paid, total - paid, coalesce(nullif(p->>'transaction_date', '')::date, current_date), st, nullif(p->>'invoice_number', ''),
      extras, sub, vat_rate, vat_amt, wht_rate, wht_amt)
  returning transaction_id into tid;
  if paid > 0 then
    insert into public.payments (transaction_id, transaction_type, payment_amount, payment_date, payment_method)
    values (tid, 'client', paid, coalesce(nullif(p->>'transaction_date', '')::date, current_date), coalesce(nullif(p->>'payment_method', ''), 'cash'));
  end if;
  return jsonb_build_object('transaction_id', tid, 'client_id', cid, 'subtotal', sub, 'vat', vat_amt, 'wht', wht_amt,
                            'total', total, 'paid', paid, 'remaining', total - paid, 'status', st);
end $$;

create or replace function public.agent_op_record_purchase(p jsonb)
returns jsonb language plpgsql as $$
declare
  sid integer := (p->>'supplier_id')::integer;
  prod_id integer := nullif(p->>'product_id', '')::integer;
  qty numeric := (p->>'quantity')::numeric;
  price numeric := (p->>'unit_price')::numeric;
  total numeric;
  paid numeric := coalesce(nullif(p->>'paid_now', '')::numeric, 0);
  st text := coalesce(nullif(p->>'status', ''), 'not_started');
  tid integer;
begin
  if sid is null or not exists (select 1 from public.suppliers where supplier_id = sid) then raise exception 'Supplier not found'; end if;
  if qty is null or qty <= 0 or qty <> trunc(qty) then raise exception 'Quantity must be a whole number above zero'; end if;
  if price is null or price < 0 then raise exception 'Unit price is required'; end if;
  if prod_id is null then prod_id := public.find_or_create_product(p->>'product_name', price); end if;
  total := round(qty * price, 2);
  if paid < 0 or paid > total then raise exception 'Paid amount must be between 0 and the total (%)', total; end if;
  if paid >= total and total > 0 and st <> 'done' then st := 'paid'; end if;
  insert into public.supplier_transactions (supplier_id, product_id, quantity, unit_price, total_amount, paid_amount, remaining_amount,
      transaction_date, status, invoice_number)
  values (sid, prod_id, qty::integer, price, total, paid, total - paid, coalesce(nullif(p->>'transaction_date', '')::date, current_date), st,
      nullif(p->>'invoice_number', ''))
  returning transaction_id into tid;
  if paid > 0 then
    insert into public.payments (supplier_id, transaction_id, transaction_type, payment_amount, payment_date, payment_method)
    values (sid, tid, 'supplier', paid, coalesce(nullif(p->>'transaction_date', '')::date, current_date), coalesce(nullif(p->>'payment_method', ''), 'cash'));
  end if;
  return jsonb_build_object('transaction_id', tid, 'supplier_id', sid, 'total', total, 'paid', paid, 'remaining', total - paid, 'status', st);
end $$;

create or replace function public.agent_op_link_records(p jsonb)
returns jsonb language plpgsql as $$
declare
  l jsonb;
  pid integer;
  out_rows jsonb := '[]'::jsonb;
begin
  for l in select * from jsonb_array_elements(coalesce(p->'links', '[]'::jsonb)) loop
    pid := nullif(l->>'project_id', '')::integer;
    if pid is null and nullif(l->>'new_project', '') is not null then
      pid := public.find_or_create_project(l->>'new_project', coalesce(l->>'new_project_type', 'general'));
    end if;
    if pid is null then raise exception 'Each link needs a project'; end if;
    insert into public.record_links (project_id, record_type, record_id, share_pct)
    values (pid, l->>'record_type', (l->>'record_id')::bigint, coalesce(nullif(l->>'share_pct', '')::numeric, 100))
    on conflict (project_id, record_type, record_id) do update set share_pct = excluded.share_pct;
    out_rows := out_rows || jsonb_build_object('project_id', pid, 'record_type', l->>'record_type', 'record_id', l->>'record_id');
  end loop;
  return jsonb_build_object('links', out_rows);
end $$;

create or replace function public.agent_op_unlink_records(p jsonb)
returns jsonb language plpgsql as $$
declare n integer;
begin
  delete from public.record_links
  where project_id = (p->>'project_id')::integer and record_type = p->>'record_type' and record_id = (p->>'record_id')::bigint;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'That link does not exist'; end if;
  return jsonb_build_object('removed', n);
end $$;

create or replace function public.agent_dispatch(p_kind text, p_payload jsonb)
returns jsonb language plpgsql as $$
begin
  if p_kind = 'record_entries' then return public.agent_op_record_entries(p_payload);
  elsif p_kind = 'client_payment' then return public.agent_op_client_payment(p_payload);
  elsif p_kind = 'supplier_payment' then return public.agent_op_supplier_payment(p_payload);
  elsif p_kind = 'record_sale' then return public.agent_op_record_sale(p_payload);
  elsif p_kind = 'record_purchase' then return public.agent_op_record_purchase(p_payload);
  elsif p_kind = 'link_records' then return public.agent_op_link_records(p_payload);
  elsif p_kind = 'unlink_records' then return public.agent_op_unlink_records(p_payload);
  elsif p_kind = 'create_record' then return public.agent_op_create(p_payload);
  elsif p_kind = 'update_record' then return public.agent_op_update(p_payload);
  elsif p_kind = 'delete_record' then return public.agent_op_delete(p_payload);
  elsif p_kind = 'batch' then
    -- several operations as one undoable action
    return (select jsonb_agg(public.agent_dispatch(x->>'kind', x->'payload') order by ord)
            from jsonb_array_elements(p_payload->'operations') with ordinality as t(x, ord));
  end if;
  raise exception 'Unknown action kind "%"', p_kind;
end $$;

-- ---------------------------------------------------------------------------
-- Action lifecycle
create or replace function public.agent_stage(p_kind text, p_summary text, p_payload jsonb, p_preview jsonb default null,
                                              p_conversation uuid default null, p_voice text default null)
returns uuid language plpgsql as $$
declare aid uuid;
begin
  if not public.is_member() then raise exception 'Not allowed'; end if;
  insert into public.agent_actions (kind, summary, payload, preview, conversation_id, voice_text)
  values (p_kind, p_summary, p_payload, p_preview, p_conversation, p_voice)
  returning id into aid;
  return aid;
end $$;

create or replace function public.agent_commit(p_action uuid)
returns jsonb language plpgsql as $$
declare
  a public.agent_actions;
  res jsonb;
begin
  select * into a from public.agent_actions where id = p_action and user_id = auth.uid() for update;
  if not found then raise exception 'Action not found'; end if;
  if a.status = 'applied' then return a.result; end if;
  if a.status <> 'pending' then raise exception 'This action is already %', a.status; end if;
  perform set_config('promed.action_id', p_action::text, true);
  res := public.agent_dispatch(a.kind, a.payload);
  set constraints all immediate;
  perform set_config('promed.action_id', '', true);
  update public.agent_actions set status = 'applied', applied_at = now(), result = res, error = null where id = p_action;
  return res;
end $$;

create or replace function public.agent_cancel(p_action uuid)
returns void language plpgsql as $$
begin
  update public.agent_actions set status = 'cancelled' where id = p_action and user_id = auth.uid() and status = 'pending';
  if not found then raise exception 'Only a waiting action can be cancelled'; end if;
end $$;

create or replace function public.agent_mark_failed(p_action uuid, p_error text)
returns void language plpgsql as $$
begin
  update public.agent_actions set status = 'failed', error = left(p_error, 2000)
  where id = p_action and user_id = auth.uid() and status = 'pending';
end $$;

create or replace function public.agent_undo(p_action uuid, p_force boolean default false)
returns jsonb language plpgsql as $$
declare
  a public.agent_actions;
  ch record;
  cur jsonb;
  sets text;
  n integer := 0;
begin
  select * into a from public.agent_actions where id = p_action and user_id = auth.uid() for update;
  if not found then raise exception 'Action not found'; end if;
  if a.status <> 'applied' then raise exception 'Only applied actions can be undone (this one is %)', a.status; end if;
  if a.applied_at < now() - interval '30 days' then raise exception 'Changes older than 30 days cannot be undone'; end if;
  perform set_config('promed.action_id', '', true);

  -- 1) Every row must still look exactly as this action left it (its last captured state).
  if not p_force then
    for ch in
      select distinct on (table_name, pk_val) * from public.agent_changes
      where action_id = p_action order by table_name, pk_val, id desc
    loop
      execute format('select to_jsonb(t) from public.%I t where t.%I::text = $1', ch.table_name, ch.pk_col) into cur using ch.pk_val;
      if ch.op = 'delete' then
        continue;
      elsif cur is null then
        raise exception 'Cannot undo: % #% was deleted after this action.', ch.table_name, ch.pk_val;
      elsif (cur - 'updated_at') is distinct from (ch.after - 'updated_at') then
        raise exception 'Cannot undo: % #% was changed after this action. Undo the later change first.', ch.table_name, ch.pk_val;
      end if;
    end loop;
  end if;

  -- 2) Replay backwards.
  for ch in select * from public.agent_changes where action_id = p_action order by id desc loop
    execute format('select to_jsonb(t) from public.%I t where t.%I::text = $1', ch.table_name, ch.pk_col) into cur using ch.pk_val;
    if ch.op = 'insert' then
      if cur is not null then
        execute format('delete from public.%I t where t.%I::text = $1', ch.table_name, ch.pk_col) using ch.pk_val;
      end if;
    elsif ch.op = 'update' then
      select string_agg(format('%I = r.%I', k, k), ', ') into sets from jsonb_object_keys(ch.before) k where k <> ch.pk_col;
      execute format('update public.%I t set %s from jsonb_populate_record(null::public.%I, $1) r where t.%I::text = $2',
                     ch.table_name, sets, ch.table_name, ch.pk_col) using ch.before, ch.pk_val;
    elsif ch.op = 'delete' then
      if cur is null then
        execute format('insert into public.%I select (jsonb_populate_record(null::public.%I, $1)).*', ch.table_name, ch.table_name) using ch.before;
      end if;
    end if;
    n := n + 1;
  end loop;

  update public.agent_actions set status = 'undone', undone_at = now() where id = p_action;
  return jsonb_build_object('undone', true, 'changes_reverted', n);
end $$;

-- ---------------------------------------------------------------------------
-- Read side (security invoker: row rules apply)
create or replace function public.agent_search(p_q text, p_kinds text[] default null, p_limit integer default 6)
returns table (kind text, id bigint, name text, detail text, score real)
language sql stable
set search_path = public, extensions
as $$
  with q as (select public.norm_text(p_q) as nq),
  cand as (
    select 'client'::text as kind, c.client_id::bigint as id, c.client_name::text as name, null::text as detail,
           greatest(similarity(public.norm_text(c.client_name), q.nq), word_similarity(q.nq, public.norm_text(c.client_name))) as score
    from public.clients c, q
    union all
    select 'supplier', s.supplier_id, s.supplier_name, null,
           greatest(similarity(public.norm_text(s.supplier_name), q.nq), word_similarity(q.nq, public.norm_text(s.supplier_name)))
    from public.suppliers s, q
    union all
    select 'product', p.product_id, p.product_name, nullif(concat_ws(' · ', p.model, 'EGP ' || p.unit_price::text), ''),
           greatest(similarity(public.norm_text(p.product_name || ' ' || coalesce(p.model, '')), q.nq),
                    word_similarity(q.nq, public.norm_text(p.product_name || ' ' || coalesce(p.model, ''))))
    from public.products p, q
    union all
    select 'project', pr.id, pr.name, t.name_en || coalesce(' / ' || t.name_ar, '') || ' · ' || pr.status,
           greatest(similarity(public.norm_text(pr.name), q.nq), word_similarity(q.nq, public.norm_text(pr.name)),
                    coalesce((select max(greatest(similarity(public.norm_text(a), q.nq), word_similarity(q.nq, public.norm_text(a)))) from unnest(pr.aliases) a), 0))
    from public.projects pr join public.project_types t on t.id = pr.type_id, q
    where pr.deleted_at is null
    union all
    select 'category', c.id, c.name_en, c.name_ar || ' · ' || c.kind,
           greatest(similarity(public.norm_text(c.name_en), q.nq), similarity(public.norm_text(coalesce(c.name_ar, '')), q.nq),
                    word_similarity(q.nq, public.norm_text(c.name_en || ' ' || coalesce(c.name_ar, ''))),
                    coalesce((select max(greatest(similarity(public.norm_text(a), q.nq), word_similarity(public.norm_text(a), q.nq))) from unnest(c.aliases) a), 0))
    from public.categories c, q
    where c.deleted_at is null
    union all
    select 'account', a.id, a.name, a.kind,
           greatest(similarity(public.norm_text(a.name), q.nq),
                    coalesce((select max(greatest(similarity(public.norm_text(x), q.nq), word_similarity(public.norm_text(x), q.nq))) from unnest(a.aliases) x), 0))
    from public.money_accounts a, q
    where a.deleted_at is null
    union all
    select 'employee', e.employee_id, e.name, e.role,
           greatest(similarity(public.norm_text(e.name), q.nq), word_similarity(q.nq, public.norm_text(e.name)))
    from public.employees e, q
    union all
    select 'compliance_item', ci.id, ci.title, ci.status || coalesce(' · expires ' || ci.expiry_date::text, ''),
           greatest(similarity(public.norm_text(ci.title), q.nq), word_similarity(q.nq, public.norm_text(ci.title)))
    from public.compliance_items ci, q
    union all
    select 'project_type', pt.id, pt.name_en, pt.name_ar,
           greatest(similarity(public.norm_text(pt.name_en || ' ' || coalesce(pt.name_ar, '')), q.nq),
                    word_similarity(q.nq, public.norm_text(pt.name_en || ' ' || coalesce(pt.name_ar, ''))))
    from public.project_types pt, q
    where pt.deleted_at is null
  ),
  ranked as (
    select c.*, row_number() over (partition by c.kind order by c.score desc) as rn
    from cand c
    where c.score >= 0.2 and (p_kinds is null or c.kind = any (p_kinds))
  )
  select kind, id, name, detail, score::real from ranked where rn <= greatest(p_limit, 1) order by score desc, kind
$$;

-- Same arithmetic as getClientAccountSummary(): opening balance + invoiced - every client payment.
create or replace function public.client_balances(p_client integer default null)
returns table (client_id integer, client_name text, opening_balance numeric, invoiced numeric, paid numeric,
               balance numeric, open_invoices integer, last_activity date)
language sql stable as $$
  select c.client_id, c.client_name::text, coalesce(c.opening_balance, 0),
         coalesce(t.inv, 0), coalesce(py.paid, 0),
         coalesce(c.opening_balance, 0) + coalesce(t.inv, 0) - coalesce(py.paid, 0),
         coalesce(t.open_cnt, 0)::integer,
         greatest(t.last_tx, py.last_pay)
  from public.clients c
  left join lateral (
    select sum(ct.total_amount) as inv, count(*) filter (where ct.remaining_amount > 0) as open_cnt, max(ct.transaction_date) as last_tx
    from public.client_transactions ct where ct.client_id = c.client_id
  ) t on true
  left join lateral (
    select sum(p.payment_amount) as paid, max(p.payment_date) as last_pay
    from public.payments p
    where p.transaction_type = 'client'
      and (p.client_id = c.client_id
           or p.transaction_id in (select ct2.transaction_id from public.client_transactions ct2 where ct2.client_id = c.client_id))
  ) py on true
  where p_client is null or c.client_id = p_client
$$;

create or replace function public.supplier_balances(p_supplier integer default null)
returns table (supplier_id integer, supplier_name text, purchased numeric, paid numeric, balance numeric,
               open_purchases integer, last_activity date)
language sql stable as $$
  select s.supplier_id, s.supplier_name::text, coalesce(t.tot, 0), coalesce(py.paid, 0),
         coalesce(t.tot, 0) - coalesce(py.paid, 0), coalesce(t.open_cnt, 0)::integer, greatest(t.last_tx, py.last_pay)
  from public.suppliers s
  left join lateral (
    select sum(st.total_amount) as tot, count(*) filter (where st.remaining_amount > 0) as open_cnt, max(st.transaction_date) as last_tx
    from public.supplier_transactions st where st.supplier_id = s.supplier_id
  ) t on true
  left join lateral (
    select sum(p.payment_amount) as paid, max(p.payment_date) as last_pay
    from public.payments p
    where p.transaction_type = 'supplier'
      and (p.supplier_id = s.supplier_id
           or p.transaction_id in (select st2.transaction_id from public.supplier_transactions st2 where st2.supplier_id = s.supplier_id))
  ) py on true
  where p_supplier is null or s.supplier_id = p_supplier
$$;

-- One row per entry, with readable names (and every project it belongs to).
create or replace view public.v_ledger with (security_invoker = true) as
select e.id, e.kind, e.amount, e.currency, e.entry_date, e.description, e.notes, e.party_name, e.source, e.voice_text,
       e.category_id, c.name_en as category_en, c.name_ar as category_ar,
       e.account_id, a.name as account_name,
       e.client_id, cl.client_name, e.supplier_id, s.supplier_name, e.employee_id, em.name as employee_name,
       (select coalesce(jsonb_agg(jsonb_build_object('project_id', p.id, 'name', p.name, 'share_pct', l.share_pct) order by p.name), '[]'::jsonb)
          from public.record_links l join public.projects p on p.id = l.project_id
         where l.record_type = 'ledger_entry' and l.record_id = e.id) as projects,
       e.created_at, e.created_by
from public.ledger_entries e
left join public.categories c on c.id = e.category_id
left join public.money_accounts a on a.id = e.account_id
left join public.clients cl on cl.client_id = e.client_id
left join public.suppliers s on s.supplier_id = e.supplier_id
left join public.employees em on em.employee_id = e.employee_id
where e.deleted_at is null;

-- Money attributed to projects through links (amount x share).
create or replace view public.v_project_money with (security_invoker = true) as
select l.project_id, 'ledger_entry'::text as record_type, e.id as record_id, e.entry_date as date,
       case when e.kind = 'income' then 'income' else 'expense' end as direction,
       round(e.amount * l.share_pct / 100, 2) as amount,
       coalesce(e.description, c.name_en) as label, c.name_en as category
from public.record_links l
join public.ledger_entries e on l.record_type = 'ledger_entry' and e.id = l.record_id and e.deleted_at is null
left join public.categories c on c.id = e.category_id
union all
select l.project_id, 'client_transaction', ct.transaction_id, ct.transaction_date, 'income',
       round(ct.total_amount * l.share_pct / 100, 2), coalesce(ct.invoice_number, 'Sale #' || ct.transaction_id), 'Sales'
from public.record_links l
join public.client_transactions ct on l.record_type = 'client_transaction' and ct.transaction_id = l.record_id
union all
select l.project_id, 'supplier_transaction', st.transaction_id, st.transaction_date, 'expense',
       round(st.total_amount * l.share_pct / 100, 2), coalesce(st.invoice_number, 'Purchase #' || st.transaction_id), 'Purchases'
from public.record_links l
join public.supplier_transactions st on l.record_type = 'supplier_transaction' and st.transaction_id = l.record_id
union all
select l.project_id, 'liability', li.id, coalesce(li.due_date, li.created_at::date), 'expense',
       round(li.total_amount * l.share_pct / 100, 2), coalesce(li.description, li.category), li.category
from public.record_links l
join public.liabilities li on l.record_type = 'liability' and li.id = l.record_id;

create or replace view public.v_project_totals with (security_invoker = true) as
select p.id as project_id, p.name, p.status, p.type_id, t.key as type_key, t.name_en as type_en, t.name_ar as type_ar,
       t.icon, t.color, p.parent_id, p.budget, p.start_date, p.end_date, p.client_id, p.supplier_id, p.product_id,
       coalesce(sum(m.amount) filter (where m.direction = 'income'), 0) as income,
       coalesce(sum(m.amount) filter (where m.direction = 'expense'), 0) as expense,
       coalesce(sum(m.amount) filter (where m.direction = 'income'), 0) - coalesce(sum(m.amount) filter (where m.direction = 'expense'), 0) as net,
       count(m.record_id) as records, max(m.date) as last_activity, p.created_at
from public.projects p
join public.project_types t on t.id = p.type_id
left join public.v_project_money m on m.project_id = p.id
where p.deleted_at is null
group by p.id, t.id;

create or replace function public.ledger_report(p_from date default null, p_to date default null, p_group text default 'category',
                                                p_kind text default null, p_project integer default null)
returns jsonb language sql stable as $$
  with base as (
    select v.*, null::integer as project_id, v.amount as amt, null::text as project_name
    from public.v_ledger v
    where p_project is null and coalesce(p_group, 'category') <> 'project'
    union all
    select v.*, l.project_id, round(v.amount * l.share_pct / 100, 2), p.name
    from public.v_ledger v
    join public.record_links l on l.record_type = 'ledger_entry' and l.record_id = v.id
    join public.projects p on p.id = l.project_id
    where (p_project is not null or p_group = 'project') and (p_project is null or l.project_id = p_project)
  ),
  f as (
    select * from base
    where (p_from is null or entry_date >= p_from) and (p_to is null or entry_date <= p_to)
      and (p_kind is null or kind = p_kind)
  ),
  g as (
    select case coalesce(p_group, 'category')
             when 'project' then coalesce(project_name, 'No project')
             when 'month' then to_char(entry_date, 'YYYY-MM')
             when 'account' then coalesce(account_name, 'Unspecified')
             when 'party' then coalesce(party_name, client_name, supplier_name, employee_name, 'Unspecified')
             when 'kind' then kind
             when 'day' then entry_date::text
             else coalesce(category_en, 'Uncategorized')
           end as grp,
           kind, sum(amt) as total, count(*) as entries
    from f group by 1, 2
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to, 'group_by', coalesce(p_group, 'category'),
    'income', coalesce((select sum(amt) from f where kind = 'income'), 0),
    'expense', coalesce((select sum(amt) from f where kind = 'expense'), 0),
    'rows', coalesce((select jsonb_agg(jsonb_build_object('group', grp, 'kind', kind, 'total', total, 'entries', entries) order by total desc) from g), '[]'::jsonb))
$$;

create or replace function public.project_overview(p_project integer)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'project', to_jsonb(t),
    'attributes', p.attributes, 'aliases', p.aliases, 'notes', p.notes,
    'type_fields', pt.fields,
    'parent', (select jsonb_build_object('id', pp.id, 'name', pp.name) from public.projects pp where pp.id = p.parent_id),
    'children', coalesce((select jsonb_agg(jsonb_build_object('id', c.project_id, 'name', c.name, 'net', c.net, 'type', c.type_en)) from public.v_project_totals c where c.parent_id = p.id), '[]'::jsonb),
    'client', (select jsonb_build_object('id', cl.client_id, 'name', cl.client_name) from public.clients cl where cl.client_id = p.client_id),
    'supplier', (select jsonb_build_object('id', s.supplier_id, 'name', s.supplier_name) from public.suppliers s where s.supplier_id = p.supplier_id),
    'product', (select jsonb_build_object('id', pr.product_id, 'name', pr.product_name) from public.products pr where pr.product_id = p.product_id),
    'by_category', coalesce((select jsonb_agg(x order by x.total desc) from (
        select m.category, m.direction, sum(m.amount) as total, count(*) as n
        from public.v_project_money m where m.project_id = p.id group by 1, 2) x), '[]'::jsonb),
    'records', coalesce((select jsonb_agg(r order by r.date desc nulls last) from (
        select m.record_type, m.record_id, m.date, m.direction, m.amount, m.label, m.category
        from public.v_project_money m where m.project_id = p.id order by m.date desc nulls last limit 100) r), '[]'::jsonb)
  )
  from public.projects p
  join public.project_types pt on pt.id = p.type_id
  join public.v_project_totals t on t.project_id = p.id
  where p.id = p_project
$$;

create or replace function public.dashboard_snapshot()
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'receivable', (select coalesce(sum(greatest(balance, 0)), 0) from public.client_balances()),
    'client_credit', (select coalesce(sum(greatest(-balance, 0)), 0) from public.client_balances()),
    'payable', (select coalesce(sum(greatest(balance, 0)), 0) from public.supplier_balances()),
    'month_income', (select coalesce(sum(amount), 0) from public.ledger_entries where kind = 'income' and deleted_at is null and date_trunc('month', entry_date) = date_trunc('month', current_date)),
    'month_expense', (select coalesce(sum(amount), 0) from public.ledger_entries where kind = 'expense' and deleted_at is null and date_trunc('month', entry_date) = date_trunc('month', current_date)),
    'overdue_invoices', (select count(*) from public.client_transactions where remaining_amount > 0 and due_date < current_date),
    'overdue_amount', (select coalesce(sum(remaining_amount), 0) from public.client_transactions where remaining_amount > 0 and due_date < current_date),
    'liabilities_due_30d', (select coalesce(sum(remaining_amount), 0) from public.liabilities where remaining_amount > 0 and due_date <= current_date + 30),
    'compliance_expiring_30d', (select count(*) from public.compliance_items where expiry_date between current_date and current_date + 30),
    'compliance_expired', (select count(*) from public.compliance_items where expiry_date < current_date and status not in ('archived', 'cancelled')),
    'active_projects', (select count(*) from public.projects where deleted_at is null and status = 'active'),
    'today', current_date
  )
$$;

-- What the agent needs to know every turn (small).
create or replace function public.agent_context()
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'today', current_date,
    'settings', coalesce((select to_jsonb(s) - 'user_id' from public.agent_settings s where s.user_id = auth.uid()),
                         jsonb_build_object('auto_save_limit', 5000, 'voice_replies', false)),
    'project_types', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'key', key, 'en', name_en, 'ar', name_ar, 'fields', fields) order by id)
                                 from public.project_types where deleted_at is null), '[]'::jsonb),
    'projects', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'type', t.key, 'status', p.status, 'aliases', p.aliases) order by p.updated_at desc)
                            from (select * from public.projects where deleted_at is null and status in ('active', 'on_hold') order by updated_at desc limit 80) p
                            join public.project_types t on t.id = p.type_id), '[]'::jsonb),
    'categories', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'en', name_en, 'ar', name_ar, 'kind', kind, 'aliases', aliases) order by kind, name_en)
                              from public.categories where deleted_at is null), '[]'::jsonb),
    'accounts', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'kind', kind, 'aliases', aliases) order by id)
                            from public.money_accounts where deleted_at is null), '[]'::jsonb),
    'memory', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'subject', subject, 'content', content) order by created_at desc)
                          from (select * from public.agent_memory where user_id = auth.uid() and deleted_at is null order by created_at desc limit 80) m), '[]'::jsonb),
    'counts', jsonb_build_object(
      'clients', (select count(*) from public.clients), 'suppliers', (select count(*) from public.suppliers),
      'products', (select count(*) from public.products), 'open_sales', (select count(*) from public.client_transactions where remaining_amount > 0))
  )
$$;

-- Read-only questions the fixed tools don't cover. STABLE => Postgres refuses any write inside;
-- the keyword check and row cap are extra fences. Row rules still apply.
create or replace function public.agent_ask_data(p_sql text)
returns jsonb
language plpgsql
stable
set statement_timeout = '6s'
as $$
declare
  q text := regexp_replace(btrim(p_sql), ';\s*$', '');
  res jsonb;
begin
  if q ~ ';' then raise exception 'Only one statement is allowed'; end if;
  if q !~* '^(select|with)\s' then raise exception 'Only SELECT queries are allowed'; end if;
  if q ~* '\m(insert|update|delete|merge|truncate|drop|alter|create|grant|revoke|copy|call|execute|prepare|listen|notify|vacuum|lock|set_config|pg_sleep|pg_read_file|pg_ls_dir|dblink|lo_import|lo_export|agent_commit|agent_undo|agent_stage|agent_cancel|agent_mark_failed|agent_remember)\M' then
    raise exception 'The query uses a blocked keyword';
  end if;
  if q ~* '\m(auth|storage|vault|supabase_functions|pg_catalog)\s*\.' then raise exception 'Only business tables can be queried'; end if;
  execute format('select coalesce(jsonb_agg(x), ''[]''::jsonb) from (select * from (%s) sub limit 200) x', q) into res;
  return res;
end $$;

create or replace function public.agent_remember(p_kind text, p_subject text, p_content text)
returns jsonb language plpgsql as $$
declare mid integer;
begin
  update public.agent_memory set deleted_at = now()
  where user_id = auth.uid() and kind = p_kind and public.norm_text(subject) = public.norm_text(p_subject) and deleted_at is null;
  insert into public.agent_memory (kind, subject, content) values (p_kind, p_subject, p_content) returning id into mid;
  return jsonb_build_object('id', mid);
end $$;

create or replace function public.agent_forget(p_id integer)
returns void language sql as $$
  update public.agent_memory set deleted_at = now() where id = p_id and user_id = auth.uid();
$$;

-- Nobody anonymous may call anything; members (authenticated) may.
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

-- Live updates for the pages that show agent results.
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['ledger_entries','projects','record_links','agent_actions','client_transactions','supplier_transactions','payments','liabilities'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;
