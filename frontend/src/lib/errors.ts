// Error reports to Sentry, only when VITE_SENTRY_DSN is set at build time (Vercel). The SDK is
// loaded on demand, so without a DSN it is never downloaded.
const DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined

let sentry: Promise<typeof import('./sentry')> | null = null

/** Once, at startup. Uncaught errors and rejected promises are reported from then on. */
export function setUpErrorTracking() {
  if (!DSN || sentry) return
  sentry = import('./sentry').then((s) => {
    s.start(DSN)
    return s
  })
  sentry.catch(() => {
    sentry = null // blocked or offline: the app works the same without it
  })
}

/** An error the app caught and handled (so Sentry would not see it on its own). */
export function reportError(error: unknown, context?: Record<string, unknown>) {
  console.error(error)
  sentry?.then((s) => s.captureException(error, { extra: context })).catch(() => {})
}
