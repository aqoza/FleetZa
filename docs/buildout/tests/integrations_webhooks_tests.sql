begin;
create temp table _t (name text, ok boolean, detail text);
grant all on _t to authenticated, service_role;

-- URL / event validation (pure)
insert into _t select 'https url ok', app.valid_webhook_url('https://hooks.example.com/fleet?x=1'), null;
insert into _t select 'http refused', not app.valid_webhook_url('http://hooks.example.com/x'), null;
insert into _t select 'localhost refused', not app.valid_webhook_url('https://localhost:8080/x'), null;
insert into _t select 'private ip refused', not app.valid_webhook_url('https://192.168.1.5/x')
  and not app.valid_webhook_url('https://10.0.0.1/x') and not app.valid_webhook_url('https://172.20.0.1/x')
  and not app.valid_webhook_url('https://169.254.169.254/latest'), null;
insert into _t select 'public 172.x ok', app.valid_webhook_url('https://172.32.0.1/x'), null;
insert into _t select 'credentials refused', not app.valid_webhook_url('https://user:pw@hooks.example.com/x'), null;
insert into _t select 'events ok', app.valid_webhook_events(array['issue.created', '*']), null;
insert into _t select 'bad events refused', not app.valid_webhook_events(array['Issue Created'])
  and not app.valid_webhook_events(array[]::text[]), null;
insert into _t select 'backoff 1/4/16 min', app.webhook_backoff(1) = interval '1 minute'
  and app.webhook_backoff(3) = interval '16 minutes', null;

-- As an admin, module off: refused
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"129bbbae-fdfc-4d21-8a86-8949fec2403b","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"owner"}}', true);
do $$ begin
  perform public.create_webhook_subscription('x', 'https://hooks.example.com/a', array['*']);
  insert into _t values ('module off: create refused', false, null);
exception when others then insert into _t values ('module off: create refused', sqlerrm = 'MODULE_DISABLED', sqlerrm); end $$;
reset role;

insert into public.tenant_modules (tenant_id, module_id, enabled) values
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'integrations', true),
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'notifications', true),
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'workflow_automation', true)
on conflict (tenant_id, module_id) do update set enabled = true;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"129bbbae-fdfc-4d21-8a86-8949fec2403b","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"owner"}}', true);
create temp table _sub as
  select public.create_webhook_subscription(' ERP ', 'https://hooks.example.com/fleet', array['vehicle.created', 'vehicle.created']) as r;
create temp table _sub_all as
  select public.create_webhook_subscription('Everything', 'https://all.example.com/hook', array['*']) as r;
insert into _t select 'create returns secret once', (select r->>'secret' ~ '^whsec_[0-9a-f]{48}$' from _sub), null;
insert into _t select 'events deduped, name trimmed',
  (select events = array['vehicle.created'] and name = 'ERP' from public.webhook_subscriptions where id = (select (r->>'id')::uuid from _sub)), null;
do $$ begin
  perform 1 from public.webhook_secrets;
  insert into _t values ('secrets unreadable by clients', false, null);
exception when others then insert into _t values ('secrets unreadable by clients', sqlstate = '42501', sqlerrm); end $$;
do $$ begin
  update public.webhook_subscriptions set failure_count = 0;
  insert into _t values ('client cannot touch counters', false, null);
exception when others then insert into _t values ('client cannot touch counters', sqlstate = '42501', sqlerrm); end $$;
do $$ begin
  update public.webhook_subscriptions set url = 'http://insecure.example.com';
  insert into _t values ('edit to http refused', false, null);
exception when others then insert into _t values ('edit to http refused', sqlstate = '23514', sqlerrm); end $$;
do $$ begin
  perform public.create_webhook_subscription('bad', 'https://127.0.0.1/x', array['*']);
  insert into _t values ('rpc refuses loopback', false, null);
exception when others then insert into _t values ('rpc refuses loopback', sqlerrm = 'WEBHOOK_INVALID_URL', sqlerrm); end $$;
create temp table _rot as select public.rotate_webhook_secret((select (r->>'id')::uuid from _sub)) as s;
grant select on _sub, _sub_all, _rot to service_role;
reset role;
insert into _t select 'rotate changes secret',
  (select s from _rot) <> (select r->>'secret' from _sub)
  and (select secret from public.webhook_secrets where subscription_id = (select (r->>'id')::uuid from _sub)) = (select s from _rot), null;

-- Viewer: refused
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"129bbbae-fdfc-4d21-8a86-8949fec2403b","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"viewer"}}', true);
do $$ begin
  perform public.send_test_webhook((select (r->>'id')::uuid from _sub));
  insert into _t values ('viewer cannot send test', false, null);
exception when others then insert into _t values ('viewer cannot send test', sqlerrm = 'FORBIDDEN', sqlerrm); end $$;
insert into _t select 'viewer sees no subscriptions', (select count(*) = 0 from public.webhook_subscriptions), null;
reset role;

-- Events fan out to matching subscriptions
insert into public.vehicles (tenant_id, name, license_plate)
values ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'Webhook truck', 'WH-001');
insert into _t select 'vehicle.created queued for both subs',
  (select count(*) from public.webhook_deliveries where event = 'vehicle.created') = 2, null;
