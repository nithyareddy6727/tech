import { supabase } from '../../lib/supabase.js';
import { calculateStockoutRisk } from './riskEngine.js';

async function findProducts(name) {
  const { data, error } = await supabase.from('products').select('id, name, sku, reorder_level').ilike('name', `%${name}%`).limit(10);
  if (error) throw new Error(error.message);
  return data || [];
}

async function resolveProduct(name) {
  const products = await findProducts(name);
  if (!products.length) return { error: `No product matches "${name}".` };
  const exact = products.filter((product) => product.name.toLowerCase() === name.toLowerCase() || product.sku.toLowerCase() === name.toLowerCase());
  if (exact.length === 1) return { product: exact[0] };
  if (products.length === 1) return { product: products[0] };
  return { error: `More than one product matches "${name}". Ask which one they mean.`, matches: products };
}

async function stockRows(productId) {
  const { data, error } = await supabase.from('stock')
    .select('quantity, average_unit_cost, inventory_value, location_id, locations(id, name, code, warehouse_id, warehouses(name))')
    .eq('product_id', productId);
  if (error) throw new Error(error.message);
  return (data || []).map((row) => ({ locationId: row.location_id, location: row.locations?.name,
    warehouse: row.locations?.warehouses?.name, quantity: Number(row.quantity),
    averageUnitCost: row.average_unit_cost === null ? null : Number(row.average_unit_cost),
    inventoryValue: row.inventory_value === null ? null : Number(row.inventory_value) }));
}

async function recentOperations(type) {
  const { data, error } = await supabase.from('operations')
    .select('id, type, status, supplier, customer, source_location_id, destination_location_id, created_at, validated_at, operation_items(quantity, counted_quantity, products(name, sku))')
    .eq('type', type).order('created_at', { ascending: false }).limit(10);
  if (error) throw new Error(error.message);
  return data || [];
}

async function draftRecommendation(type, recommendation, parameters, evidence, productId) {
  const { data, error } = await supabase.from('ai_recommendations').insert({
    product_id: productId, type, recommendation, parameters, evidence, status: 'DRAFT'
  }).select('id, product_id, type, recommendation, parameters, evidence, status, created_at').single();
  if (error) throw new Error(error.message);
  return { evidence, recommendation: { ...data, requiresApproval: true } };
}

const definitions = [
  { type: 'function', function: { name: 'get_product_stock', description: 'Get total stock, reorder level, and location quantities for a named product.', parameters: { type: 'object', properties: { productName: { type: 'string' } }, required: ['productName'], additionalProperties: false } } },
  { type: 'function', function: { name: 'get_stock_by_location', description: 'Find locations where a named product is stocked.', parameters: { type: 'object', properties: { productName: { type: 'string' } }, required: ['productName'], additionalProperties: false } } },
  { type: 'function', function: { name: 'get_stock_history', description: 'Show real recent ledger records for a product.', parameters: { type: 'object', properties: { productName: { type: 'string' } }, required: ['productName'], additionalProperties: false } } },
  { type: 'function', function: { name: 'get_recent_receipts', description: 'Show recent receipt operations.', parameters: { type: 'object', properties: {}, additionalProperties: false } } },
  { type: 'function', function: { name: 'get_recent_deliveries', description: 'Show recent delivery operations.', parameters: { type: 'object', properties: {}, additionalProperties: false } } },
  { type: 'function', function: { name: 'get_recent_transfers', description: 'Show recent transfer operations.', parameters: { type: 'object', properties: {}, additionalProperties: false } } },
  { type: 'function', function: { name: 'get_recent_adjustments', description: 'Show recent stock adjustments.', parameters: { type: 'object', properties: {}, additionalProperties: false } } },
  { type: 'function', function: { name: 'calculate_stockout_risk', description: 'Calculate low-stock and stockout risk from stock and delivery ledger facts.', parameters: { type: 'object', properties: { productName: { type: 'string' } }, required: ['productName'], additionalProperties: false } } },
  { type: 'function', function: { name: 'find_surplus_locations', description: 'Compare quantities for a named product across locations.', parameters: { type: 'object', properties: { productName: { type: 'string' } }, required: ['productName'], additionalProperties: false } } },
  { type: 'function', function: { name: 'create_transfer_draft', description: 'Create a transfer recommendation draft; never changes stock.', parameters: { type: 'object', properties: { productId: { type: 'string' }, sourceLocationId: { type: 'string' }, destinationLocationId: { type: 'string' }, quantity: { type: 'number' }, reason: { type: 'string' } }, required: ['productId', 'sourceLocationId', 'destinationLocationId', 'quantity', 'reason'], additionalProperties: false } } },
  { type: 'function', function: { name: 'create_reorder_draft', description: 'Create a reorder recommendation draft; never changes stock.', parameters: { type: 'object', properties: { productId: { type: 'string' }, locationId: { type: 'string' }, quantity: { type: 'number' }, reason: { type: 'string' } }, required: ['productId', 'locationId', 'quantity', 'reason'], additionalProperties: false } } }
];

