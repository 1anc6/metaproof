import { Component, Suspense, type ErrorInfo, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ThinkingOrb } from './ThinkingOrb'
import { ErrorPanel } from './ui'

/** Wraps the routed page: a quiet orb while its code loads, and a way out if it crashes, so one
 *  broken page never blanks the whole app. Navigating elsewhere clears the error. */
export function RouteBoundary({ pathname, children }: { pathname: string; children: ReactNode }) {
  return (
    <PageErrorBoundary pathname={pathname}>
      <Suspense fallback={<PageLoading />}>{children}</Suspense>
    </PageErrorBoundary>
  )
}

function PageLoading() {
  return (
    <div className="grid min-h-[40vh] place-items-center" aria-busy>
      <ThinkingOrb state="breathing" size={64} label="Loading…" />
    </div>
  )
}

type Props = { pathname: string; children: ReactNode }
type State = { error: Error | null; pathname: string }

class PageErrorBoundary extends Component<Props, State> {
  state: State = { error: null, pathname: this.props.pathname }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  // A crash belongs to the page it happened on; another page starts clean.
  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.pathname === state.pathname ? null : { error: null, pathname: props.pathname }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Page crashed', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <ErrorPanel message="This page hit an unexpected error. Reloading usually fixes it; your history is kept on this device.">
        <button type="button" className="btn-primary" onClick={() => window.location.reload()}>
          Reload
        </button>
        <Link to="/" className="btn-ghost">Go to overview</Link>
      </ErrorPanel>
    )
  }
}
