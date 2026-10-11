import { useSyncExternalStore } from 'react'

// Chrome and Edge (Android and desktop) offer installation through this event; Safari has no
// such event, so iPhones get "Share → Add to Home Screen" instructions instead.
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferred: InstallPromptEvent | null = null
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((l) => l())

/** Called once at startup: the browser fires the event early, before any page mounts. */
export function setUpInstall() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault() // offer it from the Settings page instead of the browser's banner
    deferred = e as InstallPromptEvent
    notify()
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    notify()
  })
  if ('serviceWorker' in navigator) {
    // Needed to install the app and to receive images from the share menu.
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        /* unsupported or blocked: the site still works, it just can't be installed */
      })
    })
  }
}

export type InstallState = 'installed' | 'available' | 'ios' | 'unavailable'

function current(): InstallState {
  if (window.matchMedia('(display-mode: standalone)').matches) return 'installed'
  if (deferred) return 'available'
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent)
  return ios ? 'ios' : 'unavailable'
}

export function useInstallState(): InstallState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    current,
    () => 'unavailable',
  )
}

export async function promptInstall() {
  if (!deferred) return
  await deferred.prompt()
  await deferred.userChoice
  deferred = null
  notify()
}
