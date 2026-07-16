import { useEffect, useState, useMemo, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../context/LanguageContext'
import LoadingSpinner from './LoadingSpinner'
import EmptyState from './ui/EmptyState'
import Pagination from './ui/Pagination'
import {
  Activity,
  AlertTriangle,
  Clock,
  DollarSign,
  Users,
  Package,
  Box,
  RefreshCw,
  CheckCircle,
  XCircle,
  Shield,
} from './ui/Icons'
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'

const REFRESH_INTERVAL_MS = 10000

function statusColor(ageMs, status) {
  if (status === 'down') return { dot: 'bg-red-500', text: 'text-red-600', bg: 'bg-red-50', border: 'border-red-200', label: 'Down' }
  if (status === 'degraded') return { dot: 'bg-amber-500', text: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200', label: 'Degraded' }
  if (ageMs == null) return { dot: 'bg-gray-400', text: 'text-gray-500', bg: 'bg-gray-50', border: 'border-gray-200', label: 'No data' }
  if (ageMs < 60_000) return { dot: 'bg-green-500', text: 'text-green-600', bg: 'bg-green-50', border: 'border-green-200', label: 'Online' }
  if (ageMs < 300_000) return { dot: 'bg-amber-500', text: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200', label: 'Stale' }
  return { dot: 'bg-red-500', text: 'text-red-600', bg: 'bg-red-50', border: 'border-red-200', label: 'Offline' }
}

function thresholdColor(value) {
  if (value == null) return 'bg-gray-300'
  if (value < 60) return 'bg-green-500'
  if (value < 85) return 'bg-amber-500'
  return 'bg-red-500'
}

function formatBytes(n) {
  if (n == null) return '—'
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s']
  let i = 0
  let v = Number(n)
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`
}

function formatRelative(ts) {
  if (!ts) return '—'
  const diff = Math.max(0, Date.now() - new Date(ts).getTime())
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

function formatDateTime(ts) {
  if (!ts) return '—'
  try {
    const d = new Date(ts)
    return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  } catch {
    return String(ts)
  }
}

function formatTime(ts) {
  if (!ts) return '—'
  try {
    const d = new Date(ts)
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch {
    return String(ts)
  }
}

function percentile(sorted, p) {
  if (!sorted || sorted.length === 0) return 0
  const idx = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))
  return sorted[idx]
}

function StatusCard({ title, snapshot, icon: Icon, extra }) {
  const ageMs = snapshot?.ts ? Date.now() - new Date(snapshot.ts).getTime() : null
  const status = snapshot?.status || null
  const c = statusColor(ageMs, status)
  const IconComponent = Icon || Box
  return (
    <div className={`card p-4 border ${c.border}`}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <span className={`w-2.5 h-2.5 rounded-full ${c.dot}`} aria-hidden="true" />
          <span className="text-sm font-semibold text-gray-900">{title}</span>
        </div>
        <div className={`p-1.5 rounded-md ${c.bg}`}>
          <IconComponent size={16} className={c.text} />
        </div>
      </div>
      <div className={`text-xs font-medium ${c.text} mb-1`}>{c.label}</div>
      <div className="text-[11px] text-gray-500">
        {snapshot?.ts ? `${formatRelative(snapshot.ts)} · ${formatTime(snapshot.ts)}` : 'No snapshots yet'}
      </div>
      {extra}
    </div>
  )
}

function MetricBar({ label, value, Icon }) {
  const IconComponent = Icon || Activity
  const pct = value == null ? 0 : Math.max(0, Math.min(100, Number(value)))
  return (
    <div>
      <div className="flex items-center justify-between text-[11px] text-gray-600 mb-0.5">
        <span className="flex items-center gap-1">
          <IconComponent size={11} className="text-gray-400" />
          {label}
        </span>
        <span className="font-mono font-medium text-gray-700">{value == null ? '—' : `${pct.toFixed(0)}%`}</span>
      </div>
      <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
        <div className={`h-full transition-all ${thresholdColor(pct)}`} style={{ width: `${value == null ? 0 : pct}%` }} />
      </div>
    </div>
  )
}

function KpiCard({ title, value, subtitle, icon: Icon, color = 'blue' }) {
  const colorMap = {
    blue: 'text-blue-600 bg-blue-50',
    green: 'text-green-600 bg-green-50',
    amber: 'text-amber-600 bg-amber-50',
    red: 'text-red-600 bg-red-50',
    purple: 'text-purple-600 bg-purple-50',
    slate: 'text-slate-600 bg-slate-50',
  }
  const IconComponent = Icon || Activity
  return (
    <div className="card p-4">
      <div className="flex items-start justify-between mb-2">
        <span className="text-xs font-medium text-gray-600">{title}</span>
        <div className={`p-1.5 rounded-md ${colorMap[color] || colorMap.blue}`}>
          <IconComponent size={14} />
        </div>
      </div>
      <div className="text-2xl font-bold text-gray-900 leading-tight">{value}</div>
      {subtitle && <div className="text-[11px] text-gray-500 mt-1">{subtitle}</div>}
    </div>
  )
}

function StatusBadge({ status }) {
  const map = {
    ok: 'bg-green-100 text-green-700',
    error: 'bg-red-100 text-red-700',
    denied: 'bg-amber-100 text-amber-700',
  }
  const cls = map[status] || 'bg-gray-100 text-gray-700'
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium ${cls}`}>{status || '—'}</span>
}

function SeverityBadge({ severity }) {
  const map = {
    warn: 'bg-amber-100 text-amber-700',
    error: 'bg-red-100 text-red-700',
  }
  const cls = map[severity] || 'bg-gray-100 text-gray-700'
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium ${cls}`}>{severity || '—'}</span>
}

function SourceBadge({ source }) {
  const map = {
    bot: 'bg-blue-100 text-blue-700',
    mcp: 'bg-purple-100 text-purple-700',
    collector: 'bg-emerald-100 text-emerald-700',
    telegram: 'bg-sky-100 text-sky-700',
  }
  const cls = map[source] || 'bg-gray-100 text-gray-700'
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium ${cls}`}>{source || '—'}</span>
}

export default function AgentMonitoring() {
  const { user } = useAuth()
  const { language } = useLanguage()

  // Status strip
  const [botHealth, setBotHealth] = useState(null)
  const [mcpHealth, setMcpHealth] = useState(null)
  const [vpsMetrics, setVpsMetrics] = useState({ cpu: null, mem: null, disk: null, netIn: null, netOut: null })

  // KPIs
  const [kpis, setKpis] = useState({
    totalCalls: 0,
    successRate: 0,
    p50: 0,
    p95: 0,
    geminiCost: 0,
    activeChats: 0,
    pendingConfirmations: 0,
    linkedUsers: 0,
    callsByHour: [],
    callsByStatus: [],
  })

  // Audit table
  const [auditRows, setAuditRows] = useState([])
  const [auditTotal, setAuditTotal] = useState(0)
  const [auditLoading, setAuditLoading] = useState(false)
  const [auditToolFilter, setAuditToolFilter] = useState('')
  const [auditStatusFilter, setAuditStatusFilter] = useState('')
  const [auditFromDate, setAuditFromDate] = useState('')
  const [auditToDate, setAuditToDate] = useState('')
  const [auditPage, setAuditPage] = useState(1)
  const [auditPageSize, setAuditPageSize] = useState(20)
  const [toolOptions, setToolOptions] = useState([])

  // Errors feed
  const [errorFeed, setErrorFeed] = useState([])

  // Linked users
  const [linkedUsers, setLinkedUsers] = useState([])
  const [linkedRefreshing, setLinkedRefreshing] = useState(false)

  // Tick to force re-render for relative time displays
  const [, setTick] = useState(0)

  const t = (key) => {
    const dict = {
      'monitoring.title': language === 'ar' ? 'مراقبة الوكيل' : 'Agent Monitoring',
      'monitoring.subtitle': language === 'ar' ? 'حالة البوت وأدوات MCP وأداء VPS في الوقت الحقيقي' : 'Live status of the bot, MCP tools, and VPS performance',
      'monitoring.liveStatus': language === 'ar' ? 'الحالة المباشرة' : 'Live Status',
      'monitoring.bot': language === 'ar' ? 'البوت' : 'Bot',
      'monitoring.mcp': language === 'ar' ? 'MCP' : 'MCP',
      'monitoring.vpsSmops': language === 'ar' ? 'VPS (smops)' : 'VPS (smops)',
      'monitoring.kpis24h': language === 'ar' ? 'مؤشرات آخر 24 ساعة' : 'Last 24h KPIs',
      'monitoring.totalCalls': language === 'ar' ? 'إجمالي الاستدعاءات' : 'Total calls',
      'monitoring.successRate': language === 'ar' ? 'معدل النجاح' : 'Success rate',
      'monitoring.p50': language === 'ar' ? 'الكمون p50' : 'p50 latency',
      'monitoring.p95': language === 'ar' ? 'الكمون p95' : 'p95 latency',
      'monitoring.geminiCost': language === 'ar' ? 'تكلفة Gemini' : 'Gemini cost',
      'monitoring.activeChats': language === 'ar' ? 'محادثات نشطة' : 'Active chats',
      'monitoring.pendingConfirms': language === 'ar' ? 'تأكيدات معلقة' : 'Pending confirmations',
      'monitoring.linkedUsers': language === 'ar' ? 'مستخدمون مربوطون' : 'Linked users',
      'monitoring.toolActivity': language === 'ar' ? 'نشاط الأدوات' : 'Tool Activity',
      'monitoring.tool': language === 'ar' ? 'الأداة' : 'Tool',
      'monitoring.status': language === 'ar' ? 'الحالة' : 'Status',
      'monitoring.all': language === 'ar' ? 'الكل' : 'All',
      'monitoring.from': language === 'ar' ? 'من' : 'From',
      'monitoring.to': language === 'ar' ? 'إلى' : 'To',
      'monitoring.applyFilters': language === 'ar' ? 'تطبيق' : 'Apply',
      'monitoring.resetFilters': language === 'ar' ? 'مسح' : 'Reset',
      'monitoring.errors': language === 'ar' ? 'سجل الأخطاء' : 'Errors Feed',
      'monitoring.noErrors': language === 'ar' ? 'لا توجد أخطاء' : 'No errors to report',
      'monitoring.linkedUsersTable': language === 'ar' ? 'المستخدمون المربوطون' : 'Linked Users',
      'monitoring.refresh': language === 'ar' ? 'تحديث' : 'Refresh',
      'monitoring.noLinkedUsers': language === 'ar' ? 'لا يوجد مستخدمون مربوطون' : 'No linked users',
      'monitoring.noAudit': language === 'ar' ? 'لا توجد سجلات' : 'No audit records',
      'monitoring.lastSeen': language === 'ar' ? 'آخر ظهور' : 'Last seen',
      'monitoring.linkedAt': language === 'ar' ? 'تاريخ الربط' : 'Linked',
      'monitoring.active': language === 'ar' ? 'نشط' : 'Active',
      'monitoring.inactive': language === 'ar' ? 'غير نشط' : 'Inactive',
      'monitoring.usageTrends': language === 'ar' ? 'اتجاه الاستدعاءات' : 'Call trends',
      'monitoring.statusBreakdown': language === 'ar' ? 'توزيع الحالات' : 'Status breakdown',
      'monitoring.chatId': language === 'ar' ? 'معرف المحادثة' : 'Chat ID',
      'monitoring.latency': language === 'ar' ? 'الكمون' : 'Latency',
      'monitoring.time': language === 'ar' ? 'الوقت' : 'Time',
      'monitoring.signInRequired': language === 'ar' ? 'سجّل الدخول لعرض المراقبة' : 'Sign in to view monitoring',
    }
    return dict[key] || key
  }

  const fetchHealth = useCallback(async () => {
    if (!supabase) return
    try {
      const [{ data: bot }, { data: mcp }] = await Promise.all([
        supabase
          .from('bot_health_snapshots')
          .select('source, ts, status, uptime_s, gemini_ok, mcp_ok, telegram_ok')
          .eq('source', 'bot')
          .order('ts', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from('bot_health_snapshots')
          .select('source, ts, status, uptime_s, gemini_ok, mcp_ok, telegram_ok')
          .eq('source', 'mcp')
          .order('ts', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ])
      setBotHealth(bot || null)
      setMcpHealth(mcp || null)
    } catch (err) {
      // Tables may not exist; keep silent
    }
  }, [])

  const fetchVpsMetrics = useCallback(async () => {
    if (!supabase) return
    try {
      const since = new Date(Date.now() - 10 * 60 * 1000).toISOString()
      const { data, error } = await supabase
        .from('vps_metrics')
        .select('metric, value_num, ts')
        .eq('host', 'smops')
        .gte('ts', since)
        .order('ts', { ascending: false })
        .limit(200)
      if (error) throw error
      const latest = {}
      for (const row of data || []) {
        if (latest[row.metric] == null) {
          latest[row.metric] = row.value_num
        }
      }
      setVpsMetrics({
        cpu: latest.cpu_pct ?? null,
        mem: latest.mem_pct ?? null,
        disk: latest.disk_pct ?? null,
        netIn: latest.net_in_bps ?? null,
        netOut: latest.net_out_bps ?? null,
      })
    } catch (err) {
      // Table may not exist; keep silent
    }
  }, [])

  const fetchKpis = useCallback(async () => {
    if (!supabase || !user?.id) return
    try {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      const [auditRes, pendingRes, linkedRes] = await Promise.all([
        supabase
          .from('bot_audit_log')
          .select('tool_name, result_status, latency_ms, cost_usd, telegram_chat_id, created_at')
          .eq('user_id', user.id)
          .gte('created_at', since)
          .limit(5000),
        supabase
          .from('bot_pending_confirmations')
          .select('chat_id', { count: 'exact', head: false })
          .limit(1000),
        supabase
          .from('telegram_links')
          .select('telegram_chat_id', { count: 'exact', head: false })
          .eq('is_active', true),
      ])

      const rows = auditRes.data || []
      const totalCalls = rows.length
      const ok = rows.filter((r) => r.result_status === 'ok').length
      const successRate = totalCalls > 0 ? (ok / totalCalls) * 100 : 0
      const latencies = rows
        .map((r) => Number(r.latency_ms))
        .filter((v) => Number.isFinite(v))
        .sort((a, b) => a - b)
      const p50 = percentile(latencies, 0.5)
      const p95 = percentile(latencies, 0.95)
      const geminiCost = rows.reduce((s, r) => s + Number(r.cost_usd || 0), 0)
      const activeChats = new Set(
        rows.map((r) => r.telegram_chat_id).filter((id) => id != null)
      ).size

      // Calls by hour (last 24h, fill empty buckets)
      const hourMap = new Map()
      const now = Date.now()
      for (let i = 23; i >= 0; i--) {
        const d = new Date(now - i * 60 * 60 * 1000)
        const key = `${String(d.getHours()).padStart(2, '0')}:00`
        hourMap.set(key, { hour: key, calls: 0, errors: 0 })
      }
      rows.forEach((r) => {
        const d = new Date(r.created_at)
        const key = `${String(d.getHours()).padStart(2, '0')}:00`
        const bucket = hourMap.get(key)
        if (bucket) {
          bucket.calls += 1
          if (r.result_status !== 'ok') bucket.errors += 1
        }
      })
      const callsByHour = Array.from(hourMap.values())

      const callsByStatus = [
        { status: 'ok', count: rows.filter((r) => r.result_status === 'ok').length },
        { status: 'error', count: rows.filter((r) => r.result_status === 'error').length },
        { status: 'denied', count: rows.filter((r) => r.result_status === 'denied').length },
      ]

      setKpis({
        totalCalls,
        successRate,
        p50,
        p95,
        geminiCost,
        activeChats,
        pendingConfirmations: pendingRes.data?.length || 0,
        linkedUsers: linkedRes.data?.length || 0,
        callsByHour,
        callsByStatus,
      })

      // Distinct tools for filter dropdown
      const tools = new Set()
      rows.forEach((r) => { if (r.tool_name) tools.add(r.tool_name) })
      setToolOptions((prev) => {
        const next = new Set([...prev, ...tools])
        return Array.from(next).sort()
      })
    } catch (err) {
      // Tables may not exist; keep silent
    }
  }, [user?.id])

  const fetchAuditTable = useCallback(async () => {
    if (!supabase || !user?.id) return
    setAuditLoading(true)
    try {
      let query = supabase
        .from('bot_audit_log')
        .select('id, created_at, telegram_chat_id, tool_name, result_status, latency_ms, source', { count: 'exact' })
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })

      if (auditToolFilter) query = query.eq('tool_name', auditToolFilter)
      if (auditStatusFilter) query = query.eq('result_status', auditStatusFilter)
      if (auditFromDate) query = query.gte('created_at', new Date(auditFromDate).toISOString())
      if (auditToDate) query = query.lte('created_at', new Date(auditToDate).toISOString())

      const from = (auditPage - 1) * auditPageSize
      const to = from + auditPageSize - 1
      query = query.range(from, to)

      const { data, count, error } = await query
      if (error) throw error
      setAuditRows(data || [])
      setAuditTotal(count || 0)
    } catch (err) {
      setAuditRows([])
      setAuditTotal(0)
    } finally {
      setAuditLoading(false)
    }
  }, [user?.id, auditToolFilter, auditStatusFilter, auditFromDate, auditToDate, auditPage, auditPageSize])

  const fetchErrors = useCallback(async () => {
    if (!supabase) return
    try {
      const { data, error } = await supabase
        .from('bot_error_feed')
        .select('id, source, severity, message, created_at')
        .order('created_at', { ascending: false })
        .limit(50)
      if (error) throw error
      setErrorFeed(data || [])
    } catch (err) {
      setErrorFeed([])
    }
  }, [])

  const fetchLinkedUsers = useCallback(async () => {
    if (!supabase || !user?.id) return
    setLinkedRefreshing(true)
    try {
      const { data, error } = await supabase
        .from('telegram_links')
        .select('telegram_chat_id, telegram_username, linked_at, last_seen_at, is_active')
        .order('linked_at', { ascending: false })
      if (error) throw error
      setLinkedUsers(data || [])
    } catch (err) {
      setLinkedUsers([])
    } finally {
      setLinkedRefreshing(false)
    }
  }, [user?.id])

  // Initial fetch + interval
  useEffect(() => {
    if (!user?.id) return
    fetchHealth()
    fetchVpsMetrics()
    fetchKpis()
    fetchAuditTable()
    fetchErrors()
    fetchLinkedUsers()

    const id = setInterval(() => {
      fetchHealth()
      fetchVpsMetrics()
      fetchKpis()
      fetchAuditTable()
      fetchErrors()
      fetchLinkedUsers()
      setTick((n) => n + 1)
    }, REFRESH_INTERVAL_MS)

    return () => clearInterval(id)
  }, [user?.id, fetchHealth, fetchVpsMetrics, fetchKpis, fetchAuditTable, fetchErrors, fetchLinkedUsers])

  // Reload audit when filters change (reset to page 1)
  useEffect(() => {
    if (!user?.id) return
    setAuditPage(1)
  }, [auditToolFilter, auditStatusFilter, auditFromDate, auditToDate, user?.id])

  useEffect(() => {
    if (!user?.id) return
    fetchAuditTable()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auditPage, auditPageSize])

  const auditTotalPages = Math.max(1, Math.ceil(auditTotal / auditPageSize))

  const kpisLoading = !user?.id

  const formatLatency = (ms) => (ms == null ? '—' : `${Math.round(ms)} ms`)
  const formatCost = (usd) => `$${(Number(usd) || 0).toFixed(4)}`
  const formatPercent = (n) => `${(Number(n) || 0).toFixed(1)}%`

  if (!user) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-gray-900">{t('monitoring.title')}</h1>
        <EmptyState
          icon="default"
          title={t('monitoring.signInRequired')}
          description=""
        />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-2">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 mb-1">{t('monitoring.title')}</h1>
          <p className="text-gray-600 text-sm">{t('monitoring.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <RefreshCw size={12} className="animate-spin-slow" />
          <span>{language === 'ar' ? 'تحديث تلقائي كل 10 ثوانٍ' : 'Auto-refresh every 10s'}</span>
        </div>
      </div>

      {/* 1. Live status strip */}
      <section>
        <h2 className="text-sm font-semibold text-gray-700 mb-2 uppercase tracking-wide">{t('monitoring.liveStatus')}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <StatusCard
            title={t('monitoring.bot')}
            snapshot={botHealth}
            icon={Activity}
          />
          <StatusCard
            title={t('monitoring.mcp')}
            snapshot={mcpHealth}
            icon={Shield}
          />
          <div className={`card p-4 border ${statusColor(vpsMetrics.cpu != null ? Date.now() - 60_000 : null, null).border}`}>
            <div className="flex items-start justify-between gap-2 mb-2">
              <div className="flex items-center gap-2">
                <span className={`w-2.5 h-2.5 rounded-full ${vpsMetrics.cpu != null ? 'bg-green-500' : 'bg-gray-400'}`} aria-hidden="true" />
                <span className="text-sm font-semibold text-gray-900">{t('monitoring.vpsSmops')}</span>
              </div>
              <div className="p-1.5 rounded-md bg-slate-50">
                <Box size={16} className="text-slate-600" />
              </div>
            </div>
            <div className="space-y-2 mt-3">
              <MetricBar label="CPU" value={vpsMetrics.cpu} Icon={Activity} />
              <MetricBar label="Memory" value={vpsMetrics.mem} Icon={Box} />
              <MetricBar label="Disk" value={vpsMetrics.disk} Icon={Package} />
              <div className="flex justify-between text-[11px] text-gray-500 pt-1 border-t border-gray-100">
                <span>↓ {formatBytes(vpsMetrics.netIn)}</span>
                <span>↑ {formatBytes(vpsMetrics.netOut)}</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 2. KPI cards */}
      <section>
        <h2 className="text-sm font-semibold text-gray-700 mb-2 uppercase tracking-wide">{t('monitoring.kpis24h')}</h2>
        {kpisLoading ? (
          <div className="card p-8 flex items-center justify-center"><LoadingSpinner size="md" /></div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
            <KpiCard title={t('monitoring.totalCalls')} value={kpis.totalCalls.toLocaleString()} icon={Activity} color="blue" />
            <KpiCard title={t('monitoring.successRate')} value={formatPercent(kpis.successRate)} icon={CheckCircle} color={kpis.successRate >= 90 ? 'green' : kpis.successRate >= 70 ? 'amber' : 'red'} />
            <KpiCard title={t('monitoring.p50')} value={formatLatency(kpis.p50)} icon={Clock} color="purple" />
            <KpiCard title={t('monitoring.p95')} value={formatLatency(kpis.p95)} icon={Clock} color="amber" />
            <KpiCard title={t('monitoring.geminiCost')} value={formatCost(kpis.geminiCost)} icon={DollarSign} color="green" />
            <KpiCard title={t('monitoring.activeChats')} value={kpis.activeChats} icon={Users} color="blue" />
            <KpiCard title={t('monitoring.pendingConfirms')} value={kpis.pendingConfirmations} icon={AlertTriangle} color={kpis.pendingConfirmations > 0 ? 'amber' : 'slate'} />
            <KpiCard title={t('monitoring.linkedUsers')} value={kpis.linkedUsers} icon={Users} color="slate" />
          </div>
        )}
      </section>

      {/* Trend & status charts */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="card p-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">{t('monitoring.usageTrends')}</h3>
          <div dir="ltr" className="w-full min-w-0">
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={kpis.callsByHour} margin={{ top: 5, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-surface-300, #e5e7eb)" />
                <XAxis dataKey="hour" stroke="#9ca3af" fontSize={11} />
                <YAxis stroke="#9ca3af" fontSize={11} allowDecimals={false} />
                <RechartsTooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="calls" stroke="#3b82f6" strokeWidth={2} dot={false} name="Calls" />
                <Line type="monotone" dataKey="errors" stroke="#ef4444" strokeWidth={2} dot={false} name="Errors" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="card p-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">{t('monitoring.statusBreakdown')}</h3>
          <div dir="ltr" className="w-full min-w-0">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={kpis.callsByStatus} margin={{ top: 5, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-surface-300, #e5e7eb)" />
                <XAxis dataKey="status" stroke="#9ca3af" fontSize={11} />
                <YAxis stroke="#9ca3af" fontSize={11} allowDecimals={false} />
                <RechartsTooltip />
                <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      {/* 3. Tool activity table */}
      <section className="card p-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 mb-3">
          <h2 className="text-base font-semibold text-gray-900">{t('monitoring.toolActivity')}</h2>
          <div className="text-xs text-gray-500">{auditTotal.toLocaleString()} {language === 'ar' ? 'سجل' : 'records'}</div>
        </div>

        {/* Filter row */}
        <div className="flex flex-wrap items-end gap-2 mb-3 pb-3 border-b border-gray-100">
          <div className="flex flex-col">
            <label className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">{t('monitoring.tool')}</label>
            <select
              value={auditToolFilter}
              onChange={(e) => setAuditToolFilter(e.target.value)}
              className="text-xs px-2 py-1.5 border border-gray-300 rounded-md bg-white min-w-[140px]"
            >
              <option value="">{t('monitoring.all')}</option>
              {toolOptions.map((tool) => (
                <option key={tool} value={tool}>{tool}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col">
            <label className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">{t('monitoring.status')}</label>
            <select
              value={auditStatusFilter}
              onChange={(e) => setAuditStatusFilter(e.target.value)}
              className="text-xs px-2 py-1.5 border border-gray-300 rounded-md bg-white min-w-[120px]"
            >
              <option value="">{t('monitoring.all')}</option>
              <option value="ok">ok</option>
              <option value="error">error</option>
              <option value="denied">denied</option>
            </select>
          </div>
          <div className="flex flex-col">
            <label className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">{t('monitoring.from')}</label>
            <input
              type="date"
              value={auditFromDate}
              onChange={(e) => setAuditFromDate(e.target.value)}
              className="text-xs px-2 py-1.5 border border-gray-300 rounded-md bg-white"
            />
          </div>
          <div className="flex flex-col">
            <label className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">{t('monitoring.to')}</label>
            <input
              type="date"
              value={auditToDate}
              onChange={(e) => setAuditToDate(e.target.value)}
              className="text-xs px-2 py-1.5 border border-gray-300 rounded-md bg-white"
            />
          </div>
          <button
            type="button"
            onClick={() => { setAuditToolFilter(''); setAuditStatusFilter(''); setAuditFromDate(''); setAuditToDate('') }}
            className="text-xs px-3 py-1.5 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors"
          >
            {t('monitoring.resetFilters')}
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left text-[11px] font-medium text-gray-500 uppercase tracking-wide">{t('monitoring.time')}</th>
                <th className="px-3 py-2 text-left text-[11px] font-medium text-gray-500 uppercase tracking-wide">{t('monitoring.chatId')}</th>
                <th className="px-3 py-2 text-left text-[11px] font-medium text-gray-500 uppercase tracking-wide">{t('monitoring.tool')}</th>
                <th className="px-3 py-2 text-left text-[11px] font-medium text-gray-500 uppercase tracking-wide">{t('monitoring.status')}</th>
                <th className="px-3 py-2 text-right text-[11px] font-medium text-gray-500 uppercase tracking-wide">{t('monitoring.latency')}</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-100">
              {auditLoading && (
                <tr><td colSpan="5" className="px-3 py-6 text-center"><LoadingSpinner size="sm" /></td></tr>
              )}
              {!auditLoading && auditRows.length === 0 && (
                <tr><td colSpan="5" className="px-3 py-6 text-center text-sm text-gray-500">{t('monitoring.noAudit')}</td></tr>
              )}
              {!auditLoading && auditRows.map((row) => (
                <tr key={row.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-3 py-2 text-xs text-gray-700 whitespace-nowrap">{formatDateTime(row.created_at)}</td>
                  <td className="px-3 py-2 text-xs font-mono text-gray-600 whitespace-nowrap">{row.telegram_chat_id || '—'}</td>
                  <td className="px-3 py-2 text-xs text-gray-900 whitespace-nowrap">{row.tool_name || '—'}</td>
                  <td className="px-3 py-2 whitespace-nowrap"><StatusBadge status={row.result_status} /></td>
                  <td className="px-3 py-2 text-xs text-right text-gray-700 whitespace-nowrap">{formatLatency(row.latency_ms)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination
          currentPage={auditPage}
          totalPages={auditTotalPages}
          onPageChange={setAuditPage}
          pageSize={auditPageSize}
          onPageSizeChange={(s) => { setAuditPageSize(s); setAuditPage(1) }}
          totalItems={auditTotal}
          pageSizeOptions={[10, 20, 50, 100]}
        />
      </section>

      {/* 4. Errors feed + 5. Linked users */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
              <AlertTriangle size={16} className="text-amber-500" />
              {t('monitoring.errors')}
            </h2>
            <span className="text-xs text-gray-500">{errorFeed.length} {language === 'ar' ? 'حدث' : 'events'}</span>
          </div>
          {errorFeed.length === 0 ? (
            <EmptyState icon="default" title={t('monitoring.noErrors')} description="" />
          ) : (
            <ul className="divide-y divide-gray-100 max-h-[420px] overflow-y-auto">
              {errorFeed.map((err) => (
                <li key={err.id} className="py-2">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[11px] text-gray-500 whitespace-nowrap">{formatTime(err.created_at)}</span>
                    <SourceBadge source={err.source} />
                    <SeverityBadge severity={err.severity} />
                  </div>
                  <div className="text-xs text-gray-800 break-words">{err.message}</div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
              <Users size={16} className="text-blue-500" />
              {t('monitoring.linkedUsersTable')}
            </h2>
            <button
              type="button"
              onClick={fetchLinkedUsers}
              disabled={linkedRefreshing}
              className="btn btn-secondary btn-sm flex items-center gap-1"
            >
              <RefreshCw size={12} className={linkedRefreshing ? 'animate-spin' : ''} />
              {t('monitoring.refresh')}
            </button>
          </div>
          {linkedUsers.length === 0 ? (
            <EmptyState icon="clients" title={t('monitoring.noLinkedUsers')} description="" />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-[11px] font-medium text-gray-500 uppercase tracking-wide">{t('monitoring.chatId')}</th>
                    <th className="px-3 py-2 text-left text-[11px] font-medium text-gray-500 uppercase tracking-wide">Username</th>
                    <th className="px-3 py-2 text-left text-[11px] font-medium text-gray-500 uppercase tracking-wide">{t('monitoring.linkedAt')}</th>
                    <th className="px-3 py-2 text-left text-[11px] font-medium text-gray-500 uppercase tracking-wide">{t('monitoring.lastSeen')}</th>
                    <th className="px-3 py-2 text-left text-[11px] font-medium text-gray-500 uppercase tracking-wide">{t('monitoring.status')}</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-100">
                  {linkedUsers.map((u) => (
                    <tr key={u.telegram_chat_id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-3 py-2 text-xs font-mono text-gray-700 whitespace-nowrap">{u.telegram_chat_id}</td>
                      <td className="px-3 py-2 text-xs text-gray-900 whitespace-nowrap">{u.telegram_username || '—'}</td>
                      <td className="px-3 py-2 text-xs text-gray-700 whitespace-nowrap">{formatDateTime(u.linked_at)}</td>
                      <td className="px-3 py-2 text-xs text-gray-700 whitespace-nowrap">{formatRelative(u.last_seen_at)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {u.is_active ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-green-100 text-green-700">
                            <CheckCircle size={11} />
                            {t('monitoring.active')}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-gray-100 text-gray-700">
                            <XCircle size={11} />
                            {t('monitoring.inactive')}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}