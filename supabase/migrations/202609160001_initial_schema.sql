create extension if not exists pgcrypto;

create type public.company_role as enum ('owner', 'admin', 'estimator', 'viewer');
create type public.project_status as enum ('draft', 'estimating', 'awarded', 'completed', 'cancelled');
create type public.document_kind as enum ('specification', 'supplier_quote', 'proposal', 'other');
create type public.processing_status as enum ('pending', 'running', 'succeeded', 'failed', 'cancelled');
create type public.review_status as enum ('pending', 'confirmed', 'rejected');
create type public.match_relation as enum ('MATCH', 'NO_MATCH', 'PARTIAL', 'SUPERSET', 'SPLIT', 'MERGED');
create type public.job_status as enum ('queued', 'running', 'succeeded', 'failed', 'cancelled');

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 200),
  legal_name text,
  base_currency text not null default 'KZT' check (base_currency ~ '^[A-Z]{3}$'),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.company_memberships (
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.company_role not null default 'estimator',
  created_at timestamptz not null default now(),
  primary key (company_id, user_id)
);
create index company_memberships_user_idx on public.company_memberships(user_id, company_id);

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  insert into public.user_profiles(user_id,display_name) values(new.id,new.raw_user_meta_data->>'display_name') on conflict(user_id) do nothing;
  return new;
end $$;
create trigger auth_user_profile after insert on auth.users for each row execute function public.handle_new_user();

create or replace function public.is_company_member(target_company_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$ select exists(select 1 from public.company_memberships m where m.company_id = target_company_id and m.user_id = auth.uid()) $$;

create or replace function public.has_company_role(target_company_id uuid, allowed public.company_role[])
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$ select exists(select 1 from public.company_memberships m where m.company_id = target_company_id and m.user_id = auth.uid() and m.role = any(allowed)) $$;

revoke all on function public.is_company_member(uuid) from public;
revoke all on function public.has_company_role(uuid, public.company_role[]) from public;
grant execute on function public.is_company_member(uuid), public.has_company_role(uuid, public.company_role[]) to authenticated;

create table public.projects (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 240), project_number text, client_name text,
  description text, status public.project_status not null default 'draft', currency text not null check (currency ~ '^[A-Z]{3}$'),
  created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  completed_at timestamptz, unique(company_id, project_number), unique(company_id, id)
);

create table public.source_documents (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid, kind public.document_kind not null, bucket_id text not null,
  storage_path text not null, original_filename text not null, media_type text not null,
  byte_size bigint not null check (byte_size >= 0 and byte_size <= 52428800), sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  uploaded_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
  unique(company_id, storage_path), unique(company_id, id),
  foreign key(company_id, project_id) references public.projects(company_id, id)
);

create table public.extraction_runs (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  source_document_id uuid not null, provider text not null, model text not null, prompt_version text not null, schema_version text not null,
  parser_version text, status public.processing_status not null default 'pending', attempt_count integer not null default 0 check(attempt_count >= 0),
  raw_response jsonb, error jsonb, started_at timestamptz, completed_at timestamptz, created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(), unique(company_id, id),
  foreign key(company_id, source_document_id) references public.source_documents(company_id, id)
);

create table public.extracted_drafts (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  extraction_run_id uuid not null, payload jsonb not null, validation_warnings jsonb not null default '[]'::jsonb,
  review_status public.review_status not null default 'pending', reviewed_by uuid references auth.users(id), reviewed_at timestamptz,
  created_at timestamptz not null default now(), unique(company_id, id),
  foreign key(company_id, extraction_run_id) references public.extraction_runs(company_id, id)
);

create table public.spec_items (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null, position text, description text not null,
  quantity numeric(24,8) check(quantity is null or quantity >= 0), unit text, normalized_quantity numeric(24,8), normalized_unit text,
  technical_attributes jsonb not null default '{}'::jsonb, source_document_id uuid, source_provenance jsonb,
  sort_order integer not null default 0, created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(company_id, id), foreign key(company_id, project_id) references public.projects(company_id,id),
  foreign key(company_id, source_document_id) references public.source_documents(company_id,id)
);

create table public.suppliers (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  name text not null, tax_id text, email text, phone text, created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(company_id,id), unique(company_id,name)
);

