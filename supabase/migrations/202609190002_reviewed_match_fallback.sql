-- Existing projects that have never generated matching suggestions retain the
-- original exact resolver. Once a position has review records, review governs
-- that position and no legacy fallback is allowed.
do $$
declare definition text;
begin
  select pg_get_functiondef('public.publish_manual_comparison(uuid)'::regprocedure) into definition;
  definition := replace(definition,
    $old$select candidate.*
      from public.line_matches reviewed
      join public.quote_lines candidate on candidate.company_id=reviewed.company_id and candidate.id=reviewed.quote_line_id
      where reviewed.company_id=tenant and reviewed.project_id=target_project and reviewed.spec_item_id=s.id
        and reviewed.review_status='confirmed' and reviewed.relation <> 'NO_MATCH'
        and candidate.quote_id=q.id
      order by reviewed.reviewed_at desc nulls last, reviewed.created_at desc
      limit 1$old$,
    $new$select candidate.* from public.quote_lines candidate
      where candidate.company_id=tenant and candidate.quote_id=q.id and (
        candidate.id = (select reviewed.quote_line_id from public.line_matches reviewed
          where reviewed.company_id=tenant and reviewed.project_id=target_project and reviewed.spec_item_id=s.id
            and reviewed.review_status='confirmed' and reviewed.relation <> 'NO_MATCH'
          order by reviewed.reviewed_at desc nulls last, reviewed.created_at desc limit 1)
        or (not exists(select 1 from public.line_matches any_review where any_review.company_id=tenant and any_review.project_id=target_project and any_review.review_status in ('pending','confirmed')) and (
          (nullif(trim(s.position),'') is not null and trim(candidate.position)=trim(s.position)) or
          (nullif(trim(s.position),'') is null and public.manual_description_key(candidate.raw_description)=public.manual_description_key(s.description))
        ))
      ) limit 1$new$
  );
  if position('not exists(select 1 from public.line_matches any_review' in definition) = 0 then
    raise exception 'could not add reviewed matching compatibility fallback';
  end if;
  execute definition;
end $$;
