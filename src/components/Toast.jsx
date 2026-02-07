import { useEffect } from 'react'
import { CheckCircle, XCircle, AlertCircle, Info, X } from './ui/Icons'

function Toast({ message, type = 'success', onClose, duration = 4000 }) {
  useEffect(() => {
    if (duration > 0) {
      const timer = setTimeout(() => {
        onClose()
      }, duration)
      return () => clearTimeout(timer)
    }
  }, [duration, onClose])

  const config = {
    success: {
      bg: 'bg-green-50',
      border: 'border-green-200',
      icon: CheckCircle,
      iconColor: 'text-green-500',
      textColor: 'text-green-800',
      label: 'Success',
    },
    error: {
      bg: 'bg-red-50',
      border: 'border-red-200',
      icon: XCircle,
      iconColor: 'text-red-500',
      textColor: 'text-red-800',
      label: 'Error',
    },
    info: {
      bg: 'bg-blue-50',
      border: 'border-blue-200',
      icon: Info,
      iconColor: 'text-blue-500',
      textColor: 'text-blue-800',
      label: 'Info',
    },
    warning: {
      bg: 'bg-yellow-50',
      border: 'border-yellow-200',
      icon: AlertCircle,
      iconColor: 'text-yellow-500',
      textColor: 'text-yellow-800',
      label: 'Warning',
    },
  }

  const { bg, border, icon: Icon, iconColor, textColor } = config[type] || config.info

  return (
    <div
      className={`${bg} ${border} border rounded-xl shadow-lg p-4 flex items-start gap-3 min-w-[320px] max-w-md animate-slide-in`}
      role="alert"
    >
      <Icon className={`${iconColor} w-5 h-5 flex-shrink-0 mt-0.5`} />
      <p className={`${textColor} text-sm font-medium flex-1`}>{message}</p>
      <button
        onClick={onClose}
        className={`${textColor} opacity-70 hover:opacity-100 transition-opacity p-0.5 rounded-lg hover:bg-black/5`}
        aria-label="Close"
      >
        <X size={18} />
      </button>
    </div>
  )
}

export default Toast
