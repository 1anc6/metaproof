import { BookOpen, History, LayoutGrid, Plus, Settings, X } from 'lucide-react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import { Toaster } from 'sonner'
import { useHistory } from '../lib/history'
import { useServerStatus, type ServerState } from '../lib/hooks'
import { useThemeSync } from '../lib/theme'
import { GithubMark, Logo, ThemeSwitch, ThemeToggle } from './ui'
import { Welcome } from './Welcome'

const NAV = [
  { to: '/', label: 'Overview', icon: LayoutGrid, end: true },
  { to: '/new', label: 'New analysis', icon: Plus },
  { to: '/history', label: 'History', icon: History },
  { to: '/method', label: 'How it works', icon: BookOpen },
  { to: '/settings', label: 'Settings', icon: Settings },
]

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
    <div className="min-h-dvh lg:pl-[264px]">
      <a
        href="#main"
        className="btn-primary fixed top-3 left-3 z-[60] -translate-y-20 focus-visible:translate-y-0"
      >
        Skip to content
      </a>
      <Sidebar onShortcuts={() => setShortcuts(true)} />
      <MobileTopBar theme={theme} />
      <main
        id="main"
        tabIndex={-1}
        className="mx-auto w-full max-w-6xl px-4 pt-4 pb-36 outline-none sm:px-8 lg:max-w-[1240px] lg:px-12 lg:pt-14 lg:pb-16"
      >
        <Outlet />
      </main>
      <MobileTabBar />
      <Welcome />
      {shortcuts && <Shortcuts onClose={() => setShortcuts(false)} />}
      {/* Bottom centre on every screen; on phones it clears the tab bar. */}
      <Toaster theme={theme} position="bottom-center" offset={24} mobileOffset={{ bottom: 104 }} />
    </div>
  )
}

