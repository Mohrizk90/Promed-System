import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../context/ToastContext'
import { useLanguage } from '../context/LanguageContext'
import LoadingSpinner from './LoadingSpinner'
import { downloadCsv } from '../utils/exportCsv'
import { Printer, Download, Users, Truck } from './ui/Icons'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, Legend, ResponsiveContainer,
} from 'recharts'

const BUCKETS = [
  { key: 'current', min: -Infinity, max: 0 },
  { key: '1_30', min: 1, max: 30 },
  { key: '31_60', min: 31, max: 60 },
  { key: '61_90', min: 61, max: 90 },
  { key: '90_plus', min: 91, max: Infinity },
]

function daysPastDue(dueDate, transactionDate) {
  const ref = dueDate || transactionDate
  if (!ref) return 0
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const d = new Date(ref)
  d.setHours(0, 0, 0, 0)
  return Math.floor((today - d) / (1000 * 60 * 60 * 24))
}

function getBucket(days) {
  if (days <= 0) return 'current'
  if (days <= 30) return '1_30'
  if (days <= 60) return '31_60'
  if (days <= 90) return '61_90'
  return '90_plus'
}

export default function AgingReport() {
  const [clientTx, setClientTx] = useState([])
  const [supplierTx, setSupplierTx] = useState([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState('client') // client | supplier
  const [filterEntity, setFilterEntity] = useState('')
  const { error: showError } = useToast()
  const { t, language } = useLanguage()

  const formatNum = (n) => (Number(n) ?? 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })
  const currency = t('common.currency')
  const formatCurrency = (n) => (language === 'ar' ? formatNum(n) + ' ' + currency : currency + ' ' + formatNum(n))

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    setLoading(true)
    try {
      const [cRes, sRes] = await Promise.all([
        supabase.from('client_transactions')
          .select('*, clients:client_id (client_name)')
          .gt('remaining_amount', 0),
        supabase.from('supplier_transactions')
          .select('*, suppliers:supplier_id (supplier_name)')
          .gt('remaining_amount', 0),
      ])
      if (cRes.error) throw cRes.error
      if (sRes.error) throw sRes.error
      setClientTx(cRes.data || [])
      setSupplierTx(sRes.data || [])
    } catch (err) {
      showError('Error loading aging data: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  const data = view === 'client' ? clientTx : supplierTx
  const entityNameField = view === 'client' ? 'client_name' : 'supplier_name'
  const entityRelation = view === 'client' ? 'clients' : 'suppliers'

  const entities = useMemo(() => {
    const map = new Map()
    data.forEach((tx) => {
      const name = tx[entityRelation]?.[entityNameField] || 'Unknown'
      if (!map.has(name)) map.set(name, name)
    })
    return Array.from(map.values()).sort()
  }, [data, entityRelation, entityNameField])

  const filteredData = useMemo(() => {
    if (!filterEntity) return data
    return data.filter((tx) => (tx[entityRelation]?.[entityNameField] || '') === filterEntity)
  }, [data, filterEntity, entityRelation, entityNameField])

  const bucketTotals = useMemo(() => {
    const totals = { current: 0, '1_30': 0, '31_60': 0, '61_90': 0, '90_plus': 0 }
    filteredData.forEach((tx) => {
      const days = daysPastDue(tx.due_date, tx.transaction_date)
      const bucket = getBucket(days)
      totals[bucket] += parseFloat(tx.remaining_amount || 0)
    })
    return totals
  }, [filteredData])

  const grandTotal = Object.values(bucketTotals).reduce((a, b) => a + b, 0)

  const chartData = [
    { name: t('aging.current'), amount: bucketTotals.current },
    { name: '1-30', amount: bucketTotals['1_30'] },
    { name: '31-60', amount: bucketTotals['31_60'] },
    { name: '61-90', amount: bucketTotals['61_90'] },
    { name: '90+', amount: bucketTotals['90_plus'] },
  ]

  const bucketColors = {
    current: 'bg-green-100 text-green-800 border-green-200',
    '1_30': 'bg-yellow-100 text-yellow-800 border-yellow-200',
    '31_60': 'bg-orange-100 text-orange-800 border-orange-200',
    '61_90': 'bg-red-100 text-red-800 border-red-200',
    '90_plus': 'bg-red-200 text-red-900 border-red-300',
  }

  const handleExport = () => {
    const rows = filteredData.map((tx) => {
      const days = daysPastDue(tx.due_date, tx.transaction_date)
      return {
        [t('aging.entity')]: tx[entityRelation]?.[entityNameField] || '',
        [t('common.invoiceNumber')]: tx.invoice_number || '',
        [t('aging.transactionDate')]: tx.transaction_date,
        [t('common.dueDate')]: tx.due_date || '',
        [t('aging.total')]: tx.total_amount,
        [t('aging.paid')]: tx.paid_amount,
        [t('aging.remaining')]: tx.remaining_amount,
        [t('aging.daysPastDue')]: days,
        [t('aging.bucket')]: getBucket(days),
      }
    })
    downloadCsv(`aging_report_${view}.csv`, rows)
  }

  if (loading) return <div className="flex items-center justify-center min-h-[300px]"><LoadingSpinner size="lg" /></div>

  return (
    <div className="space-y-4 pb-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
        <div>
          <h2 className="text-xl font-bold text-gray-900">{t('aging.title')}</h2>
          <p className="text-gray-600 text-sm">{t('aging.subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => window.print()} className="btn btn-secondary py-1.5 px-3 text-sm"><Printer size={16} /> {t('common.print')}</button>
          <button onClick={handleExport} className="btn btn-secondary py-1.5 px-3 text-sm"><Download size={16} /> {t('common.exportCsv')}</button>
        </div>
      </div>

      {/* Toggle + Filter */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex bg-gray-100 rounded-lg p-1">
          <button onClick={() => { setView('client'); setFilterEntity('') }}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${view === 'client' ? 'bg-blue-600 text-white shadow' : 'text-gray-600 hover:bg-gray-200'}`}>
            <Users size={16} /> {t('aging.receivables')}
          </button>
          <button onClick={() => { setView('supplier'); setFilterEntity('') }}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${view === 'supplier' ? 'bg-purple-600 text-white shadow' : 'text-gray-600 hover:bg-gray-200'}`}>
            <Truck size={16} /> {t('aging.payables')}
          </button>
        </div>
        <select value={filterEntity} onChange={(e) => setFilterEntity(e.target.value)}
          className="input py-2 text-sm w-52 rounded-lg border-gray-300">
          <option value="">{t('aging.allEntities')}</option>
          {entities.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
      </div>

      {/* Bucket Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
        {[
          { key: 'current', label: t('aging.current') },
          { key: '1_30', label: '1-30' },
          { key: '31_60', label: '31-60' },
          { key: '61_90', label: '61-90' },
          { key: '90_plus', label: '90+' },
        ].map((b) => (
          <div key={b.key} className={`rounded-lg border p-3 ${bucketColors[b.key]}`}>
            <p className="text-xs font-medium opacity-80">{b.label} {t('aging.days')}</p>
            <p className="text-lg font-bold">{formatCurrency(bucketTotals[b.key])}</p>
          </div>
        ))}
        <div className="rounded-lg border p-3 bg-gray-800 text-white border-gray-700">
          <p className="text-xs font-medium opacity-80">{t('aging.grandTotal')}</p>
          <p className="text-lg font-bold">{formatCurrency(grandTotal)}</p>
        </div>
      </div>

      {/* Chart */}
      <div className="card p-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">{t('aging.agingDistribution')}</h3>
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" fontSize={12} />
            <YAxis fontSize={12} />
            <RechartsTooltip formatter={(val) => formatCurrency(val)} />
            <Bar dataKey="amount" name={t('aging.remaining')} fill={view === 'client' ? '#3b82f6' : '#8b5cf6'} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Table */}
      <div className="bg-white shadow rounded overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 text-xs">
          <thead className="bg-gray-100">
            <tr>
              <th className="px-3 py-2 text-left font-semibold text-gray-700 uppercase">{t('aging.entity')}</th>
              <th className="px-3 py-2 text-left font-semibold text-gray-700 uppercase">{t('common.invoiceNumber')}</th>
              <th className="px-3 py-2 text-left font-semibold text-gray-700 uppercase">{t('aging.transactionDate')}</th>
              <th className="px-3 py-2 text-left font-semibold text-gray-700 uppercase">{t('common.dueDate')}</th>
              <th className="px-3 py-2 text-right font-semibold text-gray-700 uppercase">{t('aging.total')}</th>
              <th className="px-3 py-2 text-right font-semibold text-gray-700 uppercase">{t('aging.paid')}</th>
              <th className="px-3 py-2 text-right font-semibold text-gray-700 uppercase">{t('aging.remaining')}</th>
              <th className="px-3 py-2 text-left font-semibold text-gray-700 uppercase">{t('aging.bucket')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {filteredData.length === 0 ? (
              <tr><td colSpan="8" className="px-3 py-6 text-center text-gray-500">{t('aging.noData')}</td></tr>
            ) : (
              filteredData.map((tx) => {
                const days = daysPastDue(tx.due_date, tx.transaction_date)
                const bucket = getBucket(days)
                return (
                  <tr key={tx.transaction_id || tx.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 font-medium text-gray-900">{tx[entityRelation]?.[entityNameField] || '—'}</td>
                    <td className="px-3 py-2 text-gray-600">{tx.invoice_number || '—'}</td>
                    <td className="px-3 py-2 text-gray-600">{new Date(tx.transaction_date).toLocaleDateString()}</td>
                    <td className="px-3 py-2 text-gray-600">{tx.due_date ? new Date(tx.due_date).toLocaleDateString() : '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(tx.total_amount)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-green-700">{formatCurrency(tx.paid_amount)}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium text-red-700">{formatCurrency(tx.remaining_amount)}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${bucketColors[bucket]}`}>
                        {bucket === 'current' ? t('aging.current') : bucket === '90_plus' ? '90+' : bucket.replace('_', '-')} {t('aging.days')}
                      </span>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
