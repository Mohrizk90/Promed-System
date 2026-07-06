// Live AI worker status pill. Reads { busy, lastResult } from useDocumentWorker
// (shared via ComplianceApp) so users can see extraction happening + errors.
import { useEffect, useState } from 'react'
import { useLanguage } from '../../context/LanguageContext'
import { RefreshCw, CheckCircle, AlertCircle, Activity } from '../ui/Icons'

const DONE_VISIBLE_MS = 8000

export default function AiWorkerStatus({ busy, lastResult, variant = 'pill' }) {
  const { t } = useLanguage()
  const [hideDone, setHideDone] = useState(false)

  let tone = 'idle'
  let label = t('compliance.ai.idle')
  let detail = ''

  if (busy) {
    tone = 'busy'
    label = t('compliance.ai.analyzing')
  } else if (lastResult?.error) {
    if (lastResult.error === 'not_authenticated') {
      tone = 'warn'
      label = t('compliance.ai.sign_in')
    } else {
      tone = 'error'
      label = t('compliance.ai.error')
      detail = lastResult.error
    }
  } else if (lastResult?.id) {
    tone = 'done'
    label = t('compliance.ai.done')
  }

  useEffect(() => {
    if (tone !== 'done') {
      setHideDone(false)
      return undefined
    }
    const timer = setTimeout(() => setHideDone(true), DONE_VISIBLE_MS)
    return () => clearTimeout(timer)
  }, [lastResult?.id, tone])

  if (tone === 'idle' || (tone === 'done' && hideDone)) return null

  const tones = {
    idle:  { bg: 'bg-gray-100',   text: 'text-gray-600',   Icon: Activity },
    busy:  { bg: 'bg-blue-100',   text: 'text-blue-700',   Icon: RefreshCw },
    done:  { bg: 'bg-green-100',  text: 'text-green-700',  Icon: CheckCircle },
    warn:  { bg: 'bg-amber-100',  text: 'text-amber-800',  Icon: AlertCircle },
    error: { bg: 'bg-red-100',    text: 'text-red-700',    Icon: AlertCircle },
  }
  const s = tones[tone]
  const { Icon } = s

  if (variant === 'card') {
    return (
      <div className={`rounded-xl border p-3 flex items-start gap-3 ${s.bg} border-transparent`}>
        <Icon size={18} className={`${s.text} ${busy ? 'animate-spin' : ''} mt-0.5`} />
        <div className="min-w-0">
          <p className={`text-sm font-semibold ${s.text}`}>{label}</p>
          {detail && <p className="text-xs text-gray-600 break-words">{detail}</p>}
          {busy && (
            <p className="text-[11px] text-gray-500 mt-0.5">{t('compliance.ai.hint')}</p>
          )}
        </div>
      </div>
    )
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${s.bg} ${s.text}`}
      title={detail || label}
    >
      <Icon size={12} className={busy ? 'animate-spin' : ''} />
      {label}
    </span>
  )
}
