// Minimal mobile shell — scan-first Compliance, no ERP chrome.
import { Outlet, Link, useNavigate } from 'react-router-dom'
import { useLanguage } from '../../context/LanguageContext'
import { useAuth } from '../../context/AuthContext'
import { useDocumentWorker } from '../../hooks/useDocumentWorker'
import { ComplianceWorkerContext } from './ComplianceWorkerContext'
import { Camera, LogOut, Globe } from '../ui/Icons'

export default function ComplianceMobileLayout() {
  const { t, language, setLanguage } = useLanguage()
  const navigate = useNavigate()
  const worker = useDocumentWorker({ enabled: true, outputLocale: language })
  const { user, signOut } = useAuth()

  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
  }

  return (
    <ComplianceWorkerContext.Provider value={worker}>
      <div className="min-h-screen flex flex-col bg-gradient-to-b from-rose-50 to-gray-50">
        <header className="flex-shrink-0 px-4 py-3 flex items-center justify-between border-b border-rose-100 bg-white/90 backdrop-blur">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-rose-600 flex items-center justify-center text-white flex-shrink-0">
              <Camera size={20} />
            </div>
            <div className="min-w-0">
              <p className="font-bold text-gray-900 text-sm truncate">{t('compliance.mobile.title')}</p>
              <p className="text-[10px] text-gray-500 truncate">{user?.email}</p>
            </div>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              type="button"
              onClick={() => setLanguage(language === 'en' ? 'ar' : 'en')}
              className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 inline-flex items-center gap-1 text-xs font-bold"
              aria-label="Language"
            >
              <Globe size={16} /> {language === 'en' ? 'AR' : 'EN'}
            </button>
            <button
              type="button"
              onClick={handleSignOut}
              className="p-2 rounded-lg text-gray-500 hover:bg-gray-100"
              aria-label={t('auth.logout')}
            >
              <LogOut size={18} />
            </button>
          </div>
        </header>

        <main className="flex-1 flex flex-col min-h-0 overflow-y-auto px-4 py-4 pb-safe">
          <Outlet />
        </main>

        <nav className="flex-shrink-0 border-t border-gray-200 bg-white px-2 pb-safe grid grid-cols-2 gap-1">
          <Link
            to="/m/compliance"
            className="py-3 text-center text-sm font-semibold text-rose-700 rounded-lg hover:bg-rose-50"
          >
            {t('compliance.mobile.nav_scan')}
          </Link>
          <Link
            to="/m/compliance/queue"
            className="py-3 text-center text-sm font-semibold text-gray-700 rounded-lg hover:bg-gray-50"
          >
            {t('compliance.mobile.nav_queue')}
          </Link>
        </nav>
      </div>
    </ComplianceWorkerContext.Provider>
  )
}
