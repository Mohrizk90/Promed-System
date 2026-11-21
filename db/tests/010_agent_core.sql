-- Agent core tests. Each "-- test" chunk runs in its own savepoint, as the owner.

-- test
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"{{OWNER}}","role":"authenticated"}', true);
do $$
declare aid uuid; res jsonb; eid bigint; n int; car int;
begin
  select id into car from projects where name = 'Company car';
  aid := agent_stage('record_entries', 'test fuel', jsonb_build_object('entries', jsonb_build_array(
    jsonb_build_object('kind', 'expense', 'amount', 350, 'new_category', 'Test cat XYZ', 'description', 'fuel test',
      'links', jsonb_build_array(
        jsonb_build_object('project_id', car, 'share_pct', 60),
        jsonb_build_object('new_project', 'Test shipment Q', 'new_project_type', 'shipment', 'share_pct', 40))))));
  assert (select status from agent_actions where id = aid) = 'pending', 'staged as pending';
  assert not exists (select 1 from categories where name_en = 'Test cat XYZ'), 'nothing written before commit';
  res := agent_commit(aid);
  eid := (res->'entries'->0->>'id')::bigint;
  assert (select amount from ledger_entries where id = eid) = 350, 'amount saved';
  assert (select source from ledger_entries where id = eid) = 'agent', 'source = agent';
  assert (select count(*) from record_links where record_type = 'ledger_entry' and record_id = eid) = 2, 'two project links';
  assert exists (select 1 from projects p join project_types t on t.id = p.type_id where p.name = 'Test shipment Q' and t.key = 'shipment'), 'new project has the right type';
  select count(*) into n from agent_changes where action_id = aid;
  assert n = 5, 'captured 5 changes, got ' || n;
  assert (select expense from v_project_totals where name = 'Test shipment Q') = 140, '40% share = 140';
  assert (select status from agent_actions where id = aid) = 'applied', 'marked applied';
  assert agent_commit(aid) = res, 'committing twice is harmless';
  res := agent_undo(aid);
  assert (res->>'changes_reverted')::int = 5, 'reverted 5';
  assert not exists (select 1 from ledger_entries where id = eid), 'undo removed entry';
  assert not exists (select 1 from projects where name = 'Test shipment Q'), 'undo removed the new project';
  assert not exists (select 1 from categories where name_en = 'Test cat XYZ'), 'undo removed the new category';
  assert (select status from agent_actions where id = aid) = 'undone', 'marked undone';
  raise notice 'PASS record_entries: categories, new typed project, 60/40 split, undo';
end $$;

-- test
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"{{OWNER}}","role":"authenticated"}', true);
do $$
declare aid uuid; ok boolean := false;
begin
  aid := agent_stage('record_entries', 'bad shares', jsonb_build_object('entries', jsonb_build_array(
    jsonb_build_object('kind', 'expense', 'amount', 100, 'links', jsonb_build_array(
      jsonb_build_object('project_id', (select id from projects where name = 'Office'), 'share_pct', 70),
      jsonb_build_object('project_id', (select id from projects where name = 'General'), 'share_pct', 50))))));
  begin
    perform agent_commit(aid);
  exception when others then ok := sqlerrm like '%add up to%';
  end;
  assert ok, 'shares over 100% are rejected';
  ok := false;
  begin
    perform agent_commit(agent_stage('record_entries', 'zero', '{"entries":[{"kind":"expense","amount":0}]}'));
  exception when others then ok := sqlerrm like '%more than zero%';
  end;
  assert ok, 'zero amount rejected';
  raise notice 'PASS record_entries rejects shares over 100%% and zero amounts';
end $$;

