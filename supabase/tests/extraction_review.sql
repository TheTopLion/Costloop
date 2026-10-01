create extension if not exists pgtap with schema extensions;
set search_path = extensions, public;
begin;
select plan(7);

set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);

insert into public.projects(id,company_id,name,project_number,status,currency)
values('e1000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','Extraction review fixture','EXT-001','estimating','KZT');
insert into public.source_documents(id,company_id,project_id,kind,bucket_id,storage_path,original_filename,media_type,byte_size,sha256)
values('e2000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000001','specification','source-documents','a0000000-0000-0000-0000-000000000001/e100/spec.xls','spec.xls','application/vnd.ms-excel',16,repeat('a',64));
insert into public.extraction_runs(id,company_id,source_document_id,provider,model,prompt_version,schema_version,parser_version,status,attempt_count,started_at,completed_at)
values('e3000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','e2000000-0000-0000-0000-000000000001','fake','fixture','v1','v1','v1','succeeded',1,now(),now());
insert into public.extracted_drafts(id,company_id,extraction_run_id,payload)
values('e4000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','e3000000-0000-0000-0000-000000000001',
  '{"document_kind":"specification","sections":[{"position":"1","description":"Box coolers","parent_position":null,"source":{"source_type":"xls","sheet":"Спецификация","row":7,"cell_range":"''Спецификация''!A7:F7","evidence_text":"1 | Box coolers"}}],"lines":[{"position":"1.1","description":"Clean cooler","quantity":"2","unit":"pcs","section_position":"1","source":{"source_type":"xls","sheet":"Спецификация","row":8,"cell_range":"''Спецификация''!A8:F8","evidence_text":"1.1 | Clean cooler | 2 | pcs"}}]}'::jsonb);

select lives_ok(
  $$select public.confirm_extraction_draft('e4000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000001','[{"position":"1","description":"Box coolers","parent_position":null}]'::jsonb,'[{"position":"1.1","description":"Clean cooler","quantity":"2","unit":"pcs","section_position":"1"}]'::jsonb,null)$$,
  'review confirmation creates canonical records only after explicit confirmation');
select is((select count(*) from public.spec_sections where project_id='e1000000-0000-0000-0000-000000000001')::bigint,1::bigint,'section headers become separate canonical sections');
select is((select count(*) from public.spec_items where project_id='e1000000-0000-0000-0000-000000000001')::bigint,1::bigint,'only billable child rows become specification items');
select ok((select section_id is not null from public.spec_items where project_id='e1000000-0000-0000-0000-000000000001'),'child item keeps its section parent');
select is((select review_status::text from public.extracted_drafts where id='e4000000-0000-0000-0000-000000000001'),'confirmed','confirmed draft is marked immutable');

insert into public.suppliers(id,company_id,name) values('e5000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','Pending price supplier');
insert into public.source_documents(id,company_id,project_id,kind,bucket_id,storage_path,original_filename,media_type,byte_size,sha256)
values('e2000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000001','supplier_quote','source-documents','a0000000-0000-0000-0000-000000000001/e100/quote.xls','quote.xls','application/vnd.ms-excel',16,repeat('b',64));
insert into public.extraction_runs(id,company_id,source_document_id,provider,model,prompt_version,schema_version,parser_version,status,attempt_count,started_at,completed_at)
values('e3000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000001','e2000000-0000-0000-0000-000000000002','fake','fixture','v1','v1','v1','succeeded',1,now(),now());
insert into public.extracted_drafts(id,company_id,extraction_run_id,payload)
values('e4000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000001','e3000000-0000-0000-0000-000000000002',
  '{"document_kind":"quote","sections":[],"lines":[{"position":"1.1","description":"Pending price work","quantity":"1","unit":"pcs","unit_price":null,"line_total":null,"currency":"USD","price_status":"pending_price","source":{"source_type":"xls","sheet":"Спецификация","row":8,"cell_range":"''Спецификация''!A8:F8","evidence_text":"1.1 | Pending price work"}}]}'::jsonb);
select throws_ok(
  $$select public.confirm_extraction_draft('e4000000-0000-0000-0000-000000000002','e1000000-0000-0000-0000-000000000001','[]'::jsonb,'[{"position":"1.1","description":"Pending price work","quantity":"1","unit":"pcs","unit_price":"","line_total":"","currency":"USD"}]'::jsonb,'e5000000-0000-0000-0000-000000000001')$$,
  'P0001','A pending-price row cannot be confirmed as a supplier quote; enter the reviewed price and total first','pending price stays reviewable and is never silently saved as zero');
select is((select review_status::text from public.extracted_drafts where id='e4000000-0000-0000-0000-000000000002'),'pending','failed pending-price promotion leaves the draft reviewable');

select * from finish();
rollback;
