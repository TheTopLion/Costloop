-- Vibe workspace: the Appraise estimate is the source of truth for both people and AI.
-- The checked-write/receipt shape is adapted from Klaudia's mcp-ledger operations.
alter table public.spec_items
  add column if not exists estimated_unit_price numeric(24,8)
    check (estimated_unit_price is null or estimated_unit_price >= 0),
  add column if not exists estimated_currency text
    check (estimated_currency is null or estimated_currency ~ '^[A-Z]{3}$'),
  add column if not exists estimated_line_total numeric(24,8)
    generated always as (
      case
        when quantity is not null and estimated_unit_price is not null
          then round(quantity * estimated_unit_price, 2)
        else null
      end
    ) stored;

update public.spec_items i
set estimated_currency = p.currency
from public.projects p
where p.id = i.project_id and i.estimated_currency is null;

create table public.estimate_operations (
  id uuid primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null,
  actor_id uuid not null references auth.users(id),
  tool_name text not null,
  status text not null check (status in ('committed', 'undone')),
  summary text not null,
  request jsonb not null,
  receipt jsonb not null,
  created_at timestamptz not null default now(),
  undone_at timestamptz,
  unique(company_id, id),
  foreign key(company_id, project_id) references public.projects(company_id, id)
);

alter table public.estimate_operations enable row level security;
create policy estimate_operations_select on public.estimate_operations for select to authenticated
  using (public.is_company_member(company_id));

grant select on public.estimate_operations to authenticated;

create or replace function public.apply_estimate_percentage(
  target_project uuid,
  target_items uuid[],
  percentage numeric,
  operation_id uuid
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  tenant uuid;
  project_currency text;
  expected_count integer;
  matched_count integer;
  before_rows jsonb;
  after_rows jsonb;
  result_summary text;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if target_items is null or cardinality(target_items) = 0 then raise exception 'select at least one row'; end if;
  if cardinality(target_items) > 200 then raise exception 'at most 200 rows can be changed at once'; end if;
  if percentage <= -100 or percentage > 1000 then raise exception 'percentage must be greater than -100 and at most 1000'; end if;

  select company_id, currency into tenant, project_currency
  from public.projects where id = target_project;
  if tenant is null then raise exception 'project not found'; end if;
  if not public.has_company_role(tenant, array['owner','admin','estimator']::public.company_role[]) then
    raise exception 'insufficient project role';
  end if;

  expected_count := cardinality(target_items);
  perform 1 from public.spec_items
    where project_id = target_project and id = any(target_items)
    order by sort_order for update;
  select count(*) into matched_count from public.spec_items
    where project_id = target_project and id = any(target_items);
  if matched_count <> expected_count then raise exception 'one or more selected rows are outside the project'; end if;
  if exists(select 1 from public.spec_items where project_id = target_project and id = any(target_items) and estimated_unit_price is null) then
    raise exception 'every selected row needs a unit price before percentage changes';
  end if;

  select jsonb_agg(jsonb_build_object(
    'id', id, 'position', position, 'description', description,
    'unit_price', estimated_unit_price, 'revision', revision
  ) order by sort_order) into before_rows
  from public.spec_items where project_id = target_project and id = any(target_items);

  update public.spec_items
  set estimated_unit_price = round(estimated_unit_price * (1 + percentage / 100), 2),
      estimated_currency = coalesce(estimated_currency, project_currency)
  where project_id = target_project and id = any(target_items);

  select jsonb_agg(jsonb_build_object(
    'id', id, 'position', position, 'description', description,
    'unit_price', estimated_unit_price, 'line_total', estimated_line_total,
    'revision', revision
  ) order by sort_order) into after_rows
  from public.spec_items where project_id = target_project and id = any(target_items);

  result_summary := case when percentage >= 0 then 'Стоимость увеличена на ' else 'Стоимость уменьшена на ' end
    || trim(to_char(abs(percentage), 'FM999999990.########')) || '% для ' || matched_count || ' строк.';

  insert into public.estimate_operations(id, company_id, project_id, actor_id, tool_name, status, summary, request, receipt)
  values(operation_id, tenant, target_project, auth.uid(), 'change_prices_by_percentage', 'committed', result_summary,
    jsonb_build_object('item_ids', target_items, 'percentage', percentage),
    jsonb_build_object('before', before_rows, 'after', after_rows));

  return jsonb_build_object(
    'operation_id', operation_id, 'status', 'committed', 'summary', result_summary,
    'rows_affected', matched_count, 'before', before_rows, 'after', after_rows
  );
end $$;

create or replace function public.undo_estimate_operation(operation_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  operation public.estimate_operations%rowtype;
  item jsonb;
  current_revision integer;
  restored_rows jsonb;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  select * into operation from public.estimate_operations
    where id = operation_id and actor_id = auth.uid() for update;
  if operation.id is null then raise exception 'operation not found'; end if;
  if operation.status = 'undone' then raise exception 'operation was already undone'; end if;

  for item in select * from jsonb_array_elements(operation.receipt->'after') loop
    select revision into current_revision from public.spec_items
      where project_id = operation.project_id and id = (item->>'id')::uuid for update;
    if current_revision is distinct from (item->>'revision')::integer then
      raise exception 'cannot undo because row % changed after this operation', item->>'position';
    end if;
  end loop;

  for item in select * from jsonb_array_elements(operation.receipt->'before') loop
    update public.spec_items
      set estimated_unit_price = (item->>'unit_price')::numeric
      where project_id = operation.project_id and id = (item->>'id')::uuid;
  end loop;

  update public.estimate_operations set status = 'undone', undone_at = now()
    where id = operation_id;

  select jsonb_agg(to_jsonb(i) order by i.sort_order) into restored_rows
  from public.spec_items i
  where i.project_id = operation.project_id
    and i.id in (select (value->>'id')::uuid from jsonb_array_elements(operation.receipt->'before'));

  return jsonb_build_object(
    'operation_id', operation_id, 'status', 'undone',
    'summary', 'Изменение отменено. Восстановлено строк: ' || jsonb_array_length(operation.receipt->'before') || '.',
    'rows', restored_rows
  );
end $$;

revoke all on function public.apply_estimate_percentage(uuid,uuid[],numeric,uuid) from public;
revoke all on function public.undo_estimate_operation(uuid) from public;
grant execute on function public.apply_estimate_percentage(uuid,uuid[],numeric,uuid) to authenticated;
grant execute on function public.undo_estimate_operation(uuid) to authenticated;
