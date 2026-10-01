begin;
set search_path=extensions,public;
select plan(11);
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);

insert into projects(id,company_id,name,currency) values
('cc000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','Snapshot regression','KZT');
insert into spec_items(id,company_id,project_id,description,quantity,unit) values
('cc000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000001','cc000000-0000-0000-0000-000000000001','Pump',2,'each');
select throws_ok($$select create_awarded_proposal('cc000000-0000-0000-0000-000000000001','REGRESSION',10,12)$$,
  '23514','Select exactly one comparable winner for every specification line','incomplete awards rejected');
insert into supplier_quotes(id,company_id,project_id,supplier_id,currency) values
('cc000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000001','cc000000-0000-0000-0000-000000000001','a2000000-0000-0000-0000-000000000001','USD');
insert into quote_lines(id,company_id,quote_id,raw_description,raw_quantity,raw_unit,raw_unit_price,raw_total,raw_currency) values
('cc000000-0000-0000-0000-000000000004','a0000000-0000-0000-0000-000000000001','cc000000-0000-0000-0000-000000000003','Pump',2,'each',500,1000,'USD');
insert into comparison_snapshots(id,company_id,project_id,version,normalization_version,matching_version,base_currency) values
('cc000000-0000-0000-0000-000000000005','a0000000-0000-0000-0000-000000000001','cc000000-0000-0000-0000-000000000001',1,'test','test','KZT');
insert into comparison_cells(company_id,snapshot_id,spec_item_id,quote_line_id,supplier_id,raw_amount,raw_currency,normalized_currency,evaluated_amount,state,comparable) values
('a0000000-0000-0000-0000-000000000001','cc000000-0000-0000-0000-000000000005','cc000000-0000-0000-0000-000000000002','cc000000-0000-0000-0000-000000000004','a2000000-0000-0000-0000-000000000001',1000,'USD','KZT',520000,'comparable',true);
insert into award_decisions(company_id,project_id,snapshot_id,spec_item_id,quote_line_id,supplier_id) values
('a0000000-0000-0000-0000-000000000001','cc000000-0000-0000-0000-000000000001','cc000000-0000-0000-0000-000000000005','cc000000-0000-0000-0000-000000000002','cc000000-0000-0000-0000-000000000004','a2000000-0000-0000-0000-000000000001');
update quote_lines set raw_total=999999 where id='cc000000-0000-0000-0000-000000000004';
select lives_ok($$select create_awarded_proposal('cc000000-0000-0000-0000-000000000001','REGRESSION',10,12)$$,'proposal created atomically');
select is((select v.grand_total from proposal_versions v join proposals p on p.id=v.proposal_id where p.proposal_number='REGRESSION'),640640::numeric,'frozen evaluated cost used despite raw quote edit');
select is((select v.calculation_snapshot->'lines'->0->>'evaluated_amount' from proposal_versions v join proposals p on p.id=v.proposal_id where p.proposal_number='REGRESSION'),'520000.00000000','line price preserved as decimal text');
select throws_ok($$select create_awarded_proposal('cc000000-0000-0000-0000-000000000001','NEGATIVE',-1,12)$$,'23514','Invalid proposal number, markup or tax','negative markup rejected');
select lives_ok($$select create_awarded_proposal_v2('cc000000-0000-0000-0000-000000000001','REGRESSION-V2',10,12,30,'Client note','Net 10')$$,'proposal editor inputs create a versioned client snapshot');
select is((select v.calculation_snapshot->>'client_subtotal' from proposal_versions v join proposals p on p.id=v.proposal_id where p.proposal_number='REGRESSION-V2'),'572000.00000000','client subtotal includes the persisted pricing adjustment');
select is((select v.calculation_snapshot->'lines'->0->>'client_unit_price' from proposal_versions v join proposals p on p.id=v.proposal_id where p.proposal_number='REGRESSION-V2'),'286000.00000000','client unit price is frozen as decimal text');
select is((select v.calculation_snapshot->>'validity_days' from proposal_versions v join proposals p on p.id=v.proposal_id where p.proposal_number='REGRESSION-V2'),'30','validity is frozen in the immutable version');
select is((select v.calculation_snapshot->>'commercial_terms' from proposal_versions v join proposals p on p.id=v.proposal_id where p.proposal_number='REGRESSION-V2'),'Net 10','commercial terms are frozen in the immutable version');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select throws_ok($$select create_awarded_proposal('cc000000-0000-0000-0000-000000000001','FOREIGN',10,12)$$,'42501','Project access required','cross-tenant creation denied');
select * from finish();
rollback;
