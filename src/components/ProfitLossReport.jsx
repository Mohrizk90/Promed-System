import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../context/ToastContext'
import { useLanguage } from '../context/LanguageContext'
import LoadingSpinner from './LoadingSpinner'
import { downloadCsv } from '../utils/exportCsv'
import { Printer, Download, TrendingUp, TrendingDown } from './ui/Icons'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, Legend, ResponsiveContainer,
} from 'recharts'

const PERIOD_OPTIONS = ['monthly', 'quarterly', 'yearly', 'custom']

function getMonthKey(date) {
  const d = new Date(date)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function getQuarterKey(date) {
  const d = new Date(date)
  const q = Math.ceil((d.getMonth() + 1) / 3)
  return `${d.getFullYear()}-Q${q}`
}

function getYearKey(date) {
  return `${new Date(date).getFullYear()}`
}

export default function ProfitLossReport() {
  const [clientTx, setClientTx] = useState([])
  const [supplierTx, setSupplierTx] = useState([])
  const [liabilities, setLiabilities] = useState([])
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState('monthly')
  const [customRange, setCustomRange] = useState({ start: '', end: '' })
  const { error: showError } = useToast()
  const { t, language } = useLanguage()

  const formatNum = (n) => (Number(n) ?? 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })
  const currency = t('common.currency')
  const formatCurrency = (n) => (language === 'ar' ? formatNum(n) + ' ' + currency : currency + ' ' + formatNum(n))

  useEffect(() => { fetchData() }, [])

  const fetchData = async () => {
    setLoading(true)
    try {
      const [cRes, sRes, lRes] = await Promise.all([
        supabase.from('client_transactions').select('*').order('transaction_date'),
        supabase.from('supplier_transactions').select('*').order('transaction_date'),
        supabase.from('liabilities').select('*'),
      ])
      if (cRes.error) throw cRes.error
      if (sRes.error) throw sRes.error
      setClientTx(cRes.data || [])
      setSupplierTx(sRes.data || [])
      setLiabilities(lRes.error ? [] : (lRes.data || []))
    } catch (err) {
      showError('Error loading P&L data: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  const getPeriodKey = (date) => {
    if (period === 'quarterly') return getQuarterKey(date)
    if (period === 'yearly') return getYearKey(date)
    return getMonthKey(date)
  }

  // Filter by custom range if active
  const inRange = (date) => {
    if (period !== 'custom') return true
    if (customRange.start && date < customRange.start) return false
    if (customRange.end && date > customRange.end) return false
    return true
  }

  const pnlData = useMemo(() => {
    const periods = new Map()

    const ensurePeriod = (key) => {
      if (!periods.has(key)) periods.set(key, { period: key, revenue: 0, cogs: 0, expenses: 0 })
    }

    clientTx.forEach((tx) => {
      if (!inRange(tx.transaction_date)) return
      const key = period === 'custom' ? 'custom' : getPeriodKey(tx.transaction_date)
      ensurePeriod(key)
      periods.get(key).revenue += parseFloat(tx.total_amount || 0)
    })

    supplierTx.forEach((tx) => {
      if (!inRange(tx.transaction_date)) return
      const key = period === 'custom' ? 'custom' : getPeriodKey(tx.transaction_date)
      ensurePeriod(key)
      periods.get(key).cogs += parseFloat(tx.total_amount || 0)
    })

    liabilities.forEach((l) => {
      const date = l.due_date || l.created_at?.split('T')[0]
      if (!date || !inRange(date)) return
      const key = period === 'custom' ? 'custom' : getPeriodKey(date)
      ensurePeriod(key)
      periods.get(key).expenses += parseFloat(l.total_amount || 0)
    })

    return Array.from(periods.values())
      .sort((a, b) => a.period.localeCompare(b.period))
      .map((p) => ({
        ...p,
        grossProfit: p.revenue - p.cogs,
        netProfit: p.revenue - p.cogs - p.expenses,
        margin: p.revenue > 0 ? ((p.revenue - p.cogs) / p.revenue * 100) : 0,
      }))
  }, [clientTx, supplierTx, liabilities, period, customRange])

  // Totals
  const totals = useMemo(() => {
    return pnlData.reduce((acc, p) => ({
      revenue: acc.revenue + p.revenue,
      cogs: acc.cogs + p.cogs,
      grossProfit: acc.grossProfit + p.grossProfit,
      expenses: acc.expenses + p.expenses,
      netProfit: acc.netProfit + p.netProfit,
    }), { revenue: 0, cogs: 0, grossProfit: 0, expenses: 0, netProfit: 0 })
  }, [pnlData])

  const totalMargin = totals.revenue > 0 ? ((totals.grossProfit / totals.revenue) * 100).toFixed(1) : '0.0'

  // Previous period comparison (last entry vs second-to-last)
  const comparison = useMemo(() => {
    if (pnlData.length < 2) return null
    const curr = pnlData[pnlData.length - 1]
    const prev = pnlData[pnlData.length - 2]
    const pctChange = (curr_val, prev_val) => prev_val !== 0 ? (((curr_val - prev_val) / Math.abs(prev_val)) * 100).toFixed(1) : null
    return {
      revenue: pctChange(curr.revenue, prev.revenue),
      cogs: pctChange(curr.cogs, prev.cogs),
      grossProfit: pctChange(curr.grossProfit, prev.grossProfit),
      netProfit: pctChange(curr.netProfit, prev.netProfit),
      currentLabel: curr.period,
      prevLabel: prev.period,
    }
  }, [pnlData])

  const handleExport = () => {
    const rows = pnlData.map((p) => ({
      [t('pnl.period')]: p.period,
      [t('pnl.revenue')]: p.revenue,
      [t('pnl.cogs')]: p.cogs,
      [t('pnl.grossProfit')]: p.grossProfit,
      [t('pnl.margin')]: p.margin.toFixed(1) + '%',
      [t('pnl.expenses')]: p.expenses,
      [t('pnl.netProfit')]: p.netProfit,
    }))
    downloadCsv('profit_loss_report.csv', rows)
  }

  if (loading) return <div className="flex items-center justify-center min-h-[300px]"><LoadingSpinner size="lg" /></div>

  return (
    <div className="space-y-4 pb-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
        <div>
          <h2 className="text-xl font-bold text-gray-900">{t('pnl.title')}</h2>
          <p className="text-gray-600 text-sm">{t('pnl.subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => window.print()} className="btn btn-secondary py-1.5 px-3 text-sm"><Printer size={16} /> {t('common.print')}</button>
          <button onClick={handleExport} className="btn btn-secondary py-1.5 px-3 text-sm"><Download size={16} /> {t('common.exportCsv')}</button>
        </div>
      </div>

      {/* Period Selector */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex bg-gray-100 rounded-lg p-1">
          {PERIOD_OPTIONS.map((p) => (
            <button key={p} onClick={() => setPeriod(p)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${period === p ? 'bg-blue-600 text-white shadow' : 'text-gray-600 hover:bg-gray-200'}`}>
              {t('pnl.period_' + p)}
            </button>
          ))}
        </div>
        {period === 'custom' && (
          <div className="flex items-center gap-2">
            <input type="date" value={customRange.start} onChange={(e) => setCustomRange({ ...customRange, start: e.target.value })}
              className="input py-2 text-sm w-36 rounded-lg border-gray-300" />
            <span className="text-gray-400">-</span>
            <input type="date" value={customRange.end} onChange={(e) => setCustomRange({ ...customRange, end: e.target.value })}
              className="input py-2 text-sm w-36 rounded-lg border-gray-300" />
          </div>
        )}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="card p-4 border-l-4 border-blue-500">
          <p className="text-xs text-gray-500 font-medium">{t('pnl.revenue')}</p>
          <p className="text-xl font-bold text-gray-900">{formatCurrency(totals.revenue)}</p>
          {comparison?.revenue && (
            <p className={`text-xs mt-1 ${parseFloat(comparison.revenue) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {parseFloat(comparison.revenue) >= 0 ? '+' : ''}{comparison.revenue}%
            </p>
          )}
        </div>
        <div className="card p-4 border-l-4 border-orange-500">
          <p className="text-xs text-gray-500 font-medium">{t('pnl.cogs')}</p>
          <p className="text-xl font-bold text-gray-900">{formatCurrency(totals.cogs)}</p>
        </div>
        <div className="card p-4 border-l-4 border-green-500">
          <p className="text-xs text-gray-500 font-medium">{t('pnl.grossProfit')}</p>
          <p className="text-xl font-bold text-gray-900">{formatCurrency(totals.grossProfit)}</p>
          <p className="text-xs text-gray-500 mt-1">{t('pnl.margin')}: {totalMargin}%</p>
        </div>
        <div className="card p-4 border-l-4 border-red-500">
          <p className="text-xs text-gray-500 font-medium">{t('pnl.expenses')}</p>
          <p className="text-xl font-bold text-gray-900">{formatCurrency(totals.expenses)}</p>
        </div>
        <div className={`card p-4 border-l-4 ${totals.netProfit >= 0 ? 'border-emerald-500' : 'border-red-600'}`}>
          <p className="text-xs text-gray-500 font-medium">{t('pnl.netProfit')}</p>
          <p className={`text-xl font-bold ${totals.netProfit >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{formatCurrency(totals.netProfit)}</p>
          {comparison?.netProfit && (
            <p className={`text-xs mt-1 ${parseFloat(comparison.netProfit) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {parseFloat(comparison.netProfit) >= 0 ? '+' : ''}{comparison.netProfit}%
            </p>
          )}
        </div>
      </div>

      {/* Chart */}
      {pnlData.length > 0 && period !== 'custom' && (
        <div className="card p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">{t('pnl.chartTitle')}</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={pnlData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="period" fontSize={11} />
              <YAxis fontSize={11} />
              <RechartsTooltip formatter={(val) => formatCurrency(val)} />
              <Legend />
              <Bar dataKey="revenue" name={t('pnl.revenue')} fill="#3b82f6" radius={[2, 2, 0, 0]} />
              <Bar dataKey="cogs" name={t('pnl.cogs')} fill="#f97316" radius={[2, 2, 0, 0]} />
              <Bar dataKey="grossProfit" name={t('pnl.grossProfit')} fill="#22c55e" radius={[2, 2, 0, 0]} />
              <Bar dataKey="expenses" name={t('pnl.expenses')} fill="#ef4444" radius={[2, 2, 0, 0]} />
              <Bar dataKey="netProfit" name={t('pnl.netProfit')} fill="#10b981" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Table */}
      <div className="bg-white shadow rounded overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 text-xs">
          <thead className="bg-gray-100">
            <tr>
              <th className="px-3 py-2 text-left font-semibold text-gray-700 uppercase">{t('pnl.period')}</th>
              <th className="px-3 py-2 text-right font-semibold text-gray-700 uppercase">{t('pnl.revenue')}</th>
              <th className="px-3 py-2 text-right font-semibold text-gray-700 uppercase">{t('pnl.cogs')}</th>
              <th className="px-3 py-2 text-right font-semibold text-gray-700 uppercase">{t('pnl.grossProfit')}</th>
              <th className="px-3 py-2 text-right font-semibold text-gray-700 uppercase">{t('pnl.margin')}</th>
              <th className="px-3 py-2 text-right font-semibold text-gray-700 uppercase">{t('pnl.expenses')}</th>
              <th className="px-3 py-2 text-right font-semibold text-gray-700 uppercase">{t('pnl.netProfit')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {pnlData.length === 0 ? (
              <tr><td colSpan="7" className="px-3 py-6 text-center text-gray-500">{t('pnl.noData')}</td></tr>
            ) : (
              pnlData.map((row) => (
                <tr key={row.period} className="hover:bg-gray-50">
                  <td className="px-3 py-2 font-medium text-gray-900">{row.period}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-blue-700">{formatCurrency(row.revenue)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-orange-700">{formatCurrency(row.cogs)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-green-700">{formatCurrency(row.grossProfit)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-600">{row.margin.toFixed(1)}%</td>
                  <td className="px-3 py-2 text-right tabular-nums text-red-700">{formatCurrency(row.expenses)}</td>
                  <td className={`px-3 py-2 text-right tabular-nums font-medium ${row.netProfit >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{formatCurrency(row.netProfit)}</td>
                </tr>
              ))
            )}
          </tbody>
          {pnlData.length > 1 && (
            <tfoot className="bg-gray-50 font-semibold">
              <tr>
                <td className="px-3 py-2 text-gray-900">{t('pnl.total')}</td>
                <td className="px-3 py-2 text-right tabular-nums text-blue-700">{formatCurrency(totals.revenue)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-orange-700">{formatCurrency(totals.cogs)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-green-700">{formatCurrency(totals.grossProfit)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-gray-600">{totalMargin}%</td>
                <td className="px-3 py-2 text-right tabular-nums text-red-700">{formatCurrency(totals.expenses)}</td>
                <td className={`px-3 py-2 text-right tabular-nums ${totals.netProfit >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{formatCurrency(totals.netProfit)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  )
}
