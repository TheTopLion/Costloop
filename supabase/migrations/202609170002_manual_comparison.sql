-- Publish manual bid comparisons and awards atomically from canonical database inputs.

create unique index comparison_cells_one_supplier_per_spec
  on public.comparison_cells(snapshot_id, spec_item_id, supplier_id);

create or replace function public.manual_unit_key(value text)
returns text language sql immutable parallel safe as $$
  select case lower(trim(coalesce(value,'')))
    when 'kg' then 'kg' when 'kilogram' then 'kg' when 'kilograms' then 'kg'
    when 't' then 'kg' when 'tonne' then 'kg' when 'tonnes' then 'kg' when 'metric ton' then 'kg' when 'metric tons' then 'kg'
    when 'g' then 'kg' when 'gram' then 'kg' when 'grams' then 'kg'
    when 'ea' then 'each' when 'each' then 'each' when 'pc' then 'each' when 'pcs' then 'each' when 'piece' then 'each' when 'pieces' then 'each'
    when 'h' then 'hour' when 'hr' then 'hour' when 'hrs' then 'hour' when 'hour' then 'hour' when 'hours' then 'hour'
    when 'm' then 'm' when 'meter' then 'm' when 'meters' then 'm' when 'metre' then 'm' when 'metres' then 'm'
    when 'l' then 'l' when 'liter' then 'l' when 'liters' then 'l' when 'litre' then 'l' when 'litres' then 'l'
    else null end
$$;

create or replace function public.manual_unit_factor(value text)
returns numeric language sql immutable parallel safe as $$
  select case lower(trim(coalesce(value,'')))
    when 't' then 1000::numeric when 'tonne' then 1000::numeric when 'tonnes' then 1000::numeric
    when 'metric ton' then 1000::numeric when 'metric tons' then 1000::numeric
    when 'g' then 0.001::numeric when 'gram' then 0.001::numeric when 'grams' then 0.001::numeric
    when 'kg' then 1::numeric when 'kilogram' then 1::numeric when 'kilograms' then 1::numeric
    when 'ea' then 1::numeric when 'each' then 1::numeric when 'pc' then 1::numeric when 'pcs' then 1::numeric when 'piece' then 1::numeric when 'pieces' then 1::numeric
    when 'h' then 1::numeric when 'hr' then 1::numeric when 'hrs' then 1::numeric when 'hour' then 1::numeric when 'hours' then 1::numeric
    when 'm' then 1::numeric when 'meter' then 1::numeric when 'meters' then 1::numeric when 'metre' then 1::numeric when 'metres' then 1::numeric
    when 'l' then 1::numeric when 'liter' then 1::numeric when 'liters' then 1::numeric when 'litre' then 1::numeric when 'litres' then 1::numeric
    else null end
$$;

create or replace function public.manual_description_key(value text)
returns text language sql immutable parallel safe as $$
  select nullif(regexp_replace(lower(trim(coalesce(value,''))), '\s+', ' ', 'g'),'')
$$;

create or replace function public.save_manual_rate(
  target_project uuid,
  source_currency text,
  conversion_rate numeric,
  rate_source text
) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare tenant uuid; base text; next_version integer; result uuid; source_code text;
begin
  select company_id,currency into tenant,base from public.projects where id=target_project;
  if tenant is null then raise exception using errcode='P0002', message='project not found'; end if;
  if not public.has_company_role(tenant,array['owner','admin','estimator']::public.company_role[]) then
    raise exception using errcode='42501', message='estimator permission required';
  end if;
  source_code := upper(trim(coalesce(source_currency,'')));
  if source_code !~ '^[A-Z]{3}$' then raise exception using errcode='22023', message='invalid source currency'; end if;
  if source_code=base then raise exception using errcode='22023', message='source currency must differ from project currency'; end if;
  if conversion_rate is null or conversion_rate<=0 then raise exception using errcode='22023', message='conversion rate must be positive'; end if;
  if nullif(trim(rate_source),'') is null then raise exception using errcode='22023', message='rate source is required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(target_project::text || ':' || source_code,0));
  select coalesce(max(version),0)+1 into next_version from public.exchange_rates
    where project_id=target_project and from_currency=source_code and to_currency=base;
  insert into public.exchange_rates(company_id,project_id,from_currency,to_currency,rate,effective_on,source,version,created_by)
  values(tenant,target_project,source_code,base,conversion_rate,current_date,trim(rate_source),next_version,auth.uid()) returning id into result;
  return result;