-- test
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"{{OWNER}}","role":"authenticated"}', true);
do $$
declare cid int; aid uuid; res jsonb; bal0 numeric; bal1 numeric; snap0 jsonb; snap1 jsonb; open_total numeric; alloc_sum numeric; open1 numeric;
begin
  select client_id into cid from client_transactions where remaining_amount > 0 group by client_id order by count(*) desc limit 1;
  select balance into bal0 from client_balances(cid);
  select sum(remaining) into open_total from client_invoice_status(cid);
  select jsonb_agg(to_jsonb(t) - 'updated_at' order by transaction_id) into snap0 from client_transactions t where client_id = cid;
  aid := agent_stage('client_payment', 'test receipt', jsonb_build_object('client_id', cid, 'amount', 1000, 'payment_method', 'bank_transfer'));
  res := agent_commit(aid);
  select balance into bal1 from client_balances(cid);
  assert bal1 = bal0 - 1000, format('balance drops by 1000 (%s -> %s)', bal0, bal1);
  select coalesce(sum((a->>'allocated')::numeric), 0) into alloc_sum from jsonb_array_elements(res->'allocations') a;
  assert alloc_sum = least(1000, open_total), 'allocations cover the oldest invoices';
  select sum(remaining) into open1 from client_invoice_status(cid);
  assert open1 = open_total - alloc_sum, format('open amount drops by the allocation (%s -> %s)', open_total, open1);
  perform agent_undo(aid);
  select jsonb_agg(to_jsonb(t) - 'updated_at' order by transaction_id) into snap1 from client_transactions t where client_id = cid;
  assert snap0 = snap1, 'undo restores every invoice exactly';
  assert (select balance from client_balances(cid)) = bal0, 'undo restores the balance';
  assert not exists (select 1 from payments where payment_id = (res->>'payment_id')::int), 'undo removes the payment';
  raise notice 'PASS client_payment: FIFO allocation, balance, exact undo';
end $$;

-- test
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"{{OWNER}}","role":"authenticated"}', true);
do $$
declare sid int; aid uuid; res jsonb; bal0 numeric; snap0 jsonb; snap1 jsonb; open_total numeric;
begin
  select supplier_id into sid from supplier_transactions where remaining_amount > 0 group by supplier_id order by count(*) desc limit 1;
  select balance into bal0 from supplier_balances(sid);
  select sum(remaining_amount) into open_total from supplier_transactions where supplier_id = sid;
  select jsonb_agg(to_jsonb(t) - 'updated_at' order by transaction_id) into snap0 from supplier_transactions t where supplier_id = sid;
  aid := agent_stage('supplier_payment', 'test supplier pay', jsonb_build_object('supplier_id', sid, 'amount', open_total + 500));
  res := agent_commit(aid);
  assert (res->>'advance')::numeric = 500, 'extra 500 kept as advance';
  assert not exists (select 1 from supplier_transactions where supplier_id = sid and remaining_amount > 0), 'all purchases settled';
  assert not exists (select 1 from supplier_transactions where transaction_id in (select (x->>'transaction_id')::int from jsonb_array_elements(res->'payments') x)
                       and status not in ('paid', 'done')), 'settled purchases are marked paid';
  assert (select balance from supplier_balances(sid)) = bal0 - open_total - 500, 'supplier balance';
  perform agent_undo(aid);
  select jsonb_agg(to_jsonb(t) - 'updated_at' order by transaction_id) into snap1 from supplier_transactions t where supplier_id = sid;
  assert snap0 = snap1, 'undo restores purchases exactly';
  raise notice 'PASS supplier_payment: settles oldest first, advance, statuses, exact undo';
end $$;

-- test
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"{{OWNER}}","role":"authenticated"}', true);
do $$
declare cid int; aid uuid; res jsonb; tid int; pid int;
begin
  select client_id into cid from clients order by client_id limit 1;
  aid := agent_stage('record_sale', 'test sale', jsonb_build_object('client_id', cid, 'vat_rate', 14, 'wht_rate', 1, 'paid_now', 100,
    'lines', jsonb_build_array(
      jsonb_build_object('product_id', (select product_id from products order by product_id limit 1), 'quantity', 2, 'unit_price', 1000),
      jsonb_build_object('product_name', 'Brand new test gadget 77', 'quantity', 3, 'unit_price', 500))));
  res := agent_commit(aid);
  tid := (res->>'transaction_id')::int;
  assert (res->>'subtotal')::numeric = 3500, 'subtotal';
  assert (res->>'vat')::numeric = 490, 'vat 14%';
  assert (res->>'wht')::numeric = 35, 'wht 1%';
  assert (res->>'total')::numeric = 3955, 'total = sub + vat - wht';
  assert (select remaining_amount from client_transactions where transaction_id = tid) = 3855, 'remaining after 100 paid';
  assert (select jsonb_array_length(line_items) from client_transactions where transaction_id = tid) = 1, 'extra line in line_items';
  assert (select quantity from client_transactions where transaction_id = tid) = 2, 'primary line in columns';
  select product_id into pid from products where product_name = 'Brand new test gadget 77';
  assert pid is not null, 'new product created';
  assert exists (select 1 from payments where transaction_id = tid and transaction_type = 'client' and payment_amount = 100), 'down payment saved';
  perform agent_undo(aid);
  assert not exists (select 1 from client_transactions where transaction_id = tid), 'undo removes the sale';
  assert not exists (select 1 from products where product_id = pid), 'undo removes the new product';
  raise notice 'PASS record_sale: lines, VAT, WHT, down payment, new product, undo';
