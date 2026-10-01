-- Missing specification inputs are explicit, reviewable state, never guesses.
alter table public.spec_items add column if not exists input_status text not null default 'complete'
  check (input_status in ('complete','needs_input'));

create or replace function public.set_spec_item_input_status() returns trigger language plpgsql as $$
begin
  new.input_status := case when new.quantity is null or nullif(trim(new.unit),'') is null then 'needs_input' else 'complete' end;
  return new;
end $$;
drop trigger if exists spec_item_input_status on public.spec_items;
create trigger spec_item_input_status before insert or update of quantity,unit on public.spec_items for each row execute function public.set_spec_item_input_status();
update public.spec_items set input_status=case when quantity is null or nullif(trim(unit),'') is null then 'needs_input' else 'complete' end;

-- Promote reviewed specifications even when quantity/unit remain unknown; the trigger records needs_input.
do $$
declare definition text;
begin
  select pg_get_functiondef('public.confirm_extraction_draft(uuid,uuid,jsonb,jsonb,uuid)'::regprocedure) into definition;
  definition := regexp_replace(definition,
    'if coalesce\(line->>''quantity'',''''\)!~''\^\[0-9\]\+\(\\\.\[0-9\]\+\)\?\$'' then raise exception ''Every row needs a nonnegative decimal quantity before confirmation''; end if;\s*qty:=\(line->>''quantity''\)::numeric;',
    'if nullif(trim(coalesce(line->>''quantity'','''')) ,'''') is not null and coalesce(line->>''quantity'','''') !~ ''^[0-9]+(\\.[0-9]+)?$'' then raise exception ''Quantity must be a nonnegative decimal when provided''; end if; qty:=nullif(line->>''quantity'','''')::numeric;');
  definition := replace(definition, 'if nullif(trim(line->>''unit''),'''') is null then raise exception ''Every specification row needs a unit before confirmation''; end if;', '');
  execute definition;
end $$;
