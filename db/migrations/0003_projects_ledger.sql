-- 0003 Dynamic projects, income/expense ledger, categories, money accounts, BOMs.
-- Company-shared data: every logged-in member can read and write (same as existing tables).

create extension if not exists pg_trgm with schema extensions;

-- Arabic/English normalisation used for matching spoken names to records.
create or replace function public.norm_text(t text)
returns text
language sql
immutable
parallel safe
as $$
  select btrim(regexp_replace(
           regexp_replace(
             -- last char (tatweel) has no partner, so translate() deletes it
             translate(lower(coalesce(t, '')), 'أإآٱىة٠١٢٣٤٥٦٧٨٩ـ', 'اااايه0123456789'),
             '[ً-ْٰ]', '', 'g'),
           '\s+', ' ', 'g'))
$$;

-- ---------------------------------------------------------------------------
create table if not exists public.project_types (
  id serial primary key,
  key text not null unique,
  name_en text not null,
  name_ar text,
  icon text not null default 'folder',
  color text not null default 'blue',
  fields jsonb not null default '[]'::jsonb,   -- [{key,label_en,label_ar,type:text|number|date|select,options:[]}]
  is_system boolean not null default false,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.projects (
  id serial primary key,
  type_id integer not null references public.project_types(id),
  name text not null,
  status text not null default 'active' check (status in ('active', 'on_hold', 'done', 'cancelled')),
  parent_id integer references public.projects(id) on delete set null,
  client_id integer references public.clients(client_id) on delete set null,
  supplier_id integer references public.suppliers(supplier_id) on delete set null,
  product_id integer references public.products(product_id) on delete set null,
  budget numeric(14,2) check (budget is null or budget >= 0),
  start_date date,
  end_date date,
  aliases text[] not null default '{}',
  attributes jsonb not null default '{}'::jsonb,
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists projects_type_idx on public.projects(type_id) where deleted_at is null;
create index if not exists projects_name_trgm on public.projects using gin (public.norm_text(name) extensions.gin_trgm_ops);

create table if not exists public.categories (
  id serial primary key,
  name_en text not null,
  name_ar text,
  kind text not null default 'expense' check (kind in ('expense', 'income', 'both')),
  parent_id integer references public.categories(id) on delete set null,
  aliases text[] not null default '{}',
  color text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.money_accounts (
  id serial primary key,
  name text not null,
  kind text not null default 'other' check (kind in ('cash', 'bank', 'wallet', 'card', 'other')),
  aliases text[] not null default '{}',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.ledger_entries (
  id bigserial primary key,
  kind text not null check (kind in ('expense', 'income')),
  amount numeric(14,2) not null check (amount > 0),
  currency text not null default 'EGP',
  entry_date date not null default current_date,
  category_id integer references public.categories(id) on delete set null,
  account_id integer references public.money_accounts(id) on delete set null,
  party_name text,
  client_id integer references public.clients(client_id) on delete set null,
  supplier_id integer references public.suppliers(supplier_id) on delete set null,
  employee_id integer references public.employees(employee_id) on delete set null,
  description text,
  notes text,
  source text not null default 'manual' check (source in ('manual', 'agent', 'import')),
  voice_text text,
  receipt_path text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists ledger_entries_date_idx on public.ledger_entries(entry_date desc) where deleted_at is null;
create index if not exists ledger_entries_category_idx on public.ledger_entries(category_id);

-- Ties any record to one or more projects, with a share of its amount.
create table if not exists public.record_links (
  id bigserial primary key,
  project_id integer not null references public.projects(id) on delete cascade,
  record_type text not null check (record_type in (
    'ledger_entry', 'client_transaction', 'supplier_transaction', 'payment',
    'liability', 'compliance_item', 'inventory_item', 'product', 'bom')),
  record_id bigint not null,
  share_pct numeric(5,2) not null default 100 check (share_pct > 0 and share_pct <= 100),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (project_id, record_type, record_id)
);
create index if not exists record_links_record_idx on public.record_links(record_type, record_id);

create or replace function public.check_record_link_shares()
returns trigger language plpgsql as $$
declare total numeric;
begin
  select coalesce(sum(share_pct), 0) into total
  from public.record_links
  where record_type = new.record_type and record_id = new.record_id;
  if total > 100.001 then
    raise exception 'Project shares for this record add up to % %% (max 100 %%)', total;
  end if;
  return null;
end $$;
drop trigger if exists record_links_share_check on public.record_links;
create constraint trigger record_links_share_check after insert or update on public.record_links
  deferrable initially deferred for each row execute function public.check_record_link_shares();

create table if not exists public.boms (
  id serial primary key,
  name text not null,
  product_id integer references public.products(product_id) on delete set null,
  project_id integer references public.projects(id) on delete set null,
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create table if not exists public.bom_lines (
  id serial primary key,
  bom_id integer not null references public.boms(id) on delete cascade,
  component_product_id integer references public.products(product_id) on delete set null,
  component_name text,
  quantity numeric(14,3) not null check (quantity > 0),
  unit_cost numeric(14,2) not null default 0 check (unit_cost >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (component_product_id is not null or nullif(btrim(component_name), '') is not null)
);

-- updated_at + RLS for every new table
do $$
declare t text;
begin
  foreach t in array array['project_types','projects','categories','money_accounts','ledger_entries','boms','bom_lines'] loop
    execute format('drop trigger if exists %I on public.%I', 'set_updated_at_' || t, t);
    execute format('create trigger %I before update on public.%I for each row execute function public.update_updated_at_column()', 'set_updated_at_' || t, t);
  end loop;
  foreach t in array array['project_types','projects','categories','money_accounts','ledger_entries','record_links','boms','bom_lines'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_members', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.is_member()) with check (public.is_member())', t || '_members', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Starting set. The agent and the owner add more on the fly.
insert into public.project_types (key, name_en, name_ar, icon, color, is_system, fields) values
  ('deal', 'Deal / tender', 'صفقة / مناقصة', 'handshake', 'blue', true,
    '[{"key":"tender_no","label_en":"Tender no.","label_ar":"رقم المناقصة","type":"text"},{"key":"delivery_date","label_en":"Delivery date","label_ar":"تاريخ التسليم","type":"date"}]'),
  ('shipment', 'Shipment', 'شحنة', 'ship', 'teal', true,
    '[{"key":"origin","label_en":"Origin","label_ar":"بلد المنشأ","type":"text"},{"key":"container_no","label_en":"Container no.","label_ar":"رقم الكونتينر","type":"text"},{"key":"eta","label_en":"ETA","label_ar":"موعد الوصول","type":"date"},{"key":"customs_status","label_en":"Customs","label_ar":"الجمارك","type":"select","options":["pending","in_progress","cleared"]}]'),
  ('device', 'Device / product', 'جهاز / منتج', 'cpu', 'violet', true,
    '[{"key":"serial_no","label_en":"Serial no.","label_ar":"الرقم التسلسلي","type":"text"},{"key":"model","label_en":"Model","label_ar":"الموديل","type":"text"}]'),
  ('bom', 'Bill of materials', 'قائمة مكونات', 'layers', 'amber', true, '[]'),
  ('cost_center', 'Cost center', 'بند مصروفات', 'wallet', 'slate', true, '[]'),
  ('general', 'General', 'عام', 'folder', 'gray', true, '[]')
on conflict (key) do nothing;

insert into public.projects (type_id, name, aliases, notes)
select t.id, v.name, v.aliases, 'Created by default'
from (values
  ('cost_center', 'Office', array['المكتب','مكتب','office']),
  ('cost_center', 'Company car', array['العربية','عربية','السيارة','car']),
  ('cost_center', 'Salaries', array['المرتبات','مرتبات','الرواتب']),
  ('general', 'General', array['عام','general'])
) as v(type_key, name, aliases)
join public.project_types t on t.key = v.type_key
where not exists (select 1 from public.projects p where p.name = v.name);

insert into public.categories (name_en, name_ar, kind, aliases)
select v.* from (values
  ('Fuel', 'بنزين / وقود', 'expense', array['بنزين','سولار','وقود','fuel','gas']),
  ('Car maintenance', 'صيانة العربية', 'expense', array['صيانة عربية','ميكانيكي','كاوتش','زيت']),
  ('Shipping & freight', 'شحن', 'expense', array['شحن','شحنة','فريت','نولون','freight','shipping']),
  ('Customs & clearance', 'جمارك وتخليص', 'expense', array['جمارك','تخليص','مخلص']),
  ('Rent', 'إيجار', 'expense', array['ايجار','إيجار','rent']),
  ('Utilities', 'مرافق (كهرباء/مياه/نت)', 'expense', array['كهرباء','مياه','نت','انترنت','تليفون','موبايل']),
  ('Salaries', 'مرتبات', 'expense', array['مرتب','مرتبات','رواتب','salary']),
  ('Employee advances', 'سلف', 'expense', array['سلفة','سلف','advance']),
  ('Office supplies', 'أدوات مكتبية', 'expense', array['ورق','حبر','ادوات مكتبية','مستلزمات']),
  ('Hospitality', 'ضيافة', 'expense', array['ضيافة','بوفيه','اكل','غدا','قهوة']),
  ('Transport', 'مواصلات', 'expense', array['مواصلات','اوبر','تاكسي','كريم','uber']),
  ('Marketing', 'تسويق', 'expense', array['تسويق','اعلان','اعلانات','marketing']),
  ('Bank fees', 'مصاريف بنكية', 'expense', array['مصاريف بنك','عمولة بنك','bank fee']),
  ('Government fees & licences', 'رسوم حكومية وتراخيص', 'expense', array['رسوم','ترخيص','تراخيص','دمغة','شهادة']),
  ('Taxes', 'ضرائب', 'expense', array['ضرايب','ضرائب','tax']),
  ('Repairs & spare parts', 'إصلاح وقطع غيار', 'expense', array['قطع غيار','اصلاح','spare parts']),
  ('Commissions paid', 'عمولات', 'expense', array['عمولة','عمولات','commission']),
  ('Other expense', 'مصروفات أخرى', 'expense', array['متنوع','نثريات','other']),
  ('Service income', 'إيراد خدمات / صيانة', 'income', array['صيانة','خدمة','service']),
  ('Commission income', 'عمولات مستلمة', 'income', array['عمولة','commission']),
  ('Other income', 'إيرادات أخرى', 'income', array['ايراد','دخل','other income'])
) as v(name_en, name_ar, kind, aliases)
where not exists (select 1 from public.categories c where c.name_en = v.name_en);

insert into public.money_accounts (name, kind, aliases)
select v.* from (values
  ('Cash box', 'cash', array['الخزنة','خزنة','كاش','نقدي','cash']),
  ('Bank', 'bank', array['البنك','بنك','تحويل','bank'])
) as v(name, kind, aliases)
where not exists (select 1 from public.money_accounts a where a.name = v.name);
