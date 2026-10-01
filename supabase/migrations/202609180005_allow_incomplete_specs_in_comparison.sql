-- An incomplete specification must not prevent the rest of a project from publishing.
do $$
declare definition text;
begin
  select pg_get_functiondef('public.publish_manual_comparison(uuid)'::regprocedure) into definition;
  definition := regexp_replace(definition,
    'if exists\(select 1 from public\.spec_items where company_id=tenant and project_id=target_project and \(quantity is null or quantity<0 or nullif\(trim\(unit\),''''\) is null or public\.manual_description_key\(description\) is null\)\) then raise exception using errcode=''22023'', message=''specification quantity, unit and description are required''; end if;\s*',
    '');
  execute definition;
end $$;
