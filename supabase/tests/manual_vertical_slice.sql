create extension if not exists pgtap with schema extensions;
set search_path = extensions, public;
begin;
select plan(17);

set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);

insert into public.projects(id,company_id,name,project_number,status,currency)
values('d1000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','Manual workflow fixture','MVS-001','estimating','KZT');

select throws_ok(
  $$insert into public.supplier_quotes(company_id,project_id,supplier_id,currency)
    values('a0000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000001','b2000000-0000-0000-0000-000000000001','KZT')$$,
  '23503', null, 'a quote cannot reference a supplier from another tenant');

insert into public.suppliers(id,company_id,name) values
 ('d2000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','Manual USD Supplier'),
 ('d2000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000001','Manual KZT Supplier');
insert into public.spec_items(id,company_id,project_id,position,description,quantity,unit)
values('d3000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000001','1','Pump DN50',2,'pcs');

insert into public.supplier_quotes(id,company_id,project_id,supplier_id,quote_number,currency)
values
 ('d4000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000001','d2000000-0000-0000-0000-000000000001','MS-100','USD'),
 ('d4000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000001','d2000000-0000-0000-0000-000000000002','CTT-200','KZT');

select throws_ok(
  $$update public.supplier_quotes set status='confirmed' where id='d4000000-0000-0000-0000-000000000001'$$,
  '23514', 'cannot confirm an empty supplier quote', 'an empty quote cannot be confirmed');

insert into public.quote_lines(id,company_id,quote_id,position,raw_description,raw_quantity,raw_unit,raw_unit_price,raw_currency)
values
 ('d5000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','d4000000-0000-0000-0000-000000000001','1','Pump DN50',2,'pcs',500,'USD'),
 ('d5000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000001','d4000000-0000-0000-0000-000000000002','1','Pump DN50',2,'pcs',260000,'KZT');

select is((select calculated_line_total from public.quote_lines where id='d5000000-0000-0000-0000-000000000001'),1000.00000000::numeric,'quote line total is deterministic');

update public.supplier_quotes set status='confirmed' where id='d4000000-0000-0000-0000-000000000001';
select is((select status::text from public.supplier_quotes where id='d4000000-0000-0000-0000-000000000001'),'confirmed','a populated quote can be confirmed');
select ok((select confirmed_at is not null from public.supplier_quotes where id='d4000000-0000-0000-0000-000000000001'),'confirmation is timestamped');
select is((select count(*) from public.workflow_transitions where entity_type='supplier_quote' and entity_id='d4000000-0000-0000-0000-000000000001')::bigint,1::bigint,'quote confirmation creates a transition record');

select throws_ok(
  $$update public.supplier_quotes set status='rejected' where id='d4000000-0000-0000-0000-000000000001'$$,
  '23514', null, 'confirmed quote is terminal');

select throws_ok(
  $$update public.projects set status='draft' where id='d1000000-0000-0000-0000-000000000001'$$,
  '23514', null, 'project cannot move backwards from estimating to draft');

insert into public.exchange_rates(id,company_id,project_id,from_currency,to_currency,rate,effective_on,source,version)
values('d6000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000001','USD','KZT',520.000000000000,current_date,'manual',1);
insert into public.comparison_snapshots(id,company_id,project_id,version,normalization_version,matching_version,base_currency)
values('d7000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000001',1,'manual-v1','manual-v1','KZT');
insert into public.comparison_snapshot_rates(company_id,snapshot_id,exchange_rate_id)
values('a0000000-0000-0000-0000-000000000001','d7000000-0000-0000-0000-000000000001','d6000000-0000-0000-0000-000000000001');
select is((select count(*) from public.comparison_snapshot_rates where snapshot_id='d7000000-0000-0000-0000-000000000001')::bigint,1::bigint,'snapshot captures an explicit exchange rate');

