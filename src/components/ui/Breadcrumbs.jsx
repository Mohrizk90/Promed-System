import { Link, useLocation } from 'react-router-dom'
import { ChevronRight, Home } from './Icons'
import { useLanguage } from '../../context/LanguageContext'
import { isCompliancePath, complianceTabPath } from '../../utils/complianceRoutes'

const routeNames = {
  en: {
    dashboard: 'Dashboard',
    '': 'Client Transactions',
    invoices: 'Invoices',
    suppliers: 'Supplier Transactions',
    entities: 'Clients & Suppliers',
    liabilities: 'Liabilities & Expenses',
    settings: 'Settings',
    reports: 'Reports',
    aging: 'Aging Report',
    pnl: 'Profit & Loss',
    products: 'Inventory',
    compliance: 'Compliance',
    import: 'Import',
    documents: 'Documents',
    processing: 'Processing',
    items: 'Items',
    calendar: 'Calendar',
    authorities: 'Authorities',
    'review-orphan': 'Review',
    item: 'Item',
    login: 'Login',
    signup: 'Sign Up',
  },
  ar: {
    dashboard: 'لوحة عامة',
    '': 'معاملات العملاء',
    invoices: 'الفواتير',
    suppliers: 'معاملات الموردين',
    entities: 'العملاء والموردون',
    liabilities: 'الالتزامات والمصروفات',
    settings: 'الإعدادات',
    reports: 'التقارير',
    aging: 'تقرير الأعمار',
    pnl: 'الأرباح والخسائر',
    products: 'المخزون',
    compliance: 'الامتثال',
    import: 'استيراد',
    documents: 'المستندات',
    processing: 'المعالجة',
    items: 'العناصر',
    calendar: 'التقويم',
    authorities: 'الجهات',
    'review-orphan': 'مراجعة',
    item: 'عنصر',
    login: 'تسجيل الدخول',
    signup: 'إنشاء حساب',
  },
}

export default function Breadcrumbs() {
  const location = useLocation()
  const { language } = useLanguage()
  
  const pathSegments = location.pathname.split('/').filter(Boolean)
  const names = routeNames[language] || routeNames.en
  const inCompliance = isCompliancePath(location.pathname)
  const homePath = inCompliance ? complianceTabPath('dashboard') : '/'
  const homeLabel = inCompliance ? names.compliance : 'Home'
  const crumbSegments = inCompliance && pathSegments[0] === 'compliance'
    ? pathSegments.slice(1)
    : pathSegments
  
  // Don't show breadcrumbs on home page or if only one segment
  if (pathSegments.length === 0) return null
  if (!inCompliance && pathSegments.length === 1) return null
  if (inCompliance && crumbSegments.length === 0) return null

  return (
    <nav aria-label="Breadcrumb" className="mb-4">
      <ol className="rtl-flip flex items-center gap-1 text-sm">
        <li>
          <Link
            to={homePath}
            className="flex items-center gap-1 text-gray-500 hover:text-gray-700 transition-colors"
          >
            <Home size={16} />
            <span className="hidden sm:inline">{homeLabel}</span>
          </Link>
        </li>
        
        {crumbSegments.map((segment, index) => {
          const path = inCompliance
            ? `${complianceTabPath('dashboard')}${crumbSegments.slice(0, index + 1).map((s) => `/${s}`).join('')}`
            : `/${pathSegments.slice(0, index + 1).join('/')}`
          const isLast = index === crumbSegments.length - 1
          const name = names[segment] || segment.charAt(0).toUpperCase() + segment.slice(1)
          
          return (
            <li key={path} className="flex items-center gap-1">
              <ChevronRight size={16} className="text-gray-400 rtl-chevron-flip" />
              {isLast ? (
                <span className="font-medium text-gray-900">
                  {name}
                </span>
              ) : (
                <Link
                  to={path}
                  className="text-gray-500 hover:text-gray-700 transition-colors"
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
