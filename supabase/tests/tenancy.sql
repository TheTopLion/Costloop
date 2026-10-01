create extension if not exists pgtap with schema extensions;
set search_path = extensions, public;
begin;
select plan(12);

set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);

select is((select count(*) from public.projects where id in ('a1000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000002'))::bigint,2::bigint,'company A sees both seeded projects');
select is((select count(*) from public.suppliers)::bigint,2::bigint,'company A sees only its suppliers');
select is((select count(*) from public.spec_items where id in ('a3000000-0000-0000-0000-000000000001','a3000000-0000-0000-0000-000000000002'))::bigint,2::bigint,'company A sees the seeded specification rows');
select is((select count(*) from public.background_jobs where company_id='b0000000-0000-0000-0000-000000000001')::bigint,0::bigint,'company A sees no foreign jobs');
select is((select count(*) from public.proposal_versions where company_id='b0000000-0000-0000-0000-000000000001')::bigint,0::bigint,'company A sees no foreign exports');

select throws_ok(
  $$insert into public.projects(company_id,name,currency,created_by) values('b0000000-0000-0000-0000-000000000001','Intrusion','USD','10000000-0000-0000-0000-000000000001')$$,
  '42501', null, 'cannot insert a project into company B');
update public.projects set name='Compromised' where id='b1000000-0000-0000-0000-000000000001';
select is((select count(*) from public.projects where name='Compromised')::bigint,0::bigint,'foreign project cannot be updated');
select is((select count(*) from public.source_documents where company_id='b0000000-0000-0000-0000-000000000001')::bigint,0::bigint,'foreign documents are hidden');
select is((select count(*) from public.supplier_quotes where company_id='b0000000-0000-0000-0000-000000000001')::bigint,0::bigint,'foreign quotes are hidden');
select is((select count(*) from public.audit_events where company_id='b0000000-0000-0000-0000-000000000001')::bigint,0::bigint,'foreign audit events are hidden');

insert into public.projects(company_id,name,currency)
values('a0000000-0000-0000-0000-000000000001','Actor default test','KZT');
select is(
  (select created_by from public.projects where name='Actor default test'),
  '10000000-0000-0000-0000-000000000001'::uuid,
  'project defaults created_by to the authenticated user'
);
select is(
  (select count(*) from public.audit_events where entity_type='projects' and entity_id=(select id from public.projects where name='Actor default test' order by created_at desc limit 1) and action='insert' and actor_id='10000000-0000-0000-0000-000000000001')::bigint,
  1::bigint,
  'project creation audit records the authenticated actor'
);

select * from finish();
rollback;
