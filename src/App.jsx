import { BrowserRouter as Router, Routes, Route, Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
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
const Invoices = lazy(() => import('./components/Invoices'))
const ComplianceApp = lazy(() => import('./components/Compliance/ComplianceApp'))
const ComplianceLayout = lazy(() => import('./components/Compliance/ComplianceLayout'))
const ComplianceItemDetail = lazy(() => import('./components/Compliance/ComplianceItemDetail'))
const ComplianceOrphanReview = lazy(() => import('./components/Compliance/ComplianceOrphanReview'))
const ComplianceMobileLayout = lazy(() => import('./components/Compliance/ComplianceMobileLayout'))
const ComplianceMobileApp = lazy(() => import('./components/Compliance/ComplianceMobileApp'))
const ComplianceMobileQueue = lazy(() => import('./components/Compliance/ComplianceMobileQueue'))
const AgentMonitoring = lazy(() => import('./components/AgentMonitoring'))
const Login = lazy(() => import('./components/Auth/Login'))
const SignUp = lazy(() => import('./components/Auth/SignUp'))
import Sidebar from './components/Sidebar'
import BottomNav from './components/BottomNav'
import { AppStatusBanners } from './components/PwaControls'
import ProtectedRoute from './components/ProtectedRoute'
import ComplianceOnlyGuard from './components/ComplianceOnlyGuard'
import ComplianceMobileRedirect from './components/Compliance/ComplianceMobileRedirect'
import ErrorBoundary from './components/ErrorBoundary'
import { Breadcrumbs } from './components/ui'
import { Menu } from './components/ui/Icons'
import { ToastProvider, useToast } from './context/ToastContext'
import { LanguageProvider, useLanguage } from './context/LanguageContext'
import { AuthProvider, useAuth } from './context/AuthContext'
import { KeyboardShortcutsProvider, useKeyboardShortcuts } from './context/KeyboardShortcutsContext'
import { isCompliancePath } from './utils/complianceRoutes'
import { isMobileCompliancePath, prefersComplianceMobile } from './utils/deviceProfile'
import { getComplianceHomePath, isComplianceOnlyUser } from './utils/userAccess'

const NAV_SHORTCUTS = [
  { path: '/dashboard', shortcut: 'd' },
  { path: '/', shortcut: 'c' },
  { path: '/suppliers', shortcut: 's' },
  { path: '/entities', shortcut: 'e' },
  { path: '/liabilities', shortcut: 'l' },
  { path: '/compliance', shortcut: 'm' },
]

const PAGE_TITLES = [
  ['/dashboard', 'nav.dashboard'],
  ['/invoices', 'nav.invoices'],
  ['/suppliers', 'nav.supplierTransactions'],
  ['/entities', 'nav.clientsSuppliers'],
  ['/products', 'nav.inventory'],
  ['/liabilities', 'nav.liabilities'],
  ['/reports', 'nav.reports'],
  ['/compliance', 'nav.compliance'],
  ['/monitoring', 'nav.monitoring'],
  ['/settings', 'common.settings'],
]

function getPageTitle(pathname, t) {
  if (pathname === '/') return t('nav.clientTransactions')
  const hit = PAGE_TITLES.find(([prefix]) => pathname === prefix || pathname.startsWith(prefix + '/'))
  return hit ? t(hit[1]) : ''
}

function AppShell({ children }) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { registerShortcut, setShowHelp } = useKeyboardShortcuts()
  const { t } = useLanguage()
  const location = useLocation()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const pageTitle = getPageTitle(location.pathname, t)

  // Close the drawer whenever the route changes (e.g. via bottom tabs).
  useEffect(() => { setSidebarOpen(false) }, [location.pathname])
  const homePath = isComplianceOnlyUser(user)
    ? getComplianceHomePath({ mobile: prefersComplianceMobile() })
    : '/dashboard'

  useEffect(() => {
    const shortcuts = isComplianceOnlyUser(user)
      ? [{ path: getComplianceHomePath({ mobile: prefersComplianceMobile() }), shortcut: 'm' }]
      : NAV_SHORTCUTS
    shortcuts.forEach(({ path, shortcut }) => {
      registerShortcut(shortcut, () => navigate(path), `Go to ${path}`)
    })
    if (!isComplianceOnlyUser(user)) {
      registerShortcut('?', () => setShowHelp(true), 'Show keyboard shortcuts')
    }
  }, [navigate, registerShortcut, setShowHelp, user])

  return (
    <div className="flex h-full min-h-0">
      <Sidebar mobileOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      {/* Main content area: offset by sidebar on desktop, full width on mobile */}
        <div className="flex-1 flex flex-col min-w-0 ms-0 md:ms-60">
        {/* Mobile top bar: menu, logo, current page */}
        <header className="glass-chrome relative z-20 flex-shrink-0 flex items-center gap-2 px-2 pt-safe text-[#0b2a55] md:hidden no-print">
          <div className="flex items-center gap-2 h-12 w-full min-w-0">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="p-2 rounded-xl hover:bg-white/60 active:bg-white/80 transition-colors"
              aria-label="Open menu"
            >
              <Menu size={22} />
            </button>
            <Link to={homePath} className="flex items-center flex-shrink-0" onClick={() => setSidebarOpen(false)} aria-label="Promed home">
              <span className="bg-white/90 rounded-lg px-1.5 py-1 shadow-sm ring-1 ring-white">
                <img src="/Logo_Promed.png" alt="Promed" className="h-6 w-auto object-contain" />
              </span>
            </Link>
            {pageTitle && (
              <h1 className="flex-1 min-w-0 truncate text-[15px] font-semibold ps-1">{pageTitle}</h1>
            )}
          </div>
        </header>
        {children}
      </div>
      <BottomNav menuOpen={sidebarOpen} onMenuClick={() => setSidebarOpen((v) => !v)} />
    </div>
  )
}

