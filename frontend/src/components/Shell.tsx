import { BookOpen, History, LayoutGrid, Plus, Settings, X } from 'lucide-react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import { Toaster } from 'sonner'
import { useServerStatus, type ServerState } from '../lib/hooks'
import { useThemeSync } from '../lib/theme'
import { Logo, ThemeToggle } from './ui'

const NAV = [
  { to: '/', label: 'Overview', icon: LayoutGrid, end: true },
  { to: '/new', label: 'New analysis', icon: Plus },
  { to: '/history', label: 'History', icon: History },
  { to: '/method', label: 'Method', icon: BookOpen },
  { to: '/settings', label: 'Settings', icon: Settings },
]

/**
 * The frame of every screen, after the graphite reference: a top bar with the badge, a round
 * glass button and an outlined pill, and a floating dock along the bottom with a glowing orb for
 * the main action. The same frame on phones and desktops.
 */
export function Shell() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const theme = useThemeSync()
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])

  const [shortcuts, setShortcuts] = useState(false)

  // Keyboard shortcuts, unless the keystroke is meant for a text field: N starts a new analysis,
  // ? lists the shortcuts, Escape closes that list.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const el = e.target as HTMLElement
      if (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return
      if (e.key === 'Escape') setShortcuts(false)
      else if (e.key === '?') setShortcuts((open) => !open)
      else if (e.key.toLowerCase() === 'n') {
        setShortcuts(false)
        navigate('/new')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate])

  return (
    <div className="min-h-dvh">
      <a
        href="#main"
        className="btn-primary fixed top-3 left-3 z-[60] -translate-y-20 focus-visible:translate-y-0"
      >
        Skip to content
      </a>
      <TopBar theme={theme} />
      <main
        id="main"
        tabIndex={-1}
        className="mx-auto w-full max-w-[1120px] px-4 pt-1 pb-[calc(96px+env(safe-area-inset-bottom))] outline-none sm:px-8 lg:px-12 lg:pt-6 lg:pb-24"
      >
        <Outlet />
      </main>
      <Dock />
      {shortcuts && <Shortcuts onClose={() => setShortcuts(false)} />}
      {/* Bottom centre on every screen, clear of the dock. */}
      <Toaster theme={theme} position="bottom-center" offset={{ bottom: 88 }} mobileOffset={{ bottom: 88 }} />
    </div>
  )
}

const SERVER_LABEL: Record<ServerState, { text: string; dot: string }> = {
  checking: { text: 'Connecting', dot: 'bg-faint animate-pulse' },
  waking: { text: 'Waking server…', dot: 'bg-edited animate-pulse' },
  online: { text: 'API online', dot: 'bg-authentic' },
  offline: { text: 'API offline', dot: 'bg-ai' },
}

/** `compact`: only the dot where the words don't fit: beside the wordmark below 380px, and
 *  beside the desktop navigation until the bar is wide enough. */
export function ServerBadge({ compact = false }: { compact?: boolean }) {
  const state = useServerStatus()
  const s = SERVER_LABEL[state]
  return (
    <span className="flex items-center gap-2 text-[14px] text-ink" title={s.text}>
      <span className={`size-2 shrink-0 rounded-full ${s.dot}`} />
      <span className={compact ? 'whitespace-nowrap max-[379px]:sr-only lg:max-xl:sr-only' : 'whitespace-nowrap'}>{s.text}</span>
    </span>
  )
}

/**
 * The reference's top bar: badge and name on the left; a round glass button and an outlined pill on
 * the right. On a desktop the navigation joins it, as a segmented pill in the middle and a glowing
 * New analysis button, so nothing floats over the page.
 */
