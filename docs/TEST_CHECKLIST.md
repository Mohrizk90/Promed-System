# Promed - Full Test Checklist

Run `npm run dev` and test manually at http://localhost:5173

## 1. Client Transactions (/)
- [ ] Page loads with transaction table
- [ ] **Export CSV** – triggers download
- [ ] **Add New Transaction** – modal opens with form (Client, Product, Unit Price, Quantity, Total, Paid, Date)
- [ ] **Unit Price** – visible in form and table
- [ ] Month filters – ‹ ›, Current Month, All Months work
- [ ] **Include past remaining amounts** – checkbox toggles
- [ ] **Payments** – expand row shows payment history
- [ ] **Edit** – opens modal with pre-filled data
- [ ] **Delete** – confirms and removes transaction

## 2. Supplier Transactions (/suppliers)
- [ ] Same checks as Client Transactions
- [ ] Unit Price in table and form
- [ ] Export CSV, Add, Edit, Delete, Payments

## 3. Clients & Suppliers (/entities)
- [ ] **Clients** – Add Client, form (Name, Contact, Address), Save, Edit, Delete
- [ ] **Suppliers** – Add Supplier, form, Save, Edit, Delete
- [ ] Export CSV for both sections
- [ ] Tables show client/supplier names

## 4. Dashboard (/dashboard)
- [ ] Metric cards display (Revenue, Expenses, Profit, Cash Flow)
- [ ] Date filters – All Time, This Month, This Quarter, This Year
- [ ] **Revenue vs Expenses** – Line chart renders
- [ ] **Payment Status Distribution** – Pie chart renders
- [ ] **Top 5 Clients** – Bar chart renders
- [ ] **Top 5 Suppliers** – Bar chart renders
- [ ] **Top Products** – table with columns

## 5. Language Switcher
- [ ] Click **العربية** – UI switches to Arabic (RTL)
- [ ] Nav: لوحة عامة, معاملات العملاء, etc.
- [ ] Click **English** – switches back to English (LTR)

## 6. Unit Tests
```bash
npm run test
```
- [ ] All tests pass (translations, exportCsv, App)

## 7. Build
```bash
npm run build
```
- [ ] Build completes without errors