create table public.supplier_quotes (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null, supplier_id uuid not null, source_document_id uuid, quote_number text, quote_date date,
  currency text not null check(currency ~ '^[A-Z]{3}$'), status public.review_status not null default 'pending', validity_days integer check(validity_days >= 0),
  commercial_terms jsonb not null default '{}'::jsonb, created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(company_id,id), foreign key(company_id,project_id) references public.projects(company_id,id), foreign key(company_id,supplier_id) references public.suppliers(company_id,id),
  foreign key(company_id,source_document_id) references public.source_documents(company_id,id)
);

create table public.quote_lines (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade, quote_id uuid not null,
  position text, raw_description text not null, raw_quantity numeric(24,8), raw_unit text, raw_unit_price numeric(24,8), raw_total numeric(24,8), raw_currency text check(raw_currency is null or raw_currency ~ '^[A-Z]{3}$'),
  normalized_description text, normalized_quantity numeric(24,8), normalized_unit text, normalized_unit_price numeric(24,8), normalized_total numeric(24,8), normalized_currency text check(normalized_currency is null or normalized_currency ~ '^[A-Z]{3}$'),
  technical_attributes jsonb not null default '{}'::jsonb, source_provenance jsonb, sort_order integer not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(company_id,id),
  check(raw_quantity is null or raw_quantity >= 0), check(raw_unit_price is null or raw_unit_price >= 0), check(raw_total is null or raw_total >= 0),
  foreign key(company_id,quote_id) references public.supplier_quotes(company_id,id)
);

create table public.line_matches (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null, spec_item_id uuid not null, quote_line_id uuid, relation public.match_relation not null,
  method text not null, component_scores jsonb not null default '{}'::jsonb, confidence numeric(7,6) check(confidence between 0 and 1), mapping_version text not null,
  review_status public.review_status not null default 'pending', human_override boolean not null default false, reviewed_by uuid references auth.users(id), reviewed_at timestamptz,
  created_at timestamptz not null default now(), unique(company_id,id),
  foreign key(company_id,project_id) references public.projects(company_id,id), foreign key(company_id,spec_item_id) references public.spec_items(company_id,id), foreign key(company_id,quote_line_id) references public.quote_lines(company_id,id)
);

create table public.comparison_snapshots (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade, project_id uuid not null,
  version integer not null check(version > 0), normalization_version text not null, matching_version text not null,
  exchange_rates jsonb not null default '{}'::jsonb, base_currency text not null check(base_currency ~ '^[A-Z]{3}$'), created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
  unique(company_id,id), unique(project_id,version), foreign key(company_id,project_id) references public.projects(company_id,id)
);

create table public.comparison_cells (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  snapshot_id uuid not null, spec_item_id uuid not null, quote_line_id uuid, supplier_id uuid,
  raw_amount numeric(24,8), raw_currency text check(raw_currency is null or raw_currency ~ '^[A-Z]{3}$'), normalized_amount numeric(24,8), normalized_currency text check(normalized_currency is null or normalized_currency ~ '^[A-Z]{3}$'),
  currency_conversion jsonb, quantity_conversion jsonb, commercial_adjustments jsonb not null default '[]'::jsonb, evaluated_amount numeric(24,8),
  warnings jsonb not null default '[]'::jsonb, exclusions jsonb not null default '[]'::jsonb, comparable boolean not null default true, created_at timestamptz not null default now(), unique(company_id,id),
  foreign key(company_id,snapshot_id) references public.comparison_snapshots(company_id,id), foreign key(company_id,spec_item_id) references public.spec_items(company_id,id),
  foreign key(company_id,quote_line_id) references public.quote_lines(company_id,id), foreign key(company_id,supplier_id) references public.suppliers(company_id,id)
);

create table public.award_decisions (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null, snapshot_id uuid not null, spec_item_id uuid, supplier_id uuid not null, quote_line_id uuid,
  rationale text, decided_by uuid not null references auth.users(id), decided_at timestamptz not null default now(), unique(company_id,id),
  foreign key(company_id,project_id) references public.projects(company_id,id), foreign key(company_id,snapshot_id) references public.comparison_snapshots(company_id,id),
  foreign key(company_id,spec_item_id) references public.spec_items(company_id,id), foreign key(company_id,supplier_id) references public.suppliers(company_id,id), foreign key(company_id,quote_line_id) references public.quote_lines(company_id,id)
);

