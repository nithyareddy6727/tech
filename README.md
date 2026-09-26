# StockSense Frontend

React + Vite inventory UI for the StockSense REST API. The frontend uses Supabase Auth directly and sends the current Supabase access token as a bearer token to the Express API. It contains no service-role key or LLM secret.

## Local setup

1. Install Node.js 20.19+ or 22.12+.
2. Copy `.env.example` to `.env.local` and set the Supabase project URL, publishable/anon key, and API base URL.
3. Install and run:

```sh
npm install
npm run dev
```

The API defaults to `http://localhost:5000`. Run the separately maintained Express backend and configure its CORS origin for the Vite URL. The frontend repository does not include the backend or database migrations.

## Environment variables

| Variable | Used for |
| --- | --- |
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Browser-safe Supabase publishable/anon key |
| `VITE_API_BASE_URL` | Express API origin, e.g. `http://localhost:5000` |

Never put `SUPABASE_SERVICE_ROLE_KEY` or `LLM_API_KEY` in a Vite variable. `.env.local` is ignored by Git.

## Password reset OTP

The UI requests a Supabase recovery email, accepts its one-time token, verifies it with `type: recovery`, then sets the new password. For an actual numeric/code OTP (rather than a recovery link), configure the Supabase **Reset Password** email template to display `{{ .Token }}`. The default template may send a recovery link instead; in that configuration the OTP form will not work as intended. This frontend does not claim link-based recovery is OTP.

## Routes

- `/login`, `/signup`, `/forgot-password`
- `/` and `/dashboard`
- `/products`
- `/operations/receipts`, `/operations/deliveries`, `/operations/transfers`, `/operations/adjustments`
- `/history`, `/ai`, `/settings/warehouse`, `/profile`

## API integration

The shared client in `src/lib/api.js` uses `VITE_API_BASE_URL`, adds JSON headers, includes the current Supabase access token when available, and surfaces network/API errors. Implemented calls cover health, dashboard, products, warehouses/locations, operations and validation, ledger history, AI chat, and recommendation approve/reject.

The UI stays aligned to the supplied v1 API request shapes. A few response details are not specified in that contract: collection envelope names, IDs returned by operation creation, and recommendation IDs returned by chat. The UI accepts array or named collection envelopes; it can validate/approve only when the corresponding response includes `id` (or `operationId` for operation creation). If no ID is returned, it displays the limitation instead of inventing one. The contract also defines only warehouse/location reads, so warehouse CRUD and category CRUD are not exposed here.

## Build and Vercel

```sh
npm run build
npm run preview
```

Import the repository into Vercel with the project root set to this directory. The included `vercel.json` rewrites app routes to `index.html`. Add `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, and `VITE_API_BASE_URL` in Vercel Project Settings for the Production and Preview environments, then deploy. Configure the Supabase Auth site URL and redirect URLs for the deployed frontend domain, and allow that domain in backend CORS.

## Current integration boundary

This repository is frontend-only. No Express service, Supabase schema/seed, production credentials, or deployed endpoints were present in the workspace, so live inventory/auth flows require those external services to be configured. Verify the backend health endpoint and all mutation flows against the deployed API before the demo.# tech
xyz
