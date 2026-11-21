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
    `relative flex-1 flex flex-col items-center justify-center gap-0.5 py-1.5 min-h-[58px] text-[11px] font-medium transition-colors ${
      active ? 'text-blue-700' : 'text-[#3d5a85] active:text-[#0b2a55]'
    }`

  return (
    <nav
      className="glass-chrome fixed inset-x-3 z-40 md:hidden no-print rounded-[28px]"
      style={{ bottom: 'max(10px, env(safe-area-inset-bottom, 0px))' }}
      aria-label="Primary"
    >
      <div className="flex items-stretch px-1">
        {navItems.map((item) => {
          const Icon = item.icon
          const active = isActive(item.path)
          return (
            <Link key={item.path} to={item.path} className={itemClass(active)} aria-current={active ? 'page' : undefined}>
              <span className={`flex items-center justify-center w-12 h-8 rounded-full transition-all ${active ? 'bg-white shadow-[0_4px_12px_-4px_rgba(29,78,216,0.45)] ring-1 ring-white' : ''}`}>
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
          <span className={`flex items-center justify-center w-12 h-8 rounded-full ${menuOpen ? 'bg-white shadow ring-1 ring-white' : ''}`}>
            <Menu size={20} />
          </span>
          <span>{t('mobileNav.menu')}</span>
        </button>
      </div>
    </nav>
  )
}
