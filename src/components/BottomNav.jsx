import { Link, useLocation } from 'react-router-dom'
import { LayoutDashboard, FileText, Truck, Users, Plus } from './ui/Icons'
import { useLanguage } from '../context/LanguageContext'

export default function BottomNav({ onAddClick }) {
  const location = useLocation()
  const { t } = useLanguage()

  const navItems = [
    { path: '/dashboard', icon: LayoutDashboard, label: t('nav.dashboard') },
    { path: '/', icon: FileText, label: 'Clients' },
    { action: 'add', icon: Plus, label: 'Add', primary: true },
    { path: '/suppliers', icon: Truck, label: 'Suppliers' },
    { path: '/entities', icon: Users, label: 'Entities' },
  ]

  const isActive = (path) => location.pathname === path

  return (
    <nav className="flex-shrink-0 bg-white border-t border-gray-200 px-2 pb-safe z-40 sm:hidden">
      <div className="flex items-center justify-around">
        {navItems.map((item, index) => {
          const Icon = item.icon

          if (item.action === 'add') {
            return (
              <button
                key="add"
                onClick={onAddClick}
                className="flex flex-col items-center justify-center -mt-4 w-14 h-14 bg-blue-600 text-white rounded-full shadow-lg hover:bg-blue-700 transition-all active:scale-95"
              >
                <Icon size={24} />
              </button>
            )
          }

          return (
            <Link
              key={item.path}
              to={item.path}
              className={`flex flex-col items-center justify-center py-2 px-3 min-h-[56px] transition-colors ${
                isActive(item.path)
                  ? 'text-blue-600'
                  : 'text-gray-500'
              }`}
            >
              <Icon size={22} />
              <span className="text-xs mt-1 font-medium">{item.label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
