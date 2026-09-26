alter table public.stock
  add column if not exists average_unit_cost numeric(14, 4) check (average_unit_cost >= 0);
alter table public.stock
  add column if not exists inventory_value numeric(18, 4)
  generated always as (case when average_unit_cost is null then null else round(quantity * average_unit_cost, 4) end) stored;
alter table public.operation_items
  add column if not exists unit_cost numeric(14, 4) check (unit_cost >= 0);
alter table public.stock_ledger
  add column if not exists unit_cost numeric(14, 4) check (unit_cost >= 0);
alter table public.stock_ledger
  add column if not exists value_change numeric(18, 4);

drop function if exists public.create_product_with_stock(text, text, uuid, text, numeric, numeric, uuid, uuid);
create function public.create_product_with_stock(
  p_name text, p_sku text, p_category_id uuid, p_unit text, p_reorder_level numeric,
  p_initial_stock numeric, p_initial_unit_cost numeric, p_location_id uuid, p_user_id uuid
)
returns uuid language plpgsql security definer set search_path = public as $$
declare new_product_id uuid;
begin
  if p_initial_stock < 0 then raise exception 'Initial stock cannot be negative'; end if;
  if p_initial_unit_cost < 0 then raise exception 'Initial unit cost cannot be negative'; end if;
  if p_initial_stock > 0 and p_location_id is null then raise exception 'A location is required for initial stock'; end if;
  insert into public.products(name, sku, category_id, unit, reorder_level)
  values (p_name, p_sku, p_category_id, p_unit, p_reorder_level) returning id into new_product_id;
  if p_initial_stock > 0 then
    insert into public.stock(product_id, location_id, quantity, average_unit_cost)
    values (new_product_id, p_location_id, p_initial_stock, p_initial_unit_cost);
    insert into public.stock_ledger(product_id, location_id, type, quantity_change, quantity_before,
      quantity_after, unit_cost, value_change, destination_location_id, created_by)
    values (new_product_id, p_location_id, 'INITIAL', p_initial_stock, 0, p_initial_stock,
      p_initial_unit_cost, case when p_initial_unit_cost is null then null else round(p_initial_stock * p_initial_unit_cost, 4) end,
      p_location_id, p_user_id);
  end if;
  return new_product_id;
end;
$$;

