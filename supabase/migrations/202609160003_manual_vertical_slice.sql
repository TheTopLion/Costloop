-- Stage 02: deterministic, tenant-safe manual estimating workflow.

create type public.comparison_cell_state as enum ('comparable', 'missing_bid', 'non_comparable', 'excluded');
create type public.award_scope as enum ('line', 'quote');

alter table public.spec_items
  add column revision integer not null default 1 check (revision > 0);

alter table public.supplier_quotes
  add column revision integer not null default 1 check (revision > 0),
  add column confirmed_at timestamptz,
  add constraint supplier_quotes_confirmation_check check (
    (status = 'confirmed' and confirmed_at is not null) or
    (status <> 'confirmed' and confirmed_at is null)
  );

alter table public.quote_lines
  add column created_by uuid references auth.users(id) default auth.uid(),
  add column revision integer not null default 1 check (revision > 0),
  add column calculated_line_total numeric(24,8)
    generated always as (
      case
        when raw_total is not null then raw_total
        when raw_quantity is not null and raw_unit_price is not null then raw_quantity * raw_unit_price
        else null
      end
    ) stored;

alter table public.comparison_cells
  add column state public.comparison_cell_state not null default 'comparable',
  add column state_reason text,
  add constraint comparison_cells_state_shape check (
    (state = 'missing_bid' and quote_line_id is null and supplier_id is not null and evaluated_amount is null) or
    (state = 'comparable' and quote_line_id is not null and supplier_id is not null and evaluated_amount is not null and comparable) or
    (state in ('non_comparable', 'excluded') and supplier_id is not null and not comparable)
  );

alter table public.award_decisions
  add column scope public.award_scope not null default 'line',
  add column quote_id uuid,
  add constraint award_decisions_quote_fk foreign key(company_id, quote_id)
    references public.supplier_quotes(company_id,id),
  add constraint award_decisions_scope_shape check (
    (scope = 'line' and spec_item_id is not null and quote_line_id is not null and quote_id is null) or
    (scope = 'quote' and spec_item_id is null and quote_line_id is null and quote_id is not null)
  );

alter table public.proposals
  add column revision integer not null default 1 check (revision > 0);

alter table public.proposal_versions
  add constraint proposal_version_total_check
  check (grand_total = subtotal + markup_amount + tax_amount);

alter table public.award_decisions alter column decided_by set default auth.uid();

create unique index award_one_line_winner
  on public.award_decisions(project_id, spec_item_id) where scope = 'line';
create unique index award_one_whole_quote
  on public.award_decisions(project_id) where scope = 'quote';

create table public.exchange_rates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null,
  from_currency text not null check(from_currency ~ '^[A-Z]{3}$'),
  to_currency text not null check(to_currency ~ '^[A-Z]{3}$'),
  rate numeric(28,12) not null check(rate > 0),
  effective_on date not null,
  source text not null check(length(trim(source)) > 0),
  version integer not null check(version > 0),
  created_by uuid not null references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  unique(company_id,id),
  unique(project_id,from_currency,to_currency,effective_on,version),
  check(from_currency <> to_currency),
  foreign key(company_id,project_id) references public.projects(company_id,id)
);

create table public.comparison_snapshot_rates (
  company_id uuid not null references public.companies(id) on delete cascade,
  snapshot_id uuid not null,
  exchange_rate_id uuid not null,
  created_at timestamptz not null default now(),
  primary key(snapshot_id,exchange_rate_id),
  foreign key(company_id,snapshot_id) references public.comparison_snapshots(company_id,id),
  foreign key(company_id,exchange_rate_id) references public.exchange_rates(company_id,id)
);

create table public.workflow_transitions (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  entity_type text not null check(entity_type in ('project','supplier_quote','proposal')),
  entity_id uuid not null,
  from_state text not null,
  to_state text not null,
  revision integer not null check(revision > 0),
  actor_id uuid not null references auth.users(id) default auth.uid(),
  occurred_at timestamptz not null default now(),
  unique(entity_type,entity_id,revision)
);

