import { supabase } from '../lib/supabase.js';

export async function listLedger({ productId, locationId, limit = 100 } = {}) {
  let query = supabase.from('stock_ledger')
    .select('*, products(name, sku), locations(name, code), operations(type, status)')
    .order('created_at', { ascending: false })
    .limit(Math.min(Math.max(Number(limit) || 100, 1), 500));
  if (productId) query = query.eq('product_id', productId);
  if (locationId) query = query.eq('location_id', locationId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data || [];
}