function TopBar({ theme }: { theme: 'light' | 'dark' }) {
  const tabs = NAV.filter((n) => n.to !== '/new')
  return (
    <header className="no-print relative z-30 px-4 pt-[env(safe-area-inset-top)] sm:px-8 lg:px-12">
      <div className="mx-auto flex h-16 max-w-[1120px] items-center justify-between gap-3 lg:h-[76px]">
        <NavLink to="/" className="rounded-full">
          <Logo />
        </NavLink>
        <nav aria-label="Main" className="track hidden items-center gap-0.5 rounded-full p-1 lg:flex">
          {tabs.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex h-10 items-center gap-2 rounded-full px-4 text-[14px] transition ${isActive ? 'selected' : 'text-faint hover:text-ink'}`
              }
            >
              <Icon className="size-[18px]" strokeWidth={1.5} aria-hidden />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="flex items-center gap-2.5">
          <ThemeToggle resolved={theme} />
          <span className="btn-ghost h-10 px-3.5 max-[379px]:w-10 max-[379px]:px-0 lg:h-11 lg:px-4 lg:max-xl:w-11 lg:max-xl:px-0">
            <ServerBadge compact />
          </span>
          <NavLink to="/new" title="New analysis (N)" className="btn-primary hidden h-11 px-5 text-[14px] lg:inline-flex">
            <Plus className="size-4" strokeWidth={2} /> New analysis
          </NavLink>
        </div>
      </div>
    </header>
  )
}

/** After a tap, let go of focus so the keyboard focus ring doesn't linger (some Android browsers
 *  keep it); a keyboard activation has `detail` 0 and keeps it. */
const releaseAfterTap = (e: React.MouseEvent<HTMLElement>) => {
  if (e.detail > 0) e.currentTarget.blur()
}

/**
 * The navigation on phones and tablets: a bar on the bottom edge, not a card floating over the page.
 * Near-opaque with a thin line on top, clear of the home indicator. 4px between each icon and its
 * label; the main action is a plain filled circle in the middle.
 */
function Dock() {
  const items = NAV.filter((n) => n.to !== '/new')
  const half = items.length / 2
  return (
    <nav className="dock no-print fixed inset-x-0 bottom-0 z-40 pb-[env(safe-area-inset-bottom)] lg:hidden" aria-label="Main">
      <div className="mx-auto flex h-16 max-w-[480px] items-center px-2">
        {items.slice(0, half).map((item) => (
          <TabLink key={item.to} {...item} />
        ))}
        <NavLink
          to="/new"
          aria-label="New analysis"
          title="New analysis (N)"
          onClick={releaseAfterTap}
          className="flex flex-1 basis-0 justify-center outline-none [&:focus-visible>.orb]:outline-2 [&:focus-visible>.orb]:outline-offset-2 [&:focus-visible>.orb]:outline-ink"
        >
          <span className="orb size-11 active:scale-95">
            <Plus className="size-5" strokeWidth={2} />
          </span>
        </NavLink>
        {items.slice(half).map((item) => (
          <TabLink key={item.to} {...item} />
        ))}
      </div>
    </nav>
  )
}

function TabLink({ to, label, icon: Icon, end }: (typeof NAV)[number]) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={releaseAfterTap}
      // The focus ring goes round the tab, not the whole hit area.
      className="flex min-w-0 flex-1 basis-0 flex-col items-center gap-1 py-1 outline-none [&:focus-visible>span:first-child]:outline-2 [&:focus-visible>span:first-child]:outline-ink"
    >
      {({ isActive }) => (
        <>
          <span className={`grid h-7 w-12 place-items-center rounded-full transition ${isActive ? 'bg-raised text-ink' : 'text-faint'}`}>
            <Icon className="size-5" strokeWidth={isActive ? 1.9 : 1.5} aria-hidden />
          </span>
          <span className={`text-[11px] leading-none whitespace-nowrap ${isActive ? 'font-medium text-ink' : 'text-faint'}`}>{label}</span>
        </>
      )}
    </NavLink>
  )
}

const SHORTCUTS = [
  ['N', 'New analysis'],
  ['?', 'Show or hide this list'],
  ['Esc', 'Close this list'],
] as const

/** The keyboard shortcuts, as a small dialog. Opened with ?. */
function Shortcuts({ onClose }: { onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null
    close.current?.focus()
    return () => before?.focus()
  }, [])
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        onClick={(e) => e.stopPropagation()}
        className="panel panel-raised animate-pop w-full max-w-sm rounded-xl p-4 sm:p-6"
      >
        <div className="flex items-center justify-between">
          <h2 id="shortcuts-title" className="display text-[28px] leading-none">
            Keyboard shortcuts
          </h2>
          <button ref={close} type="button" onClick={onClose} className="well size-10" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>
        <dl className="mt-4 flex flex-col">
          {SHORTCUTS.map(([key, what]) => (
            <div key={key} className="flex items-center justify-between border-t border-line py-3 first:border-t-0">
              <dt className="text-[15px] text-muted">{what}</dt>
              <dd>
                <kbd className="chip px-3 py-1 font-semibold">{key}</kbd>
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  )
}