create table public.proposal_version_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  proposal_version_id uuid not null,
  spec_item_id uuid not null,
  award_decision_id uuid not null,
  description text not null,
  quantity numeric(24,8) not null check(quantity >= 0),
  unit text,
  unit_price numeric(24,8) not null check(unit_price >= 0),
  line_total numeric(24,8) not null check(line_total >= 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique(company_id,id),
  unique(proposal_version_id,spec_item_id),
  foreign key(company_id,proposal_version_id) references public.proposal_versions(company_id,id),
  foreign key(company_id,spec_item_id) references public.spec_items(company_id,id),
  foreign key(company_id,award_decision_id) references public.award_decisions(company_id,id)
);

create or replace function public.bump_row_revision()
returns trigger language plpgsql as $$
begin
  new.revision := old.revision + 1;
  return new;
end $$;

create trigger spec_items_revision before update on public.spec_items
for each row execute function public.bump_row_revision();
create trigger quote_lines_revision before update on public.quote_lines
for each row execute function public.bump_row_revision();

create or replace function public.validate_project_transition()
returns trigger language plpgsql as $$
begin
  if new.status is not distinct from old.status then return new; end if;
  if not (
    (old.status = 'draft' and new.status in ('estimating','cancelled')) or
    (old.status = 'estimating' and new.status in ('awarded','cancelled')) or
    (old.status = 'awarded' and new.status in ('completed','cancelled'))
  ) then raise exception using errcode='23514', message=format('invalid project transition: %s -> %s',old.status,new.status); end if;
  return new;
end $$;

create or replace function public.validate_quote_transition()
returns trigger language plpgsql as $$
begin
  if new.status is not distinct from old.status then return new; end if;
  if old.status <> 'pending' or new.status not in ('confirmed','rejected') then
    raise exception using errcode='23514', message=format('invalid supplier quote transition: %s -> %s',old.status,new.status);
  end if;
  if new.status = 'confirmed' and not exists(select 1 from public.quote_lines l where l.company_id=new.company_id and l.quote_id=new.id) then
    raise exception using errcode='23514', message='cannot confirm an empty supplier quote';
  end if;
  new.confirmed_at := case when new.status='confirmed' then now() else null end;
  new.revision := old.revision + 1;
  return new;
end $$;

create or replace function public.validate_proposal_transition()
returns trigger language plpgsql as $$
begin
  if new.status is not distinct from old.status then return new; end if;
  if not (
    (old.status='draft' and new.status in ('issued','cancelled')) or
    (old.status='issued' and new.status in ('accepted','cancelled'))
  ) then raise exception using errcode='23514', message=format('invalid proposal transition: %s -> %s',old.status,new.status); end if;
  if new.status='issued' and not exists(select 1 from public.proposal_versions v where v.company_id=new.company_id and v.proposal_id=new.id) then
    raise exception using errcode='23514', message='cannot issue a proposal without a version';
  end if;
  new.revision := old.revision + 1;
  return new;
end $$;

create trigger validate_project_status before update of status on public.projects
for each row execute function public.validate_project_transition();
create trigger validate_quote_status before update of status on public.supplier_quotes
for each row execute function public.validate_quote_transition();
create trigger validate_proposal_status before update of status on public.proposals
for each row execute function public.validate_proposal_transition();

create or replace function public.record_workflow_transition()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare kind text; rev integer;
begin
  if new.status is not distinct from old.status then return new; end if;
  kind := case tg_table_name when 'projects' then 'project' when 'supplier_quotes' then 'supplier_quote' else 'proposal' end;
  rev := case when tg_table_name='projects' then coalesce((select count(*)::int + 1 from public.workflow_transitions w where w.entity_type=kind and w.entity_id=new.id),1) else new.revision end;
  insert into public.workflow_transitions(company_id,entity_type,entity_id,from_state,to_state,revision,actor_id)
  values(new.company_id,kind,new.id,old.status::text,new.status::text,rev,auth.uid());
  return new;
end $$;

create trigger project_transition_audit after update of status on public.projects
for each row execute function public.record_workflow_transition();
create trigger quote_transition_audit after update of status on public.supplier_quotes
for each row execute function public.record_workflow_transition();
create trigger proposal_transition_audit after update of status on public.proposals
for each row execute function public.record_workflow_transition();

