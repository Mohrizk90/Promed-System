import { Link, useLocation } from 'react-router-dom'
import { LayoutDashboard, FileText, Truck, Users, Plus } from './ui/Icons'
import { useLanguage } from '../context/LanguageContext'

export default function BottomNav({ onAddClick }) {
  const location = useLocation()
  const { t } = useLanguage()

  const navItems = [
    { path: '/dashboard', icon: LayoutDashboard, label: t('nav.dashboard'), color: 'indigo' },
    { path: '/', icon: FileText, label: 'Clients', color: 'blue' },
    { action: 'add', icon: Plus, label: 'Add', primary: true, color: 'blue' },
    { path: '/suppliers', icon: Truck, label: 'Suppliers', color: 'purple' },
    { path: '/entities', icon: Users, label: 'Entities', color: 'emerald' },
  ]

  const isActive = (path) => location.pathname === path

  const colorClasses = {
    indigo: 'text-indigo-600 active:text-indigo-700',
    blue: 'text-blue-600 active:text-blue-700',
    purple: 'text-purple-600 active:text-purple-700',
    emerald: 'text-emerald-600 active:text-emerald-700',
  }
  const buttonColorClasses = {
    indigo: 'bg-indigo-600 hover:bg-indigo-700',
    blue: 'bg-blue-600 hover:bg-blue-700',
    purple: 'bg-purple-600 hover:bg-purple-700',
    emerald: 'bg-emerald-600 hover:bg-emerald-700',
  }

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-2 pb-safe pl-safe pr-safe z-40 sm:hidden">
      <div className="rtl-flip flex items-center justify-around">
        {navItems.map((item) => {
          const Icon = item.icon

          if (item.action === 'add') {
            return (
              <button
                key="add"
                onClick={onAddClick}
                className={`flex flex-col items-center justify-center -mt-4 w-14 h-14 text-white rounded-full shadow-lg transition-all active:scale-95 ${buttonColorClasses[item.color] || 'bg-blue-600 hover:bg-blue-700'}`}
              >
                <Icon size={24} />
              </button>
            )
          }

          const active = isActive(item.path)
          const colorClass = colorClasses[item.color] || 'text-blue-600'
          return (
            <Link
              key={item.path}
              to={item.path}
              className={`flex flex-col items-center justify-center py-2 px-3 min-h-[56px] transition-colors ${active ? colorClass : 'text-gray-500'}`}
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
