-- 0005 Dry run: execute an operation inside a sub-transaction that is always rolled back, so the
-- agent can show an exact preview (totals, which invoices a payment covers, errors) before the
-- owner confirms. Nothing is kept: the forced exception undoes every row change.
create or replace function public.agent_dry_run(p_kind text, p_payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  res jsonb;
  err text;
begin
  if not public.is_member() then raise exception 'Not allowed'; end if;
  perform set_config('promed.action_id', '', true);
  begin
    res := public.agent_dispatch(p_kind, p_payload);
    set constraints all immediate;
    raise exception using errcode = 'P0001', message = 'AGENT_DRY_RUN_OK';
  exception when others then
    err := sqlerrm;
  end;
  set constraints all deferred;
  if err = 'AGENT_DRY_RUN_OK' then
    return jsonb_build_object('ok', true, 'result', res);
  end if;
  return jsonb_build_object('ok', false, 'error', err);
end $$;

revoke execute on function public.agent_dry_run(text, jsonb) from public, anon;
grant execute on function public.agent_dry_run(text, jsonb) to authenticated, service_role;

-- Recent actions of one conversation, for the agent's own memory of what it did.
create or replace function public.agent_recent_actions(p_conversation uuid default null, p_limit integer default 15)
returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) from (
    select id, kind, summary, status, error, created_at, applied_at, undone_at
    from public.agent_actions
    where user_id = auth.uid() and (p_conversation is null or conversation_id = p_conversation)
    order by created_at desc limit least(greatest(p_limit, 1), 100)
  ) x
$$;
revoke execute on function public.agent_recent_actions(uuid, integer) from public, anon;
grant execute on function public.agent_recent_actions(uuid, integer) to authenticated, service_role;

-- Agent settings (auto-save limit, spoken replies) for the signed-in owner.
create or replace function public.agent_set_settings(p_auto_save_limit numeric default null, p_voice_replies boolean default null)
returns jsonb language plpgsql as $$
declare s public.agent_settings;
begin
  if not public.is_member() then raise exception 'Not allowed'; end if;
  insert into public.agent_settings (user_id) values (auth.uid()) on conflict (user_id) do nothing;
  update public.agent_settings
     set auto_save_limit = coalesce(p_auto_save_limit, auto_save_limit),
         voice_replies = coalesce(p_voice_replies, voice_replies),
         updated_at = now()
   where user_id = auth.uid()
  returning * into s;
  return to_jsonb(s) - 'user_id';
end $$;
revoke execute on function public.agent_set_settings(numeric, boolean) from public, anon;
grant execute on function public.agent_set_settings(numeric, boolean) to authenticated, service_role;

-- File an uploaded attachment into the Compliance inbox (same row shape as the Inbox upload).
create or replace function public.agent_file_compliance_document(p_path text, p_file_name text, p_mime text,
                                                                 p_size bigint default null, p_title text default null)
returns integer language plpgsql as $$
declare did integer;
begin
  if not public.is_member() then raise exception 'Not allowed'; end if;
  if split_part(p_path, '/', 1) <> auth.uid()::text then raise exception 'That file does not belong to you'; end if;
  insert into public.compliance_item_documents (item_id, is_orphan, file_name, storage_path, bucket, mime_type, size_bytes,
                                                version, is_current_version, uploaded_by_email, user_id, intended_title)
  values (null, true, p_file_name, p_path, 'compliance-documents', p_mime, p_size, 1, true, auth.jwt() ->> 'email', auth.uid(),
          nullif(p_title, ''))
  returning id into did;
  return did;
end $$;
revoke execute on function public.agent_file_compliance_document(text, text, text, bigint, text) from public, anon;
grant execute on function public.agent_file_compliance_document(text, text, text, bigint, text) to authenticated, service_role;
