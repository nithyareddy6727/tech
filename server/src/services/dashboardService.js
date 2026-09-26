import { supabase } from '../lib/supabase.js';

export async function getDashboard(filters = {}) {
  const [productResult, stockResult, operationsResult] = await Promise.all([
    supabase.from('products').select('id, name, sku, category_id, reorder_level'),
    supabase.from('stock').select('product_id, quantity, inventory_value, location_id, locations(warehouse_id)'),
    supabase.from('operations').select('id, type, status, source_location_id, destination_location_id, source:locations!operations_source_location_id_fkey(warehouse_id), destination:locations!operations_destination_location_id_fkey(warehouse_id), operation_items(products(category_id, name, sku))')
  ]);
  for (const result of [productResult, stockResult, operationsResult]) if (result.error) throw new Error(result.error.message);

  const products = (productResult.data || []).filter((product) => {
    if (filters.categoryId && product.category_id !== filters.categoryId) return false;
    if (filters.search && !`${product.name} ${product.sku}`.toLowerCase().includes(filters.search.toLowerCase())) return false;
    return true;
  });
  const productIds = new Set(products.map((product) => product.id));
  const stockRows = (stockResult.data || []).filter((row) =>
    productIds.has(row.product_id) &&
    (!filters.locationId || row.location_id === filters.locationId) &&
    (!filters.warehouseId || row.locations?.warehouse_id === filters.warehouseId));
  const quantities = new Map();
  for (const row of stockRows) quantities.set(row.product_id, (quantities.get(row.product_id) || 0) + Number(row.quantity));
  const operations = (operationsResult.data || []).filter((operation) => {
    if (filters.type && operation.type !== filters.type.toUpperCase()) return false;
    if (filters.status && operation.status !== filters.status.toUpperCase()) return false;
    if (filters.warehouseId && operation.source?.warehouse_id !== filters.warehouseId && operation.destination?.warehouse_id !== filters.warehouseId) return false;
    const items = operation.operation_items || [];
    if (filters.categoryId && !items.some((item) => item.products?.category_id === filters.categoryId)) return false;
    if (filters.search && !items.some((item) => `${item.products?.name || ''} ${item.products?.sku || ''}`.toLowerCase().includes(filters.search.toLowerCase()))) return false;
    if (filters.locationId && operation.source_location_id !== filters.locationId && operation.destination_location_id !== filters.locationId) return false;
    return true;
  });
  const countPending = (type) => operations.filter((operation) => operation.type === type && !['DONE', 'CANCELED'].includes(operation.status)).length;
  const inStockProducts = products.filter((product) => (quantities.get(product.id) || 0) > 0);
  const unvaluedStockCount = stockRows.filter((row) => Number(row.quantity) > 0 && row.inventory_value === null).length;
  return {
    totalProducts: inStockProducts.length,
    lowStockCount: products.filter((product) => {
      const quantity = quantities.get(product.id) || 0;
      return quantity > 0 && quantity <= Number(product.reorder_level);
    }).length,
    outOfStockCount: products.filter((product) => (quantities.get(product.id) || 0) <= 0).length,
    pendingReceipts: countPending('RECEIPT'),
    pendingDeliveries: countPending('DELIVERY'),
    scheduledTransfers: operations.filter((operation) => operation.type === 'TRANSFER' && ['DRAFT', 'WAITING', 'READY'].includes(operation.status)).length,
    totalInventoryValue: unvaluedStockCount ? null : stockRows.reduce((total, row) => total + Number(row.inventory_value || 0), 0),
    unvaluedStockCount
  };
}