/* Promed service worker.
 * - Hashed build assets (/assets/*), icons, fonts: cache-first.
 * - Page navigations: network-first, falling back to the cached app shell when offline.
 * - Everything else (Supabase, /api, /mcp, other origins, non-GET): untouched, straight to network.
 * Bump VERSION to force old caches out.
 */
const VERSION = 'promed-v1'
const SHELL_CACHE = `${VERSION}-shell`
const ASSET_CACHE = `${VERSION}-assets`
const SHELL_URL = '/index.html'
const PRECACHE = [SHELL_URL, '/manifest.webmanifest', '/Logo_Promed.png', '/icons/icon-192.png', '/icons/icon-512.png']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(PRECACHE)).catch(() => {}),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)))
      await self.clients.claim()
    })(),
  )
})

// The page asks a waiting worker to take over when the user accepts the update banner.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting()
})

function isStaticAsset(url) {
  return (
    url.pathname.startsWith('/assets/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname.startsWith('/fonts/') ||
    url.pathname === '/Logo_Promed.png'
  )
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (/^\/(api|mcp|bot-health|collector-health)\//.test(url.pathname)) return

  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(request)
          if (res.ok) {
            const cache = await caches.open(SHELL_CACHE)
            cache.put(SHELL_URL, res.clone())
          }
          return res
        } catch {
          const cached = await caches.match(SHELL_URL)
          return cached || Response.error()
        }
      })(),
    )
    return
  }

  if (isStaticAsset(url)) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request)
        if (cached) return cached
        const res = await fetch(request)
        if (res.ok) {
          const cache = await caches.open(ASSET_CACHE)
          cache.put(request, res.clone())
        }
        return res
      })(),
    )
  }
})
