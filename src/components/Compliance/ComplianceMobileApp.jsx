// Mobile Compliance home — scan / pick file, AI runs in background.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useLanguage } from '../../context/LanguageContext'
import { useToast } from '../../context/ToastContext'
import { useImportJob } from '../../hooks/useImportJob'
import { useComplianceWorkerStatus } from './ComplianceWorkerContext'
import ComplianceScanCapture from './ComplianceScanCapture'
import AiWorkerStatus from './AiWorkerStatus'
import { Camera, Upload, ChevronRight, RefreshCw, X } from '../ui/Icons'
import { UPLOAD_JOB_TONES } from '../../utils/complianceUpload'
import { setForceComplianceDesktop } from '../../utils/deviceProfile'
import { isComplianceOnlyUser } from '../../utils/userAccess'

export default function ComplianceMobileApp() {
  const { t } = useLanguage()
  const { user } = useAuth()
  const { success, error: showError } = useToast()
  const navigate = useNavigate()
  const inputRef = useRef(null)
  const worker = useComplianceWorkerStatus()
  const [showScan, setShowScan] = useState(false)

  const { jobs, enqueue, retry, remove, clearFailed } = useImportJob({
    userEmail: user?.email || '',
    userId: user?.id || null,
    onJobComplete: ({ fileName }) => {
      success(t('compliance.import.upload_complete', { name: fileName || 'File' }))
    },
    onJobFailed: ({ message }) => {
      if (message) showError(message)
    },
  })

  const activeJobs = useMemo(
    () => jobs.filter((j) => j.status !== 'completed').slice(0, 5),
    [jobs],
  )

  const openDesktop = () => {
    setForceComplianceDesktop(true)
    window.location.href = '/compliance'
  }

  return (
    <div className="flex flex-col gap-4 max-w-lg mx-auto w-full">
      <AiWorkerStatus busy={worker.busy} lastResult={worker.lastResult} variant="card" />

      <div className="rounded-2xl bg-white border border-rose-100 shadow-sm p-6 text-center">
        <button
          type="button"
          onClick={() => setShowScan(true)}
          disabled={!user?.id}
          className="mx-auto w-24 h-24 rounded-full bg-rose-600 text-white flex items-center justify-center shadow-lg active:scale-95 transition-transform disabled:opacity-50"
        >
          <Camera size={40} />
        </button>
        <h1 className="text-lg font-bold text-gray-900 mt-4">{t('compliance.mobile.scan_headline')}</h1>
        <p className="text-sm text-gray-600 mt-1">{t('compliance.mobile.scan_subtitle')}</p>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={!user?.id}
          className="mt-4 text-sm text-rose-700 font-medium inline-flex items-center gap-1"
        >
          <Upload size={16} /> {t('compliance.import.choose_files')}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*,application/pdf"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const fl = e.target.files
            if (fl?.length) enqueue(Array.from(fl))
            e.target.value = ''
          }}
        />
      </div>

      {activeJobs.length > 0 && (
        <div className="rounded-xl bg-white border border-gray-200 overflow-hidden">
          <div className="px-3 py-2 bg-gray-50 border-b text-xs font-semibold text-gray-700">
            {t('compliance.import.queue_title')}
          </div>
          <ul className="divide-y divide-gray-100">
            {activeJobs.map((j) => {
              const tone = UPLOAD_JOB_TONES[j.status] || UPLOAD_JOB_TONES.queued
              return (
                <li key={j.jobId} className="px-3 py-2 flex items-center gap-2 text-sm">
                  <span className="flex-1 truncate">{j.fileName}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${tone.bg} ${tone.text}`}>
                    {t(`compliance.import.status.${j.status}`)}
                  </span>
                  {j.status === 'failed' && (
                    <button type="button" onClick={() => retry(j.jobId)} className="text-rose-700">
                      <RefreshCw size={14} />
                    </button>
                  )}
                  <button type="button" onClick={() => remove(j.jobId)} className="text-gray-400">
                    <X size={14} />
                  </button>
                </li>
              )
            })}
          </ul>
          {jobs.some((j) => j.status === 'failed') && (
            <div className="px-3 py-2 border-t">
              <button type="button" onClick={clearFailed} className="text-xs text-red-700 font-medium">
                {t('compliance.bulk.clear_failed_uploads')}
              </button>
            </div>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={() => navigate('/m/compliance/queue')}
        className="w-full flex items-center justify-between rounded-xl bg-white border border-gray-200 px-4 py-3 text-start shadow-sm"
      >
        <span className="text-sm font-semibold text-gray-900">{t('compliance.mobile.view_queue')}</span>
        <ChevronRight size={18} className="text-gray-400" />
      </button>

      {!isComplianceOnlyUser(user) && (
        <button
          type="button"
          onClick={openDesktop}
          className="text-xs text-center text-gray-500 hover:text-gray-700 py-2"
        >
          {t('compliance.mobile.open_full_desktop')}
        </button>
      )}

      <ComplianceScanCapture
        open={showScan}
        onClose={() => setShowScan(false)}
        disabled={!user?.id}
        onCapture={(files) => enqueue(files)}
      />
    </div>
  )
}
