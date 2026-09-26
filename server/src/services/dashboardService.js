import { supabase } from '../lib/supabase.js';

export async function getDashboard() {
  const [productResult, stockResult, receiptResult, deliveryResult, transferResult] = await Promise.all([
    supabase.from('products').select('id, reorder_level'),
    supabase.from('stock').select('product_id, quantity'),
    supabase.from('operations').select('id', { count: 'exact', head: true }).eq('type', 'RECEIPT').neq('status', 'DONE').neq('status', 'CANCELED'),
    supabase.from('operations').select('id', { count: 'exact', head: true }).eq('type', 'DELIVERY').neq('status', 'DONE').neq('status', 'CANCELED'),
    supabase.from('operations').select('id', { count: 'exact', head: true }).eq('type', 'TRANSFER').in('status', ['DRAFT', 'WAITING', 'READY'])
  ]);
  for (const result of [productResult, stockResult, receiptResult, deliveryResult, transferResult]) {
    if (result.error) throw new Error(result.error.message);
  }
  const quantities = new Map();
  for (const row of stockResult.data || []) quantities.set(row.product_id, (quantities.get(row.product_id) || 0) + Number(row.quantity));
  const products = productResult.data || [];
  return {
    totalProducts: products.length,
    lowStockCount: products.filter((product) => (quantities.get(product.id) || 0) <= Number(product.reorder_level)).length,
    outOfStockCount: products.filter((product) => (quantities.get(product.id) || 0) <= 0).length,
    pendingReceipts: receiptResult.count || 0,
    pendingDeliveries: deliveryResult.count || 0,
    scheduledTransfers: transferResult.count || 0
  };
}