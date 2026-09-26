# StockSense

Standalone inventory management API and Supabase schema for the StockSense hackathon. The backend is Node.js/Express and the frontend is a separate React/Vite application owned by the frontend developer.

## Backend Setup

Requirements: Node.js 18.18+ and a Supabase project.

1. In the Supabase SQL Editor, run `supabase/migrations/001_initial_schema.sql`.
2. Copy `.env.example` to `server/.env` and set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `LLM_API_KEY`. `LLM_MODEL` defaults to `gpt-4o-mini`.
3. Install and start the API:

```powershell
cd server
npm install
npm run build
npm start
```

4. Confirm `http://localhost:5000/api/health` returns `{"ok":true}`. All other API routes require `Authorization: Bearer <Supabase access token>`.
5. To load demo records, create at least one user in Supabase Auth, then run `supabase/seed.sql` once in the SQL Editor.

Never put the Supabase service-role key or LLM key in Vite variables or browser code. Use Supabase Auth directly from the frontend; the API validates the access token against Supabase Auth.

## API

- `GET /api/health` (public)
- `GET /api/dashboard`
- `GET|POST /api/products`; `PUT /api/products/:id`
- `GET /api/warehouses`; `GET /api/locations?warehouseId=`
- `POST /api/operations/receipts`
- `POST /api/operations/deliveries`
- `POST /api/operations/transfers`
- `POST /api/operations/adjustments`
- `POST /api/operations/:id/validate`; `GET /api/operations`
- `GET /api/ledger`
- `POST /api/agent/chat`
- `POST /api/agent/recommendations/:id/approve`
- `POST /api/agent/recommendations/:id/reject`

Create-operation calls produce `READY` records; inventory changes only on validation. The database RPC locks affected stock rows and commits stock, ledger, and operation status together. Transfer drafts and reorder drafts do not affect inventory until their approval endpoint runs.

## Frontend Integration

Set `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, and `VITE_API_BASE_URL` in the frontend's `.env.local` (the API base URL is `http://localhost:5000` locally). For every protected request, send `Authorization: Bearer ${session.access_token}` and `Content-Type: application/json` when sending JSON. Use Supabase Auth for signup/login/password reset; do not send the publishable key as a substitute for the access token. Configure `FRONTEND_URL` on the backend to the deployed Vercel origin.

Chat responses are `{ message, evidence, recommendation }`. A non-null recommendation contains its `id`, `type`, `parameters`, and `requiresApproval: true`; call the approval route only after explicit user confirmation. Every endpoint's request fields follow the supplied StockSense technical contract.

## Deployment

Deploy the `server` directory as a Node web service on Render with `npm install` and `npm start`. Set `PORT` (Render supplies it), `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `LLM_API_KEY`, `LLM_MODEL`, and `FRONTEND_URL` as Render environment variables. Deploy the frontend separately to Vercel and set its three `VITE_*` variables there. Run the migration and seed SQL against the production Supabase project as appropriate.
