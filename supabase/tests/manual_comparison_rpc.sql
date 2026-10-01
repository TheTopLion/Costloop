create extension if not exists pgtap with schema extensions;
set search_path = extensions, public;
begin;
select plan(21);

set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);

insert into public.projects(id,company_id,name,project_number,status,currency)
values('c1000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','Manual comparison RPC fixture','RPC-001','estimating','KZT');
insert into public.suppliers(id,company_id,name) values
 ('c2000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','RPC Supplier USD'),
 ('c2000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000001','RPC Supplier KZT');
insert into public.spec_items(id,company_id,project_id,position,description,quantity,unit,sort_order) values
 ('c3000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001','1','Structural steel',1000,'kg',1),
 ('c3000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001','2','Pump assembly',2,'each',2);
insert into public.supplier_quotes(id,company_id,project_id,supplier_id,quote_number,currency) values
 ('c4000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001','c2000000-0000-0000-0000-000000000001','USD-1','USD'),
 ('c4000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001','c2000000-0000-0000-0000-000000000002','KZT-1','KZT');
insert into public.quote_lines(id,company_id,quote_id,position,raw_description,raw_quantity,raw_unit,raw_unit_price,raw_currency,sort_order) values
 ('c5000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','c4000000-0000-0000-0000-000000000001','1','Structural steel',1,'tonne',500,'USD',1),
 ('c5000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000001','c4000000-0000-0000-0000-000000000001','2','Pump assembly',2,'each',100000,'KZT',2),
 ('c5000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000001','c4000000-0000-0000-0000-000000000002','1','Structural steel',1000,'kg',550,'KZT',1);
update public.supplier_quotes set status='confirmed' where id in ('c4000000-0000-0000-0000-000000000001','c4000000-0000-0000-0000-000000000002');

select throws_ok(
  $$select public.publish_manual_comparison('c1000000-0000-0000-0000-000000000001')$$,
  '22023','missing explicit project exchange rate','foreign-currency comparison requires an explicit project rate');
select throws_ok(
  $$select public.save_manual_rate('c1000000-0000-0000-0000-000000000001','USD',0,'bad')$$,
  '22023','conversion rate must be positive','non-positive exchange rates are rejected');
select lives_ok(
  $$select public.save_manual_rate('c1000000-0000-0000-0000-000000000001','usd',510,'manual first')$$,
  'first explicit project rate is saved');
select lives_ok(
  $$select public.save_manual_rate('c1000000-0000-0000-0000-000000000001','USD',520,'manual latest')$$,
  'a new explicit project rate version is saved');
select is((select max(version) from public.exchange_rates where project_id='c1000000-0000-0000-0000-000000000001' and from_currency='USD'),2,'rate versions increment per project and currency');

insert into public.quote_lines(id,company_id,quote_id,position,raw_description,raw_quantity,raw_unit,raw_unit_price,raw_currency,sort_order)
values('c5000000-0000-0000-0000-000000000004','a0000000-0000-0000-0000-000000000001','c4000000-0000-0000-0000-000000000001','1','Duplicate structural steel',1,'tonne',501,'USD',3);
select throws_ok(
  $$select public.publish_manual_comparison('c1000000-0000-0000-0000-000000000001')$$,
  '22023','ambiguous quote lines; positions or descriptions must uniquely identify a line','ambiguous line matches abort publication');
delete from public.quote_lines where id='c5000000-0000-0000-0000-000000000004';

select lives_ok(
  $$select public.publish_manual_comparison('c1000000-0000-0000-0000-000000000001')$$,
  'valid manual comparison publishes atomically');
