// Loaded only by lib/errors.ts, and only when a DSN is set. Named imports keep the chunk to the
// parts used: the whole package (session replay, feedback widget...) is several times larger.
import { captureException, init } from '@sentry/browser'

export function start(dsn: string) {
  init({
    dsn,
    environment: import.meta.env.MODE,
    // Nothing about the visitor: the error, its stack and the page's path only.
    dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false },
  })
}

export { captureException }
