-- Run once in Supabase SQL Editor after creating the demo user in Supabase Auth.
do $seed$
declare
  demo_user_id uuid;
  category_id uuid;
  warehouse_id uuid;
  steel_location_id uuid;
  west_location_id uuid;
  east_location_id uuid;
  steel_id uuid;
  chairs_id uuid;
  bolts_id uuid;
  operation_id uuid;
  before_quantity numeric;
  day_offset integer;
begin
  select id into demo_user_id from auth.users order by created_at limit 1;
  if demo_user_id is null then raise exception 'Create a Supabase Auth user before running the demo seed.'; end if;
  insert into public.categories(name) values ('Raw Materials') on conflict (name) do update set name = excluded.name returning id into category_id;
  insert into public.warehouses(name, code, address) values ('Central Warehouse', 'CENTRAL', 'Demo address')
    on conflict (code) do update set name = excluded.name returning id into warehouse_id;
  insert into public.locations(warehouse_id, name, code) values (warehouse_id, 'Steel Storage', 'STEEL')
    on conflict (warehouse_id, code) do update set name = excluded.name returning id into steel_location_id;
  insert into public.locations(warehouse_id, name, code) values (warehouse_id, 'West Aisle', 'WEST')
    on conflict (warehouse_id, code) do update set name = excluded.name returning id into west_location_id;
  insert into public.locations(warehouse_id, name, code) values (warehouse_id, 'East Aisle', 'EAST')
    on conflict (warehouse_id, code) do update set name = excluded.name returning id into east_location_id;
  insert into public.products(name, sku, category_id, unit, reorder_level) values ('Steel Rods', 'STEEL-001', category_id, 'rod', 20)
    on conflict (sku) do update set name = excluded.name, reorder_level = excluded.reorder_level returning id into steel_id;
  insert into public.products(name, sku, category_id, unit, reorder_level) values ('Chairs', 'CHAIR-001', null, 'unit', 5)
    on conflict (sku) do update set name = excluded.name, reorder_level = excluded.reorder_level returning id into chairs_id;
  insert into public.products(name, sku, category_id, unit, reorder_level) values ('Bolts', 'BOLT-001', category_id, 'box', 15)
    on conflict (sku) do update set name = excluded.name, reorder_level = excluded.reorder_level returning id into bolts_id;
  insert into public.stock(product_id, location_id, quantity) values
    (steel_id, steel_location_id, 17), (chairs_id, west_location_id, 38),
    (bolts_id, west_location_id, 40), (bolts_id, east_location_id, 30)
  on conflict (product_id, location_id) do update set quantity = excluded.quantity;

  insert into public.stock_ledger(product_id, location_id, type, quantity_change, quantity_before, quantity_after, created_by, created_at)
  values (steel_id, steel_location_id, 'INITIAL', 40, 0, 40, demo_user_id, now() - interval '18 days');
  before_quantity := 40;
  foreach day_offset in array array[14, 11, 8, 5] loop
    insert into public.operations(type, status, customer, source_location_id, created_by, created_at, validated_at)
    values ('DELIVERY', 'DONE', 'Demo customer', steel_location_id, demo_user_id,
      now() - make_interval(days => day_offset), now() - make_interval(days => day_offset)) returning id into operation_id;
    insert into public.operation_items(operation_id, product_id, quantity) values (operation_id, steel_id, 7);
    insert into public.stock_ledger(product_id, location_id, operation_id, type, quantity_change, quantity_before,
      quantity_after, source_location_id, created_by, created_at)
    values (steel_id, steel_location_id, operation_id, 'DELIVERY', -7, before_quantity, before_quantity - 7,
      steel_location_id, demo_user_id, now() - make_interval(days => day_offset));
    before_quantity := before_quantity - 7;
  end loop;
  insert into public.operations(type, status, supplier, destination_location_id, created_by, created_at, validated_at)
  values ('RECEIPT', 'DONE', 'Demo Steel Supplier', steel_location_id, demo_user_id, now() - interval '2 days', now() - interval '2 days')
  returning id into operation_id;
  insert into public.operation_items(operation_id, product_id, quantity) values (operation_id, steel_id, 5);
  insert into public.stock_ledger(product_id, location_id, operation_id, type, quantity_change, quantity_before,
    quantity_after, destination_location_id, created_by, created_at)
  values (steel_id, steel_location_id, operation_id, 'RECEIPT', 5, 12, 17, steel_location_id, demo_user_id, now() - interval '2 days');

  insert into public.stock_ledger(product_id, location_id, type, quantity_change, quantity_before, quantity_after, created_by, created_at)
  values (chairs_id, west_location_id, 'INITIAL', 40, 0, 40, demo_user_id, now() - interval '10 days');
  insert into public.operations(type, status, destination_location_id, created_by, created_at, validated_at)
  values ('ADJUSTMENT', 'DONE', west_location_id, demo_user_id, now() - interval '1 day', now() - interval '1 day') returning id into operation_id;
  insert into public.operation_items(operation_id, product_id, quantity, counted_quantity) values (operation_id, chairs_id, 38, 38);
  insert into public.stock_ledger(product_id, location_id, operation_id, type, quantity_change, quantity_before,
    quantity_after, destination_location_id, created_by, created_at)
  values (chairs_id, west_location_id, operation_id, 'ADJUSTMENT', -2, 40, 38, west_location_id, demo_user_id, now() - interval '1 day');

  insert into public.stock_ledger(product_id, location_id, type, quantity_change, quantity_before, quantity_after, created_by, created_at)
  values (bolts_id, west_location_id, 'INITIAL', 50, 0, 50, demo_user_id, now() - interval '8 days'),
    (bolts_id, east_location_id, 'INITIAL', 20, 0, 20, demo_user_id, now() - interval '8 days');
  insert into public.operations(type, status, source_location_id, destination_location_id, created_by, created_at, validated_at)
  values ('TRANSFER', 'DONE', west_location_id, east_location_id, demo_user_id, now() - interval '3 days', now() - interval '3 days') returning id into operation_id;
  insert into public.operation_items(operation_id, product_id, quantity) values (operation_id, bolts_id, 10);
  insert into public.stock_ledger(product_id, location_id, operation_id, type, quantity_change, quantity_before,
    quantity_after, source_location_id, destination_location_id, created_by, created_at)
  values (bolts_id, west_location_id, operation_id, 'TRANSFER_OUT', -10, 50, 40, west_location_id, east_location_id, demo_user_id, now() - interval '3 days'),
    (bolts_id, east_location_id, operation_id, 'TRANSFER_IN', 10, 20, 30, west_location_id, east_location_id, demo_user_id, now() - interval '3 days');
end;
$seed$;