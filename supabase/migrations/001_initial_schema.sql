create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  created_at timestamptz not null default now()
);
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(), name text not null unique, created_at timestamptz not null default now()
);
create table if not exists public.warehouses (
  id uuid primary key default gen_random_uuid(), name text not null, code text not null unique,
  address text, created_at timestamptz not null default now()
);
create table if not exists public.locations (
  id uuid primary key default gen_random_uuid(), warehouse_id uuid not null references public.warehouses(id),
  name text not null, code text not null, created_at timestamptz not null default now(), unique (warehouse_id, code)
);
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(), name text not null, sku text not null unique,
  category_id uuid references public.categories(id) on delete set null, unit text not null default 'unit',
  reorder_level numeric(14,3) not null default 0 check (reorder_level >= 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.stock (
  id uuid primary key default gen_random_uuid(), product_id uuid not null references public.products(id) on delete cascade,
  location_id uuid not null references public.locations(id), quantity numeric(14,3) not null default 0 check (quantity >= 0),
  unique (product_id, location_id)
);
create table if not exists public.operations (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('RECEIPT','DELIVERY','TRANSFER','ADJUSTMENT')),
  status text not null default 'DRAFT' check (status in ('DRAFT','WAITING','READY','DONE','CANCELED')),
  supplier text, customer text, source_location_id uuid references public.locations(id),
  destination_location_id uuid references public.locations(id), created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(), validated_at timestamptz
);
create table if not exists public.operation_items (
  id uuid primary key default gen_random_uuid(), operation_id uuid not null references public.operations(id) on delete cascade,
  product_id uuid not null references public.products(id), quantity numeric(14,3) not null check (quantity >= 0),
  counted_quantity numeric(14,3) check (counted_quantity >= 0), unique (operation_id, product_id)
);
create table if not exists public.stock_ledger (
  id uuid primary key default gen_random_uuid(), product_id uuid not null references public.products(id),
  location_id uuid not null references public.locations(id), operation_id uuid references public.operations(id),
  type text not null, quantity_change numeric(14,3) not null, quantity_before numeric(14,3) not null,
  quantity_after numeric(14,3) not null, source_location_id uuid references public.locations(id),
  destination_location_id uuid references public.locations(id), created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create table if not exists public.ai_risks (
  id uuid primary key default gen_random_uuid(), product_id uuid references public.products(id) on delete set null,
  risk_type text not null, severity text not null, title text not null, explanation text not null,
  evidence jsonb not null default '[]'::jsonb, status text not null default 'OPEN', created_at timestamptz not null default now()
);
create table if not exists public.ai_recommendations (
  id uuid primary key default gen_random_uuid(), product_id uuid references public.products(id) on delete set null,
  type text not null, recommendation text not null, parameters jsonb not null default '{}'::jsonb,
  evidence jsonb not null default '[]'::jsonb,
  status text not null default 'DRAFT' check (status in ('DRAFT','APPROVED','REJECTED','EXECUTED')),
  created_at timestamptz not null default now()
);

create index if not exists stock_ledger_product_created_idx on public.stock_ledger(product_id, created_at desc);
create index if not exists stock_ledger_location_created_idx on public.stock_ledger(location_id, created_at desc);
create index if not exists operations_type_status_idx on public.operations(type, status);

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at before update on public.products
for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.warehouses enable row level security;
alter table public.locations enable row level security;
alter table public.products enable row level security;
alter table public.stock enable row level security;
alter table public.operations enable row level security;
alter table public.operation_items enable row level security;
alter table public.stock_ledger enable row level security;
alter table public.ai_risks enable row level security;
alter table public.ai_recommendations enable row level security;

drop policy if exists profiles_read_self on public.profiles;
create policy profiles_read_self on public.profiles for select to authenticated using (id = (select auth.uid()));
drop policy if exists profiles_write_self on public.profiles;
create policy profiles_write_self on public.profiles for all to authenticated
using (id = (select auth.uid())) with check (id = (select auth.uid()));
do $$
declare table_name text;
begin
  foreach table_name in array array['categories','warehouses','locations','products','stock','operations','operation_items','stock_ledger','ai_risks','ai_recommendations'] loop
    execute format('drop policy if exists authenticated_read on public.%I', table_name);
    execute format('create policy authenticated_read on public.%I for select to authenticated using (true)', table_name);
  end loop;
end;
$$;

create or replace function public.create_product_with_stock(
  p_name text, p_sku text, p_category_id uuid, p_unit text, p_reorder_level numeric,
  p_initial_stock numeric, p_location_id uuid, p_user_id uuid
)
returns uuid language plpgsql security definer set search_path = public as $$
declare new_product_id uuid;
begin
  if p_initial_stock < 0 then raise exception 'Initial stock cannot be negative'; end if;
  if p_initial_stock > 0 and p_location_id is null then raise exception 'A location is required for initial stock'; end if;
  insert into public.products(name, sku, category_id, unit, reorder_level)
  values (p_name, p_sku, p_category_id, p_unit, p_reorder_level) returning id into new_product_id;
  if p_initial_stock > 0 then
    insert into public.stock(product_id, location_id, quantity) values (new_product_id, p_location_id, p_initial_stock);
    insert into public.stock_ledger(product_id, location_id, type, quantity_change, quantity_before,
      quantity_after, destination_location_id, created_by)
    values (new_product_id, p_location_id, 'INITIAL', p_initial_stock, 0, p_initial_stock, p_location_id, p_user_id);
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
  insert into public.operation_items(operation_id, product_id, quantity, counted_quantity)
  select new_operation_id, (item->>'productId')::uuid,
    case when p_type = 'ADJUSTMENT' then (item->>'countedQuantity')::numeric
      else (item->>'quantity')::numeric end,
    case when p_type = 'ADJUSTMENT' then (item->>'countedQuantity')::numeric else null end
  from jsonb_array_elements(p_data->'items') item;
  if p_type <> 'ADJUSTMENT' and exists (
    select 1 from public.operation_items where operation_id = new_operation_id and quantity <= 0
  ) then raise exception 'Operation quantities must be positive'; end if;
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
      select quantity into source_before from public.stock where product_id = item.product_id and location_id = op.source_location_id;
      select quantity into destination_before from public.stock where product_id = item.product_id and location_id = op.destination_location_id;
      if source_before < item.quantity then raise exception 'Insufficient stock for product %', item.product_id; end if;
      update public.stock set quantity = source_before - item.quantity where product_id = item.product_id and location_id = op.source_location_id;
      update public.stock set quantity = destination_before + item.quantity where product_id = item.product_id and location_id = op.destination_location_id;
      insert into public.stock_ledger(product_id, location_id, operation_id, type, quantity_change,
        quantity_before, quantity_after, source_location_id, destination_location_id, created_by)
      values (item.product_id, op.source_location_id, op.id, 'TRANSFER_OUT', -item.quantity,
        source_before, source_before - item.quantity, op.source_location_id, op.destination_location_id, p_user_id),
        (item.product_id, op.destination_location_id, op.id, 'TRANSFER_IN', item.quantity,
        destination_before, destination_before + item.quantity, op.source_location_id, op.destination_location_id, p_user_id);
    else
      movement_location := case when op.type in ('RECEIPT','ADJUSTMENT') then op.destination_location_id else op.source_location_id end;
      insert into public.stock(product_id, location_id, quantity) values (item.product_id, movement_location, 0)
        on conflict (product_id, location_id) do nothing;
      select quantity into stock_before from public.stock
        where product_id = item.product_id and location_id = movement_location for update;
      if op.type = 'RECEIPT' then
        stock_after := stock_before + item.quantity;
      elsif op.type = 'DELIVERY' then
        if item.quantity > stock_before then raise exception 'Insufficient stock for product %', item.product_id; end if;
        stock_after := stock_before - item.quantity;
      else
        stock_after := item.counted_quantity;
      end if;
      update public.stock set quantity = stock_after where product_id = item.product_id and location_id = movement_location;
      insert into public.stock_ledger(product_id, location_id, operation_id, type, quantity_change,
        quantity_before, quantity_after, source_location_id, destination_location_id, created_by)
      values (item.product_id, movement_location, op.id, op.type, stock_after - stock_before,
        stock_before, stock_after, op.source_location_id, op.destination_location_id, p_user_id);
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
    insert into public.operations(type, status, supplier, destination_location_id, created_by)
    values ('RECEIPT', 'READY', 'AI-approved reorder', (rec.parameters->>'locationId')::uuid, p_user_id)
    returning id into new_operation_id;
    insert into public.operation_items(operation_id, product_id, quantity)
    values (new_operation_id, rec.product_id, (rec.parameters->>'quantity')::numeric);
  else
    raise exception 'Unsupported recommendation type';
  end if;

  update public.ai_recommendations set status = 'APPROVED' where id = rec.id;
  validation_result := public.validate_inventory_operation(new_operation_id, p_user_id);
  update public.ai_recommendations set status = 'EXECUTED' where id = rec.id;
  return validation_result || jsonb_build_object('recommendationId', rec.id, 'recommendationStatus', 'EXECUTED');
end;
$$;

revoke all on function public.create_product_with_stock(text,text,uuid,text,numeric,numeric,uuid,uuid) from public, anon, authenticated;
revoke all on function public.create_inventory_operation(uuid,text,jsonb) from public, anon, authenticated;
revoke all on function public.validate_inventory_operation(uuid,uuid) from public, anon, authenticated;
revoke all on function public.approve_ai_recommendation(uuid,uuid) from public, anon, authenticated;
grant execute on function public.create_product_with_stock(text,text,uuid,text,numeric,numeric,uuid,uuid) to service_role;
grant execute on function public.create_inventory_operation(uuid,text,jsonb) to service_role;
grant execute on function public.validate_inventory_operation(uuid,uuid) to service_role;
grant execute on function public.approve_ai_recommendation(uuid,uuid) to service_role;