end $$;

create or replace function public.publish_manual_comparison(target_project uuid)
returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare tenant uuid; base text; snapshot_id uuid; next_version integer; rate_inputs jsonb;
begin
  select company_id,currency into tenant,base from public.projects where id=target_project for update;
  if tenant is null then raise exception using errcode='P0002', message='project not found'; end if;
  if not public.has_company_role(tenant,array['owner','admin','estimator']::public.company_role[]) then
    raise exception using errcode='42501', message='estimator permission required';
  end if;
  if not exists(select 1 from public.spec_items where company_id=tenant and project_id=target_project) then
    raise exception using errcode='22023', message='comparison requires specification items';
  end if;
  if not exists(select 1 from public.supplier_quotes where company_id=tenant and project_id=target_project and status='confirmed') then
    raise exception using errcode='22023', message='comparison requires confirmed supplier quotes';
  end if;
  if exists(select 1 from public.supplier_quotes where company_id=tenant and project_id=target_project and status='confirmed' group by supplier_id having count(*)>1) then
    raise exception using errcode='22023', message='a supplier has multiple confirmed quotes; select one explicitly';
  end if;
  if exists(select 1 from public.spec_items where company_id=tenant and project_id=target_project and (quantity is null or quantity<0 or nullif(trim(unit),'') is null or public.manual_description_key(description) is null)) then
    raise exception using errcode='22023', message='specification quantity, unit and description are required';
  end if;

  -- Never choose an arbitrary quote line: position is authoritative when supplied;
  -- otherwise an exact, whitespace-normalized technical description must be unique.
  if exists(
    select 1
    from public.spec_items s
    cross join public.supplier_quotes q
    where s.company_id=tenant and s.project_id=target_project and q.company_id=tenant and q.project_id=target_project and q.status='confirmed'
      and (select count(*) from public.quote_lines l where l.company_id=tenant and l.quote_id=q.id and (
        (nullif(trim(s.position),'') is not null and trim(l.position)=trim(s.position)) or
        (nullif(trim(s.position),'') is null and public.manual_description_key(l.raw_description)=public.manual_description_key(s.description))
      )) > 1
  ) then raise exception using errcode='22023', message='ambiguous quote lines; positions or descriptions must uniquely identify a line'; end if;

  -- A foreign-currency price is publishable only with an explicit project rate.
  if exists(
    select 1
    from public.spec_items s cross join public.supplier_quotes q
    join lateral (
      select l.* from public.quote_lines l where l.company_id=tenant and l.quote_id=q.id and (
        (nullif(trim(s.position),'') is not null and trim(l.position)=trim(s.position)) or
        (nullif(trim(s.position),'') is null and public.manual_description_key(l.raw_description)=public.manual_description_key(s.description))
      ) limit 1
    ) l on true
    where s.company_id=tenant and s.project_id=target_project and q.company_id=tenant and q.project_id=target_project and q.status='confirmed'
      and coalesce(l.raw_currency,q.currency)<>base
      and not exists(select 1 from public.exchange_rates r where r.company_id=tenant and r.project_id=target_project and r.from_currency=coalesce(l.raw_currency,q.currency) and r.to_currency=base)
  ) then raise exception using errcode='22023', message='missing explicit project exchange rate'; end if;

  perform pg_advisory_xact_lock(hashtextextended(target_project::text || ':comparison',0));
  select coalesce(max(version),0)+1 into next_version from public.comparison_snapshots where project_id=target_project;
  select coalesce(jsonb_object_agg(from_currency, details),'{}'::jsonb) into rate_inputs from (
    select distinct on (from_currency) from_currency,
      jsonb_build_object('to_currency',to_currency,'rate',rate::text,'effective_on',effective_on::text,'version',version::text,'source',source) details
    from public.exchange_rates where company_id=tenant and project_id=target_project and to_currency=base
    order by from_currency,effective_on desc,version desc,created_at desc,id desc
  ) latest;
  insert into public.comparison_snapshots(company_id,project_id,version,normalization_version,matching_version,exchange_rates,base_currency,created_by)
  values(tenant,target_project,next_version,'manual-units-v1','position-or-exact-description-v1',rate_inputs,base,auth.uid()) returning id into snapshot_id;

  insert into public.comparison_snapshot_rates(company_id,snapshot_id,exchange_rate_id)
  select tenant,snapshot_id,id from (
    select distinct on (from_currency) id,from_currency
    from public.exchange_rates where company_id=tenant and project_id=target_project and to_currency=base
    order by from_currency,effective_on desc,version desc,created_at desc,id desc
  ) latest;

  with candidates as (
    select s.id spec_id,s.quantity spec_qty,s.unit spec_unit,q.supplier_id,q.id quote_id,
      l.id line_id,l.raw_quantity,l.raw_unit,l.raw_unit_price,coalesce(l.raw_currency,q.currency) line_currency,
      public.manual_unit_key(s.unit) spec_key,public.manual_unit_key(l.raw_unit) line_key,
      public.manual_unit_factor(s.unit) spec_factor,public.manual_unit_factor(l.raw_unit) line_factor,
      case when coalesce(l.raw_currency,q.currency)=base then 1::numeric else fx.rate end fx_rate,
      fx.id fx_id
    from public.spec_items s
    cross join public.supplier_quotes q
    left join lateral (
      select candidate.* from public.quote_lines candidate where candidate.company_id=tenant and candidate.quote_id=q.id and (
        (nullif(trim(s.position),'') is not null and trim(candidate.position)=trim(s.position)) or
        (nullif(trim(s.position),'') is null and public.manual_description_key(candidate.raw_description)=public.manual_description_key(s.description))
      ) limit 1
    ) l on true
    left join lateral (
      select r.id,r.rate from public.exchange_rates r where r.company_id=tenant and r.project_id=target_project
        and r.from_currency=coalesce(l.raw_currency,q.currency) and r.to_currency=base
      order by r.effective_on desc,r.version desc,r.created_at desc,r.id desc limit 1
    ) fx on true
    where s.company_id=tenant and s.project_id=target_project and q.company_id=tenant and q.project_id=target_project and q.status='confirmed'
  ), amounts as (
    select *,
      case when line_id is not null and raw_unit_price is not null and spec_factor is not null and line_factor is not null and spec_key=line_key and fx_rate is not null
        then round((spec_qty*spec_factor/line_factor)*raw_unit_price,8) end raw_required_amount,
      case when line_id is not null and raw_unit_price is not null and spec_factor is not null and line_factor is not null and spec_key=line_key and fx_rate is not null
        then round((spec_qty*spec_factor/line_factor)*raw_unit_price*fx_rate,8) end evaluated,
      case when line_id is null then 'missing_bid'
        when raw_unit_price is null then 'pending price'
        when spec_key is null or line_key is null then 'unit is not supported'
        when spec_key<>line_key then 'units are not dimensionally comparable'
        when fx_rate is null then 'exchange rate is missing'
        else null end reason
    from candidates
  ), ranked as (
    select *,min(evaluated) filter(where evaluated is not null) over(partition by spec_id) cheapest
    from amounts
  )
  insert into public.comparison_cells(company_id,snapshot_id,spec_item_id,quote_line_id,supplier_id,raw_amount,raw_currency,normalized_amount,normalized_currency,currency_conversion,quantity_conversion,evaluated_amount,warnings,exclusions,comparable,state,state_reason)
  select tenant,snapshot_id,spec_id,line_id,supplier_id,raw_required_amount,line_currency,evaluated,base,
    case when line_id is null then null else jsonb_build_object('from',line_currency,'to',base,'rate',coalesce(fx_rate,0)::text,'exchange_rate_id',fx_id::text) end,
    case when line_id is null then null else jsonb_build_object('requested_quantity',spec_qty::text,'requested_unit',spec_unit,'quoted_quantity',raw_quantity::text,'quoted_unit',raw_unit,'raw_unit_price',raw_unit_price::text,'spec_factor',coalesce(spec_factor,0)::text,'quote_factor',coalesce(line_factor,0)::text) end,
    evaluated,
    case
      when evaluated is null then jsonb_build_array(jsonb_build_object('code',replace(reason,' ','_'),'message',reason))
      when evaluated=cheapest then jsonb_build_array(jsonb_build_object('code','cheapest_offer','message','Lowest comparable evaluated amount'))
      when cheapest=0 then '[]'::jsonb
      else jsonb_build_array(jsonb_build_object('code','spread_from_cheapest','percent',round(((evaluated-cheapest)/cheapest)*100,4)::text)) end,
    case when evaluated is null and line_id is not null then jsonb_build_array(jsonb_build_object('reason',reason)) else '[]'::jsonb end,
    evaluated is not null,
    case when line_id is null or raw_unit_price is null then 'missing_bid'::public.comparison_cell_state when evaluated is null then 'non_comparable'::public.comparison_cell_state else 'comparable'::public.comparison_cell_state end,
    reason
  from ranked;
  return snapshot_id;
