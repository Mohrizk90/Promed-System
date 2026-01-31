import {
  // Navigation
  LayoutDashboard,
  Users,
  ShoppingCart,
  Truck,
  FileText,
  Settings,
  Menu,
  X,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowDown,
  ArrowUpRight,
  ArrowDownRight,
  Home,
  
  // Actions
  Plus,
  Minus,
  Edit,
  Trash2,
  Copy,
  Download,
  Upload,
  Search,
  Filter,
  RefreshCw,
  MoreHorizontal,
  MoreVertical,
  ExternalLink,
  Eye,
  EyeOff,
  Check,
  CheckCircle,
  XCircle,
  AlertCircle,
  AlertTriangle,
  Info,
  HelpCircle,
  
  // Data
  Calendar,
  Clock,
  DollarSign,
  CreditCard,
  Wallet,
  Receipt,
  FileSpreadsheet,
  BarChart3,
  LineChart,
  PieChart,
  TrendingUp,
  TrendingDown,
  Activity,
  
  // UI
  Sun,
  Moon,
  Globe,
  Bell,
  BellOff,
  Star,
  Heart,
  Bookmark,
  Tag,
  Hash,
  
  // Users
  User,
  UserPlus,
  UserMinus,
  UserCheck,
  LogIn,
  LogOut,
  Lock,
  Unlock,
  Key,
  Shield,
  
  // Files
  File,
  FileText as FileTextIcon,
  Folder,
  FolderOpen,
  Save,
  Printer,
  
  // Communication
  Mail,
  Phone,
  MessageSquare,
  Send,
  
  // Misc
  Package,
  Box,
  Loader2,
  Grip,
  Move,
  Maximize2,
  Minimize2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'

// Re-export all icons
export {
  // Navigation
  LayoutDashboard,
  Users,
  ShoppingCart,
  Truck,
  FileText,
  Settings,
  Menu,
  X,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowDown,
  ArrowUpRight,
  ArrowDownRight,
  Home,
  
  // Actions
  Plus,
  Minus,
  Edit,
  Trash2,
  Copy,
  Download,
  Upload,
  Search,
  Filter,
  RefreshCw,
  MoreHorizontal,
  MoreVertical,
  ExternalLink,
  Eye,
  EyeOff,
  Check,
  CheckCircle,
  XCircle,
  AlertCircle,
  AlertTriangle,
  Info,
  HelpCircle,
  
  // Data
  Calendar,
  Clock,
  DollarSign,
  CreditCard,
  Wallet,
  Receipt,
  FileSpreadsheet,
  BarChart3,
  LineChart,
  PieChart,
  TrendingUp,
  TrendingDown,
  Activity,
  
  // UI
  Sun,
  Moon,
  Globe,
  Bell,
  BellOff,
  Star,
  Heart,
  Bookmark,
  Tag,
  Hash,
  
  // Users
  User,
  UserPlus,
  UserMinus,
  UserCheck,
  LogIn,
  LogOut,
  Lock,
  Unlock,
  Key,
  Shield,
  
  // Files
  File,
  FileTextIcon,
  Folder,
  FolderOpen,
  Save,
  Printer,
  
  // Communication
  Mail,
  Phone,
  MessageSquare,
  Send,
  
  // Misc
  Package,
  Box,
  Loader2,
  Grip,
  Move,
  Maximize2,
  Minimize2,
  ZoomIn,
  ZoomOut,
}

// Loading spinner component
export function Spinner({ size = 'md', className = '' }) {
  const sizes = {
    sm: 'w-4 h-4',
    md: 'w-6 h-6',
    lg: 'w-8 h-8',
    xl: 'w-12 h-12',
  }
  
  return (
    <Loader2 className={`animate-spin ${sizes[size]} ${className}`} />
  )
}

// Icon with tooltip
export function IconButton({ icon: Icon, label, onClick, className = '', size = 20, disabled = false, variant = 'ghost' }) {
  const variants = {
    ghost: 'text-gray-600 hover:text-gray-900 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-gray-100 dark:hover:bg-gray-700',
    primary: 'text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/50',
    danger: 'text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/50',
    success: 'text-green-600 hover:text-green-700 hover:bg-green-50 dark:text-green-400 dark:hover:bg-green-900/50',
  }
  
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`p-2 rounded-lg transition-colors ${variants[variant]} ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${className}`}
      title={label}
      aria-label={label}
    >
      <Icon size={size} />
    </button>
  )
}
