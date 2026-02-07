import { BrowserRouter as Router, Routes, Route, Link, useLocation, useNavigate } from 'react-router-dom'
import { useState, useEffect, lazy, Suspense } from 'react'
import ToastContainer from './components/ToastContainer'
import LoadingSpinner from './components/LoadingSpinner'

const ClientTransactions = lazy(() => import('./components/ClientTransactions'))
const SupplierTransactions = lazy(() => import('./components/SupplierTransactions'))
const Dashboard = lazy(() => import('./components/Dashboard'))
const ClientsSuppliers = lazy(() => import('./components/ClientsSuppliers'))
const Liabilities = lazy(() => import('./components/Liabilities'))
const SettingsPage = lazy(() => import('./components/Settings'))
const AgingReport = lazy(() => import('./components/AgingReport'))
const ProfitLossReport = lazy(() => import('./components/ProfitLossReport'))
const ProductInventory = lazy(() => import('./components/ProductInventory'))
const Login = lazy(() => import('./components/Auth/Login'))
const SignUp = lazy(() => import('./components/Auth/SignUp'))
import LanguageSwitcher from './components/LanguageSwitcher'
import BottomNav from './components/BottomNav'
import ProtectedRoute from './components/ProtectedRoute'
import { Breadcrumbs } from './components/ui'
import { 
  LayoutDashboard, 
  FileText, 
  Truck, 
  Users, 
  Wallet,
  Package,
  ClipboardList,
  Menu, 
  X,
  HelpCircle,
  Settings,
  LogOut,
  User as UserIcon
} from './components/ui/Icons'
import { ToastProvider, useToast } from './context/ToastContext'
import { LanguageProvider, useLanguage } from './context/LanguageContext'
import { AuthProvider, useAuth } from './context/AuthContext'
import { KeyboardShortcutsProvider, useKeyboardShortcuts } from './context/KeyboardShortcutsContext'

