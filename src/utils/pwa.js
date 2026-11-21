// Installable-app (PWA) plumbing: service worker registration, the browser's
// install prompt, and "new version available" detection. Exposed as a tiny
// store so any component can subscribe via usePwa().
import { useSyncExternalStore } from 'react'

let state = {
  canInstall: false,      // Chrome/Edge/Android fired beforeinstallprompt
  isStandalone: false,    // already running as an installed app
  isIos: false,           // iOS Safari has no prompt; show manual hint instead
  updateReady: false,     // a new service worker is waiting
}
let deferredPrompt = null
let waitingWorker = null
const listeners = new Set()

function set(patch) {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

function subscribe(l) {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function usePwa() {
  return useSyncExternalStore(subscribe, () => state, () => state)
}

export async function promptInstall() {
  if (!deferredPrompt) return false
  deferredPrompt.prompt()
  const { outcome } = await deferredPrompt.userChoice
  deferredPrompt = null
  set({ canInstall: false })
  return outcome === 'accepted'
}

export function applyUpdate() {
  if (!waitingWorker) return window.location.reload()
  waitingWorker.postMessage('SKIP_WAITING')
}

function trackWaiting(reg) {
  const mark = (worker) => {
    waitingWorker = worker
    set({ updateReady: true })
  }
  if (reg.waiting && navigator.serviceWorker.controller) mark(reg.waiting)
  reg.addEventListener('updatefound', () => {
    const nw = reg.installing
    if (!nw) return
    nw.addEventListener('statechange', () => {
      // Only an *update* if a worker already controls the page.
      if (nw.state === 'installed' && navigator.serviceWorker.controller) mark(nw)
    })
  })
}

export function initPwa() {
  if (typeof window === 'undefined') return
  const standalone =
    window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true
  const ua = window.navigator.userAgent
  const isIos = /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && 'ontouchend' in document)
  set({ isStandalone: standalone, isIos })

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferredPrompt = e
    set({ canInstall: true })
  })
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null
    set({ canInstall: false, isStandalone: true })
  })

  // Dev server serves unhashed modules; a service worker there only causes stale code.
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js')
      trackWaiting(reg)
      // Check for a new deploy when the app comes back to the foreground.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {})
      })
    } catch {
      /* non-fatal: app works without offline support */
    }
  })
  let reloaded = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded || !waitingWorker) return
    reloaded = true
    window.location.reload()
  })
}
