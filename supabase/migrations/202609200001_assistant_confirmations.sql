-- Durable, user-scoped approval records for destructive and bulk assistant tools.
create table public.assistant_confirmations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete cascade,
  tool_name text not null,
  arguments jsonb not null,
  summary text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  consumed_at timestamptz,
  unique(company_id, id)
);

alter table public.assistant_confirmations enable row level security;
create policy assistant_confirmations_select on public.assistant_confirmations for select to authenticated
  using(actor_id = auth.uid() and public.is_company_member(company_id));
create policy assistant_confirmations_insert on public.assistant_confirmations for insert to authenticated
  with check(actor_id = auth.uid() and public.has_company_role(company_id,array['owner','admin','estimator']::public.company_role[]));
create policy assistant_confirmations_update on public.assistant_confirmations for update to authenticated
  using(actor_id = auth.uid() and public.has_company_role(company_id,array['owner','admin','estimator']::public.company_role[]))
  with check(actor_id = auth.uid() and public.has_company_role(company_id,array['owner','admin','estimator']::public.company_role[]));

grant select,insert,update on public.assistant_confirmations to authenticated;