function Navigation() {
  const location = useLocation()
  const navigate = useNavigate()
  const { t } = useLanguage()
  const { user, signOut } = useAuth()
  const { registerShortcut, setShowHelp } = useKeyboardShortcuts()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)

  const isActive = (path) => location.pathname === path || (path === '/reports/aging' && location.pathname.startsWith('/reports'))

  const navItems = [
    { path: '/dashboard', label: t('nav.dashboard'), icon: LayoutDashboard, shortcut: 'd', color: 'indigo' },
    { path: '/', label: t('nav.clientTransactions'), icon: FileText, shortcut: 'c', color: 'cyan' },
    { path: '/suppliers', label: t('nav.supplierTransactions'), icon: Truck, shortcut: 's', color: 'violet' },
    { path: '/products', label: t('nav.products'), icon: Package, shortcut: 'p', color: 'teal' },
    { path: '/entities', label: t('nav.clientsSuppliers'), icon: Users, shortcut: 'e', color: 'emerald' },
    { path: '/liabilities', label: t('nav.liabilities'), icon: Wallet, shortcut: 'l', color: 'amber' },
    { path: '/reports/aging', label: t('nav.reports'), icon: ClipboardList, shortcut: 'r', color: 'rose' },
  ]

  const navColorClasses = {
    indigo: { active: 'bg-indigo-500 text-white shadow-inner', inactive: 'text-blue-100 hover:bg-indigo-500/40 hover:text-white' },
    cyan: { active: 'bg-cyan-500 text-white shadow-inner', inactive: 'text-blue-100 hover:bg-cyan-500/40 hover:text-white' },
    violet: { active: 'bg-violet-500 text-white shadow-inner', inactive: 'text-blue-100 hover:bg-violet-500/40 hover:text-white' },
    teal: { active: 'bg-teal-500 text-white shadow-inner', inactive: 'text-blue-100 hover:bg-teal-500/40 hover:text-white' },
    emerald: { active: 'bg-emerald-500 text-white shadow-inner', inactive: 'text-blue-100 hover:bg-emerald-500/40 hover:text-white' },
    amber: { active: 'bg-amber-500 text-amber-950 shadow-inner', inactive: 'text-blue-100 hover:bg-amber-500/50 hover:text-amber-950' },
    rose: { active: 'bg-rose-500 text-white shadow-inner', inactive: 'text-blue-100 hover:bg-rose-500/40 hover:text-white' },
  }

  // Register keyboard shortcuts for navigation
  useEffect(() => {
    navItems.forEach(item => {
      registerShortcut(item.shortcut, () => navigate(item.path), `Go to ${item.label}`)
    })
    registerShortcut('?', () => setShowHelp(true), 'Show keyboard shortcuts')
  }, [navigate, registerShortcut, setShowHelp])

  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
  }

  return (
    <nav className="bg-blue-700 text-white shadow-lg flex-shrink-0 z-30 pt-safe">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="rtl-flip flex justify-between h-16">
          {/* Logo and Desktop Nav */}
          <div className="rtl-flip flex">
            <Link to="/dashboard" className="flex-shrink-0 flex items-center gap-2">
              <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center">
                <span className="text-blue-700 font-bold text-lg">P</span>
              </div>
              <h1 className="text-2xl font-bold hidden sm:block">Promed</h1>
            </Link>
            
            {/* Desktop Navigation */}
            <div className="rtl-flip hidden md:ml-8 md:flex md:space-x-1 md:items-center">
              {navItems.map((item) => {
                const Icon = item.icon
                const active = isActive(item.path)
                const colors = navColorClasses[item.color] || navColorClasses.indigo
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${active ? colors.active : colors.inactive}`}
                  >
                    <Icon size={18} />
                    <span>{item.label}</span>
                    <kbd className="hidden lg:inline-block ml-1 kbd text-[10px] opacity-60">{item.shortcut}</kbd>
                  </Link>
                )
              })}
            </div>
          </div>

          {/* Right side controls */}
          <div className="rtl-flip flex items-center gap-2">
            {/* Help button */}
            <button
              onClick={() => setShowHelp(true)}
              className="hidden sm:flex p-2 rounded-lg text-blue-200 hover:text-white hover:bg-blue-600 transition-colors"
              title="Keyboard shortcuts (?)"
            >
              <HelpCircle size={20} />
            </button>
            
            {/* Language Switcher */}
            <LanguageSwitcher />

            {/* User Menu */}
            <div className="relative hidden sm:block">
              <button
                onClick={() => setUserMenuOpen(!userMenuOpen)}
                className="flex items-center gap-2 p-2 rounded-lg hover:bg-blue-600 transition-colors"
              >
                <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center">
                  <UserIcon size={18} />
                </div>
              </button>
              
              {userMenuOpen && (
                <>
                  <div 
                    className="fixed inset-0 z-10" 
                    onClick={() => setUserMenuOpen(false)}
                  />
                  <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-20">
                    <div className="px-4 py-2 border-b border-gray-200">
              <p className="text-sm font-medium text-gray-900 truncate">
                {user?.email}
              </p>
            </div>
                    <button
                      onClick={() => {
                        setUserMenuOpen(false)
                        navigate('/settings')
                      }}
                      className="w-full flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                    >
                      <Settings size={16} />
                      Settings
                    </button>
                    <button
                      onClick={() => {
                        setUserMenuOpen(false)
                        handleSignOut()
                      }}
                      className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-gray-100"
                    >
                      <LogOut size={16} />
                      Sign Out
                    </button>
                  </div>
                </>
              )}
            </div>
            
            {/* Mobile menu button */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden p-2 rounded-lg hover:bg-blue-600"
            >
              {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
            </button>
          </div>
        </div>
      </div>
      
      {/* Mobile Navigation */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-blue-600 animate-slide-up">
          <div className="px-2 pt-2 pb-3 space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon
              const active = isActive(item.path)
              const colors = navColorClasses[item.color] || navColorClasses.indigo
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  onClick={() => setMobileMenuOpen(false)}
                  className={`flex items-center gap-3 px-3 py-3 rounded-lg text-base font-medium ${active ? colors.active : colors.inactive}`}
                >
                  <Icon size={20} />
                  {item.label}
                </Link>
              )
            })}
            <div className="border-t border-blue-600 pt-2 mt-2">
              <button
                onClick={() => {
                  setMobileMenuOpen(false)
                  handleSignOut()
                }}
                className="flex items-center gap-3 px-3 py-3 rounded-lg text-base font-medium text-red-300 hover:bg-blue-600 w-full"
              >
                <LogOut size={20} />
                Sign Out
              </button>
            </div>
          </div>
        </div>
      )}
    </nav>
  )
}

function NotFound() {
  const navigate = useNavigate()
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-100 px-4">
      <h1 className="text-4xl font-bold text-gray-800 mb-2">404</h1>
      <p className="text-gray-600 mb-6">Page not found</p>
      <button
        onClick={() => navigate('/')}
        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
      >
        Go to Home
      </button>
    </div>
  )
}

function AppContent() {
  const { toasts, removeToast } = useToast()
  const { user } = useAuth()
  const location = useLocation()
  const isLoginPage = location.pathname === '/login'
  const isSignUpPage = location.pathname === '/signup'
  const showAppShell = user && !isLoginPage && !isSignUpPage

  return (
    <>
      <div className={`${showAppShell ? 'h-screen flex flex-col bg-gray-100 overflow-hidden' : 'min-h-screen bg-gray-100'} ${showAppShell ? 'pb-0' : ''}`}>
        {showAppShell && <Navigation />}
        <main className={showAppShell ? 'flex-1 min-h-0 flex flex-col overflow-hidden max-w-7xl w-full mx-auto py-2 sm:py-3 px-3 sm:px-4 lg:px-6' : ''}>
          {showAppShell && <Breadcrumbs />}
          <div className={showAppShell ? 'flex-1 min-h-0 overflow-y-auto overflow-x-hidden flex flex-col main-scroll-mobile' : ''}>
          <Suspense fallback={<div className="flex-1 flex items-center justify-center min-h-[200px]"><LoadingSpinner size="lg" /></div>}>
            <Routes>
              {/* Public */}
              <Route path="/login" element={<Login />} />
              <Route path="/signup" element={<SignUp />} />

              {/* Protected: must be signed in to access */}
              <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
              <Route path="/" element={<ProtectedRoute><ClientTransactions /></ProtectedRoute>} />
              <Route path="/suppliers" element={<ProtectedRoute><SupplierTransactions /></ProtectedRoute>} />
              <Route path="/entities" element={<ProtectedRoute><ClientsSuppliers /></ProtectedRoute>} />
              <Route path="/entities/clients" element={<ProtectedRoute><ClientsSuppliers /></ProtectedRoute>} />
              <Route path="/entities/suppliers" element={<ProtectedRoute><ClientsSuppliers /></ProtectedRoute>} />
              <Route path="/liabilities" element={<ProtectedRoute><Liabilities /></ProtectedRoute>} />
              <Route path="/settings" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
              <Route path="/products" element={<ProtectedRoute><ProductInventory /></ProtectedRoute>} />
              <Route path="/reports/aging" element={<ProtectedRoute><AgingReport /></ProtectedRoute>} />
              <Route path="/reports/pnl" element={<ProtectedRoute><ProfitLossReport /></ProtectedRoute>} />

              {/* 404 */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
          </div>
        </main>

        {showAppShell && <BottomNav />}

        <ToastContainer toasts={toasts} removeToast={removeToast} />
      </div>
    </>
  )
}

function App() {
  return (
    <Router>
      <LanguageProvider>
        <AuthProvider>
          <ToastProvider>
            <KeyboardShortcutsProvider>
              <AppContent />
            </KeyboardShortcutsProvider>
          </ToastProvider>
        </AuthProvider>
      </LanguageProvider>
    </Router>
  )
}

export default App
