// Small building blocks shared by the Projects, Money and Agent activity pages.

// Numbers are wrapped in a left-to-right isolate so "-49,950" stays readable inside Arabic text.
export const fmt = (n, digits = 0) => `⁦${Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: 0 })}⁩`

export const today = () => new Date().toISOString().slice(0, 10)

export const openAgent = () => window.dispatchEvent(new CustomEvent('promed:agent-open'))

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
      <div className="min-w-0">
        <h1 className="text-xl sm:text-2xl font-bold text-[#0b2a55] tracking-tight">{title}</h1>
        {subtitle && <p className="text-[13px] text-slate-500 mt-0.5 max-w-2xl">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

const TONES = {
  green: 'text-emerald-700',
  red: 'text-rose-700',
  blue: 'text-blue-700',
  slate: 'text-slate-800',
}

export function Stat({ label, value, tone = 'slate', hint, icon: Icon }) {
  return (
    <div className="glass rounded-2xl px-4 py-3 min-w-0">
      <div className="flex items-center gap-1.5 text-[12px] text-slate-500">
        {Icon && <Icon size={14} />}
        <span className="truncate">{label}</span>
      </div>
      <div className={`text-lg sm:text-xl font-bold tabular-nums mt-0.5 truncate ${TONES[tone] || TONES.slate}`}>{value}</div>
      {hint && <div className="text-[11px] text-slate-400 truncate">{hint}</div>}
    </div>
  )
}

export function Button({ children, variant = 'primary', className = '', ...props }) {
  const styles = {
    primary: 'bg-blue-600 text-white hover:bg-blue-700 shadow-[0_8px_20px_-10px_rgba(37,99,235,0.9)]',
    secondary: 'btn-secondary',
    ghost: 'text-slate-600 hover:bg-white/70',
    danger: 'text-rose-700 hover:bg-rose-50',
    agent: 'text-white bg-gradient-to-br from-blue-600 via-indigo-600 to-violet-600 shadow-[0_8px_20px_-10px_rgba(79,70,229,0.9)]',
  }
  return (
    <button type="button" className={`inline-flex items-center justify-center gap-1.5 rounded-xl px-3.5 h-9 text-[13px] font-medium transition-colors disabled:opacity-50 ${styles[variant]} ${className}`} {...props}>
      {children}
    </button>
  )
}

export function Field({ label, children, className = '' }) {
  return (
    <label className={`block ${className}`}>
      <span className="block text-[12px] font-medium text-slate-600 mb-1">{label}</span>
      {children}
    </label>
  )
}

export const inputClass = 'input w-full px-3 h-10 text-[14px] outline-none'

export function StatusPill({ status, t }) {
  const tone = {
    active: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    on_hold: 'bg-amber-50 text-amber-800 ring-amber-200',
    done: 'bg-blue-50 text-blue-700 ring-blue-200',
    cancelled: 'bg-slate-100 text-slate-500 ring-slate-200',
  }[status] || 'bg-slate-100 text-slate-600 ring-slate-200'
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ring-1 ${tone}`}>{t(`projects.status_${status}`)}</span>
}

// Tailwind needs literal class names, so the type colours are spelled out.
export const TYPE_COLORS = {
  blue: 'bg-blue-100 text-blue-700',
  indigo: 'bg-indigo-100 text-indigo-700',
  violet: 'bg-violet-100 text-violet-700',
  emerald: 'bg-emerald-100 text-emerald-700',
  green: 'bg-emerald-100 text-emerald-700',
  amber: 'bg-amber-100 text-amber-800',
  orange: 'bg-orange-100 text-orange-700',
  rose: 'bg-rose-100 text-rose-700',
  red: 'bg-rose-100 text-rose-700',
  teal: 'bg-teal-100 text-teal-700',
  cyan: 'bg-cyan-100 text-cyan-700',
  slate: 'bg-slate-100 text-slate-700',
  gray: 'bg-slate-100 text-slate-700',
}
