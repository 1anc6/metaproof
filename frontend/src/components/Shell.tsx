import { BookOpen, History, LayoutGrid, Plus, Settings } from 'lucide-react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useEffect } from 'react'
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

  // N starts a new analysis from anywhere, unless the keystroke is meant for a text field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'n' || e.metaKey || e.ctrlKey || e.altKey) return
      const el = e.target as HTMLElement
      if (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return
      navigate('/new')
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
      <Sidebar />
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
      {/* Bottom centre on every screen; on phones it clears the tab bar. */}
      <Toaster theme={theme} position="bottom-center" offset={24} mobileOffset={{ bottom: 104 }} />
    </div>
  )
}

function Sidebar() {
  const history = useHistory()
  return (
    <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-[264px] flex-col px-5 pt-7 pb-6 lg:flex">
      <NavLink to="/" className="self-start pb-9">
        <Logo />
      </NavLink>

      <NavLink to="/new" className="btn-ghost mb-8 justify-start py-2.5 pl-2.5 font-semibold">
        <span className="grid size-8 place-items-center rounded-full bg-primary text-on-primary">
          <Plus className="size-4" strokeWidth={2.5} />
        </span>
        <span className="flex-1">New analysis</span>
        <kbd className="mr-1 rounded-md bg-raised px-1.5 py-0.5 text-[11px] font-semibold text-faint">N</kbd>
      </NavLink>

      <p className="eyebrow px-3 pb-3">Workspace</p>
      <nav className="flex flex-col gap-1" aria-label="Main">
        {NAV.filter((n) => n.to !== '/new').map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-full py-2 pr-4 pl-2 text-[15px] transition ${
                isActive ? 'selected font-semibold' : 'text-muted hover:bg-hover hover:text-ink'
              }`
            }
          >
            <span className="grid size-8 place-items-center rounded-full">
              <Icon className="size-[18px]" strokeWidth={1.75} />
            </span>
            <span className="flex-1">{label}</span>
            {to === '/history' && history.length > 0 && (
              <span className="text-[13px] font-medium text-faint tabular-nums">{history.length}</span>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="mt-auto flex flex-col gap-4">
        <div className="panel rounded-lg p-4">
          <p className="eyebrow">Privacy</p>
          <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
            Files are analyzed, then deleted. Only a hash, a thumbnail and the findings are kept, for
            90 days.
          </p>
        </div>
        <ThemeSwitch className="self-start" />
        <div className="flex items-center justify-between px-2">
          <ServerBadge />
          <a
            href="https://github.com/1anc6/metaproof"
            target="_blank"
            rel="noreferrer"
            className="text-faint transition hover:text-ink"
            aria-label="Source code on GitHub"
          >
            <GithubMark className="size-4" />
          </a>
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

export function ServerBadge() {
  const state = useServerStatus()
  const s = SERVER_LABEL[state]
  return (
    <span className="flex items-center gap-2 text-[13px] font-medium text-faint">
      <span className={`size-2 rounded-full ${s.dot}`} />
      {s.text}
    </span>
  )
}

function MobileTopBar({ theme }: { theme: 'light' | 'dark' }) {
  return (
    <header className="no-print panel-bar sticky top-0 z-30 px-4 pt-[env(safe-area-inset-top)] lg:hidden">
      <div className="flex h-16 items-center justify-between">
        <NavLink to="/">
          <Logo />
        </NavLink>
        <div className="flex items-center gap-3">
          <ServerBadge />
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
