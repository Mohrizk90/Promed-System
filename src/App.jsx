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
const Login = lazy(() => import('./components/Auth/Login'))
const SignUp = lazy(() => import('./components/Auth/SignUp'))
import Sidebar from './components/Sidebar'
import BottomNav from './components/BottomNav'
import ProtectedRoute from './components/ProtectedRoute'
import { Breadcrumbs } from './components/ui'
import { Menu } from './components/ui/Icons'
import { ToastProvider, useToast } from './context/ToastContext'
import { LanguageProvider, useLanguage } from './context/LanguageContext'
import { AuthProvider, useAuth } from './context/AuthContext'
import { KeyboardShortcutsProvider, useKeyboardShortcuts } from './context/KeyboardShortcutsContext'

const NAV_SHORTCUTS = [
  { path: '/dashboard', shortcut: 'd' },
  { path: '/', shortcut: 'c' },
  { path: '/suppliers', shortcut: 's' },
  { path: '/products', shortcut: 'p' },
  { path: '/entities', shortcut: 'e' },
  { path: '/liabilities', shortcut: 'l' },
  { path: '/reports/aging', shortcut: 'r' },
]

function AppShell({ children }) {
  const navigate = useNavigate()
  const { registerShortcut, setShowHelp } = useKeyboardShortcuts()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  useEffect(() => {
    NAV_SHORTCUTS.forEach(({ path, shortcut }) => {
      registerShortcut(shortcut, () => navigate(path), `Go to ${path}`)
    })
    registerShortcut('?', () => setShowHelp(true), 'Show keyboard shortcuts')
  }, [navigate, registerShortcut, setShowHelp])

  return (
    <div className="flex h-full min-h-0 bg-gray-100">
      <Sidebar mobileOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      {/* Main content area: offset by sidebar on desktop, full width on mobile */}
      <div className="flex-1 flex flex-col min-w-0 ms-0 md:ms-60">
        {/* Mobile top bar: hamburger + logo only */}
        <header className="flex-shrink-0 flex items-center gap-2 h-12 px-3 bg-blue-700 text-white md:hidden border-b border-blue-600">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="p-2 rounded-lg hover:bg-blue-600 transition-colors"
            aria-label="Open menu"
          >
            <Menu size={24} />
          </button>
          <Link to="/dashboard" className="flex items-center" onClick={() => setSidebarOpen(false)}>
            <div className="bg-white rounded-lg px-2 py-1.5">
              <img src="/Logo_Promed.png" alt="Promed" className="h-8 w-auto object-contain" />
            </div>
          </Link>
        </header>
        {children}
      </div>
    </div>
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
        {showAppShell ? (
          <AppShell>
            <main className="flex-1 min-h-0 flex flex-col overflow-hidden max-w-7xl w-full mx-auto py-2 sm:py-3 px-3 sm:px-4 lg:px-6">
              <Breadcrumbs />
              <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden flex flex-col main-scroll-mobile">
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
