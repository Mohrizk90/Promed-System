import { FileText, Users, ShoppingCart, Truck, BarChart3, CreditCard, Package, Plus } from './Icons'

const iconMap = {
  transactions: FileText,
  clients: Users,
  suppliers: Truck,
  products: Package,
  payments: CreditCard,
  dashboard: BarChart3,
  cart: ShoppingCart,
  default: FileText,
}

export default function EmptyState({
  icon = 'default',
  title,
  description,
  actionLabel,
  onAction,
  children,
}) {
  const IconComponent = iconMap[icon] || iconMap.default

  return (
    <div className="empty-state">
      <div className="relative mb-4">
        <div className="w-20 h-20 rounded-full bg-gray-100 flex items-center justify-center">
          <IconComponent className="w-10 h-10 text-gray-400" strokeWidth={1.5} />
        </div>
        {/* Decorative dots */}
        <div className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-blue-200" />
        <div className="absolute -bottom-1 -left-2 w-2 h-2 rounded-full bg-green-200" />
      </div>
      
      {title && (
        <h3 className="empty-state-title">{title}</h3>
      )}
      
      {description && (
        <p className="empty-state-description">{description}</p>
      )}
      
      {actionLabel && onAction && (
        <button
          onClick={onAction}
          className="btn btn-primary"
        >
          <Plus size={18} />
          {actionLabel}
        </button>
      )}
      
      {children}
    </div>
  )
}

// Compact version for inline empty states
export function EmptyStateCompact({ message, icon = 'default' }) {
  const IconComponent = iconMap[icon] || iconMap.default

  return (
    <div className="flex flex-col items-center justify-center py-8 text-center">
      <IconComponent className="w-8 h-8 text-gray-300 mb-2" />
      <p className="text-sm text-gray-500">{message}</p>
    </div>
  )
}
