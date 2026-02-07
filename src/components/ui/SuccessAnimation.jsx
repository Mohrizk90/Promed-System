import { useEffect, useState } from 'react'
import { CheckCircle } from './Icons'

export default function SuccessAnimation({ show, onComplete }) {
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    if (show) {
      setIsVisible(true)
      const timer = setTimeout(() => {
        setIsVisible(false)
        onComplete?.()
      }, 1500)
      return () => clearTimeout(timer)
    }
  }, [show, onComplete])

  if (!isVisible) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
      <div className="relative">
        {/* Success checkmark */}
        <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center animate-success">
          <CheckCircle className="w-12 h-12 text-green-600" strokeWidth={2} />
        </div>
        
        {/* Confetti pieces */}
        {[...Array(12)].map((_, i) => (
          <div
            key={i}
            className="confetti-piece"
            style={{
              backgroundColor: ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6'][i % 5],
              left: '50%',
              top: '50%',
              transform: `rotate(${i * 30}deg) translateY(-60px)`,
              animationDelay: `${i * 0.05}s`,
              borderRadius: i % 2 === 0 ? '50%' : '0',
            }}
          />
        ))}
      </div>
    </div>
  )
}

// Mini success indicator for inline use
export function MiniSuccess({ show }) {
  if (!show) return null
  
  return (
    <span className="inline-flex items-center gap-1 text-green-600 animate-fade-in">
      <CheckCircle size={16} />
      <span className="text-sm font-medium">Saved!</span>
    </span>
  )
}
