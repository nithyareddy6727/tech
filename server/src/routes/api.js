import { Router } from 'express';
import { asyncRoute } from '../middleware/auth.js';
import { getDashboard } from '../services/dashboardService.js';
import { createOperation, createProduct, getOperation, listLocations, listOperations, listProducts, listWarehouses, updateProduct, validateOperation } from '../services/inventoryService.js';
import { listLedger } from '../services/ledgerService.js';
import { approveRecommendation, chat, rejectRecommendation } from '../services/ai/agent.js';

export const apiRouter = Router();
const fail = (message) => { const error = new Error(message); error.status = 400; throw error; };
const validNumber = (value, label, { zero = true } = {}) => {
  if (value === undefined || value === null || value === '') fail(`${label} must be provided as a number.`);
  const number = Number(value);
  if (!Number.isFinite(number) || (zero ? number < 0 : number <= 0)) fail(`${label} must be ${zero ? 'non-negative' : 'positive'}.`);
  return number;
};
function validateItems(items, adjustment = false, receipt = false) {
  if (!Array.isArray(items) || !items.length) fail('At least one item is required.');
  const seen = new Set();
  return items.map((item) => {
    if (!item.productId || seen.has(item.productId)) fail('Each item needs a unique productId.');
    seen.add(item.productId);
    if (adjustment) return { productId: item.productId, countedQuantity: validNumber(item.countedQuantity, 'countedQuantity') };
    const result = { productId: item.productId, quantity: validNumber(item.quantity, 'quantity', { zero: false }) };
    if (receipt) result.unitCost = validNumber(item.unitCost, 'unitCost');
    return result;
  });
}

apiRouter.get('/dashboard', asyncRoute(async (req, res) => res.json(await getDashboard())));
apiRouter.get('/products', asyncRoute(async (req, res) => res.json(await listProducts(req.query))));
apiRouter.post('/products', asyncRoute(async (req, res) => {
  const body = req.body || {};
  if (!body.name?.trim() || !body.sku?.trim() || !body.unit?.trim()) fail('name, sku, and unit are required.');
  const initialStock = validNumber(body.initialStock ?? 0, 'initialStock');
  const initialUnitCost = body.initialUnitCost === undefined || body.initialUnitCost === null || body.initialUnitCost === ''
    ? null
    : validNumber(body.initialUnitCost, 'initialUnitCost');
  if (initialStock > 0 && initialUnitCost === null) fail('initialUnitCost is required when initialStock is greater than zero.');
  const product = await createProduct({
    name: body.name.trim(), sku: body.sku.trim(), categoryId: body.categoryId || null,
    unit: body.unit.trim(), reorderLevel: validNumber(body.reorderLevel ?? 0, 'reorderLevel'),
    initialStock, initialUnitCost, locationId: body.locationId || null
  }, req.user.id);
  res.status(201).json(product);
}));
apiRouter.put('/products/:id', asyncRoute(async (req, res) => res.json(await updateProduct(req.params.id, req.body || {}))));
apiRouter.get('/warehouses', asyncRoute(async (req, res) => res.json(await listWarehouses())));
apiRouter.get('/locations', asyncRoute(async (req, res) => res.json(await listLocations(req.query.warehouseId))));

const operationRoute = (type, requiredLocation, locationKey) => asyncRoute(async (req, res) => {
  const body = req.body || {};
  if (requiredLocation && !body[locationKey]) fail(`${locationKey} is required.`);
  if (type === 'TRANSFER' && body.sourceLocationId === body.destinationLocationId) fail('Transfer locations must differ.');
  const input = { items: validateItems(body.items, type === 'ADJUSTMENT', type === 'RECEIPT') };
  if (type === 'RECEIPT') {
    if (!body.supplier?.trim()) fail('supplier is required.');
    input.supplier = body.supplier.trim(); input.destinationLocationId = body.destinationLocationId;
  }
  if (type === 'DELIVERY') {
    if (!body.customer?.trim()) fail('customer is required.');
    input.customer = body.customer.trim(); input.sourceLocationId = body.sourceLocationId;
  }
  if (type === 'TRANSFER') {
    if (!body.sourceLocationId || !body.destinationLocationId) fail('sourceLocationId and destinationLocationId are required.');
    input.sourceLocationId = body.sourceLocationId; input.destinationLocationId = body.destinationLocationId;
  }
  if (type === 'ADJUSTMENT') input.destinationLocationId = body.locationId;
  const id = await createOperation(type, input, req.user.id);
  res.status(201).json({ id, status: 'READY', operation: await getOperation(id) });
});

apiRouter.post('/operations/receipts', operationRoute('RECEIPT', true, 'destinationLocationId'));
apiRouter.post('/operations/deliveries', operationRoute('DELIVERY', true, 'sourceLocationId'));
apiRouter.post('/operations/transfers', operationRoute('TRANSFER'));
apiRouter.post('/operations/adjustments', operationRoute('ADJUSTMENT', true, 'locationId'));
apiRouter.post('/operations/:id/validate', asyncRoute(async (req, res) => res.json(await validateOperation(req.params.id, req.user.id))));
apiRouter.get('/operations', asyncRoute(async (req, res) => res.json(await listOperations(req.query))));
apiRouter.get('/ledger', asyncRoute(async (req, res) => res.json(await listLedger(req.query))));

apiRouter.post('/agent/chat', asyncRoute(async (req, res) => {
  if (typeof req.body?.message !== 'string' || !req.body.message.trim()) fail('message is required.');
  res.json(await chat(req.body.message.trim()));
}));
apiRouter.post('/agent/recommendations/:id/approve', asyncRoute(async (req, res) => {
  res.json(await approveRecommendation(req.params.id, req.user.id));
}));
apiRouter.post('/agent/recommendations/:id/reject', asyncRoute(async (req, res) => {
  res.json(await rejectRecommendation(req.params.id));
}));