insert into public.comparison_cells(id,company_id,snapshot_id,spec_item_id,quote_line_id,supplier_id,raw_amount,raw_currency,normalized_amount,normalized_currency,evaluated_amount,state,comparable)
values('d8000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','d7000000-0000-0000-0000-000000000001','d3000000-0000-0000-0000-000000000001','d5000000-0000-0000-0000-000000000001','d2000000-0000-0000-0000-000000000001',1000,'USD',520000,'KZT',520000,'comparable',true);

select throws_ok(
  $$insert into public.comparison_cells(company_id,snapshot_id,spec_item_id,quote_line_id,supplier_id,evaluated_amount,state,comparable)
    values('a0000000-0000-0000-0000-000000000001','d7000000-0000-0000-0000-000000000001','d3000000-0000-0000-0000-000000000001','d5000000-0000-0000-0000-000000000002','d2000000-0000-0000-0000-000000000001',520000,'comparable',true)$$,
  '23514', 'comparison cell quote line must belong to snapshot project and supplier', 'comparison cell rejects a quote line from a different supplier');

select throws_ok(
  $$insert into public.award_decisions(company_id,project_id,snapshot_id,spec_item_id,supplier_id,quote_line_id,scope)
    values('a0000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000001','d7000000-0000-0000-0000-000000000001','d3000000-0000-0000-0000-000000000001','d2000000-0000-0000-0000-000000000002','d5000000-0000-0000-0000-000000000001','line')$$,
  '23514', null, 'award rejects a supplier that does not own the quote line');

insert into public.award_decisions(id,company_id,project_id,snapshot_id,spec_item_id,supplier_id,quote_line_id,scope,rationale)
values('d9000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000001','d7000000-0000-0000-0000-000000000001','d3000000-0000-0000-0000-000000000001','d2000000-0000-0000-0000-000000000001','d5000000-0000-0000-0000-000000000001','line','Lowest evaluated compliant offer');
select is((select count(*) from public.award_decisions where id='d9000000-0000-0000-0000-000000000001')::bigint,1::bigint,'valid comparable line can be awarded');

insert into public.proposals(id,company_id,project_id,proposal_number,currency)
values('da000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000001','PROP-001','KZT');

select throws_ok(
  $$insert into public.proposal_versions(company_id,proposal_id,version,subtotal,markup_amount,tax_amount,grand_total,calculation_snapshot,generator_version)
    values('a0000000-0000-0000-0000-000000000001','da000000-0000-0000-0000-000000000001',2,520000,52000,68640,640640,'{}','manual-v1')$$,
  '23514', 'proposal version must be 1', 'proposal versions must be sequential');

select throws_ok(
  $$insert into public.proposal_versions(company_id,proposal_id,version,subtotal,markup_amount,tax_amount,grand_total,calculation_snapshot,generator_version)
    values('a0000000-0000-0000-0000-000000000001','da000000-0000-0000-0000-000000000001',1,520000,52000,68640,1,'{}','manual-v1')$$,
  '23514', null, 'proposal total must equal subtotal plus markup and tax');

insert into public.proposal_versions(id,company_id,proposal_id,version,subtotal,markup_amount,tax_amount,grand_total,calculation_snapshot,generator_version)
values('db000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','da000000-0000-0000-0000-000000000001',1,520000,52000,68640,640640,'{"markup_rate":"0.10","tax_rate":"0.12"}','manual-v1');
select is((select grand_total from public.proposal_versions where id='db000000-0000-0000-0000-000000000001'),640640.00000000::numeric,'valid deterministic proposal version is stored');

update public.proposals set status='issued' where id='da000000-0000-0000-0000-000000000001';
select is((select status from public.proposals where id='da000000-0000-0000-0000-000000000001'),'issued','versioned proposal can be issued');

select throws_ok(
  $$update public.proposal_versions set grand_total=1 where id='db000000-0000-0000-0000-000000000001'$$,
  '23514', 'versioned records are immutable', 'proposal versions cannot be mutated');

select * from finish();
rollback;
