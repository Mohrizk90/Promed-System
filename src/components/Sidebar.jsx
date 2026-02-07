import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import {
  LayoutDashboard,
  Receipt,
  Truck,
  Users,
  CreditCard,
  Package,
  PieChart,
  X,
  HelpCircle,
  Settings,
  LogOut,
  User as UserIcon,
  ChevronDown,
} from './ui/Icons'
import LanguageSwitcher from './LanguageSwitcher'
import { useLanguage } from '../context/LanguageContext'
import packageJson from '../../package.json'
import { useAuth } from '../context/AuthContext'
import { useKeyboardShortcuts } from '../context/KeyboardShortcutsContext'

const SIDEBAR_WIDTH = '15rem'

export default function Sidebar({ mobileOpen, onClose }) {
  const location = useLocation()
  const navigate = useNavigate()
  const { t } = useLanguage()
  const { user, signOut } = useAuth()
  const { setShowHelp } = useKeyboardShortcuts()
  const [userMenuOpen, setUserMenuOpen] = useState(false)

  const isActive = (path) =>
    location.pathname === path || (path === '/reports/aging' && location.pathname.startsWith('/reports'))

  const navItems = [
    { path: '/dashboard', label: t('nav.dashboard'), icon: LayoutDashboard, shortcut: 'd', color: 'indigo' },
    { path: '/', label: t('nav.clientTransactions'), icon: Receipt, shortcut: 'c', color: 'cyan' },
    { path: '/suppliers', label: t('nav.supplierTransactions'), icon: Truck, shortcut: 's', color: 'violet' },
    { path: '/entities', label: t('nav.clientsSuppliers'), icon: Users, shortcut: 'e', color: 'emerald' },
    { path: '/liabilities', label: t('nav.liabilities'), icon: CreditCard, shortcut: 'l', color: 'amber' },
    { path: '/products', label: t('nav.products'), icon: Package, shortcut: 'p', color: 'teal', beta: true },
    { path: '/reports/aging', label: t('nav.reports'), icon: PieChart, shortcut: 'r', color: 'rose', beta: true },
  ]

  const iconColors = {
    indigo: { inactive: 'bg-indigo-500/90 text-white', active: 'bg-indigo-100 text-indigo-600' },
    cyan: { inactive: 'bg-cyan-500/90 text-white', active: 'bg-cyan-100 text-cyan-600' },
    violet: { inactive: 'bg-violet-500/90 text-white', active: 'bg-violet-100 text-violet-600' },
    teal: { inactive: 'bg-teal-500/90 text-white', active: 'bg-teal-100 text-teal-600' },
    emerald: { inactive: 'bg-emerald-500/90 text-white', active: 'bg-emerald-100 text-emerald-600' },
    amber: { inactive: 'bg-amber-500/90 text-white', active: 'bg-amber-100 text-amber-700' },
    rose: { inactive: 'bg-rose-500/90 text-white', active: 'bg-rose-100 text-rose-600' },
  }

  const handleNavClick = () => { if (onClose) onClose() }

  const handleSignOut = async () => {
    setUserMenuOpen(false)
    if (onClose) onClose()
    await signOut()
    navigate('/login')
  }

  /* ── Shared nav link renderer ── */
  const NavLink = ({ item, size = 'sm' }) => {
    const Icon = item.icon
    const active = isActive(item.path)
    const ic = iconColors[item.color] || iconColors.indigo
    const isSm = size === 'sm'

    return (
      <Link
        key={item.path}
        to={item.path}
        onClick={handleNavClick}
        className={`rtl-flip flex items-center gap-2.5 px-2.5 ${isSm ? 'py-1.5' : 'py-2'} rounded-lg text-[13px] font-medium transition-all ${
          active
            ? 'bg-white/95 text-gray-800 shadow-sm'
            : 'text-blue-100 hover:bg-white/10'
        }`}
      >
        <span className={`flex items-center justify-center ${isSm ? 'w-7 h-7' : 'w-8 h-8'} rounded-md flex-shrink-0 transition-colors ${active ? ic.active : ic.inactive}`}>
          <Icon size={isSm ? 16 : 18} strokeWidth={2} />
        </span>
        <span className="truncate flex items-center gap-1.5">
          {item.label}
          {item.beta && (
            <span className={`inline-flex items-center px-1 py-px rounded text-[9px] font-semibold leading-tight flex-shrink-0 ${active ? 'bg-blue-100 text-blue-700' : 'bg-white/20 text-white/90'}`}>
              {t('common.beta')}
            </span>
          )}
        </span>
        {isSm && <kbd className="hidden xl:inline-flex ml-auto text-[9px] opacity-40 font-mono flex-shrink-0">{item.shortcut}</kbd>}
      </Link>
    )
  }

  /* ── Desktop sidebar content ── */
  const sidebarContent = (
    <>
      {/* Logo */}
      <div className="flex-shrink-0 px-3 pt-3 pb-2">
        <Link to="/dashboard" onClick={handleNavClick} className="block bg-white rounded-lg px-2.5 py-1.5">
          <img src="/Logo_Promed.png" alt="Promed" className="h-10 w-auto mx-auto object-contain" />
        </Link>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2 py-1 space-y-0.5" aria-label="Main">
        {navItems.map((item) => <NavLink key={item.path} item={item} size="sm" />)}
      </nav>

      {/* Bottom section */}
      <div className="flex-shrink-0 px-2 py-2 border-t border-white/10 space-y-0.5">
        {/* Help */}
        <button
          type="button"
          onClick={() => { setShowHelp(true); if (onClose) onClose() }}
          className="rtl-flip w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-[12px] text-blue-200/80 hover:bg-white/10 hover:text-white transition-colors"
        >
          <HelpCircle size={14} className="flex-shrink-0" />
          <span className="truncate">{t('common.keyboard')}</span>
        </button>

        {/* Language */}
        <div className="px-1">
          <LanguageSwitcher />
        </div>

        {/* User */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setUserMenuOpen(!userMenuOpen)}
            className="rtl-flip w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[12px] text-blue-200/80 hover:bg-white/10 hover:text-white transition-colors"
          >
            <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0">
              <UserIcon size={12} />
            </div>
            <span className="truncate text-left flex-1 min-w-0">{user?.email || 'Account'}</span>
            <ChevronDown size={12} className={`flex-shrink-0 transition-transform ${userMenuOpen ? 'rotate-180' : ''}`} />
          </button>
          {userMenuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setUserMenuOpen(false)} aria-hidden="true" />
              <div className="absolute bottom-full left-1 right-1 mb-1 bg-white rounded-lg shadow-lg border border-gray-200 py-0.5 z-20">
                <button
                  type="button"
                  onClick={() => { setUserMenuOpen(false); handleNavClick(); navigate('/settings') }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-gray-700 hover:bg-gray-50 rounded"
                >
                  <Settings size={13} />
                  {t('common.settings')}
                </button>
                <button
                  type="button"
                  onClick={handleSignOut}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-red-600 hover:bg-gray-50 rounded"
                >
                  <LogOut size={13} />
                  {t('common.signOut')}
                </button>
              </div>
            </>
          )}
        </div>

        {/* Version */}
        <div className="text-center pt-0.5">
          <span className="text-[9px] text-blue-300/50 font-medium">v{packageJson.version}</span>
        </div>
      </div>
    </>
  )

  const baseClasses = 'flex flex-col h-full bg-gradient-to-b from-blue-700 to-blue-800 text-white z-30'
  const widthStyle = { width: SIDEBAR_WIDTH, minWidth: SIDEBAR_WIDTH }

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className={`${baseClasses} hidden md:flex fixed top-0 bottom-0 start-0 pt-safe`}
        style={widthStyle}
        aria-label="Sidebar"
      >
        {sidebarContent}
      </aside>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 md:hidden animate-fade-in"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* Mobile drawer */}
      <aside
        className={`${baseClasses} md:hidden fixed top-0 bottom-0 start-0 pt-safe transform transition-transform duration-200 ease-out ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full rtl:translate-x-full'
        }`}
        style={widthStyle}
        aria-label="Sidebar"
        aria-hidden={!mobileOpen}
      >
        {/* Mobile header */}
        <div className="flex items-center justify-between px-3 py-2 flex-shrink-0">
          <div className="bg-white rounded-lg px-2.5 py-1.5">
            <img src="/Logo_Promed.png" alt="Promed" className="h-10 w-auto object-contain" />
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-blue-200 hover:bg-white/10 hover:text-white"
            aria-label="Close menu"
          >
            <X size={20} />
          </button>
        </div>

        {/* Mobile nav */}
        <div className="flex-1 overflow-hidden flex flex-col">
          <nav className="flex-1 overflow-y-auto px-2 py-1 space-y-0.5">
            {navItems.map((item) => <NavLink key={item.path} item={item} size="md" />)}
          </nav>

          {/* Mobile bottom */}
          <div className="flex-shrink-0 px-2 py-2 border-t border-white/10 space-y-0.5">
            <button
              type="button"
              onClick={() => { setShowHelp(true); onClose?.() }}
              className="rtl-flip w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-[12px] text-blue-200/80 hover:bg-white/10 hover:text-white"
            >
              <HelpCircle size={14} />
              <span>{t('common.keyboard')}</span>
            </button>
            <div className="px-1">
              <LanguageSwitcher />
            </div>
            <button
              type="button"
              onClick={handleSignOut}
              className="rtl-flip w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-[12px] text-red-300/80 hover:bg-white/10 hover:text-white"
            >
              <LogOut size={14} />
              <span>{t('common.signOut')}</span>
            </button>
            <div className="text-center pt-0.5">
              <span className="text-[9px] text-blue-300/50 font-medium">v{packageJson.version}</span>
            </div>
          </div>
        </div>
      </aside>
    </>
  )
}