async function productTool(name, args) {
  const resolved = await resolveProduct(args.productName);
  if (!resolved.product) return { evidence: resolved.matches || [], clarification: resolved.error };
  const product = resolved.product;
  if (name === 'get_product_stock' || name === 'get_stock_by_location') {
    const locations = await stockRows(product.id);
    return { evidence: [{ productId: product.id, name: product.name, sku: product.sku, reorderLevel: Number(product.reorder_level), totalStock: locations.reduce((sum, row) => sum + row.quantity, 0), locations }] };
  }
  if (name === 'get_stock_history') {
    const { data, error } = await supabase.from('stock_ledger').select('id, type, quantity_change, quantity_before, quantity_after, created_at, locations(name)')
      .eq('product_id', product.id).order('created_at', { ascending: false }).limit(20);
    if (error) throw new Error(error.message);
    return { evidence: (data || []).map((row) => ({ id: row.id, type: row.type, quantityChange: Number(row.quantity_change), before: Number(row.quantity_before), after: Number(row.quantity_after), location: row.locations?.name, createdAt: row.created_at })) };
  }
  if (name === 'calculate_stockout_risk') return calculateStockoutRisk(product.id);
  const locations = await stockRows(product.id);
  return { evidence: [{ productId: product.id, name: product.name, reorderLevel: Number(product.reorder_level), locations: [...locations].sort((a, b) => b.quantity - a.quantity) }] };
}

export async function executeTool(name, args) {
  if (['get_product_stock', 'get_stock_by_location', 'get_stock_history', 'calculate_stockout_risk', 'find_surplus_locations'].includes(name)) {
    return productTool(name, args);
  }
  const operationTypes = {
    get_recent_receipts: 'RECEIPT', get_recent_deliveries: 'DELIVERY',
    get_recent_transfers: 'TRANSFER', get_recent_adjustments: 'ADJUSTMENT'
  };
  if (operationTypes[name]) return { evidence: await recentOperations(operationTypes[name]) };
  if (name === 'create_transfer_draft') {
    if (!(args.quantity > 0) || args.sourceLocationId === args.destinationLocationId) throw new Error('Transfer needs a positive quantity and two different locations.');
    const rows = await stockRows(args.productId);
    const source = rows.find((row) => row.locationId === args.sourceLocationId);
    const destination = rows.find((row) => row.locationId === args.destinationLocationId);
    if (!source || source.quantity < args.quantity) throw new Error('The source location does not have enough available stock.');
    if (!destination) throw new Error('Destination location is not stocked for this product; choose a valid location.');
    return draftRecommendation('TRANSFER', args.reason, { sourceLocationId: args.sourceLocationId, destinationLocationId: args.destinationLocationId, items: [{ productId: args.productId, quantity: args.quantity }] }, [{ source, destination }], args.productId);
  }
  if (name === 'create_reorder_draft') {
    if (!(args.quantity > 0)) throw new Error('Reorder quantity must be positive.');
    const { data: product, error } = await supabase.from('products').select('id, name, sku, reorder_level').eq('id', args.productId).single();
    if (error) throw new Error(error.message);
    const current = (await stockRows(product.id)).find((row) => row.locationId === args.locationId);
    if (!current) throw new Error('No stock record exists at that location.');
    if (current.averageUnitCost === null) throw new Error('Cannot draft a priced reorder because this location has no known average unit cost. Add a costed receipt first.');
    return draftRecommendation('REORDER', args.reason, { locationId: args.locationId, quantity: args.quantity, unitCost: current.averageUnitCost }, [{ product: { name: product.name, sku: product.sku, reorderLevel: Number(product.reorder_level) }, current }], product.id);
  }
  throw new Error(`Unknown AI tool: ${name}`);
}

export { definitions as toolDefinitions };