end $$;

-- test
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"{{OWNER}}","role":"authenticated"}', true);
do $$
declare sid int; aid uuid; res jsonb;
begin
  select supplier_id into sid from suppliers order by supplier_id limit 1;
  res := agent_commit(agent_stage('record_purchase', 'test purchase', jsonb_build_object('supplier_id', sid,
    'product_name', 'Test import part 55', 'quantity', 5, 'unit_price', 200, 'paid_now', 1000)));
  assert (res->>'total')::numeric = 1000 and res->>'status' = 'paid', 'fully paid purchase is marked paid';
  assert (select remaining_amount from supplier_transactions where transaction_id = (res->>'transaction_id')::int) = 0, 'nothing remaining';
  raise notice 'PASS record_purchase: total, paid status';
end $$;

-- test
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"{{OWNER}}","role":"authenticated"}', true);
do $$
declare cid int; old text; aid uuid; aid2 uuid; ok boolean := false;
begin
  select client_id, contact_info into cid, old from clients order by client_id limit 1;
  aid := agent_stage('update_record', 'edit phone', jsonb_build_object('table', 'clients', 'id', cid, 'values', jsonb_build_object('contact_info', '0100 TEST')));
  perform agent_commit(aid);
  assert (select contact_info from clients where client_id = cid) = '0100 TEST', 'edited';
  -- someone edits the same row afterwards -> undo must refuse
  update clients set address = 'changed later' where client_id = cid;
  begin
    perform agent_undo(aid);
  exception when others then ok := sqlerrm like '%was changed after%';
  end;
  assert ok, 'undo refuses when the row changed since';
  perform agent_undo(aid, true);
  assert (select contact_info from clients where client_id = cid) is not distinct from old, 'forced undo restores';
  ok := false;
  begin
    perform agent_commit(agent_stage('update_record', 'bad col', jsonb_build_object('table', 'clients', 'id', cid, 'values', '{"user_id": null}'::jsonb)));
  exception when others then ok := sqlerrm like '%not allowed%';
  end;
  assert ok, 'columns outside the allowlist are refused';
  ok := false;
  begin
    perform agent_commit(agent_stage('delete_record', 'bad table', '{"table":"app_members","id":"x"}'));
  exception when others then ok := sqlerrm like '%cannot work on table%';
  end;
  assert ok, 'tables outside the registry are refused';
  raise notice 'PASS update_record: edit, conflict-safe undo, column + table allowlists';
end $$;

-- test
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"{{OWNER}}","role":"authenticated"}', true);
do $$
declare res jsonb; eid bigint; aid uuid; lid int;
begin
  res := agent_commit(agent_stage('record_entries', 't', '{"entries":[{"kind":"income","amount":750,"description":"service visit"}]}'));
  eid := (res->'entries'->0->>'id')::bigint;
  aid := agent_stage('delete_record', 'del', jsonb_build_object('table', 'ledger_entries', 'id', eid));
  perform agent_commit(aid);
  assert (select deleted_at from ledger_entries where id = eid) is not null, 'soft deleted';
  assert not exists (select 1 from v_ledger where id = eid), 'hidden from the ledger view';
  perform agent_undo(aid);
  assert exists (select 1 from v_ledger where id = eid), 'undo brings it back';
  res := agent_commit(agent_stage('create_record', 'liab', '{"table":"liabilities","values":{"category":"Loan","description":"test loan","total_amount":12000}}'));
  lid := (res->'record'->>'id')::int;
  assert (select remaining_amount from liabilities where id = lid) = 12000, 'remaining defaults to total';
  perform agent_commit(agent_stage('create_record', 'lp', jsonb_build_object('table', 'liability_payments', 'values',
    jsonb_build_object('liability_id', lid, 'payment_amount', 2000, 'payment_date', current_date))));
  assert (select remaining_amount from liabilities where id = lid) = 10000, 'liability payment syncs remaining';
  raise notice 'PASS delete (soft) + undo, create liability + payment';
end $$;

