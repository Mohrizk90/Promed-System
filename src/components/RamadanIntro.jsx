import { useState, useEffect, useMemo, useRef } from 'react'

const RAMADAN_INTRO_KEY = 'promed_ramadan_intro_seen'

const SPARKLES = ['✨', '⭐', '✦', '❋', '✧', '˚', '·']
const HILAL_COUNT = 5

function getRandom(min, max) {
  return min + Math.random() * (max - min)
}

export default function RamadanIntro() {
  const [visible, setVisible] = useState(false)
  const [exiting, setExiting] = useState(false)
  const [gone, setGone] = useState(false)

  const showIntro = useMemo(() => {
    if (typeof sessionStorage === 'undefined') return false
    try {
      const seen = sessionStorage.getItem(RAMADAN_INTRO_KEY)
      return !seen
    } catch {
      return false
    }
  }, [])

  useEffect(() => {
    if (!showIntro) return
    const t = requestAnimationFrame(() => {
      setVisible(true)
    })
    return () => cancelAnimationFrame(t)
  }, [showIntro])

  const overlayRef = useRef(null)
  useEffect(() => {
    if (visible && overlayRef.current) {
      overlayRef.current.focus()
    }
  }, [visible])

  useEffect(() => {
    if (!visible) return
    const timer = setTimeout(() => {
      markSeenAndExit()
    }, 5000)
    return () => clearTimeout(timer)
  }, [visible])

  const markSeenAndExit = () => {
    setExiting(true)
    try {
      sessionStorage.setItem(RAMADAN_INTRO_KEY, '1')
    } catch {}
    setTimeout(() => {
      setVisible(false)
      setGone(true)
    }, 650)
  }

  const fallingItems = useMemo(() => {
    const items = []
    for (let i = 0; i < 28; i++) {
      items.push({
        id: i,
        char: SPARKLES[i % SPARKLES.length],
        left: getRandom(0, 100),
        delay: getRandom(0, 2.5),
        duration: 3 + getRandom(0, 2),
        size: 14 + Math.floor(getRandom(0, 18)),
      })
    }
    return items
  }, [])

  const hilals = useMemo(() => {
    return Array.from({ length: HILAL_COUNT }, (_, i) => ({
      id: i,
      left: getRandom(2, 94),
      top: getRandom(4, 40),
      delay: getRandom(0, 1.5),
      size: 20 + Math.floor(getRandom(0, 24)),
    }))
  }, [])

  if (!showIntro || gone || (!visible && !exiting)) return null

  return (
    <div
      ref={overlayRef}
      role="dialog"
      aria-label="Ramadan Kareem"
      tabIndex={0}
      className={`fixed inset-0 z-[9999] flex flex-col items-center justify-center overflow-hidden outline-none ${
        exiting ? 'animate-ramadan-overlay-out' : ''
      }`}
      style={{
        background: 'linear-gradient(180deg, #0f172a 0%, #1e293b 40%, #0f172a 100%)',
      }}
      onClick={markSeenAndExit}
      onKeyDown={(e) => e.key === 'Escape' && markSeenAndExit()}
    >
      {/* Falling sparkles */}
      {fallingItems.map((item) => (
        <span
          key={item.id}
          className="animate-ramadan-drop pointer-events-none absolute"
          style={{
            left: `${item.left}%`,
            top: '-2rem',
            fontSize: `${item.size}px`,
            animationDelay: `${item.delay}s`,
            animationDuration: `${item.duration}s`,
            opacity: 0.85,
          }}
        >
          {item.char}
        </span>
      ))}

      {/* Floating hilals (crescent moons) */}
      {hilals.map((h) => (
        <span
          key={h.id}
          className="animate-ramadan-hilal pointer-events-none absolute"
          style={{
            left: `${h.left}%`,
            top: `${h.top}%`,
            fontSize: `${h.size}px`,
            animationDelay: `${h.delay}s`,
          }}
          aria-hidden
        >
          🌙
        </span>
      ))}

      {/* Center content */}
      <div className="relative z-10 flex flex-col items-center justify-center px-4 text-center">
        <span
          className="mb-4 text-6xl sm:text-7xl animate-ramadan-hilal"
          style={{ animationDelay: '0.2s' }}
          aria-hidden
        >
          🌙
        </span>
        <h1 className="animate-ramadan-text text-3xl sm:text-4xl md:text-5xl font-bold text-white drop-shadow-lg">
          Ramadan Kareem
        </h1>
        <p className="animate-ramadan-text mt-2 text-lg text-amber-200/90" style={{ animationDelay: '0.15s' }}>
          رمضان كريم
        </p>
        <p className="mt-6 text-sm text-slate-400">
          Tap or wait to continue
        </p>
      </div>
    </div>
  )
}
