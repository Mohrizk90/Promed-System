# Promed - Transaction Management System

A modern frontend application for managing client and supplier transactions, built with React and Supabase.

## Features

- **Client Transactions**: View, add, edit, and delete client sales transactions
- **Supplier Transactions**: Manage supplier purchase transactions
- **Payments Breakdown**: Detailed view of payments for both clients and suppliers
- **Real-time Updates**: Automatic UI updates when data changes in the database
- **CRUD Operations**: Full create, read, update, and delete functionality
- **Responsive Design**: Modern UI built with Tailwind CSS

## Tech Stack

- **React 18** - UI framework
- **Vite** - Build tool and dev server
- **Supabase** - Backend as a service (database, real-time subscriptions)
- **Tailwind CSS** - Styling
- **React Router** - Navigation

## Setup Instructions

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Supabase

1. Get your Supabase anon key from your Supabase project dashboard:
   - Go to Settings → API
   - Copy the "anon public" key

2. Create a `.env` file in the root directory:

```env
VITE_SUPABASE_ANON_KEY=your_anon_key_here
```

Alternatively, you can directly edit `src/lib/supabase.js` and replace `YOUR_ANON_KEY_HERE` with your actual anon key.

### 3. Enable Realtime in Supabase

To enable real-time updates, you need to enable Realtime for your tables in Supabase:

1. Go to your Supabase dashboard
2. Navigate to Database → Replication
3. Enable replication for the following tables:
   - `client_transactions`
   - `supplier_transactions`
   - `payments`

### 4. Run the Development Server

```bash
npm run dev
```

The application will be available at `http://localhost:5173`

### 5. Build for Production

```bash
npm run build
```

The built files will be in the `dist` directory.

## Database Schema

The application expects the following tables in your Supabase database:

- `clients` - Client information
- `suppliers` - Supplier information
- `products` - Product catalog
- `client_transactions` - Sales transactions
- `supplier_transactions` - Purchase transactions
- `payments` - Payment records

See the SQL schema provided in the project documentation for table structures.

## Usage

### Client Transactions

- View all client transactions with summary totals
- Add new transactions by clicking "Add Transaction"
- Edit existing transactions
- Delete transactions
- View remaining balances

### Supplier Transactions

- Manage supplier purchase transactions
- Track payments made to suppliers
- View outstanding balances

### Payments Breakdown

- View detailed payment history for clients and suppliers
- Add new payments to transactions
- Delete payment records
- See total amounts, paid amounts, and remaining balances grouped by client/supplier

## Environment Variables

- `VITE_SUPABASE_URL` - Your Supabase project URL (e.g. `https://xxxx.supabase.co`)
- `VITE_SUPABASE_ANON_KEY` - Your Supabase anonymous/public key (required)

Copy `.env.example` to `.env` and fill in your values for local development.

## Deploy on Vercel

1. **Push your code** to GitHub, GitLab, or Bitbucket.

2. **Import the project** on [Vercel](https://vercel.com):
   - Go to [vercel.com/new](https://vercel.com/new)
   - Import your repository
   - Vercel will detect the Vite app (build: `npm run build`, output: `dist`)

3. **Set environment variables** in the Vercel project:
   - Project → **Settings** → **Environment Variables**
   - Add:
     - `VITE_SUPABASE_URL` = your Supabase project URL (e.g. `https://xxxx.supabase.co`)
     - `VITE_SUPABASE_ANON_KEY` = your Supabase anon/public key

4. **Redeploy** after saving the env vars so the build picks them up.

5. **Supabase Auth (optional):** If using Supabase Auth, add your Vercel site URL in Supabase:
   - **Authentication** → **URL Configuration** → add `https://your-app.vercel.app` to Site URL and Redirect URLs.

The `vercel.json` in the repo configures:
- SPA routing (all routes → `index.html` for React Router)
- Security headers
- Long-lived cache for `/assets/*`

## Notes

- The application connects directly to Supabase without a backend server
- All database operations are handled through Supabase's REST API
- Real-time updates are enabled via Supabase Realtime subscriptions
- Make sure Row Level Security (RLS) policies are configured appropriately in Supabase if you need authentication

## Troubleshooting

### Real-time updates not working

- Ensure Realtime is enabled for your tables in Supabase dashboard
- Check that your Supabase anon key is correct
- Verify network connectivity

### Database connection errors

- Verify your Supabase URL and anon key are correct
- Check that your Supabase project is active
- Ensure the database tables exist and match the expected schema
