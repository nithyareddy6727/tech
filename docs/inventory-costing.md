# Inventory Costing

StockSense calculates inventory valuation with a moving weighted-average unit cost per product and location. Amounts use the business's chosen account currency; the application does not assume or convert a currency.

## Setup

Apply migrations in order:

1. `supabase/migrations/001_initial_schema.sql`
2. `supabase/migrations/002_inventory_costing.sql`

For demo data, apply `supabase/seed.sql` after creating a Supabase Auth user. The sample products are seeded with explicit illustrative costs.

## Cost Rules

- A receipt must provide a nonnegative `unitCost` for each item. On validation, the destination average becomes `(old quantity * old average + received quantity * receipt unit cost) / new quantity`.
- Initial stock accepts `initialUnitCost`. Positive initial stock requires a known cost; zero-stock products need no cost.
- Deliveries value the outgoing quantity at that location's current weighted-average cost.
- Transfers use the source location's average cost and carry that value into the destination. The source average stays the same; the destination average is reweighted. Total inventory value is preserved, apart from numeric rounding.
- Adjustments use the current location average cost for the quantity difference. They do not invent a new purchase cost.
- A positive stock row with no known average cost remains unvalued. Product and dashboard valuation return `null`/"Unknown" if any positive stock included in that total is uncosted. The migration deliberately does not guess costs for existing inventory.

## API Fields

`POST /api/products` accepts optional `initialUnitCost`; when `initialStock > 0`, it is required. Receipt items accept `unitCost`, required and nonnegative. Product responses include `averageUnitCost`, `totalInventoryValue`, and per-location `average_unit_cost`/`inventory_value`. Dashboard responses include `totalInventoryValue` and `unvaluedStockCount`. Ledger rows include `unit_cost` and `value_change`.