function Sidebar({ onShortcuts }: { onShortcuts: () => void }) {
  const history = useHistory()
  return (
    <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-[264px] flex-col px-5 pt-7 pb-6 lg:flex">
      <NavLink to="/" className="self-start pb-9">
        <Logo />
      </NavLink>

      {/* Same height, padding, gap and icon disc as the nav rows below, so everything lines up. */}
      <NavLink to="/new" className="btn-ghost mb-8 h-12 justify-start gap-3 py-0 pr-4 pl-2 font-semibold">
        <span className="grid size-8 place-items-center rounded-full bg-primary text-on-primary">
          <Plus className="size-4" strokeWidth={2.5} />
        </span>
        New analysis
      </NavLink>

      <nav className="flex flex-col gap-1.5" aria-label="Main">
        {NAV.filter((n) => n.to !== '/new').map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex h-12 items-center gap-3 rounded-full pr-2 pl-2 text-[15px] transition ${
                isActive ? 'selected font-semibold shadow-[0_1px_2px_rgb(24_24_27/0.06)]' : 'text-muted hover:bg-hover hover:text-ink'
              }`
            }
          >
            <span className="grid size-8 place-items-center rounded-full">
              <Icon className="size-[18px]" strokeWidth={1.75} />
            </span>
            <span className="flex-1">{label}</span>
            {to === '/history' && history.length > 0 && (
              <span className="rounded-full bg-raised px-2.5 py-1 text-[12px] font-semibold text-muted tabular-nums">{history.length}</span>
            )}
          </NavLink>
        ))}
      </nav>

      {/* One card for everything below the nav: privacy, theme, status. Every row is full width. */}
      <div className="panel mt-auto flex flex-col gap-3 rounded-lg p-3">
        <div className="px-1 pt-1">
          <span className="tag-hi">Private by design</span>
          <p className="mt-2.5 text-[13px] leading-relaxed text-muted">
            Files are deleted after analysis. Only a hash, a thumbnail and the findings are kept, for
            90 days.
          </p>
        </div>
        <ThemeSwitch stretch />
        <div className="flex items-center justify-between gap-2 border-t border-line px-1 pt-3">
          <ServerBadge />
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onShortcuts}
              aria-label="Keyboard shortcuts"
              title="Keyboard shortcuts (?)"
              className="grid size-8 place-items-center rounded-full text-[13px] font-semibold text-faint transition hover:bg-hover hover:text-ink"
            >
              ?
            </button>
            <a
              href="https://github.com/1anc6/metaproof"
              target="_blank"
              rel="noreferrer"
              className="grid size-8 place-items-center rounded-full text-faint transition hover:bg-hover hover:text-ink"
              aria-label="Source code on GitHub"
            >
              <GithubMark className="size-4" />
            </a>
          </div>
        </div>
      </div>
    </aside>
  )
}

const SERVER_LABEL: Record<ServerState, { text: string; dot: string }> = {
  checking: { text: 'Connecting', dot: 'bg-faint animate-pulse' },
  waking: { text: 'Waking server…', dot: 'bg-edited animate-pulse' },
  online: { text: 'API online', dot: 'bg-authentic' },
  offline: { text: 'API offline', dot: 'bg-ai' },
}

/** `compact` shows only the dot while the API is up, and words once something needs saying.
 *  Below 380px the words don't fit beside the wordmark, so compact keeps just the dot there. */
export function ServerBadge({ compact = false }: { compact?: boolean }) {
  const state = useServerStatus()
  const s = SERVER_LABEL[state]
  const quiet = compact && state === 'online'
  return (
    <span className="flex items-center gap-2 text-[13px] font-medium text-faint" title={s.text}>
      <span className={`size-2 shrink-0 rounded-full ${s.dot}`} />
      <span className={quiet ? 'sr-only' : compact ? 'whitespace-nowrap max-[379px]:sr-only' : 'whitespace-nowrap'}>{s.text}</span>
    </span>
  )
}

function MobileTopBar({ theme }: { theme: 'light' | 'dark' }) {
  return (
    <header className="no-print panel-bar sticky top-0 z-30 px-4 pt-[env(safe-area-inset-top)] lg:hidden">
      <div className="flex h-16 items-center justify-between gap-3">
        <NavLink to="/">
          <Logo />
        </NavLink>
        <div className="flex items-center gap-3">
          <ServerBadge compact />
          <ThemeToggle resolved={theme} />
        </div>
      </div>
    </header>
  )
}

/** Floating pill tab bar: two tabs either side of the lime centre action. */
function MobileTabBar() {
  const items = NAV.filter((n) => n.to !== '/new')
  const half = items.length / 2
  return (
    <nav
      className="no-print fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-[max(env(safe-area-inset-bottom),16px)] lg:hidden"
      aria-label="Main"
    >
      <div className="panel-bar pill-bar flex w-full max-w-sm items-center justify-between rounded-full p-2">
        {items.slice(0, half).map((item) => (
          <TabLink key={item.to} {...item} />
        ))}
        <NavLink
          to="/new"
          aria-label="New analysis"
          className="mx-1 grid size-14 shrink-0 place-items-center rounded-full bg-primary text-on-primary shadow-[0_12px_28px_-12px_rgb(0_0_0/0.55)] transition active:scale-95"
        >
          <Plus className="size-6" strokeWidth={2} />
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
      aria-label={label}
      // The focus ring goes round the icon disc, not the whole tab-wide hit area.
      className="flex min-w-0 flex-1 basis-0 justify-center outline-none [&:focus-visible>span]:outline-2 [&:focus-visible>span]:outline-offset-2 [&:focus-visible>span]:outline-ink"
    >
      {({ isActive }) => (
        <span
          className={`grid size-12 place-items-center rounded-full transition ${
            isActive ? 'selected' : 'text-faint hover:text-ink'
          }`}
        >
          <Icon className="size-5" strokeWidth={1.75} />
        </span>
      )}
    </NavLink>
  )
}

const SHORTCUTS = [
  ['N', 'New analysis'],
  ['?', 'Show or hide this list'],
  ['Esc', 'Close this list'],
] as const

/** The keyboard shortcuts, as a small dialog. Opened with ? or the sidebar hint. */
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
        className="panel panel-raised animate-pop w-full max-w-sm rounded-xl p-6"
      >
        <div className="flex items-center justify-between">
          <h2 id="shortcuts-title" className="text-[17px] font-semibold tracking-[-0.02em]">
            Keyboard shortcuts
          </h2>
          <button ref={close} type="button" onClick={onClose} className="well size-9" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>
        <dl className="mt-4 flex flex-col">
          {SHORTCUTS.map(([key, what]) => (
            <div key={key} className="flex items-center justify-between border-t border-line py-3 first:border-t-0">
              <dt className="text-[15px] text-muted">{what}</dt>
              <dd>
                <kbd className="rounded-md bg-raised px-2 py-1 text-[13px] font-semibold">{key}</kbd>
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  )
}