create or replace function public.validate_comparison_cell_references()
returns trigger language plpgsql as $$
declare snapshot_project uuid; spec_project uuid; line_project uuid; line_supplier uuid;
begin
  select project_id into snapshot_project from public.comparison_snapshots where company_id=new.company_id and id=new.snapshot_id;
  select project_id into spec_project from public.spec_items where company_id=new.company_id and id=new.spec_item_id;
  if snapshot_project is null or spec_project is distinct from snapshot_project then
    raise exception using errcode='23514', message='comparison cell specification must belong to snapshot project';
  end if;
  if new.quote_line_id is not null then
    select q.project_id,q.supplier_id into line_project,line_supplier
      from public.quote_lines l join public.supplier_quotes q on q.company_id=l.company_id and q.id=l.quote_id
      where l.company_id=new.company_id and l.id=new.quote_line_id;
    if line_project is distinct from snapshot_project or line_supplier is distinct from new.supplier_id then
      raise exception using errcode='23514', message='comparison cell quote line must belong to snapshot project and supplier';
    end if;
  end if;
  return new;
end $$;
create trigger validate_comparison_cell before insert or update on public.comparison_cells
for each row execute function public.validate_comparison_cell_references();

create or replace function public.validate_award_references()
returns trigger language plpgsql as $$
declare snapshot_project uuid; item_project uuid; quote_project uuid; quote_supplier uuid; line_quote uuid;
begin
  select project_id into snapshot_project from public.comparison_snapshots where company_id=new.company_id and id=new.snapshot_id;
  if snapshot_project is distinct from new.project_id then
    raise exception using errcode='23514', message='award snapshot must belong to award project';
  end if;
  if new.scope='line' then
    select project_id into item_project from public.spec_items where company_id=new.company_id and id=new.spec_item_id;
    select l.quote_id,q.project_id,q.supplier_id into line_quote,quote_project,quote_supplier
      from public.quote_lines l join public.supplier_quotes q on q.company_id=l.company_id and q.id=l.quote_id
      where l.company_id=new.company_id and l.id=new.quote_line_id;
    if item_project is distinct from new.project_id or quote_project is distinct from new.project_id or quote_supplier is distinct from new.supplier_id then
      raise exception using errcode='23514', message='line award references must belong to award project and supplier';
    end if;
    if not exists(select 1 from public.comparison_cells c where c.company_id=new.company_id and c.snapshot_id=new.snapshot_id and c.spec_item_id=new.spec_item_id and c.quote_line_id=new.quote_line_id and c.supplier_id=new.supplier_id and c.state='comparable') then
      raise exception using errcode='23514', message='line award requires a comparable cell in the selected snapshot';
    end if;
  else
    select project_id,supplier_id into quote_project,quote_supplier from public.supplier_quotes where company_id=new.company_id and id=new.quote_id;
    if quote_project is distinct from new.project_id or quote_supplier is distinct from new.supplier_id then
      raise exception using errcode='23514', message='whole-quote award must belong to award project and supplier';
    end if;
    if exists(
      select 1 from public.spec_items s where s.company_id=new.company_id and s.project_id=new.project_id
      and not exists(select 1 from public.comparison_cells c where c.company_id=new.company_id and c.snapshot_id=new.snapshot_id and c.spec_item_id=s.id and c.supplier_id=new.supplier_id and c.state='comparable')
    ) then raise exception using errcode='23514', message='whole-quote award requires a comparable bid for every specification item'; end if;
  end if;
  return new;
end $$;
create trigger validate_award before insert or update on public.award_decisions
for each row execute function public.validate_award_references();

create or replace function public.validate_snapshot_rate()
returns trigger language plpgsql as $$
declare snapshot_project uuid; rate_project uuid;
begin
  select project_id into snapshot_project from public.comparison_snapshots where company_id=new.company_id and id=new.snapshot_id;
  select project_id into rate_project from public.exchange_rates where company_id=new.company_id and id=new.exchange_rate_id;
  if snapshot_project is distinct from rate_project then
    raise exception using errcode='23514', message='exchange rate must belong to snapshot project';
  end if;
  return new;
