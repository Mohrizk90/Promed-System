-- 0006 AI usage and cost: every Gemini call is logged with its token counts, and its cost in USD
-- is computed from a dated price list (so price changes, like the 1 Jan 2027 increase, apply by date).
-- Costs are estimates from published per-token prices; the real bill is in Google AI Studio.

create table if not exists public.ai_prices (
  model text not null,
  valid_from date not null,
  input_per_m numeric(10,4) not null,      -- USD per 1M input tokens (text/image/audio)
  cached_per_m numeric(10,4),              -- USD per 1M cached input tokens (null = same as input)
  output_per_m numeric(10,4) not null,     -- USD per 1M output tokens (thinking tokens included)
  note text,
  primary key (model, valid_from)
);

insert into public.ai_prices (model, valid_from, input_per_m, cached_per_m, output_per_m, note) values
  ('gemini-3.8-flash',      '2000-01-01', 0.75, 0.075, 3.75,  'Introductory price until 31 Dec 2026'),
  ('gemini-3.8-flash',      '2027-01-01', 1.50, 0.15,  7.50,  'Standard price from 1 Jan 2027'),
  ('gemini-3.5-flash',      '2000-01-01', 1.50, 0.15,  9.00,  'Backup and web search model'),
  ('gemini-3.5-transcribe', '2000-01-01', 2.00, null,  12.00, 'Voice to text (about $0.005 per minute)'),
  ('gemini-3.8-flash-tts',  '2000-01-01', 0.50, null,  9.00,  'Read aloud: output = audio tokens (25 per second); preview price until 31 Dec 2026'),
  ('gemini-3.8-flash-tts',  '2027-01-01', 1.00, null,  18.00, 'Read aloud from 1 Jan 2027'),
  ('gemini-2.5-flash',      '2000-01-01', 0.30, 0.03,  2.50,  'Compliance document scanner')
on conflict (model, valid_from) do nothing;

create table if not exists public.ai_usage (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  user_id uuid default auth.uid(),
  feature text not null check (feature in ('chat', 'transcribe', 'speak', 'web_search', 'document_scan', 'other')),
  model text not null,
  conversation_id uuid,
  input_tokens integer not null default 0 check (input_tokens >= 0),
  cached_tokens integer not null default 0 check (cached_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  reasoning_tokens integer not null default 0 check (reasoning_tokens >= 0),
  cost_usd numeric(14,6),
  meta jsonb
);
create index if not exists ai_usage_created_at on public.ai_usage (created_at desc);

-- Price lookup: exact model name, else the longest known name the model starts with
-- (e.g. "gemini-3.8-flash-preview-11-2026" -> gemini-3.8-flash).
create or replace function public.ai_cost_usd(p_model text, p_at timestamptz, p_input integer, p_cached integer, p_output integer)
returns numeric
language sql stable
set search_path = public
as $$
  select round(
           (greatest(p_input - least(p_cached, p_input), 0) * p.input_per_m
            + least(p_cached, p_input) * coalesce(p.cached_per_m, p.input_per_m)
            + p_output * p.output_per_m) / 1000000.0, 6)
  from public.ai_prices p
  where (p.model = p_model or p_model like p.model || '%') and p.valid_from <= p_at::date
  order by (p.model = p_model) desc, length(p.model) desc, p.valid_from desc
  limit 1
$$;

create or replace function public.ai_usage_set_cost()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.cost_usd := public.ai_cost_usd(new.model, coalesce(new.created_at, now()), new.input_tokens, new.cached_tokens, new.output_tokens);
  return new;
end $$;

drop trigger if exists ai_usage_cost on public.ai_usage;
create trigger ai_usage_cost before insert on public.ai_usage for each row execute function public.ai_usage_set_cost();

alter table public.ai_prices enable row level security;
alter table public.ai_usage enable row level security;

drop policy if exists ai_prices_read on public.ai_prices;
create policy ai_prices_read on public.ai_prices for select to authenticated using (public.is_member());

drop policy if exists ai_usage_read on public.ai_usage;
create policy ai_usage_read on public.ai_usage for select to authenticated using (public.is_member());
drop policy if exists ai_usage_insert on public.ai_usage;
create policy ai_usage_insert on public.ai_usage for insert to authenticated
  with check (public.is_member() and user_id = auth.uid());

revoke all on public.ai_prices, public.ai_usage from anon;
grant select on public.ai_prices to authenticated;
grant select, insert on public.ai_usage to authenticated;
grant usage on sequence public.ai_usage_id_seq to authenticated;

-- Totals for a date range (Cairo days), by feature, by model and by day.
create or replace function public.ai_usage_summary(p_from date default null, p_to date default null)
returns jsonb
language plpgsql stable
set search_path = public
as $$
declare
  d_from date := coalesce(p_from, date_trunc('month', (now() at time zone 'Africa/Cairo'))::date);
  d_to date := coalesce(p_to, (now() at time zone 'Africa/Cairo')::date);
  res jsonb;
begin
  if not public.is_member() then raise exception 'Not allowed'; end if;
  with u as (
    select *, (created_at at time zone 'Africa/Cairo')::date as day from public.ai_usage
    where (created_at at time zone 'Africa/Cairo')::date between d_from and d_to
  )
  select jsonb_build_object(
    'from', d_from, 'to', d_to,
    'total_usd', coalesce((select round(sum(cost_usd), 4) from u), 0),
    'calls', (select count(*) from u),
    'unpriced_calls', (select count(*) from u where cost_usd is null),
    'input_tokens', coalesce((select sum(input_tokens) from u), 0),
    'cached_tokens', coalesce((select sum(cached_tokens) from u), 0),
    'output_tokens', coalesce((select sum(output_tokens) from u), 0),
    'today_usd', coalesce((select round(sum(cost_usd), 4) from u where day = (now() at time zone 'Africa/Cairo')::date), 0),
    'by_feature', coalesce((select jsonb_agg(x order by (x->>'usd')::numeric desc) from (
        select jsonb_build_object('feature', feature, 'calls', count(*), 'usd', round(coalesce(sum(cost_usd), 0), 4)) x from u group by feature) f), '[]'::jsonb),
    'by_model', coalesce((select jsonb_agg(x order by (x->>'usd')::numeric desc) from (
        select jsonb_build_object('model', model, 'calls', count(*), 'usd', round(coalesce(sum(cost_usd), 0), 4)) x from u group by model) m), '[]'::jsonb),
    'by_day', coalesce((select jsonb_agg(x order by x->>'day') from (
        select jsonb_build_object('day', day, 'calls', count(*), 'usd', round(coalesce(sum(cost_usd), 0), 4)) x from u group by day) d), '[]'::jsonb)
  ) into res;
  return res;
end $$;

revoke execute on function public.ai_usage_summary(date, date) from public, anon;
grant execute on function public.ai_usage_summary(date, date) to authenticated, service_role;
revoke execute on function public.ai_cost_usd(text, timestamptz, integer, integer, integer) from public, anon;
grant execute on function public.ai_cost_usd(text, timestamptz, integer, integer, integer) to authenticated, service_role;
