alter table public.extracted_drafts add column if not exists canonical_result jsonb;

-- Uploaded evidence cannot be removed through client storage credentials.
drop policy if exists storage_tenant_delete on storage.objects;
create policy storage_generated_delete on storage.objects for delete to authenticated
using(bucket_id='generated-exports' and public.has_company_role((storage.foldername(name))[1]::uuid,array['owner','admin']::public.company_role[]));

create or replace function public.confirm_extraction_draft(
  target_draft uuid, target_project uuid, reviewed_lines jsonb, target_supplier uuid default null
) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare
  d public.extracted_drafts; r public.extraction_runs; doc public.source_documents;
  line jsonb; original_line jsonb; line_index integer:=0; quote_id uuid; item_id uuid;
  result_ids jsonb:='[]'; qty numeric; price numeric; total numeric; curr text;
begin
  select * into d from public.extracted_drafts where id=target_draft for update;
  if d.id is null or not public.has_company_role(d.company_id,array['owner','admin','estimator']::public.company_role[]) then
    raise exception using errcode='42501',message='Draft access required';
  end if;
  select * into r from public.extraction_runs where id=d.extraction_run_id and company_id=d.company_id;
  select * into doc from public.source_documents where id=r.source_document_id and project_id=target_project and company_id=d.company_id;
  if doc.id is null or r.status<>'succeeded' then raise exception 'Extraction must succeed for this project before confirmation'; end if;
  if d.review_status='confirmed' then return d.canonical_result; end if;
  if d.review_status<>'pending' then raise exception 'Draft is no longer pending'; end if;
  if jsonb_typeof(reviewed_lines)<>'array' or jsonb_array_length(reviewed_lines)=0
    or jsonb_array_length(reviewed_lines)>2000
    or jsonb_array_length(reviewed_lines)<>jsonb_array_length(d.payload->'lines') then
    raise exception 'Review must retain one row per extracted line and contain 1 to 2000 lines';
  end if;
  if doc.kind='supplier_quote' then
    if not exists(select 1 from public.suppliers where id=target_supplier and company_id=d.company_id) then raise exception 'Select a supplier in this workspace'; end if;
    curr:=reviewed_lines->0->>'currency';
    if curr is null or curr!~'^[A-Z]{3}$' then raise exception 'Specify an ISO currency on each quotation line'; end if;
    insert into public.supplier_quotes(company_id,project_id,supplier_id,source_document_id,currency)
    values(d.company_id,target_project,target_supplier,doc.id,curr) returning id into quote_id;
  elsif doc.kind<>'specification' then raise exception 'Unsupported document kind'; end if;
  for line in select value from jsonb_array_elements(reviewed_lines) loop
    original_line:=d.payload->'lines'->line_index;
    if original_line->'source' is null or jsonb_typeof(original_line->'source')<>'object' then raise exception 'Source provenance is required'; end if;
    if length(trim(coalesce(line->>'description','')))<2 then raise exception 'A description is required on every row'; end if;
    if coalesce(line->>'quantity','')!~'^[0-9]+(\.[0-9]+)?$' then raise exception 'Every row needs a nonnegative decimal quantity'; end if;
    qty:=(line->>'quantity')::numeric;
    if doc.kind='specification' then
      insert into public.spec_items(company_id,project_id,position,description,quantity,unit,source_document_id,source_provenance,sort_order)
      values(d.company_id,target_project,nullif(line->>'position',''),line->>'description',qty,nullif(line->>'unit',''),doc.id,original_line->'source',line_index)
      returning id into item_id;
    else
      if line->>'currency' is distinct from curr then raise exception 'All quote lines must share the reviewed quotation currency'; end if;
      if coalesce(line->>'unit_price','')!~'^[0-9]+(\.[0-9]+)?$'
        or coalesce(line->>'line_total','')!~'^[0-9]+(\.[0-9]+)?$' then raise exception 'Quote prices and totals must be nonnegative decimal values'; end if;
      price:=(line->>'unit_price')::numeric; total:=(line->>'line_total')::numeric;
      if abs(round(qty*price,2)-round(total,2))>0.01 then raise exception 'Quantity times unit price must agree with the reviewed total'; end if;
      insert into public.quote_lines(company_id,quote_id,position,raw_description,raw_quantity,raw_unit,raw_unit_price,raw_total,raw_currency,source_provenance,sort_order)
      values(d.company_id,quote_id,nullif(line->>'position',''),line->>'description',qty,line->>'unit',price,total,curr,original_line->'source',line_index)
      returning id into item_id;
    end if;
    result_ids:=result_ids||jsonb_build_array(item_id);
    line_index:=line_index+1;
  end loop;
  if quote_id is not null then update public.supplier_quotes set status='confirmed' where id=quote_id; end if;
  update public.extracted_drafts set review_status='confirmed',reviewed_by=auth.uid(),reviewed_at=now(),
    canonical_result=jsonb_build_object('line_ids',result_ids,'quote_id',quote_id,'reviewed_lines',reviewed_lines)
    where id=target_draft;
  return jsonb_build_object('line_ids',result_ids,'quote_id',quote_id);
end $$;
revoke all on function public.confirm_extraction_draft(uuid,uuid,jsonb,uuid) from public;
grant execute on function public.confirm_extraction_draft(uuid,uuid,jsonb,uuid) to authenticated;

create or replace function public.protect_confirmed_draft() returns trigger language plpgsql as $$
begin
  if old.review_status='confirmed' then raise exception 'Confirmed extraction drafts are immutable'; end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
create trigger confirmed_draft_immutable before update or delete on public.extracted_drafts for each row execute function public.protect_confirmed_draft();
create trigger audit_extracted_drafts after insert or update or delete on public.extracted_drafts for each row execute function public.record_audit_event();