insert into _t select 'envelope carries data',
  (select payload->'data'->>'name' = 'Webhook truck' and payload->>'event' = 'vehicle.created'
   from public.webhook_deliveries where event = 'vehicle.created' limit 1), null;
insert into public.customers (tenant_id, name) values ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'Hook customer');
insert into _t select 'customer.created only to * sub',
  (select count(*) from public.webhook_deliveries where event = 'customer.created') = 1, null;

-- Automation webhook action enqueues (deduped with the fan-out)
insert into public.automation_rules (tenant_id, name, event, actions)
select '170d2d86-5c22-4bcb-9d74-420c879419b2', 'Ping ERP', 'customer.created',
  jsonb_build_array(jsonb_build_object('type', 'webhook', 'subscription_id', (r->>'id'))) from _sub;
insert into public.customers (tenant_id, name) values ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'Second customer');
insert into _t select 'rule webhook action enqueued',
  (select count(*) from public.webhook_deliveries d where d.event = 'customer.created'
     and d.subscription_id = (select (r->>'id')::uuid from _sub)) = 1,
  (select string_agg(status || ':' || coalesce(detail, ''), '; ') from public.automation_runs);

-- Worker cycle (service role)
set local role service_role;
create temp table _claim as select * from public.claim_webhook_deliveries('170d2d86-5c22-4bcb-9d74-420c879419b2', 10);
insert into _t select 'claim returns url + secret', (select count(*) >= 3 and bool_and(secret like 'whsec_%') from _claim), null;
insert into _t select 'claimed rows leased', (select count(*) = 0 from public.claim_webhook_deliveries('170d2d86-5c22-4bcb-9d74-420c879419b2', 10)), null;
select public.record_webhook_attempt((select id from _claim where event = 'vehicle.created' limit 1), true, 200, null);
create temp table _fail as select id from _claim where event = 'customer.created' limit 1;
grant select on _claim, _fail to authenticated;
select public.record_webhook_attempt((select id from _fail), false, 500, 'Internal Server Error');
reset role;
insert into _t select 'success marks delivered', exists (select 1 from public.webhook_deliveries where status = 'delivered' and response_code = 200 and delivered_at is not null), null;
insert into _t select 'failure schedules retry',
  (select status = 'pending' and attempts = 1 and next_attempt_at > now() + interval '50 seconds' from public.webhook_deliveries where id = (select id from _fail)), null;
update public.webhook_deliveries set attempts = 5, next_attempt_at = now() where id = (select id from _fail);
set local role service_role;
select public.record_webhook_attempt((select id from _fail), false, null, 'timeout');
reset role;
insert into _t select 'sixth failure is final', (select status = 'failed' from public.webhook_deliveries where id = (select id from _fail)), null;
insert into _t select 'admins notified once', (select count(*) >= 1 from public.notifications where kind = 'integrations.webhook_failed'), null;
insert into _t select 'failure_count tracked', (select failure_count >= 2 from public.webhook_subscriptions s
  join public.webhook_deliveries d on d.subscription_id = s.id where d.id = (select id from _fail)), null;

-- Retry + test delivery as admin
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"129bbbae-fdfc-4d21-8a86-8949fec2403b","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"owner"}}', true);
select public.retry_webhook_delivery((select id from _fail));
create temp table _test as select public.send_test_webhook((select (r->>'id')::uuid from _sub)) as id;
insert into _t select 'admin reads deliveries', (select count(*) > 0 from public.webhook_deliveries), null;
reset role;
insert into _t select 'retry resets budget', (select status = 'pending' and attempts = 0 from public.webhook_deliveries where id = (select id from _fail)), null;
insert into _t select 'test delivery queued', exists (select 1 from public.webhook_deliveries where id = (select id from _test) and event = 'webhook.test'), null;

-- Clients cannot call the worker RPCs; paused subscriptions are not claimed
set local role authenticated;
do $$ begin
  perform public.claim_webhook_deliveries('170d2d86-5c22-4bcb-9d74-420c879419b2', 1);
  insert into _t values ('clients cannot claim', false, null);
exception when others then insert into _t values ('clients cannot claim', sqlstate = '42501', sqlerrm); end $$;
reset role;
update public.webhook_subscriptions set active = false;
set local role service_role;
insert into _t select 'paused subs not claimed', (select count(*) = 0 from public.claim_webhook_deliveries('170d2d86-5c22-4bcb-9d74-420c879419b2', 10)), null;
reset role;

-- Cross-tenant enqueue refused
insert into public.tenant_modules (tenant_id, module_id, enabled) values ('5eed0000-0000-4000-8000-0000000000b1', 'integrations', true)
on conflict (tenant_id, module_id) do update set enabled = true;
do $$ begin
  perform app.enqueue_webhook((select (r->>'id')::uuid from _sub),
    (select app.emit_event('5eed0000-0000-4000-8000-0000000000b1', 'x.y', null, null, '{}')));
  insert into _t values ('cross-tenant enqueue refused', false, null);
exception when others then insert into _t values ('cross-tenant enqueue refused', sqlerrm like 'WEBHOOK_NOT_FOUND: subscription%', sqlerrm); end $$;

-- @print
select name, ok, detail from _t order by ok, name;
rollback;
