-- A published comparison must use the line selected by matching review, never
-- fall back to a convenient position/description coincidence.
do $$
declare definition text;
begin
  select pg_get_functiondef('public.publish_manual_comparison(uuid)'::regprocedure) into definition;

  definition := replace(definition, 'position-or-exact-description-v1', 'human-reviewed-line-matches-v1');
  definition := replace(definition,
    $old$select candidate.* from public.quote_lines candidate where candidate.company_id=tenant and candidate.quote_id=q.id and (
        (nullif(trim(s.position),'') is not null and trim(candidate.position)=trim(s.position)) or
        (nullif(trim(s.position),'') is null and public.manual_description_key(candidate.raw_description)=public.manual_description_key(s.description))
      ) limit 1$old$,
    $new$select candidate.*
      from public.line_matches reviewed
      join public.quote_lines candidate on candidate.company_id=reviewed.company_id and candidate.id=reviewed.quote_line_id
      where reviewed.company_id=tenant and reviewed.project_id=target_project and reviewed.spec_item_id=s.id
        and reviewed.review_status='confirmed' and reviewed.relation <> 'NO_MATCH'
        and candidate.quote_id=q.id
      order by reviewed.reviewed_at desc nulls last, reviewed.created_at desc
      limit 1$new$
  );

  if position('from public.line_matches reviewed' in definition) = 0 then
    raise exception 'could not upgrade comparison matching resolver';
  end if;
  execute definition;
end $$;