create table public.proposals (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade, project_id uuid not null,
  proposal_number text not null, currency text not null check(currency ~ '^[A-Z]{3}$'), status text not null default 'draft' check(status in ('draft','issued','accepted','cancelled')),
  created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(company_id,id), unique(company_id,proposal_number),
  foreign key(company_id,project_id) references public.projects(company_id,id)
);

create table public.proposal_versions (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade, proposal_id uuid not null,
  version integer not null check(version > 0), subtotal numeric(24,8) not null check(subtotal >= 0), markup_amount numeric(24,8) not null default 0, tax_amount numeric(24,8) not null default 0,
  grand_total numeric(24,8) not null check(grand_total >= 0), calculation_snapshot jsonb not null, export_document_id uuid, generator_version text not null,
  created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), unique(company_id,id), unique(proposal_id,version),
  foreign key(company_id,proposal_id) references public.proposals(company_id,id), foreign key(company_id,export_document_id) references public.source_documents(company_id,id)
);

create table public.actual_costs (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade, project_id uuid not null, spec_item_id uuid not null,
  amount numeric(24,8) not null check(amount >= 0), currency text not null check(currency ~ '^[A-Z]{3}$'), quantity numeric(24,8) check(quantity is null or quantity >= 0), unit text,
  incurred_on date, notes text, recorded_by uuid not null references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(company_id,id),
  foreign key(company_id,project_id) references public.projects(company_id,id), foreign key(company_id,spec_item_id) references public.spec_items(company_id,id)
);

create table public.background_jobs (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade, project_id uuid,
  job_type text not null, idempotency_key text not null, status public.job_status not null default 'queued', payload jsonb not null default '{}'::jsonb, result jsonb,
  attempts integer not null default 0 check(attempts >= 0), max_attempts integer not null default 3 check(max_attempts > 0), last_error jsonb, run_after timestamptz not null default now(),
  locked_at timestamptz, locked_by text, created_by uuid references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), completed_at timestamptz,
  unique(company_id,id), unique(company_id,job_type,idempotency_key), foreign key(company_id,project_id) references public.projects(company_id,id)
);
create index background_jobs_claim_idx on public.background_jobs(status,run_after) where status in ('queued','failed');

create table public.audit_events (
  id bigint generated always as identity primary key, company_id uuid not null references public.companies(id) on delete cascade,
  actor_id uuid references auth.users(id), action text not null, entity_type text not null, entity_id uuid, old_data jsonb, new_data jsonb,
  request_id text, occurred_at timestamptz not null default now()
);
create index audit_events_company_time_idx on public.audit_events(company_id,occurred_at desc);

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
do $$ declare t text; begin foreach t in array array['companies','user_profiles','projects','spec_items','suppliers','supplier_quotes','quote_lines','proposals','actual_costs','background_jobs'] loop execute format('create trigger touch_updated_at before update on public.%I for each row execute function public.touch_updated_at()',t); end loop; end $$;

create or replace function public.reject_source_document_mutation() returns trigger language plpgsql as $$ begin raise exception 'source documents are immutable'; end $$;
create trigger source_documents_immutable before update or delete on public.source_documents for each row execute function public.reject_source_document_mutation();

create or replace function public.record_audit_event() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare row_data jsonb; tenant uuid; entity uuid;
begin
 row_data := case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 tenant := (row_data->>'company_id')::uuid; entity := nullif(row_data->>'id','')::uuid;
 insert into public.audit_events(company_id,actor_id,action,entity_type,entity_id,old_data,new_data,request_id)
 values(tenant,auth.uid(),lower(tg_op),tg_table_name,entity,case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end,current_setting('request.headers',true)::jsonb->>'x-request-id');
 return coalesce(new,old);
end $$;
do $$ declare t text; begin foreach t in array array['projects','source_documents','spec_items','suppliers','supplier_quotes','quote_lines','line_matches','award_decisions','proposals','proposal_versions','actual_costs'] loop execute format('create trigger audit_%I after insert or update or delete on public.%I for each row execute function public.record_audit_event()',t,t); end loop; end $$;