create or replace function public.create_inventory_operation(p_user_id uuid, p_type text, p_data jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare new_operation_id uuid;
begin
  if p_type not in ('RECEIPT','DELIVERY','TRANSFER','ADJUSTMENT') then raise exception 'Unsupported operation type'; end if;
  if coalesce(jsonb_typeof(p_data->'items'), '') <> 'array' or jsonb_array_length(p_data->'items') = 0 then
    raise exception 'At least one operation item is required';
  end if;
  insert into public.operations(type, status, supplier, customer, source_location_id, destination_location_id, created_by)
  values (p_type, 'READY', p_data->>'supplier', p_data->>'customer',
    nullif(p_data->>'sourceLocationId','')::uuid, nullif(p_data->>'destinationLocationId','')::uuid, p_user_id)
  returning id into new_operation_id;
  insert into public.operation_items(operation_id, product_id, quantity, counted_quantity, unit_cost)
  select new_operation_id, (item->>'productId')::uuid,
    case when p_type = 'ADJUSTMENT' then (item->>'countedQuantity')::numeric else (item->>'quantity')::numeric end,
    case when p_type = 'ADJUSTMENT' then (item->>'countedQuantity')::numeric else null end,
    case when p_type = 'RECEIPT' then (item->>'unitCost')::numeric else null end
  from jsonb_array_elements(p_data->'items') item;
  if p_type <> 'ADJUSTMENT' and exists (
    select 1 from public.operation_items where operation_id = new_operation_id and quantity <= 0
  ) then raise exception 'Operation quantities must be positive'; end if;
  if p_type = 'RECEIPT' and exists (
    select 1 from public.operation_items where operation_id = new_operation_id and unit_cost is null
  ) then raise exception 'Every receipt item needs a unitCost'; end if;
  return new_operation_id;
end;
$$;

create or replace function public.validate_inventory_operation(p_operation_id uuid, p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  op public.operations%rowtype;
  item record;
  movement_location uuid;
  location_to_lock uuid;
  stock_before numeric;
  stock_after numeric;
  source_before numeric;
  destination_before numeric;
  source_cost numeric;
  destination_cost numeric;
  movement_cost numeric;
  next_average_cost numeric;
  movement_value numeric;
begin
  select * into op from public.operations where id = p_operation_id for update;
  if not found then raise exception 'Operation not found'; end if;
  if op.created_by <> p_user_id then raise exception 'Operation does not belong to this user'; end if;
  if op.status <> 'READY' then raise exception 'Only READY operations can be validated'; end if;
  if op.type in ('RECEIPT','ADJUSTMENT') and op.destination_location_id is null then raise exception 'A destination location is required'; end if;
  if op.type in ('DELIVERY','TRANSFER') and op.source_location_id is null then raise exception 'A source location is required'; end if;
  if op.type = 'TRANSFER' and op.source_location_id = op.destination_location_id then raise exception 'Transfer locations must differ'; end if;

  for item in select * from public.operation_items where operation_id = op.id order by product_id loop
    if op.type = 'TRANSFER' then
      for location_to_lock in
        select id from public.locations where id in (op.source_location_id, op.destination_location_id) order by id
      loop
        insert into public.stock(product_id, location_id, quantity) values (item.product_id, location_to_lock, 0)
          on conflict (product_id, location_id) do nothing;
        perform 1 from public.stock where product_id = item.product_id and location_id = location_to_lock for update;
      end loop;
      select quantity, average_unit_cost into source_before, source_cost from public.stock
        where product_id = item.product_id and location_id = op.source_location_id;
      select quantity, average_unit_cost into destination_before, destination_cost from public.stock
        where product_id = item.product_id and location_id = op.destination_location_id;
      if source_before < item.quantity then raise exception 'Insufficient stock for product %', item.product_id; end if;
      movement_cost := source_cost;
      movement_value := case when movement_cost is null then null else round(item.quantity * movement_cost, 4) end;
      if destination_before = 0 then
        next_average_cost := source_cost;
      elsif destination_cost is null or source_cost is null then
        next_average_cost := null;
      else
        next_average_cost := round(((destination_before * destination_cost) + (item.quantity * source_cost)) /
          (destination_before + item.quantity), 4);
      end if;
      update public.stock set quantity = source_before - item.quantity
        where product_id = item.product_id and location_id = op.source_location_id;
      update public.stock set quantity = destination_before + item.quantity, average_unit_cost = next_average_cost
        where product_id = item.product_id and location_id = op.destination_location_id;
      insert into public.stock_ledger(product_id, location_id, operation_id, type, quantity_change,
        quantity_before, quantity_after, unit_cost, value_change, source_location_id, destination_location_id, created_by)
      values (item.product_id, op.source_location_id, op.id, 'TRANSFER_OUT', -item.quantity,
        source_before, source_before - item.quantity, movement_cost, -movement_value,
        op.source_location_id, op.destination_location_id, p_user_id),
        (item.product_id, op.destination_location_id, op.id, 'TRANSFER_IN', item.quantity,
        destination_before, destination_before + item.quantity, movement_cost, movement_value,
        op.source_location_id, op.destination_location_id, p_user_id);
    else
      movement_location := case when op.type in ('RECEIPT','ADJUSTMENT') then op.destination_location_id else op.source_location_id end;
      insert into public.stock(product_id, location_id, quantity) values (item.product_id, movement_location, 0)
        on conflict (product_id, location_id) do nothing;
      select quantity, average_unit_cost into stock_before, movement_cost from public.stock
        where product_id = item.product_id and location_id = movement_location for update;
      if op.type = 'RECEIPT' then
        if item.unit_cost is null or item.unit_cost < 0 then raise exception 'Receipt unit cost is required and cannot be negative'; end if;
        stock_after := stock_before + item.quantity;
        if stock_before = 0 then
          next_average_cost := item.unit_cost;
        elsif movement_cost is null then
          next_average_cost := null;
        else
          next_average_cost := round(((stock_before * movement_cost) + (item.quantity * item.unit_cost)) / stock_after, 4);
        end if;
        movement_cost := item.unit_cost;
        movement_value := round(item.quantity * item.unit_cost, 4);
      elsif op.type = 'DELIVERY' then
        if item.quantity > stock_before then raise exception 'Insufficient stock for product %', item.product_id; end if;
        stock_after := stock_before - item.quantity;
        next_average_cost := movement_cost;
        movement_value := case when movement_cost is null then null else round(item.quantity * movement_cost, 4) end;
      else
        stock_after := item.counted_quantity;
        next_average_cost := movement_cost;
        movement_value := case when movement_cost is null then null else round((stock_after - stock_before) * movement_cost, 4) end;
      end if;
      update public.stock set quantity = stock_after, average_unit_cost = next_average_cost
        where product_id = item.product_id and location_id = movement_location;
      insert into public.stock_ledger(product_id, location_id, operation_id, type, quantity_change,
        quantity_before, quantity_after, unit_cost, value_change, source_location_id, destination_location_id, created_by)
      values (item.product_id, movement_location, op.id, op.type, stock_after - stock_before,
        stock_before, stock_after, movement_cost,
        case when op.type = 'DELIVERY' then -movement_value else movement_value end,
        op.source_location_id, op.destination_location_id, p_user_id);
    end if;
  end loop;
  update public.operations set status = 'DONE', validated_at = now() where id = op.id;
  return jsonb_build_object('success', true, 'operationId', op.id, 'status', 'DONE');
end;
$$;

create or replace function public.approve_ai_recommendation(p_recommendation_id uuid, p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  rec public.ai_recommendations%rowtype;
  new_operation_id uuid;
  validation_result jsonb;
begin
  select * into rec from public.ai_recommendations where id = p_recommendation_id for update;
  if not found then raise exception 'Recommendation not found'; end if;
  if rec.status <> 'DRAFT' then raise exception 'Only DRAFT recommendations can be approved'; end if;
  if rec.type = 'TRANSFER' then
    insert into public.operations(type, status, source_location_id, destination_location_id, created_by)
    values ('TRANSFER', 'READY', (rec.parameters->>'sourceLocationId')::uuid,
      (rec.parameters->>'destinationLocationId')::uuid, p_user_id) returning id into new_operation_id;
    insert into public.operation_items(operation_id, product_id, quantity)
    select new_operation_id, (item->>'productId')::uuid, (item->>'quantity')::numeric
    from jsonb_array_elements(rec.parameters->'items') item;
  elsif rec.type = 'REORDER' then
    if rec.parameters->>'unitCost' is null then raise exception 'Reorder draft has no evidence-based unit cost'; end if;
    insert into public.operations(type, status, supplier, destination_location_id, created_by)
    values ('RECEIPT', 'READY', 'AI-approved reorder', (rec.parameters->>'locationId')::uuid, p_user_id)
    returning id into new_operation_id;
    insert into public.operation_items(operation_id, product_id, quantity, unit_cost)
    values (new_operation_id, rec.product_id, (rec.parameters->>'quantity')::numeric, (rec.parameters->>'unitCost')::numeric);
  else
    raise exception 'Unsupported recommendation type';
  end if;
  update public.ai_recommendations set status = 'APPROVED' where id = rec.id;
  validation_result := public.validate_inventory_operation(new_operation_id, p_user_id);
  update public.ai_recommendations set status = 'EXECUTED' where id = rec.id;
  return validation_result || jsonb_build_object('recommendationId', rec.id, 'recommendationStatus', 'EXECUTED');
end;
$$;

create or replace function public.approve_ai_recommendation(p_recommendation_id uuid, p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  rec public.ai_recommendations%rowtype;
  new_operation_id uuid;
  validation_result jsonb;
begin
  select * into rec from public.ai_recommendations where id = p_recommendation_id for update;
  if not found then raise exception 'Recommendation not found'; end if;
  if rec.status <> 'DRAFT' then raise exception 'Only DRAFT recommendations can be approved'; end if;
  if rec.type = 'TRANSFER' then
    insert into public.operations(type, status, source_location_id, destination_location_id, created_by)
    values ('TRANSFER', 'READY', (rec.parameters->>'sourceLocationId')::uuid,
      (rec.parameters->>'destinationLocationId')::uuid, p_user_id) returning id into new_operation_id;
    insert into public.operation_items(operation_id, product_id, quantity)
    select new_operation_id, (item->>'productId')::uuid, (item->>'quantity')::numeric
    from jsonb_array_elements(rec.parameters->'items') item;
  elsif rec.type = 'REORDER' then
    if rec.parameters->>'unitCost' is null then raise exception 'Reorder draft has no evidence-based unit cost'; end if;
    insert into public.operations(type, status, supplier, destination_location_id, created_by)
    values ('RECEIPT', 'READY', 'AI-approved reorder', (rec.parameters->>'locationId')::uuid, p_user_id)
    returning id into new_operation_id;
    insert into public.operation_items(operation_id, product_id, quantity, unit_cost)
    values (new_operation_id, rec.product_id, (rec.parameters->>'quantity')::numeric, (rec.parameters->>'unitCost')::numeric);
  else
    raise exception 'Unsupported recommendation type';
  end if;
  update public.ai_recommendations set status = 'APPROVED' where id = rec.id;
  validation_result := public.validate_inventory_operation(new_operation_id, p_user_id);
  update public.ai_recommendations set status = 'EXECUTED' where id = rec.id;
  return validation_result || jsonb_build_object('recommendationId', rec.id, 'recommendationStatus', 'EXECUTED');
end;
$$;

revoke all on function public.create_product_with_stock(text,text,uuid,text,numeric,numeric,numeric,uuid,uuid) from public, anon, authenticated;
revoke all on function public.approve_ai_recommendation(uuid,uuid) from public, anon, authenticated;
grant execute on function public.create_product_with_stock(text,text,uuid,text,numeric,numeric,numeric,uuid,uuid) to service_role;
grant execute on function public.approve_ai_recommendation(uuid,uuid) to service_role;