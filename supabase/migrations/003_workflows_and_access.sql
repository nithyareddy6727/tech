alter table public.operations drop constraint if exists operations_status_check;
alter table public.operations add constraint operations_status_check
  check (status in ('DRAFT', 'WAITING', 'READY', 'PICKED', 'PACKED', 'DONE', 'CANCELED'));

alter table public.ai_recommendations
  add column if not exists created_by uuid references auth.users(id) on delete set null;

create table if not exists public.demo_seed_runs (
  seed_key text primary key,
  seeded_at timestamptz not null default now()
);
alter table public.demo_seed_runs enable row level security;
revoke all on public.demo_seed_runs from public, anon, authenticated;

create or replace function public.set_delivery_status(p_operation_id uuid, p_user_id uuid, p_next_status text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  op public.operations%rowtype;
  expected_status text;
begin
  if p_next_status not in ('PICKED', 'PACKED') then raise exception 'Unsupported delivery workflow status'; end if;
  select * into op from public.operations where id = p_operation_id for update;
  if not found then raise exception 'Operation not found'; end if;
  if op.created_by <> p_user_id then raise exception 'Operation does not belong to this user'; end if;
  if op.type <> 'DELIVERY' then raise exception 'Pick and pack only apply to deliveries'; end if;
  expected_status := case when p_next_status = 'PICKED' then 'READY' else 'PICKED' end;
  if op.status <> expected_status then raise exception 'Delivery must be % before it can be marked %', expected_status, p_next_status; end if;
  update public.operations set status = p_next_status where id = op.id;
  return jsonb_build_object('success', true, 'operationId', op.id, 'status', p_next_status);
end;
$$;

create or replace function public.validate_inventory_operation_flow(p_operation_id uuid, p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  op public.operations%rowtype;
  validation_result jsonb;
begin
  select * into op from public.operations where id = p_operation_id for update;
  if not found then raise exception 'Operation not found'; end if;
  if op.created_by <> p_user_id then raise exception 'Operation does not belong to this user'; end if;
  if op.type = 'DELIVERY' then
    if op.status <> 'PACKED' then raise exception 'Delivery must be PACKED before validation'; end if;
    update public.operations set status = 'READY' where id = op.id;
  elsif op.status <> 'READY' then
    raise exception 'Only READY operations can be validated';
  end if;
  validation_result := public.validate_inventory_operation(op.id, p_user_id);
  return validation_result;
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
  if rec.created_by is distinct from p_user_id then raise exception 'Recommendation does not belong to this user'; end if;
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

revoke all on function public.set_delivery_status(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.validate_inventory_operation_flow(uuid, uuid) from public, anon, authenticated;
revoke all on function public.approve_ai_recommendation(uuid, uuid) from public, anon, authenticated;
grant execute on function public.set_delivery_status(uuid, uuid, text) to service_role;
grant execute on function public.validate_inventory_operation_flow(uuid, uuid) to service_role;
grant execute on function public.approve_ai_recommendation(uuid, uuid) to service_role;