create or replace function public.create_company_workspace(company_name text, currency text default 'KZT') returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$ declare company uuid; begin
 if auth.uid() is null then raise exception 'authentication required'; end if;
 if currency !~ '^[A-Z]{3}$' then raise exception 'invalid ISO currency'; end if;
 insert into public.companies(name,base_currency,created_by) values(trim(company_name),upper(currency),auth.uid()) returning id into company;
 insert into public.company_memberships(company_id,user_id,role) values(company,auth.uid(),'owner');
 insert into public.user_profiles(user_id) values(auth.uid()) on conflict do nothing;
 return company;
end $$;
revoke all on function public.create_company_workspace(text,text) from public;
grant execute on function public.create_company_workspace(text,text) to authenticated;

alter table public.companies enable row level security;
alter table public.user_profiles enable row level security;
alter table public.company_memberships enable row level security;
do $$ declare t text; begin foreach t in array array['projects','source_documents','extraction_runs','extracted_drafts','spec_items','suppliers','supplier_quotes','quote_lines','line_matches','comparison_snapshots','comparison_cells','award_decisions','proposals','proposal_versions','actual_costs','background_jobs','audit_events'] loop execute format('alter table public.%I enable row level security',t); end loop; end $$;

create policy companies_select on public.companies for select to authenticated using(public.is_company_member(id));
create policy companies_update on public.companies for update to authenticated using(public.has_company_role(id,array['owner','admin']::public.company_role[])) with check(public.has_company_role(id,array['owner','admin']::public.company_role[]));
create policy profiles_self_select on public.user_profiles for select to authenticated using(user_id=auth.uid());
create policy profiles_self_update on public.user_profiles for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy memberships_select on public.company_memberships for select to authenticated using(public.is_company_member(company_id));
create policy memberships_manage on public.company_memberships for all to authenticated using(public.has_company_role(company_id,array['owner','admin']::public.company_role[])) with check(public.has_company_role(company_id,array['owner','admin']::public.company_role[]));

do $$ declare t text; begin foreach t in array array['projects','source_documents','extraction_runs','extracted_drafts','spec_items','suppliers','supplier_quotes','quote_lines','line_matches','comparison_snapshots','comparison_cells','award_decisions','proposals','proposal_versions','actual_costs','background_jobs'] loop
 execute format('create policy tenant_select on public.%I for select to authenticated using(public.is_company_member(company_id))',t);
 execute format('create policy tenant_insert on public.%I for insert to authenticated with check(public.has_company_role(company_id,array[''owner'',''admin'',''estimator'']::public.company_role[]))',t);
 execute format('create policy tenant_update on public.%I for update to authenticated using(public.has_company_role(company_id,array[''owner'',''admin'',''estimator'']::public.company_role[])) with check(public.has_company_role(company_id,array[''owner'',''admin'',''estimator'']::public.company_role[]))',t);
 execute format('create policy tenant_delete on public.%I for delete to authenticated using(public.has_company_role(company_id,array[''owner'',''admin'',''estimator'']::public.company_role[]))',t);
 end loop; end $$;
create policy audit_select on public.audit_events for select to authenticated using(public.is_company_member(company_id));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
 ('source-documents','source-documents',false,52428800,array['application/pdf','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']),
 ('generated-exports','generated-exports',false,52428800,array['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create policy storage_tenant_read on storage.objects for select to authenticated using(bucket_id in ('source-documents','generated-exports') and public.is_company_member((storage.foldername(name))[1]::uuid));
create policy storage_tenant_insert on storage.objects for insert to authenticated with check(bucket_id in ('source-documents','generated-exports') and public.is_company_member((storage.foldername(name))[1]::uuid));
create policy storage_tenant_delete on storage.objects for delete to authenticated using(bucket_id in ('source-documents','generated-exports') and public.has_company_role((storage.foldername(name))[1]::uuid,array['owner','admin','estimator']::public.company_role[]));

grant usage on schema public to authenticated;
grant select,insert,update,delete on all tables in schema public to authenticated;
grant usage,select on all sequences in schema public to authenticated;
