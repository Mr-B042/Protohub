# ProtoHub API — Backend Setup Guide

Node.js + Express + Supabase (PostgreSQL) backend for the ProtoHub CRM.

---

## Prerequisites

- Node.js 20+
- A free [Supabase](https://supabase.com) account
- (Optional) [Supabase CLI](https://supabase.com/docs/guides/cli) for local dev

---

## Step 1 — Create a Supabase Project

1. Go to https://supabase.com/dashboard and create a new project
2. Choose a region closest to Nigeria (e.g. **eu-west-1** or **us-east-1**)
3. Save your database password somewhere safe

---

## Step 2 — Run the Database Migrations

In your Supabase project:

1. Go to **SQL Editor**
2. Paste and run `supabase/migrations/001_initial_schema.sql`
3. Then paste and run `supabase/migrations/002_rls_policies.sql`

---

## Step 3 — Get Your API Keys

In Supabase dashboard → **Project Settings → API**:

| Key | Where to use |
|-----|-------------|
| Project URL | `SUPABASE_URL` |
| `anon` public key | `SUPABASE_ANON_KEY` |
| `service_role` secret key | `SUPABASE_SERVICE_ROLE_KEY` |

---

## Step 4 — Configure Environment

```bash
cd backend
cp .env.example .env
# Edit .env and fill in your keys
```

---

## Step 5 — Install and Run

```bash
cd backend
npm install
npm run dev        # Development (hot reload)
npm run build      # Production build
npm start          # Run production build
```

The API runs on **http://localhost:4000** by default.

---

## API Overview

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/register` | Create first account + organization |
| POST | `/api/auth/login` | Login, receive access + refresh tokens |
| POST | `/api/auth/refresh` | Refresh access token |
| GET  | `/api/auth/me` | Current user profile |
| POST | `/api/auth/invite` | Invite a team member (Owner/Admin only) |
| GET  | `/api/products` | List all products with pricing + packages |
| POST | `/api/products` | Create product |
| PATCH | `/api/products/:id` | Update product |
| DELETE | `/api/products/:id` | Delete product |
| GET  | `/api/orders` | List orders (paginated, filterable) |
| POST | `/api/orders` | Create order |
| PATCH | `/api/orders/:id/status` | Update order status |
| GET  | `/api/agents` | List agents with stock |
| POST | `/api/agents/:id/stock` | Assign stock to agent |
| GET  | `/api/stock/movements` | Stock movement history |
| POST | `/api/stock/update` | Manual warehouse stock update |
| GET  | `/api/stock/count-sessions` | List stock count sessions |
| POST | `/api/stock/count-sessions` | Create stock count session |
| PATCH | `/api/stock/count-entries/:id` | Submit agent/admin counts |
| POST | `/api/stock/count-entries/:id/adjust` | Write-off and adjust stock |
| GET  | `/api/expenses` | List expenses |
| POST | `/api/expenses` | Add expense |
| POST | `/api/payroll/generate` | Generate payroll run |
| GET  | `/api/customers` | Derived customer list |
| POST | `/api/customers/flags` | Flag a customer |
| GET  | `/api/notifications` | System notifications |
| PATCH | `/api/notifications/read-all` | Mark all read |
| GET  | `/api/waybills` | List waybill records |

---

## Authentication Flow

All protected endpoints require:
```
Authorization: Bearer <access_token>
```

Tokens expire after 1 hour. Use `POST /api/auth/refresh` with your `refreshToken` to get a new one.

---

## Deploying to Railway

1. Push the `backend/` folder to a GitHub repo
2. Go to https://railway.app → New Project → Deploy from GitHub
3. Set environment variables from `.env`
4. Railway auto-detects Node.js and runs `npm start`
5. Set `FRONTEND_URL` to your Vercel frontend URL for CORS

---

## Deploying Frontend to Vercel

```bash
cd ..   # back to project root
npx vercel
```

Set environment variable in Vercel:
```
VITE_API_URL=https://your-railway-app.railway.app
```