function NotFound() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()
  const complianceOnly = isComplianceOnlyUser(user)
  const homePath = complianceOnly
    ? getComplianceHomePath({ mobile: prefersComplianceMobile() })
    : (isCompliancePath(location.pathname) ? '/compliance' : '/')
  const homeLabel = complianceOnly || isCompliancePath(location.pathname) ? 'Compliance' : 'Home'
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-100 px-4">
      <h1 className="text-4xl font-bold text-gray-800 mb-2">404</h1>
      <p className="text-gray-600 mb-6">Page not found</p>
      <button
        onClick={() => navigate(homePath)}
        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
      >
        Go to {homeLabel}
      </button>
    </div>
  )
}

function AppContent() {
  const { toasts, removeToast } = useToast()
  const { user, loading } = useAuth()
  const location = useLocation()
  const isLoginPage = location.pathname === '/login'
  const isSignUpPage = location.pathname === '/signup'
  const isPublicPage = isLoginPage || isSignUpPage

  // While Supabase is still hydrating the session from localStorage, render ONLY
  // the spinner and do NOT mount the route tree. Otherwise the catch-all
  // <Navigate to="/login"> in the else-branch fires during loading and rewrites
  // the URL to /login; once hydration finishes the user is stranded on the login
  // page even though a valid session exists. (This is the "sign in on every
  // refresh" bug.) On the public pages we let the form render immediately.
  if (loading && !isPublicPage) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  const showMobileComplianceShell = user && !isPublicPage && isMobileCompliancePath(location.pathname)
  const showAppShell = user && !isLoginPage && !isSignUpPage && !showMobileComplianceShell

  // Phone users on /compliance/* go straight to the scan mini-app (no ERP chrome flash).
  if (
    user
    && !isPublicPage
    && prefersComplianceMobile()
    && location.pathname.startsWith('/compliance')
    && !isMobileCompliancePath(location.pathname)
  ) {
    const suffix = location.pathname.replace(/^\/compliance/, '') || ''
    return <Navigate to={`/m/compliance${suffix}${location.search}`} replace />
  }

  return (
    <>
      <div className={showAppShell || showMobileComplianceShell ? 'app-wallpaper h-full flex flex-col overflow-hidden' : 'app-wallpaper h-full overflow-y-auto'}>
        {showMobileComplianceShell ? (
          <ErrorBoundary>
            <Suspense fallback={<div className="flex-1 flex items-center justify-center min-h-[200px]"><LoadingSpinner size="lg" /></div>}>
              <Routes>
                <Route path="/m/compliance" element={<ProtectedRoute><ComplianceMobileLayout /></ProtectedRoute>}>
                  <Route index element={<ComplianceMobileApp />} />
                  <Route path="queue" element={<ComplianceMobileQueue />} />
                  <Route path="review-orphan/:docId" element={<ComplianceOrphanReview />} />
                </Route>
                <Route path="*" element={<Navigate to="/m/compliance" replace />} />
              </Routes>
            </Suspense>
          </ErrorBoundary>
        ) : showAppShell ? (
          <AppShell>
            <ComplianceMobileRedirect />
            <main className="app-main flex-1 min-h-0 flex flex-col overflow-hidden max-w-7xl w-full mx-auto py-2 sm:py-3 px-3 sm:px-4 lg:px-6">
              <Breadcrumbs />
              <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden flex flex-col main-scroll-mobile">
                <ErrorBoundary>
                <Suspense fallback={<div className="flex-1 flex items-center justify-center min-h-[200px]"><LoadingSpinner size="lg" /></div>}>
                  <Routes>
              {/* Public */}
              <Route path="/login" element={<Login />} />
              <Route path="/signup" element={<SignUp />} />

              {/* Protected: must be signed in; compliance-only users are redirected */}
              <Route path="/dashboard" element={<ProtectedRoute><ComplianceOnlyGuard><Dashboard /></ComplianceOnlyGuard></ProtectedRoute>} />
              <Route path="/" element={<ProtectedRoute><ComplianceOnlyGuard><ClientTransactions /></ComplianceOnlyGuard></ProtectedRoute>} />
              <Route path="/invoices" element={<ProtectedRoute><ComplianceOnlyGuard><Invoices /></ComplianceOnlyGuard></ProtectedRoute>} />
              <Route path="/suppliers" element={<ProtectedRoute><ComplianceOnlyGuard><SupplierTransactions /></ComplianceOnlyGuard></ProtectedRoute>} />
              <Route path="/entities" element={<ProtectedRoute><ComplianceOnlyGuard><ClientsSuppliers /></ComplianceOnlyGuard></ProtectedRoute>} />
              <Route path="/entities/clients" element={<ProtectedRoute><ComplianceOnlyGuard><ClientsSuppliers /></ComplianceOnlyGuard></ProtectedRoute>} />
              <Route path="/entities/suppliers" element={<ProtectedRoute><ComplianceOnlyGuard><ClientsSuppliers /></ComplianceOnlyGuard></ProtectedRoute>} />
              <Route path="/entities/employees" element={<ProtectedRoute><ComplianceOnlyGuard><ClientsSuppliers /></ComplianceOnlyGuard></ProtectedRoute>} />
              <Route path="/liabilities" element={<ProtectedRoute><ComplianceOnlyGuard><Liabilities /></ComplianceOnlyGuard></ProtectedRoute>} />
              <Route path="/settings" element={<ProtectedRoute><ComplianceOnlyGuard><SettingsPage /></ComplianceOnlyGuard></ProtectedRoute>} />
              <Route path="/products" element={<ProtectedRoute><ComplianceOnlyGuard><ProductInventory /></ComplianceOnlyGuard></ProtectedRoute>} />
              <Route path="/reports/aging" element={<ProtectedRoute><ComplianceOnlyGuard><AgingReport /></ComplianceOnlyGuard></ProtectedRoute>} />
              <Route path="/reports/pnl" element={<ProtectedRoute><ComplianceOnlyGuard><ProfitLossReport /></ComplianceOnlyGuard></ProtectedRoute>} />
              <Route path="/monitoring/agent" element={<ProtectedRoute><ComplianceOnlyGuard><AgentMonitoring /></ComplianceOnlyGuard></ProtectedRoute>} />

              {/* Compliance & Regulatory Management (worker runs for all sub-routes) */}
              <Route path="/compliance" element={<ProtectedRoute><ComplianceLayout /></ProtectedRoute>}>
                <Route index element={<ComplianceApp />} />
                <Route path="import" element={<Navigate to="/compliance" replace />} />
                <Route path="scan" element={<Navigate to="/m/compliance" replace />} />
                <Route path="review-orphan/:docId" element={<ComplianceOrphanReview />} />
                <Route path="item/:id" element={<ComplianceItemDetail />} />
                <Route path=":tab" element={<ComplianceApp />} />
              </Route>

              {/* 404 */}
              <Route path="*" element={<NotFound />} />
                  </Routes>
                </Suspense>
                </ErrorBoundary>
              </div>
            </main>
          </AppShell>
        ) : (
          <Suspense fallback={<div className="flex-1 flex items-center justify-center min-h-[200px]"><LoadingSpinner size="lg" /></div>}>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/signup" element={<SignUp />} />
              <Route path="*" element={<Navigate to="/login" replace />} />
            </Routes>
          </Suspense>
        )}

        <AppStatusBanners />
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