select is((select count(*) from public.comparison_snapshots where project_id='c1000000-0000-0000-0000-000000000001')::bigint,1::bigint,'one immutable snapshot is created');
select is((select count(*) from public.comparison_cells c join public.comparison_snapshots s on s.id=c.snapshot_id where s.project_id='c1000000-0000-0000-0000-000000000001')::bigint,4::bigint,'one cell is created for every specification and participating supplier');
select is((select evaluated_amount from public.comparison_cells where spec_item_id='c3000000-0000-0000-0000-000000000001' and supplier_id='c2000000-0000-0000-0000-000000000001'),260000.00000000::numeric,'tonne-to-kilogram quantity and latest FX are exact');
select is((select currency_conversion->>'rate' from public.comparison_cells where spec_item_id='c3000000-0000-0000-0000-000000000001' and supplier_id='c2000000-0000-0000-0000-000000000001'),'520.000000000000','cell snapshots the exact decimal FX input');
select is((select state::text from public.comparison_cells where spec_item_id='c3000000-0000-0000-0000-000000000002' and supplier_id='c2000000-0000-0000-0000-000000000002'),'missing_bid','absent supplier line is explicit missing bid');
select ok((select warnings @> '[{"code":"cheapest_offer"}]'::jsonb from public.comparison_cells where spec_item_id='c3000000-0000-0000-0000-000000000001' and supplier_id='c2000000-0000-0000-0000-000000000001'),'cheapest comparable offer is explained');
select is((select exchange_rates->'USD'->>'rate' from public.comparison_snapshots where project_id='c1000000-0000-0000-0000-000000000001'),'520.000000000000','snapshot records latest explicit rate as a string');

select lives_ok(
  $$select public.set_manual_award('c1000000-0000-0000-0000-000000000001',(select id from public.comparison_snapshots where project_id='c1000000-0000-0000-0000-000000000001'),'c3000000-0000-0000-0000-000000000001','c2000000-0000-0000-0000-000000000002')$$,
  'a comparable line can be awarded');
select throws_ok(
  $$select public.set_manual_award('c1000000-0000-0000-0000-000000000001',(select id from public.comparison_snapshots where project_id='c1000000-0000-0000-0000-000000000001'),'c3000000-0000-0000-0000-000000000002','c2000000-0000-0000-0000-000000000002')$$,
  '22023','selected supplier has no comparable bid for specification item','missing bid cannot be awarded');
select lives_ok(
  $$select public.set_manual_award('c1000000-0000-0000-0000-000000000001',(select id from public.comparison_snapshots where project_id='c1000000-0000-0000-0000-000000000001'),null,'c2000000-0000-0000-0000-000000000001')$$,
  'a single complete quote can replace line awards atomically');
select is((select scope::text from public.award_decisions where project_id='c1000000-0000-0000-0000-000000000001'),'quote','whole-quote selection leaves one quote-scoped award');

insert into public.line_matches(company_id,project_id,spec_item_id,quote_line_id,relation,method,component_scores,confidence,mapping_version,review_status,human_override,reviewed_by,reviewed_at)
values('a0000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001','c3000000-0000-0000-0000-000000000001','c5000000-0000-0000-0000-000000000003','MATCH','test','{}'::jsonb,1,'test','confirmed',true,'10000000-0000-0000-0000-000000000001',now());
select lives_ok(
  $$select public.publish_manual_comparison('c1000000-0000-0000-0000-000000000001')$$,
  'a reviewed line match publishes a new snapshot'
);
select is(
  (select quote_line_id from public.comparison_cells where snapshot_id=(select id from public.comparison_snapshots where project_id='c1000000-0000-0000-0000-000000000001' order by version desc limit 1) and spec_item_id='c3000000-0000-0000-0000-000000000001' and supplier_id='c2000000-0000-0000-0000-000000000002'),
  'c5000000-0000-0000-0000-000000000003'::uuid,
  'published comparison uses the human-reviewed quote line'
);

select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select throws_ok(
  $$select public.publish_manual_comparison('c1000000-0000-0000-0000-000000000001')$$,
  '42501','estimator permission required','another tenant cannot publish the comparison');

select * from finish();
rollback;
