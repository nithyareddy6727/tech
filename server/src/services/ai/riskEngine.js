import { supabase } from '../../lib/supabase.js';

export async function calculateStockoutRisk(productId) {
  const [productResult, stockResult, historyResult] = await Promise.all([
    supabase.from('products').select('id, name, sku, reorder_level').eq('id', productId).single(),
    supabase.from('stock').select('quantity, average_unit_cost, inventory_value, location_id, locations(id, name)').eq('product_id', productId),
    supabase.from('stock_ledger').select('id, quantity_change, created_at, location_id, type')
      .eq('product_id', productId).eq('type', 'DELIVERY').lt('quantity_change', 0)
      .gte('created_at', new Date(Date.now() - 30 * 86400000).toISOString()).order('created_at', { ascending: true })
  ]);
  for (const result of [productResult, stockResult, historyResult]) if (result.error) throw new Error(result.error.message);

  const product = productResult.data;
  const quantity = (stockResult.data || []).reduce((sum, row) => sum + Number(row.quantity), 0);
  const reorderLevel = Number(product.reorder_level);
  const deliveries = historyResult.data || [];
  const distinctDays = new Set(deliveries.map((row) => row.created_at.slice(0, 10)));
  let averageDailyUsage = null;
  let daysCoverage = null;
  let historyNote = 'Insufficient delivery history to calculate average daily usage (need at least 3 delivery records across 7 days).';
  if (deliveries.length >= 3 && distinctDays.size >= 3) {
    const elapsedDays = Math.max(1, (Date.parse(deliveries.at(-1).created_at) - Date.parse(deliveries[0].created_at)) / 86400000);
    if (elapsedDays >= 7) {
      averageDailyUsage = deliveries.reduce((sum, row) => sum + Math.abs(Number(row.quantity_change)), 0) / elapsedDays;
      daysCoverage = averageDailyUsage > 0 ? quantity / averageDailyUsage : null;
      historyNote = 'Average usage is calculated from delivery ledger records in the last 30 days.';
    }
  }
  const atOrBelowReorder = quantity <= reorderLevel;
  return {
    product: { id: product.id, name: product.name, sku: product.sku },
    quantity,
    inventoryValue: (stockResult.data || []).some((row) => Number(row.quantity) > 0 && row.inventory_value === null)
      ? null
      : (stockResult.data || []).reduce((sum, row) => sum + Number(row.inventory_value || 0), 0),
    costStatus: (stockResult.data || []).some((row) => Number(row.quantity) > 0 && row.average_unit_cost === null)
      ? 'Some on-hand inventory has no known cost.'
      : 'All on-hand inventory has a recorded cost.',
    reorderLevel,
    lowStock: atOrBelowReorder,
    outOfStock: quantity <= 0,
    averageDailyUsage,
    daysCoverage,
    stockoutRisk: atOrBelowReorder || (daysCoverage !== null && daysCoverage < 7),
    assumedLeadTimeDays: 7,
    historyNote,
    evidence: [
      { kind: 'stock', productId, quantity, reorderLevel, locations: (stockResult.data || []).map((row) => ({ name: row.locations?.name, quantity: Number(row.quantity), averageUnitCost: row.average_unit_cost === null ? null : Number(row.average_unit_cost), inventoryValue: row.inventory_value === null ? null : Number(row.inventory_value) })) },
      ...deliveries.map((row) => ({ kind: 'ledger', id: row.id, type: row.type, quantityChange: Number(row.quantity_change), createdAt: row.created_at }))
    ]
  };
}