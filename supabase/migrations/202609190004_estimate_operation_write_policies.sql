-- RPCs run as the authenticated user. Allow only self-owned operation records
-- inside a writable company; row data remains protected by spec_items RLS.
create policy estimate_operations_insert on public.estimate_operations for insert to authenticated
  with check (
    actor_id = auth.uid()
    and public.has_company_role(company_id, array['owner','admin','estimator']::public.company_role[])
  );

create policy estimate_operations_update on public.estimate_operations for update to authenticated
  using (
    actor_id = auth.uid()
    and public.has_company_role(company_id, array['owner','admin','estimator']::public.company_role[])
  )
  with check (
    actor_id = auth.uid()
    and public.has_company_role(company_id, array['owner','admin','estimator']::public.company_role[])
  );

grant insert, update on public.estimate_operations to authenticated;
