/**
 * Server-side replica of the web app's client statement document
 * (src/components/ClientStatementModal.jsx → .client-statement-document)
 * rendered to a self-contained HTML page, then printed to PDF by headless
 * Chrome — the same engine as the user's Ctrl+P, so the output matches the
 * system's printed statement instead of a hand-drawn jsPDF template.
 *
 * Ledger rows and totals come from the SAME shared functions the UI uses
 * (buildStatementRows / formatStatementPeriod / getClientAccountSummary),
 * dynamically imported from src/utils — one source of truth for the math.
 */
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { logger } from '../logger.js';

type Client = {
  client_id: number | string;
  client_name: string | null;
  contact_info: string | null;
  address: string | null;
  opening_balance: number;
};

type Tx = {
  transaction_id: number | string;
  transaction_date: string | null;
  total_amount: number;
  invoice_number: string | null;
  external_invoice_number?: string | null;
  status: string | null;
};

type Pay = {
  transaction_id: number | string | null;
  payment_date: string | null;
  payment_amount: number;
  payment_method: string | null;
  notes?: string | null;
};

export type StatementHtmlInput = {
  client: Client;
  transactions: Tx[];
  payments: Pay[];
  company: {
    companyName: string;
    companyAddress: string;
    companyPhone: string;
    companyEmail: string;
    companyTagline: string;
  };
  options: {
    language?: 'en' | 'ar';
    dateFrom?: string | null;
    dateTo?: string | null;
    openingBalance?: number;
  };
};

// Same strings as src/translations/index.js (entities.* / clientTransactions.* / common.*).
const L = {
  en: {
    statementTitle: 'Statement',
    statementNumber: 'Statement #',
    date: 'Date',
    billTo: 'Bill To',
    colDate: 'Date',
    colType: 'Type',
    colInv: 'Invoice #',
    colInvAmount: 'INV. Amount',
    colPayment: 'Payment',
    colBalance: 'Balance',
    openingBalance: 'OPENING BALANCE',
    invoice: 'Invoice',
    payment: 'Payment',
    accountPayment: 'Account Payment',
    totals: 'Totals',
    totalAmount: 'Total Amount',
    paidAmount: 'Paid Amount',
    remainingAmount: 'Remaining Amount',
    customerCredit: 'Customer Credit',
    noData: 'No activity in this period',
    currency: 'EGP',
  },
  ar: {
    statementTitle: 'كشف حساب',
    statementNumber: 'رقم الكشف',
    date: 'التاريخ',
    billTo: 'فاتورة إلى',
    colDate: 'التاريخ',
    colType: 'النوع',
    colInv: 'رقم الفاتورة',
    colInvAmount: 'مبلغ الفاتورة',
    colPayment: 'الدفعة',
    colBalance: 'الرصيد',
    openingBalance: 'رصيد افتتاحي',
    invoice: 'فاتورة',
    payment: 'دفعة',
    accountPayment: 'دفعة على الحساب',
    totals: 'الإجماليات',
    totalAmount: 'المبلغ الإجمالي',
    paidAmount: 'المبلغ المدفوع',
    remainingAmount: 'المبلغ المتبقي',
    customerCredit: 'رصيد دائن للعميل',
    noData: 'لا توجد حركة في هذه الفترة',
    currency: 'ج.م',
  },
};

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtNum(n: number): string {
  return (Number(n) || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtTableDate(value: string | null): string {
  if (!value) return '—';
  const str = String(value);
  const d = new Date(str.includes('T') ? str : `${str}T00:00:00`);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-GB');
}

function repoRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '..', '..', '..');
}

async function importShared(): Promise<{
  buildStatementRows: Function;
  formatStatementPeriod: Function;
  getClientAccountSummary: Function;
}> {
  const root = repoRoot().replace(/\\/g, '/');
  const base = root.startsWith('/') ? root : `/${root}`;
  const gen = await import(`file://${encodeURI(base)}/src/utils/generateStatement.js`);
  const alloc = await import(`file://${encodeURI(base)}/src/utils/paymentAllocation.js`);
  return {
    buildStatementRows: gen.buildStatementRows,
    formatStatementPeriod: gen.formatStatementPeriod,
    getClientAccountSummary: alloc.getClientAccountSummary,
  };
}

let _fontCss: string | null | undefined;
async function amiriFontCss(): Promise<string> {
  if (_fontCss !== undefined) return _fontCss ?? '';
  try {
    const dir = path.join(repoRoot(), 'public', 'fonts');
    const [reg, bold] = await Promise.all([
      fs.readFile(path.join(dir, 'Amiri-Regular.ttf')),
      fs.readFile(path.join(dir, 'Amiri-Bold.ttf')),
    ]);
    _fontCss = `
@font-face { font-family: 'Amiri'; font-weight: 400; src: url(data:font/ttf;base64,${reg.toString('base64')}) format('truetype'); }
@font-face { font-family: 'Amiri'; font-weight: 700; src: url(data:font/ttf;base64,${bold.toString('base64')}) format('truetype'); }`;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'Amiri fonts unavailable for HTML statement');
    _fontCss = null;
  }
  return _fontCss ?? '';
}

