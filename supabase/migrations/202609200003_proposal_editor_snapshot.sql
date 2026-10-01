-- Stage 05 proposal metadata and client-facing prices are calculated and frozen
-- in PostgreSQL. The exporter receives no supplier identifiers or source costs.
create or replace function public.create_awarded_proposal_v2(
  target_project uuid,
  proposal_reference text,
  markup_percent numeric,
  tax_percent numeric,
  validity_days integer,
  proposal_notes text,
  proposal_terms text
) returns uuid language plpgsql security invoker set search_path=public,pg_temp as $$
declare
  p public.projects; proposal_row public.proposals; version_id uuid;
  items jsonb; expected_count integer; actual_count integer; distinct_count integer;
  base numeric; markup numeric; client_subtotal numeric; tax numeric; version_number integer;
begin
  select * into p from public.projects where id=target_project for update;
  if p.id is null or not public.has_company_role(p.company_id,array['owner','admin','estimator']::public.company_role[]) then
    raise exception using errcode='42501', message='Project access required';
  end if;
  if proposal_reference is null or length(trim(proposal_reference)) not between 1 and 160
    or markup_percent is null or tax_percent is null or markup_percent < 0 or tax_percent < 0
    or markup_percent::text in ('NaN','Infinity','-Infinity') or tax_percent::text in ('NaN','Infinity','-Infinity')
    or validity_days is null or validity_days not between 0 and 3650
    or length(coalesce(proposal_notes,'')) > 8000 or length(coalesce(proposal_terms,'')) > 8000 then
    raise exception using errcode='23514', message='Invalid proposal commercial inputs';
  end if;
  if exists(select 1 from public.award_decisions where project_id=p.id and scope='quote')
    and exists(select 1 from public.award_decisions where project_id=p.id and scope='line') then
    raise exception using errcode='23514', message='Resolve mixed whole-quote and line awards first';
  end if;
  select count(*) into expected_count from public.spec_items where project_id=p.id;
  select count(*),count(distinct s.id),sum(c.evaluated_amount),jsonb_agg(jsonb_build_object(
    'spec_item_id',s.id,'position',s.position,'description',s.description,'quantity',s.quantity::text,'unit',s.unit,
    'award_id',a.id,'snapshot_id',a.snapshot_id,'cell_id',c.id,'quote_line_id',c.quote_line_id,
    'supplier_id',c.supplier_id,'source_cost',c.evaluated_amount::text,
    'client_unit_price',case when s.quantity>0 then round(c.evaluated_amount*(1+markup_percent/100)/s.quantity,8)::text end,
    'client_line_total',round(c.evaluated_amount*(1+markup_percent/100),8)::text,
    'raw_amount',c.raw_amount::text,'raw_currency',c.raw_currency,
    'currency_conversion',c.currency_conversion,'quantity_conversion',c.quantity_conversion,
    'commercial_adjustments',c.commercial_adjustments,'exchange_rates',snap.exchange_rates
  ) order by s.sort_order,s.id)
  into actual_count,distinct_count,base,items
  from public.spec_items s
  join public.award_decisions a on a.project_id=s.project_id and (a.scope='quote' or a.spec_item_id=s.id)
  join public.comparison_snapshots snap on snap.id=a.snapshot_id and snap.base_currency=p.currency
  join public.comparison_cells c on c.snapshot_id=a.snapshot_id and c.spec_item_id=s.id
    and c.supplier_id=a.supplier_id and (a.scope='quote' or c.quote_line_id=a.quote_line_id)
  join public.quote_lines l on l.id=c.quote_line_id and (a.scope='line' or l.quote_id=a.quote_id)
  where s.project_id=p.id and c.state='comparable' and c.comparable
    and c.normalized_currency=p.currency and c.evaluated_amount>=0;
  if expected_count=0 or actual_count<>expected_count or distinct_count<>expected_count then
    raise exception using errcode='23514', message='Select exactly one comparable winner for every specification line';
  end if;
  base := round(base,8);
  markup := round(base*markup_percent/100,8);
  client_subtotal := base+markup;
  tax := round(client_subtotal*tax_percent/100,8);
  select * into proposal_row from public.proposals
    where company_id=p.company_id and proposal_number=trim(proposal_reference) for update;
  if proposal_row.id is null then
    insert into public.proposals(company_id,project_id,proposal_number,currency)
    values(p.company_id,p.id,trim(proposal_reference),p.currency) returning * into proposal_row;
  elsif proposal_row.project_id<>p.id or proposal_row.currency<>p.currency or proposal_row.status<>'draft' then
    raise exception using errcode='23514', message='Proposal must be a draft for this project and currency';
  end if;
  select coalesce(max(version),0)+1 into version_number from public.proposal_versions where proposal_id=proposal_row.id;
  insert into public.proposal_versions(company_id,proposal_id,version,subtotal,markup_amount,tax_amount,
    grand_total,calculation_snapshot,generator_version)
  values(p.company_id,proposal_row.id,version_number,base,markup,tax,client_subtotal+tax,
    jsonb_build_object('lines',items,'currency',p.currency,'markup_percent',markup_percent::text,
      'tax_percent',tax_percent::text,'client_subtotal',client_subtotal::text,
      'validity_days',validity_days,'notes',coalesce(proposal_notes,''),
      'commercial_terms',coalesce(proposal_terms,''),'rounding','numeric:8:half-away-from-zero'),
    'awarded-proposal-v3') returning id into version_id;
  return version_id;
end $$;

revoke all on function public.create_awarded_proposal_v2(uuid,text,numeric,numeric,integer,text,text) from public;
grant execute on function public.create_awarded_proposal_v2(uuid,text,numeric,numeric,integer,text,text) to authenticated;
