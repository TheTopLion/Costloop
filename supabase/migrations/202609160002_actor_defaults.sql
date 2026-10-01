-- PostgREST mutations should record the authenticated actor even when a client
-- omits the column. Service-role jobs have no auth.uid() and must remain explicit.
alter table public.companies alter column created_by set default auth.uid();
alter table public.projects alter column created_by set default auth.uid();
alter table public.source_documents alter column uploaded_by set default auth.uid();
alter table public.extraction_runs alter column created_by set default auth.uid();
alter table public.spec_items alter column created_by set default auth.uid();
alter table public.suppliers alter column created_by set default auth.uid();
alter table public.supplier_quotes alter column created_by set default auth.uid();
alter table public.comparison_snapshots alter column created_by set default auth.uid();
alter table public.proposals alter column created_by set default auth.uid();
alter table public.proposal_versions alter column created_by set default auth.uid();
