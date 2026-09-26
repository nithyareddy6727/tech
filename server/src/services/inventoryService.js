import { supabase } from '../lib/supabase.js';

function throwIfError(error) {
  if (error) throw new Error(error.message);
}

export async function createProduct(input, userId) {
  const { data, error } = await supabase.rpc('create_product_with_stock', {
    p_name: input.name,
    p_sku: input.sku,
    p_category_id: input.categoryId || null,
    p_unit: input.unit,
    p_reorder_level: input.reorderLevel,
    p_initial_stock: input.initialStock,
    p_location_id: input.locationId || null,
    p_user_id: userId
  });
  throwIfError(error);
  return getProduct(data);
}

export async function updateProduct(id, input) {
  const values = {};
  for (const key of ['name', 'sku', 'unit']) if (input[key] !== undefined) values[key] = input[key];
  if (input.categoryId !== undefined) values.category_id = input.categoryId || null;
  if (input.reorderLevel !== undefined) values.reorder_level = input.reorderLevel;
  const { data, error } = await supabase.from('products').update(values).eq('id', id).select('*').single();
  throwIfError(error);
  return data;
}

export async function getProduct(id) {
  const { data, error } = await supabase.from('products')
    .select('*, categories(name), stock(quantity, location_id, locations(id, name, code, warehouse_id, warehouses(name)))')
    .eq('id', id).single();
  throwIfError(error);
  return data;
}

export async function listProducts({ search, categoryId, lowStock } = {}) {
  let query = supabase.from('products')
    .select('*, categories(name), stock(quantity, location_id, locations(id, name, code, warehouse_id, warehouses(name)))')
    .order('name');
  if (search) query = query.or(`name.ilike.%${search}%,sku.ilike.%${search}%`);
  if (categoryId) query = query.eq('category_id', categoryId);
  const { data, error } = await query;
  throwIfError(error);
  const products = (data || []).map((product) => ({
    ...product,
    totalStock: (product.stock || []).reduce((total, row) => total + Number(row.quantity), 0)
  }));
  return lowStock === 'true'
    ? products.filter((product) => product.totalStock <= Number(product.reorder_level))
    : products;
}

export async function createOperation(type, input, userId) {
  const { data, error } = await supabase.rpc('create_inventory_operation', {
    p_user_id: userId,
    p_type: type,
    p_data: input
  });
  throwIfError(error);
  return data;
}

export async function validateOperation(id, userId) {
  const { data, error } = await supabase.rpc('validate_inventory_operation', {
    p_operation_id: id,
    p_user_id: userId
  });
  throwIfError(error);
  return data;
}

export async function getOperation(id) {
  const { data, error } = await supabase.from('operations')
    .select('*, operation_items(*, products(name, sku)), source:locations!operations_source_location_id_fkey(id, name), destination:locations!operations_destination_location_id_fkey(id, name)')
    .eq('id', id).single();
  throwIfError(error);
  return data;
}

export async function listOperations(filters = {}) {
  let query = supabase.from('operations')
    .select('*, operation_items(*, products(id, name, sku, category_id)), source:locations!operations_source_location_id_fkey(id, name, warehouse_id), destination:locations!operations_destination_location_id_fkey(id, name, warehouse_id)')
    .order('created_at', { ascending: false });
  if (filters.type) query = query.eq('type', filters.type.toUpperCase());
  if (filters.status) query = query.eq('status', filters.status.toUpperCase());
  const { data, error } = await query;
  throwIfError(error);
  return (data || []).filter((operation) => {
    const items = operation.operation_items || [];
    if (filters.categoryId && !items.some((item) => item.products?.category_id === filters.categoryId)) return false;
    if (filters.search) {
      const needle = filters.search.toLowerCase();
      if (!items.some((item) => `${item.products?.name || ''} ${item.products?.sku || ''}`.toLowerCase().includes(needle))) return false;
    }
    if (filters.warehouseId && ![operation.source?.warehouse_id, operation.destination?.warehouse_id].includes(filters.warehouseId)) return false;
    return true;
  });
}

export async function listWarehouses() {
  const { data, error } = await supabase.from('warehouses').select('*, locations(*)').order('name');
  throwIfError(error);
  return data || [];
}

export async function listLocations(warehouseId) {
  let query = supabase.from('locations').select('*, warehouses(name, code)').order('name');
  if (warehouseId) query = query.eq('warehouse_id', warehouseId);
  const { data, error } = await query;
  throwIfError(error);
  return data || [];
}