end $$;
create trigger validate_snapshot_rate before insert or update on public.comparison_snapshot_rates
for each row execute function public.validate_snapshot_rate();

create or replace function public.validate_proposal_version()
returns trigger language plpgsql as $$
declare expected integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.proposal_id::text,0));
  select coalesce(max(version),0)+1 into expected from public.proposal_versions where proposal_id=new.proposal_id;
  if new.version <> expected then raise exception using errcode='23514', message=format('proposal version must be %s',expected); end if;
  return new;
end $$;
create trigger validate_proposal_version before insert on public.proposal_versions
for each row execute function public.validate_proposal_version();

create or replace function public.validate_proposal_version_line()
returns trigger language plpgsql as $$
declare proposal_project uuid; item_project uuid; award_project uuid; award_item uuid;
begin
  select p.project_id into proposal_project
    from public.proposal_versions v
    join public.proposals p on p.company_id=v.company_id and p.id=v.proposal_id
    where v.company_id=new.company_id and v.id=new.proposal_version_id;
  select project_id into item_project from public.spec_items where company_id=new.company_id and id=new.spec_item_id;
  select project_id,spec_item_id into award_project,award_item from public.award_decisions where company_id=new.company_id and id=new.award_decision_id;
  if proposal_project is null or item_project is distinct from proposal_project or award_project is distinct from proposal_project or award_item is distinct from new.spec_item_id then
    raise exception using errcode='23514', message='proposal line, specification and award must belong to the proposal project';
  end if;
  return new;
end $$;
create trigger validate_proposal_version_line before insert or update on public.proposal_version_lines
for each row execute function public.validate_proposal_version_line();

create or replace function public.reject_version_mutation()
returns trigger language plpgsql as $$ begin raise exception using errcode='23514', message='versioned records are immutable'; end $$;
create trigger comparison_snapshots_immutable before update or delete on public.comparison_snapshots for each row execute function public.reject_version_mutation();
create trigger comparison_cells_immutable before update or delete on public.comparison_cells for each row execute function public.reject_version_mutation();
create trigger snapshot_rates_immutable before update or delete on public.comparison_snapshot_rates for each row execute function public.reject_version_mutation();
create trigger proposal_versions_immutable before update or delete on public.proposal_versions for each row execute function public.reject_version_mutation();
create trigger proposal_version_lines_immutable before update or delete on public.proposal_version_lines for each row execute function public.reject_version_mutation();

alter table public.exchange_rates enable row level security;
alter table public.comparison_snapshot_rates enable row level security;
alter table public.workflow_transitions enable row level security;
alter table public.proposal_version_lines enable row level security;

do $$ declare t text; begin foreach t in array array['exchange_rates','comparison_snapshot_rates','proposal_version_lines'] loop
 execute format('create policy tenant_select on public.%I for select to authenticated using(public.is_company_member(company_id))',t);
 execute format('create policy tenant_insert on public.%I for insert to authenticated with check(public.has_company_role(company_id,array[''owner'',''admin'',''estimator'']::public.company_role[]))',t);
 execute format('create policy tenant_update on public.%I for update to authenticated using(public.has_company_role(company_id,array[''owner'',''admin'',''estimator'']::public.company_role[])) with check(public.has_company_role(company_id,array[''owner'',''admin'',''estimator'']::public.company_role[]))',t);
 execute format('create policy tenant_delete on public.%I for delete to authenticated using(public.has_company_role(company_id,array[''owner'',''admin'',''estimator'']::public.company_role[]))',t);
end loop; end $$;
create policy workflow_transitions_select on public.workflow_transitions for select to authenticated using(public.is_company_member(company_id));

create trigger audit_exchange_rates after insert or update or delete on public.exchange_rates for each row execute function public.record_audit_event();
create trigger audit_proposal_version_lines after insert or update or delete on public.proposal_version_lines for each row execute function public.record_audit_event();

grant select,insert,update,delete on public.exchange_rates,public.comparison_snapshot_rates,public.proposal_version_lines to authenticated;
grant select on public.workflow_transitions to authenticated;
grant usage,select on sequence public.workflow_transitions_id_seq to authenticated;
