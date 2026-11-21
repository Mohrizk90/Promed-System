import { useEffect, useState } from 'react'
import { Download, RefreshCw } from './ui/Icons'
import { WifiOff, Share } from 'lucide-react'
import { useLanguage } from '../context/LanguageContext'
import { usePwa, promptInstall, applyUpdate } from '../utils/pwa'

/** Sidebar entry: native install prompt (Chrome/Edge/Android) or an iOS how-to. */
export function InstallAppButton({ onDone }) {
  const { t } = useLanguage()
  const { canInstall, isStandalone, isIos } = usePwa()
  const [showIosHint, setShowIosHint] = useState(false)

  if (isStandalone || (!canInstall && !isIos)) return null

  const handleClick = async () => {
    if (canInstall) {
      await promptInstall()
      onDone?.()
    } else {
      setShowIosHint((v) => !v)
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        className="rtl-flip w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-[12px] font-semibold text-white bg-white/10 hover:bg-white/20 transition-colors"
      >
        <Download size={14} className="flex-shrink-0" />
        <span className="truncate">{t('pwa.install')}</span>
      </button>
      {showIosHint && (
        <p className="flex items-start gap-1.5 mt-1 px-2.5 text-[11px] leading-snug text-blue-100">
          <Share size={12} className="flex-shrink-0 mt-0.5" />
          {t('pwa.iosHint')}
        </p>
      )}
    </div>
  )
}

/** Thin status bars: "new version ready" and offline/back-online. */
export function AppStatusBanners() {
  const { t } = useLanguage()
  const { updateReady } = usePwa()
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine))
  const [justReconnected, setJustReconnected] = useState(false)

  useEffect(() => {
    let timer
    const up = () => {
      setOnline(true)
      setJustReconnected(true)
      timer = setTimeout(() => setJustReconnected(false), 2500)
    }
    const down = () => {
      clearTimeout(timer)
      setJustReconnected(false)
      setOnline(false)
    }
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])

  if (!updateReady && online && !justReconnected) return null

  return (
    <div className="fixed inset-x-0 top-0 z-[60] flex flex-col items-center gap-2 px-3 pt-safe pointer-events-none no-print">
      {!online && (
        <div role="status" className="pointer-events-auto mt-2 flex items-center gap-2 rounded-full bg-gray-900/90 text-white text-xs sm:text-sm px-4 py-2 shadow-lg animate-slide-down">
          <WifiOff size={16} className="flex-shrink-0" />
          <span>{t('pwa.offline')}</span>
        </div>
      )}
      {online && justReconnected && (
        <div role="status" className="pointer-events-auto mt-2 rounded-full bg-emerald-600 text-white text-xs sm:text-sm px-4 py-2 shadow-lg animate-slide-down">
          {t('pwa.back')}
        </div>
      )}
      {updateReady && (
        <div role="status" className="pointer-events-auto mt-2 flex items-center gap-3 rounded-full bg-blue-700 text-white text-xs sm:text-sm ps-4 pe-1.5 py-1.5 shadow-lg animate-slide-down">
          <span>{t('pwa.updateReady')}</span>
          <button
            type="button"
            onClick={applyUpdate}
            className="inline-flex items-center gap-1.5 rounded-full bg-white text-blue-700 font-semibold px-3 py-1 hover:bg-blue-50"
          >
            <RefreshCw size={14} />
            {t('pwa.reload')}
          </button>
        </div>
      )}
    </div>
  )
}