export async function buildStatementHtml(input: StatementHtmlInput): Promise<string> {
  const { client, transactions, payments, company, options } = input;
  const lang = options.language === 'en' ? 'en' : 'ar';
  const t = L[lang];
  const isAr = lang === 'ar';
  const openingBalance = Number(options.openingBalance ?? client.opening_balance ?? 0);

  const { buildStatementRows, formatStatementPeriod, getClientAccountSummary } =
    await importShared();

  const rows: Array<{
    date: string | null;
    type: string;
    invoiceNumber: string;
    invAmount: number | '';
    payment: number | '';
    balance: number;
  }> = buildStatementRows(transactions, payments, {
    dateFrom: options.dateFrom ?? null,
    dateTo: options.dateTo ?? null,
    openingBalance,
  });

  // Headline totals = whole-account position, same as computeStatementSummary
  // in ClientStatementModal.jsx (date range only filters ledger rows).
  const { totalInvoiced, totalPaid, balance } = getClientAccountSummary(
    transactions,
    payments,
    openingBalance,
  );
  const openingCredit = Math.max(0, -openingBalance);
  const summary = { total: totalInvoiced, paid: totalPaid + openingCredit, remaining: balance };
  const isCredit = summary.remaining < 0;

  const cur = (v: number | ''): string => {
    if (v === '' || v == null) return '';
    const s = fmtNum(v);
    return isAr ? `${s} ${t.currency}` : `${t.currency} ${s}`;
  };

  const typeLabel = (type: string): string => {
    if (type === 'openingBalance') return t.openingBalance;
    if (type === 'invoice') return t.invoice;
    if (type === 'accountPayment') return t.accountPayment;
    if (type === 'payment') return t.payment;
    return type;
  };

  const period = formatStatementPeriod(options.dateFrom ?? '', options.dateTo ?? '');
  const today = new Date().toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const clientName = client.client_name || '—';

  const bodyRows = rows
    .map(
      (row) => `
      <tr>
        <td class="c-date">${esc(fmtTableDate(row.date))}</td>
        <td class="c-type ${row.type === 'openingBalance' ? 'opening' : ''}">${esc(typeLabel(row.type))}</td>
        <td class="c-inv">${esc(row.invoiceNumber || '—')}</td>
        <td class="c-amount">${row.invAmount !== '' ? esc(cur(row.invAmount)) : ''}</td>
        <td class="c-amount">${row.payment !== '' ? esc(cur(row.payment)) : ''}</td>
        <td class="c-amount">${esc(cur(row.balance))}</td>
      </tr>`,
    )
    .join('');

  const contactLines = [company.companyAddress, company.companyPhone, company.companyEmail]
    .filter(Boolean)
    .map((l) => `<p>${esc(l)}</p>`)
    .join('');

  const fontCss = await amiriFontCss();

  // Styling mirrors the Tailwind classes on .client-statement-document plus the
  // print rules in src/index.css (.client-statement-table thead #374151, zebra
  // #f9fafb, summary boxes blue-50/green-50/red-50 with print-color-adjust).
  return `<!DOCTYPE html>
<html lang="${lang}" dir="${isAr ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8">
<style>
${fontCss}
* { margin: 0; padding: 0; box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body {
  font-family: ${fontCss ? "'Amiri', " : ''}'Segoe UI', Tahoma, Arial, sans-serif;
  color: #111827;
  font-size: 12px;
  padding: 8px 4px;
}
.doc { width: 100%; background: #fff; }
.company-head { text-align: center; border-bottom: 1px solid #d1d5db; padding-bottom: 12px; margin-bottom: 12px; }
.company-head .name { font-size: 14px; font-weight: 700; color: #111827; }
.company-head .contact { margin-top: 4px; font-size: 11px; color: #4b5563; line-height: 1.5; }
.company-head .tagline { font-size: 11px; color: #6b7280; margin-top: 4px; }
h1.title { text-align: center; font-size: 14px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; }
.title-rule { border-bottom: 1px solid #9ca3af; margin: 8px 0 14px; }
.meta { display: flex; justify-content: space-between; gap: 16px; margin-bottom: 16px; font-size: 12px; }
.meta dt { font-weight: 600; color: #374151; display: inline; }
.meta dd { display: inline; color: #111827; margin-inline-start: 6px; }
.meta .row { margin-bottom: 4px; }
.meta .bill { text-align: ${isAr ? 'left' : 'right'}; }
.meta .bill .who { font-weight: 700; }
.meta .bill .sub { color: #4b5563; }
table.ledger { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 11px; }
table.ledger col.w-date { width: 13%; }
table.ledger col.w-type { width: 20%; }
table.ledger col.w-inv { width: 13%; }
table.ledger col.w-amt { width: 18%; }
table.ledger thead tr { background: #374151; color: #fff; }
table.ledger th {
  padding: 6px 8px; font-size: 10px; font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.04em; text-align: start; color: #fff;
}
table.ledger th.c-amount-h { text-align: end; }
table.ledger th.c-inv-h { text-align: center; }
table.ledger td { padding: 5px 8px; border-top: 1px solid #e5e7eb; vertical-align: top; font-variant-numeric: tabular-nums; }
table.ledger tbody tr:nth-child(even) { background: #f9fafb; }
td.c-date { white-space: nowrap; }
td.c-type { overflow-wrap: break-word; }
td.c-type.opening { font-weight: 700; text-transform: uppercase; }
td.c-inv { text-align: center; white-space: nowrap; }
td.c-amount { text-align: end; white-space: nowrap; }
.summary { margin-top: 20px; padding-top: 16px; border-top: 2px solid #9ca3af; break-inside: avoid; page-break-inside: avoid; }
.summary .heading { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: #374151; text-align: center; margin-bottom: 12px; }
.summary .boxes { display: flex; gap: 12px; }
.summary .box { flex: 1; text-align: center; padding: 12px; border-radius: 6px; }
.summary .box .label { font-weight: 600; color: #374151; font-size: 11px; }
.summary .box .value { font-size: 13px; font-weight: 700; margin-top: 4px; font-variant-numeric: tabular-nums; }
.box.total { background: #eff6ff; border: 1px solid #bfdbfe; }
.box.total .value { color: #111827; }
.box.paid { background: #f0fdf4; border: 1px solid #bbf7d0; }
.box.paid .value { color: #166534; }
.box.remaining { background: #fef2f2; border: 1px solid #fecaca; }
.box.remaining .value { color: ${isCredit ? '#166534' : '#991b1b'}; }
.no-data { text-align: center; color: #6b7280; padding: 32px 0; font-size: 12px; }
</style>
</head>
<body>
<div class="doc">
  <div class="company-head">
    <p class="name">${esc(company.companyName)}</p>
    ${contactLines ? `<div class="contact">${contactLines}</div>` : ''}
    ${company.companyTagline ? `<p class="tagline">${esc(company.companyTagline)}</p>` : ''}
  </div>

  <h1 class="title">${esc(t.statementTitle)} ${esc(company.companyName)} - ${esc(clientName)}</h1>
  <div class="title-rule"></div>

  <div class="meta">
    <div>
      <div class="row"><dt>${esc(t.statementNumber)}:</dt><dd>${esc(period)}</dd></div>
      <div class="row"><dt>${esc(t.date)}:</dt><dd>${esc(today)}</dd></div>
    </div>
    <div class="bill">
      <div class="row"><dt>${esc(t.billTo)}:</dt></div>
      <div class="row who">${esc(clientName)}</div>
      ${client.address?.trim() ? `<div class="row sub">${esc(client.address.trim())}</div>` : ''}
      ${client.contact_info?.trim() ? `<div class="row sub">${esc(client.contact_info.trim())}</div>` : ''}
    </div>
  </div>

  ${
    rows.length === 0
      ? `<p class="no-data">${esc(t.noData)}</p>`
      : `
  <table class="ledger">
    <colgroup>
      <col class="w-date"><col class="w-type"><col class="w-inv"><col class="w-amt"><col class="w-amt"><col class="w-amt">
    </colgroup>
    <thead>
      <tr>
        <th>${esc(t.colDate)}</th>
        <th>${esc(t.colType)}</th>
        <th class="c-inv-h">${esc(t.colInv)}</th>
        <th class="c-amount-h">${esc(t.colInvAmount)}</th>
        <th class="c-amount-h">${esc(t.colPayment)}</th>
        <th class="c-amount-h">${esc(t.colBalance)}</th>
      </tr>
    </thead>
    <tbody>${bodyRows}</tbody>
  </table>

  <div class="summary">
    <p class="heading">${esc(t.totals)}</p>
    <div class="boxes">
      <div class="box total"><p class="label">${esc(t.totalAmount)}</p><p class="value">${esc(cur(summary.total))}</p></div>
      <div class="box paid"><p class="label">${esc(t.paidAmount)}</p><p class="value">${esc(cur(summary.paid))}</p></div>
      <div class="box remaining"><p class="label">${esc(isCredit ? t.customerCredit : t.remainingAmount)}</p><p class="value">${esc(cur(Math.abs(summary.remaining)))}</p></div>
    </div>
  </div>`
  }
</div>
</body>
</html>`;
}