end $$;

create or replace function public.set_manual_award(
  target_project uuid,
  target_snapshot uuid,
  target_spec uuid,
  target_supplier uuid
) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare tenant uuid; result uuid; selected_line uuid; selected_quote uuid; spec_count bigint; comparable_count bigint;
begin
  select company_id into tenant from public.projects where id=target_project for update;
  if tenant is null then raise exception using errcode='P0002', message='project not found'; end if;
  if not public.has_company_role(tenant,array['owner','admin','estimator']::public.company_role[]) then
    raise exception using errcode='42501', message='estimator permission required';
  end if;
  if not exists(select 1 from public.comparison_snapshots where id=target_snapshot and company_id=tenant and project_id=target_project) then
    raise exception using errcode='22023', message='snapshot does not belong to project';
  end if;
  if target_spec is not null then
    select c.quote_line_id,l.quote_id into selected_line,selected_quote
      from public.comparison_cells c join public.quote_lines l on l.company_id=c.company_id and l.id=c.quote_line_id
      where c.company_id=tenant and c.snapshot_id=target_snapshot and c.spec_item_id=target_spec and c.supplier_id=target_supplier and c.state='comparable';
    if selected_line is null then raise exception using errcode='22023', message='selected supplier has no comparable bid for specification item'; end if;
    delete from public.award_decisions where company_id=tenant and project_id=target_project and (scope='quote' or (scope='line' and spec_item_id=target_spec));
    insert into public.award_decisions(company_id,project_id,snapshot_id,spec_item_id,supplier_id,quote_line_id,scope,decided_by)
    values(tenant,target_project,target_snapshot,target_spec,target_supplier,selected_line,'line',auth.uid()) returning id into result;
  else
    select count(*) into spec_count from public.spec_items where company_id=tenant and project_id=target_project;
    select count(*),(array_agg(l.quote_id))[1] into comparable_count,selected_quote
      from public.comparison_cells c join public.quote_lines l on l.company_id=c.company_id and l.id=c.quote_line_id
      where c.company_id=tenant and c.snapshot_id=target_snapshot and c.supplier_id=target_supplier and c.state='comparable';
    if comparable_count<>spec_count or (select count(distinct l.quote_id) from public.comparison_cells c join public.quote_lines l on l.company_id=c.company_id and l.id=c.quote_line_id where c.company_id=tenant and c.snapshot_id=target_snapshot and c.supplier_id=target_supplier and c.state='comparable')<>1 then
      raise exception using errcode='22023', message='whole-quote award requires one comparable quote covering every specification item';
    end if;
    delete from public.award_decisions where company_id=tenant and project_id=target_project;
    insert into public.award_decisions(company_id,project_id,snapshot_id,supplier_id,quote_id,scope,decided_by)
    values(tenant,target_project,target_snapshot,target_supplier,selected_quote,'quote',auth.uid()) returning id into result;
  end if;
  return result;
end $$;

revoke all on function public.manual_unit_key(text),public.manual_unit_factor(text),public.manual_description_key(text) from public;
revoke all on function public.save_manual_rate(uuid,text,numeric,text),public.publish_manual_comparison(uuid),public.set_manual_award(uuid,uuid,uuid,uuid) from public;
grant execute on function public.save_manual_rate(uuid,text,numeric,text),public.publish_manual_comparison(uuid),public.set_manual_award(uuid,uuid,uuid,uuid) to authenticated;
