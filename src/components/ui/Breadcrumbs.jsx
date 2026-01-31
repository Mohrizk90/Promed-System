import { Link, useLocation } from 'react-router-dom'
import { ChevronRight, Home } from './Icons'
import { useLanguage } from '../../context/LanguageContext'

const routeNames = {
  en: {
    dashboard: 'Dashboard',
    '': 'Client Transactions',
    suppliers: 'Supplier Transactions',
    entities: 'Clients & Suppliers',
    settings: 'Settings',
    login: 'Login',
    signup: 'Sign Up',
  },
  ar: {
    dashboard: 'لوحة عامة',
    '': 'معاملات العملاء',
    suppliers: 'معاملات الموردين',
    entities: 'العملاء والموردون',
    settings: 'الإعدادات',
    login: 'تسجيل الدخول',
    signup: 'إنشاء حساب',
  },
}

export default function Breadcrumbs() {
  const location = useLocation()
  const { language } = useLanguage()
  
  const pathSegments = location.pathname.split('/').filter(Boolean)
  
  // Don't show breadcrumbs on home page or if only one segment
  if (pathSegments.length === 0) return null
  
  const names = routeNames[language] || routeNames.en

  return (
    <nav aria-label="Breadcrumb" className="mb-4">
      <ol className="rtl-flip flex items-center gap-1 text-sm">
        <li>
          <Link
            to="/"
            className="flex items-center gap-1 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
          >
            <Home size={16} />
            <span className="hidden sm:inline">Home</span>
          </Link>
        </li>
        
        {pathSegments.map((segment, index) => {
          const path = '/' + pathSegments.slice(0, index + 1).join('/')
          const isLast = index === pathSegments.length - 1
          const name = names[segment] || segment.charAt(0).toUpperCase() + segment.slice(1)
          
          return (
            <li key={path} className="flex items-center gap-1">
              <ChevronRight size={16} className="text-gray-400 rtl-chevron-flip" />
              {isLast ? (
                <span className="font-medium text-gray-900 dark:text-gray-100">
                  {name}
                </span>
              ) : (
                <Link
                  to={path}
                  className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
                >
                  {name}
                </Link>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
