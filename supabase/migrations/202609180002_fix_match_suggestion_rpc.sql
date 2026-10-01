-- Disambiguate the PL/pgSQL variable from quote_lines.quote_id.
create or replace function public.save_match_suggestions(target_project uuid, suggestions jsonb)
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare tenant uuid; item jsonb; inserted integer := 0; spec_id uuid; target_quote_line_id uuid; relation_value public.match_relation; status_value public.review_status;
begin
  select company_id into tenant from public.projects where id=target_project;
  if tenant is null then raise exception using errcode='P0002', message='project not found'; end if;
  if not public.has_company_role(tenant,array['owner','admin','estimator']::public.company_role[]) then raise exception using errcode='42501', message='estimator permission required'; end if;
  if jsonb_typeof(suggestions) <> 'array' or jsonb_array_length(suggestions)>50000 then raise exception using errcode='22023', message='invalid matching suggestions'; end if;
  update public.line_matches set review_status='rejected',reviewed_by=auth.uid(),reviewed_at=now()
    where company_id=tenant and project_id=target_project and not human_override and review_status='pending';
  for item in select value from jsonb_array_elements(suggestions) loop
    spec_id := (item->>'spec_item_id')::uuid; target_quote_line_id := nullif(item->>'quote_line_id','')::uuid;
    relation_value := (item->>'relation')::public.match_relation;
    status_value := case when item->>'review_status'='confirmed' then 'confirmed'::public.review_status else 'pending'::public.review_status end;
    if not exists(select 1 from public.spec_items s where s.id=spec_id and s.company_id=tenant and s.project_id=target_project) then raise exception using errcode='22023', message='suggestion specification is outside project'; end if;
    if target_quote_line_id is not null and not exists(select 1 from public.quote_lines l join public.supplier_quotes q on q.id=l.quote_id and q.company_id=l.company_id where l.id=target_quote_line_id and l.company_id=tenant and q.project_id=target_project and q.status='confirmed') then raise exception using errcode='22023', message='suggestion quote line is outside confirmed project quotes'; end if;
    if target_quote_line_id is null and relation_value <> 'NO_MATCH' then raise exception using errcode='22023', message='a non-match relation requires a quote line'; end if;
    insert into public.line_matches(company_id,project_id,spec_item_id,quote_line_id,relation,method,component_scores,confidence,mapping_version,review_status,human_override,reviewed_by,reviewed_at)
    values(tenant,target_project,spec_id,target_quote_line_id,relation_value,coalesce(nullif(item->>'method',''),'rapidfuzz-rules-v1'),coalesce(item->'component_scores','{}'::jsonb),greatest(0,least(1,coalesce((item->>'confidence')::numeric,0))),coalesce(nullif(item->>'mapping_version',''),'rapidfuzz-rules-v1'),status_value,false,case when status_value='confirmed' then auth.uid() end,case when status_value='confirmed' then now() end);
    inserted := inserted+1;
  end loop;
  return inserted;
end $$;
