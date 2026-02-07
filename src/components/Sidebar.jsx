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
} from './ui/Icons'
import LanguageSwitcher from './LanguageSwitcher'
import { useLanguage } from '../context/LanguageContext'
import { useAuth } from '../context/AuthContext'
import { useKeyboardShortcuts } from '../context/KeyboardShortcutsContext'

const SIDEBAR_WIDTH = '16.5rem' // ~w-66

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

  const iconColorClasses = {
    indigo: { inactive: 'bg-indigo-500 text-white', active: 'bg-indigo-100 text-indigo-700' },
    cyan: { inactive: 'bg-cyan-500 text-white', active: 'bg-cyan-100 text-cyan-700' },
    violet: { inactive: 'bg-violet-500 text-white', active: 'bg-violet-100 text-violet-700' },
    teal: { inactive: 'bg-teal-500 text-white', active: 'bg-teal-100 text-teal-700' },
    emerald: { inactive: 'bg-emerald-500 text-white', active: 'bg-emerald-100 text-emerald-700' },
    amber: { inactive: 'bg-amber-500 text-amber-950', active: 'bg-amber-100 text-amber-800' },
    rose: { inactive: 'bg-rose-500 text-white', active: 'bg-rose-100 text-rose-700' },
  }

  const handleNavClick = () => {
    if (onClose) onClose()
  }

  const handleSignOut = async () => {
    setUserMenuOpen(false)
    if (onClose) onClose()
    await signOut()
    navigate('/login')
  }

  const sidebarContent = (
    <>
      {/* Logo */}
      <div className="flex-shrink-0 px-3 py-3 border-b border-blue-600/50">
        <Link to="/dashboard" onClick={handleNavClick} className="block bg-white rounded-lg px-3 py-2.5">
          <img src="/Logo_Promed.png" alt="Promed" className="h-14 w-auto mx-auto object-contain" />
        </Link>
      </div>

      {/* Nav links */}
      <nav className="flex-1 overflow-y-auto py-2 px-2 space-y-1" aria-label="Main">
        {navItems.map((item) => {
          const Icon = item.icon
          const active = isActive(item.path)
          const iconColors = iconColorClasses[item.color] || iconColorClasses.indigo
          return (
            <Link
              key={item.path}
              to={item.path}
              onClick={handleNavClick}
              className={`rtl-flip flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                active
                  ? 'bg-white text-blue-800 shadow-sm'
                  : 'text-blue-100 hover:bg-blue-600 hover:text-white'
              }`}
            >
              <span className={`flex items-center justify-center w-9 h-9 rounded-lg flex-shrink-0 transition-colors ${active ? iconColors.active : iconColors.inactive}`}>
                <Icon size={20} className="flex-shrink-0" strokeWidth={2} />
              </span>
              <span className="truncate flex items-center gap-1.5">
                {item.label}
                {item.beta && (
                  <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold flex-shrink-0 ${active ? 'bg-blue-100 text-blue-800' : 'bg-white/25 text-white'}`} title={t('common.beta')}>
                    {t('common.beta')}
                  </span>
                )}
              </span>
              <kbd className="hidden xl:inline-flex ml-auto kbd text-[10px] opacity-60 flex-shrink-0">{item.shortcut}</kbd>
            </Link>
          )
        })}
      </nav>

      {/* Bottom: Help, Language, User */}
      <div className="flex-shrink-0 p-2 border-t border-blue-600/50 space-y-1">
        <button
          type="button"
          onClick={() => { setShowHelp(true); if (onClose) onClose() }}
          className="rtl-flip w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-blue-100 hover:bg-blue-600 hover:text-white transition-colors"
        >
          <HelpCircle size={18} className="flex-shrink-0" />
          <span className="truncate">{t('common.keyboard')}</span>
        </button>
        <div className="px-2">
          <LanguageSwitcher />
        </div>
        <div className="relative">
          <button
            type="button"
            onClick={() => setUserMenuOpen(!userMenuOpen)}
            className="rtl-flip w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-blue-100 hover:bg-blue-600 hover:text-white transition-colors"
          >
            <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center flex-shrink-0">
              <UserIcon size={16} />
            </div>
            <span className="truncate text-left flex-1 min-w-0">{user?.email || 'Account'}</span>
          </button>
          {userMenuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setUserMenuOpen(false)} aria-hidden="true" />
              <div className="absolute bottom-full left-2 right-2 mb-1 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-20">
                <button
                  type="button"
                  onClick={() => { setUserMenuOpen(false); handleNavClick(); navigate('/settings') }}
                  className="w-full flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                >
                  <Settings size={16} />
                  {t('common.settings')}
                </button>
                <button
                  type="button"
                  onClick={handleSignOut}
                  className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-gray-100"
                >
                  <LogOut size={16} />
                  {t('common.signOut')}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  )

  const baseClasses = 'flex flex-col h-full bg-blue-700 text-white z-30'
  const widthStyle = { width: SIDEBAR_WIDTH, minWidth: SIDEBAR_WIDTH }

  /* Desktop: fixed sidebar on the start side */
  return (
    <>
      {/* Desktop sidebar - always visible from md up */}
      <aside
        className={`${baseClasses} hidden md:flex fixed top-0 bottom-0 start-0 pt-safe`}
        style={widthStyle}
        aria-label="Sidebar"
      >
        {sidebarContent}
      </aside>

      {/* Mobile overlay backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 md:hidden animate-fade-in"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* Mobile sidebar - slide-in drawer */}
      <aside
        className={`${baseClasses} md:hidden fixed top-0 bottom-0 start-0 pt-safe transform transition-transform duration-200 ease-out ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full rtl:translate-x-full'
        }`}
        style={widthStyle}
        aria-label="Sidebar"
        aria-hidden={!mobileOpen}
      >
        <div className="flex items-center justify-between px-3 py-2 border-b border-blue-600/50 flex-shrink-0">
          <div className="bg-white rounded-lg px-3 py-2.5">
            <img src="/Logo_Promed.png" alt="Promed" className="h-14 w-auto object-contain" />
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-blue-100 hover:bg-blue-600 hover:text-white"
            aria-label="Close menu"
          >
            <X size={24} />
          </button>
        </div>
        <div className="flex-1 overflow-hidden flex flex-col">
          <nav className="flex-1 overflow-y-auto py-2 px-2 space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon
              const active = isActive(item.path)
              const iconColors = iconColorClasses[item.color] || iconColorClasses.indigo
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  onClick={handleNavClick}
                  className={`rtl-flip flex items-center gap-3 px-3 py-3 rounded-xl text-base font-medium transition-all ${
                    active
                      ? 'bg-white text-blue-800 shadow-sm'
                      : 'text-blue-100 hover:bg-blue-600 hover:text-white'
                  }`}
                >
                  <span className={`flex items-center justify-center w-10 h-10 rounded-lg flex-shrink-0 transition-colors ${active ? iconColors.active : iconColors.inactive}`}>
                    <Icon size={22} className="flex-shrink-0" strokeWidth={2} />
                  </span>
                  <span className="truncate flex items-center gap-1.5">
                    {item.label}
                    {item.beta && (
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold flex-shrink-0 ${active ? 'bg-blue-100 text-blue-800' : 'bg-white/25 text-white'}`}>{t('common.beta')}</span>
                    )}
                  </span>
                </Link>
              )
            })}
          </nav>
          <div className="flex-shrink-0 p-2 border-t border-blue-600/50 space-y-1">
            <button
              type="button"
              onClick={() => { setShowHelp(true); onClose?.() }}
              className="rtl-flip w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-blue-100 hover:bg-blue-600 hover:text-white"
            >
              <HelpCircle size={18} />
              <span>{t('common.keyboard')}</span>
            </button>
            <div className="px-2">
              <LanguageSwitcher />
            </div>
            <button
              type="button"
              onClick={handleSignOut}
              className="rtl-flip w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-red-200 hover:bg-blue-600 hover:text-white"
            >
              <LogOut size={18} />
              <span>{t('common.signOut')}</span>
            </button>
          </div>
        </div>
      </aside>
    </>
  )
}
