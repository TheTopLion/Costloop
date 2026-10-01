-- Preserve source hierarchy separately from priceable lines and admit legacy Excel evidence.

update storage.buckets
set allowed_mime_types = array['application/pdf','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
where id = 'source-documents';

create table public.spec_sections (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null,
  parent_section_id uuid,
  position text,
  description text not null check(length(trim(description)) >= 2),
  source_document_id uuid not null,
  source_provenance jsonb not null,
  sort_order integer not null default 0,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique(company_id,id),
  foreign key(company_id,project_id) references public.projects(company_id,id),
  foreign key(company_id,parent_section_id) references public.spec_sections(company_id,id),
  foreign key(company_id,source_document_id) references public.source_documents(company_id,id)
);
create index spec_sections_project_order on public.spec_sections(company_id,project_id,sort_order);
alter table public.spec_items add column section_id uuid;
alter table public.spec_items add constraint spec_items_section_fk foreign key(company_id,section_id) references public.spec_sections(company_id,id);
alter table public.spec_sections enable row level security;
create policy tenant_select on public.spec_sections for select to authenticated using(public.is_company_member(company_id));
create policy tenant_insert on public.spec_sections for insert to authenticated with check(public.has_company_role(company_id,array['owner','admin','estimator']::public.company_role[]));
create policy tenant_update on public.spec_sections for update to authenticated using(public.has_company_role(company_id,array['owner','admin','estimator']::public.company_role[])) with check(public.has_company_role(company_id,array['owner','admin','estimator']::public.company_role[]));
create policy tenant_delete on public.spec_sections for delete to authenticated using(public.has_company_role(company_id,array['owner','admin','estimator']::public.company_role[]));
create trigger audit_spec_sections after insert or update or delete on public.spec_sections for each row execute function public.record_audit_event();
grant select,insert,update,delete on public.spec_sections to authenticated;

drop function if exists public.confirm_extraction_draft(uuid,uuid,jsonb,uuid);
create function public.confirm_extraction_draft(
  target_draft uuid, target_project uuid, reviewed_sections jsonb, reviewed_lines jsonb, target_supplier uuid default null
) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare
  d public.extracted_drafts; r public.extraction_runs; doc public.source_documents;
  section jsonb; original_section jsonb; line jsonb; original_line jsonb;
  section_index integer:=0; line_index integer:=0; section_id uuid; parent_id uuid; quote_id uuid; item_id uuid;
  section_ids jsonb:='{}'::jsonb; result_ids jsonb:='[]'::jsonb; qty numeric; price numeric; total numeric; curr text;
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
  if jsonb_typeof(reviewed_lines)<>'array' or jsonb_array_length(reviewed_lines)=0 or jsonb_array_length(reviewed_lines)>2000
     or jsonb_array_length(reviewed_lines)<>jsonb_array_length(d.payload->'lines') then
    raise exception 'Review must retain one row per extracted line and contain 1 to 2000 lines';
  end if;
  if jsonb_typeof(reviewed_sections)<>'array' or jsonb_array_length(reviewed_sections)<>jsonb_array_length(coalesce(d.payload->'sections','[]'::jsonb)) then
    raise exception 'Review must retain every extracted section';
  end if;
  if doc.kind='supplier_quote' then
    if not exists(select 1 from public.suppliers where id=target_supplier and company_id=d.company_id) then raise exception 'Select a supplier in this workspace'; end if;
    curr:=reviewed_lines->0->>'currency';
    if curr is null or curr!~'^[A-Z]{3}$' then raise exception 'Specify an ISO currency on each quotation line'; end if;
    insert into public.supplier_quotes(company_id,project_id,supplier_id,source_document_id,currency)
    values(d.company_id,target_project,target_supplier,doc.id,curr) returning id into quote_id;
  elsif doc.kind<>'specification' then raise exception 'Unsupported document kind'; end if;
  if doc.kind='specification' then
    for section in select value from jsonb_array_elements(reviewed_sections) loop
      original_section:=d.payload->'sections'->section_index;
      if original_section->'source' is null or jsonb_typeof(original_section->'source')<>'object' then raise exception 'Section source provenance is required'; end if;
      if length(trim(coalesce(section->>'description','')))<2 then raise exception 'A description is required on every section'; end if;
      parent_id:=null;
      if nullif(section->>'parent_position','') is not null then
        parent_id:=nullif(section_ids->>(section->>'parent_position'),'')::uuid;
        if parent_id is null then raise exception 'Section parent must precede its child'; end if;
      end if;
      insert into public.spec_sections(company_id,project_id,parent_section_id,position,description,source_document_id,source_provenance,sort_order,created_by)
      values(d.company_id,target_project,parent_id,nullif(section->>'position',''),section->>'description',doc.id,original_section->'source',section_index,auth.uid()) returning id into section_id;
      if nullif(section->>'position','') is not null then section_ids:=section_ids||jsonb_build_object(section->>'position',section_id::text); end if;
      section_index:=section_index+1;
    end loop;
  end if;
  for line in select value from jsonb_array_elements(reviewed_lines) loop
    original_line:=d.payload->'lines'->line_index;
    if original_line->'source' is null or jsonb_typeof(original_line->'source')<>'object' then raise exception 'Source provenance is required'; end if;
    if length(trim(coalesce(line->>'description','')))<2 then raise exception 'A description is required on every row'; end if;
    if coalesce(line->>'quantity','')!~'^[0-9]+(\.[0-9]+)?$' then raise exception 'Every row needs a nonnegative decimal quantity before confirmation'; end if;
    qty:=(line->>'quantity')::numeric;
    if doc.kind='specification' then
      if nullif(trim(line->>'unit'),'') is null then raise exception 'Every specification row needs a unit before confirmation'; end if;
      section_id:=nullif(section_ids->>(line->>'section_position'),'')::uuid;
      insert into public.spec_items(company_id,project_id,section_id,position,description,quantity,unit,source_document_id,source_provenance,sort_order,created_by)
      values(d.company_id,target_project,section_id,nullif(line->>'position',''),line->>'description',qty,line->>'unit',doc.id,original_line->'source',line_index,auth.uid())
      returning id into item_id;
    else
      if line->>'currency' is distinct from curr then raise exception 'All quote lines must share the reviewed quotation currency'; end if;
      if coalesce(line->>'unit_price','')!~'^[0-9]+(\.[0-9]+)?$' or coalesce(line->>'line_total','')!~'^[0-9]+(\.[0-9]+)?$' then
        raise exception 'A pending-price row cannot be confirmed as a supplier quote; enter the reviewed price and total first';
      end if;
      price:=(line->>'unit_price')::numeric; total:=(line->>'line_total')::numeric;
      if abs(round(qty*price,2)-round(total,2))>0.01 then raise exception 'Quantity times unit price must agree with the reviewed total'; end if;
      insert into public.quote_lines(company_id,quote_id,position,raw_description,raw_quantity,raw_unit,raw_unit_price,raw_total,raw_currency,source_provenance,sort_order)
      values(d.company_id,quote_id,nullif(line->>'position',''),line->>'description',qty,nullif(line->>'unit',''),price,total,curr,original_line->'source',line_index)
      returning id into item_id;
    end if;
    result_ids:=result_ids||jsonb_build_array(item_id);
    line_index:=line_index+1;
  end loop;
  if quote_id is not null then update public.supplier_quotes set status='confirmed' where id=quote_id; end if;
  update public.extracted_drafts set review_status='confirmed',reviewed_by=auth.uid(),reviewed_at=now(),
    canonical_result=jsonb_build_object('line_ids',result_ids,'quote_id',quote_id,'reviewed_sections',reviewed_sections,'reviewed_lines',reviewed_lines)
    where id=target_draft;
  return jsonb_build_object('line_ids',result_ids,'quote_id',quote_id);
end $$;
revoke all on function public.confirm_extraction_draft(uuid,uuid,jsonb,jsonb,uuid) from public;
grant execute on function public.confirm_extraction_draft(uuid,uuid,jsonb,jsonb,uuid) to authenticated;
