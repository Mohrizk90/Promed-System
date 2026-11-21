import { Link, useLocation } from 'react-router-dom'
import { LayoutDashboard, Receipt, FileText, Truck, Menu } from './ui/Icons'
import { useLanguage } from '../context/LanguageContext'
import { useAuth } from '../context/AuthContext'
import { isComplianceOnlyUser } from '../utils/userAccess'

/** Phone tab bar. The last tab opens the full sidebar drawer for everything else. */
export default function BottomNav({ onMenuClick, menuOpen = false } = {}) {
  const location = useLocation()
  const { t } = useLanguage()
  const { user } = useAuth()

  if (isComplianceOnlyUser(user)) return null

  const navItems = [
    { path: '/dashboard', icon: LayoutDashboard, label: t('mobileNav.home') },
    { path: '/', icon: Receipt, label: t('mobileNav.clients') },
    { path: '/invoices', icon: FileText, label: t('mobileNav.invoices') },
    { path: '/suppliers', icon: Truck, label: t('mobileNav.suppliers') },
  ]

  const isActive = (path) => !menuOpen && location.pathname === path

  const itemClass = (active) =>
    `relative flex-1 flex flex-col items-center justify-center gap-0.5 pt-2 pb-1.5 min-h-[56px] text-[11px] font-medium transition-colors ${
      active ? 'text-blue-700' : 'text-gray-500 active:text-gray-700'
    }`

  return (
    <nav
      className="fixed bottom-0 inset-x-0 bg-white/95 backdrop-blur border-t border-gray-200 pb-safe pl-safe pr-safe z-40 md:hidden no-print shadow-[0_-2px_10px_rgba(0,0,0,0.04)]"
      aria-label="Primary"
    >
      <div className="flex items-stretch">
        {navItems.map((item) => {
          const Icon = item.icon
          const active = isActive(item.path)
          return (
            <Link key={item.path} to={item.path} className={itemClass(active)} aria-current={active ? 'page' : undefined}>
              {active && <span className="absolute top-0 inset-x-5 h-0.5 rounded-b bg-blue-600" aria-hidden="true" />}
              <span className={`flex items-center justify-center w-10 h-7 rounded-full transition-colors ${active ? 'bg-blue-50' : ''}`}>
                <Icon size={20} strokeWidth={active ? 2.4 : 2} />
              </span>
              <span className="truncate max-w-full px-1">{item.label}</span>
            </Link>
          )
        })}
        <button
          type="button"
          onClick={onMenuClick}
          className={itemClass(menuOpen)}
          aria-label={t('mobileNav.menu')}
          aria-expanded={menuOpen}
        >
          <span className={`flex items-center justify-center w-10 h-7 rounded-full ${menuOpen ? 'bg-blue-50' : ''}`}>
            <Menu size={20} />
          </span>
          <span>{t('mobileNav.menu')}</span>
        </button>
      </div>
    </nav>
  )
}