-- test
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"{{OWNER}}","role":"authenticated"}', true);
do $$
declare res jsonb; aid uuid; ok boolean := false;
begin
  aid := agent_stage('batch', 'two', '{"operations":[
    {"kind":"record_entries","payload":{"entries":[{"kind":"expense","amount":40,"new_category":"Batch cat A"}]}},
    {"kind":"record_entries","payload":{"entries":[{"kind":"expense","amount":60,"new_category":"Batch cat A"}]}}]}');
  res := agent_commit(aid);
  assert jsonb_array_length(res) = 2, 'two results';
  assert (select count(*) from categories where name_en = 'Batch cat A') = 1, 'category reused, not duplicated';
  perform agent_undo(aid);
  assert not exists (select 1 from categories where name_en = 'Batch cat A'), 'batch undone as one';
  aid := agent_stage('record_entries', 'c', '{"entries":[{"kind":"expense","amount":5}]}');
  perform agent_cancel(aid);
  begin perform agent_commit(aid); exception when others then ok := sqlerrm like '%already cancelled%'; end;
  assert ok, 'a cancelled action cannot be applied';
  raise notice 'PASS batch as one undoable action; cancel';
end $$;

-- test
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"{{OWNER}}","role":"authenticated"}', true);
do $$
declare r record;
begin
  select * into r from agent_search('بنزين', array['category']) limit 1;
  assert r.name = 'Fuel', 'بنزين -> Fuel, got ' || coalesce(r.name, 'nothing');
  select * into r from agent_search('العربيه', array['project']) limit 1;
  assert r.name = 'Company car', 'العربيه -> Company car, got ' || coalesce(r.name, 'nothing');
  select * into r from agent_search('الخزنه', array['account']) limit 1;
  assert r.name = 'Cash box', 'الخزنه -> Cash box, got ' || coalesce(r.name, 'nothing');
  select * into r from agent_search((select left(client_name, 6) from clients order by client_id limit 1), array['client']) limit 1;
  assert r.id is not null, 'partial client name found';
  raise notice 'PASS agent_search: Arabic aliases, spelling variants, partial names';
end $$;

-- test
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"{{OWNER}}","role":"authenticated"}', true);
do $$
declare j jsonb; ok boolean;
begin
  assert (select count(*) from client_balances()) = (select count(*) from clients), 'balance per client';
  j := dashboard_snapshot();
  assert j ? 'receivable' and j ? 'payable', 'dashboard snapshot';
  j := agent_context();
  assert jsonb_array_length(j->'categories') >= 21 and jsonb_array_length(j->'project_types') >= 6, 'context has lists';
  j := ledger_report(null, null, 'category', null, null);
  assert j ? 'rows', 'ledger report';
  j := project_overview((select id from projects where name = 'Office'));
  assert j->'project'->>'name' = 'Office', 'project overview';
  j := agent_ask_data('select count(*) as n from clients');
  assert (j->0->>'n')::int = (select count(*) from clients), 'ask_data select';
  ok := false; begin perform agent_ask_data('delete from clients'); exception when others then ok := true; end; assert ok, 'delete blocked';
  ok := false; begin perform agent_ask_data('with x as (delete from clients returning *) select * from x'); exception when others then ok := true; end; assert ok, 'writable CTE blocked';
  ok := false; begin perform agent_ask_data('select 1; drop table clients'); exception when others then ok := true; end; assert ok, 'two statements blocked';
  ok := false; begin perform agent_ask_data('select * from auth.users'); exception when others then ok := true; end; assert ok, 'auth schema blocked';
  ok := false; begin perform agent_ask_data('select set_config(''promed.action_id'',''x'',false)'); exception when others then ok := true; end; assert ok, 'set_config blocked';
  assert jsonb_array_length(agent_ask_data('select * from generate_series(1, 1000)')) = 200, 'row cap 200';
  raise notice 'PASS read functions and read-only question guard';
end $$;

-- test
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
do $$
declare ok boolean := false;
begin
  assert (select count(*) from clients) = 0, 'a signed-up stranger sees no clients';
  assert (select count(*) from ledger_entries) = 0, 'or ledger entries';
  begin perform agent_stage('record_entries', 'x', '{}'); exception when others then ok := true; end;
  assert ok, 'and cannot stage actions';
  raise notice 'PASS non-members see and do nothing';
end $$;

-- test
set local role anon;
do $$
declare ok boolean := false;
begin
  begin perform agent_search('x'); exception when insufficient_privilege then ok := true; end;
  assert ok, 'anon cannot call agent functions';
  ok := false;
  begin perform 1 from ledger_entries limit 1; exception when insufficient_privilege then ok := true; end;
  assert ok or (select count(*) from ledger_entries) = 0, 'anon cannot read the ledger';
  raise notice 'PASS anonymous visitors are locked out';
end $$;
