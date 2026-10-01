-- The published comparison already represents incomplete rows as pending input.
-- Remove the legacy all-or-nothing quantity/unit gate that survived the earlier
-- formatting-sensitive regexp migration.
do $$
declare
  definition text;
  gate_start integer;
  gate_end integer;
begin
  select pg_get_functiondef('public.publish_manual_comparison(uuid)'::regprocedure) into definition;
  gate_start := strpos(definition, 'if exists(select 1 from public.spec_items where company_id=tenant and project_id=target_project and (quantity is null');
  if gate_start > 0 then
    gate_end := strpos(substr(definition, gate_start), 'end if;');
    if gate_end = 0 then raise exception 'Could not locate end of stale comparison input gate'; end if;
    definition := overlay(definition placing '' from gate_start for gate_end + length('end if;') - 1);
    execute definition;
  end if;
end $$;
