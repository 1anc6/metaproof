import { BookOpen, History, LayoutGrid, Plus, Settings } from 'lucide-react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useEffect } from 'react'
import { Toaster } from 'sonner'
import { useHistory } from '../lib/history'
import { useServerStatus, type ServerState } from '../lib/hooks'
import { GithubMark, Logo } from './ui'
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
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])

  return (
    <div className="min-h-dvh lg:pl-[252px]">
      <a
        href="#main"
        className="btn-primary fixed top-3 left-3 z-[60] -translate-y-20 focus-visible:translate-y-0"
      >
        Skip to content
      </a>
      <Sidebar />
      <MobileTopBar />
      {/* Desktop: 12px from the sidebar and level with its top edge, like a second panel. */}
      <main id="main" tabIndex={-1} className="mx-auto outline-none w-full max-w-6xl px-4 pt-6 pb-32 sm:px-8 lg:mx-0 lg:max-w-[1680px] lg:px-3 lg:pt-3 lg:pb-12">
        <Outlet />
      </main>
      <MobileTabBar />
      <Welcome />
      {/* Bottom centre on every screen; on phones it clears the floating tab bar. */}
      <Toaster theme="dark" position="bottom-center" offset={24} mobileOffset={{ bottom: 96 }} />
    </div>
  )
}

function Sidebar() {
  const history = useHistory()
  return (
    <aside className="no-print fixed inset-y-3 left-3 z-30 hidden w-[240px] flex-col lg:flex">
      <div className="glass flex h-full flex-col rounded-[28px] p-4">
        <NavLink to="/" className="px-2 pt-1 pb-6">
          <Logo />
        </NavLink>

        <p className="eyebrow px-3 pb-2">Workspace</p>
        <nav className="flex flex-col gap-1" aria-label="Main">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm transition ${
                  isActive
                    ? 'glass glass-strong text-ink'
                    : 'text-muted hover:bg-white/5 hover:text-ink'
                }`
              }
            >
              <Icon className="size-4" strokeWidth={1.75} />
              <span className="flex-1">{label}</span>
              {to === '/history' && history.length > 0 && (
                <span className="font-mono text-[11px] text-faint">{history.length}</span>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto flex flex-col gap-3">
          <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-3.5">
            <p className="text-xs leading-relaxed text-muted">
              Files are analyzed, then deleted. Only a hash, a thumbnail and the findings are kept,
              for 90 days.
            </p>
          </div>
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
      </div>
    </aside>
  )
}

const SERVER_LABEL: Record<ServerState, { text: string; dot: string }> = {
  checking: { text: 'Connecting', dot: 'bg-zinc-500 animate-pulse' },
  waking: { text: 'Waking server…', dot: 'bg-edited animate-pulse' },
  online: { text: 'API online', dot: 'bg-authentic' },
  offline: { text: 'API offline', dot: 'bg-ai' },
}

export function ServerBadge() {
  const state = useServerStatus()
  const s = SERVER_LABEL[state]
  return (
    <span className="flex items-center gap-2 font-mono text-[11px] text-faint">
      <span className={`size-1.5 rounded-full ${s.dot}`} />
      {s.text}
    </span>
  )
}

function MobileTopBar() {
  return (
    <header className="no-print sticky top-0 z-30 px-4 pt-[max(env(safe-area-inset-top),12px)] lg:hidden">
      <div className="glass glass-bar flex items-center justify-between rounded-full py-2 pr-3 pl-3">
        <NavLink to="/">
          <Logo />
        </NavLink>
        <ServerBadge />
      </div>
    </header>
  )
}

/** Floating glass tab bar: two tabs either side of a bright centre action. */
function MobileTabBar() {
  const items = NAV.filter((n) => n.to !== '/new')
  const half = items.length / 2
  return (
    <nav
      className="no-print fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-[max(env(safe-area-inset-bottom),14px)] lg:hidden"
      aria-label="Main"
    >
      <div className="glass glass-bar flex w-full max-w-sm items-center justify-between rounded-full p-1.5">
        {items.slice(0, half).map((item) => (
          <TabLink key={item.to} {...item} />
        ))}
        <NavLink
          to="/new"
          aria-label="New analysis"
          className="mx-1 grid size-12 shrink-0 place-items-center rounded-full bg-white text-black shadow-[0_8px_24px_-6px_rgba(255,255,255,0.5)] transition active:scale-95"
        >
          <Plus className="size-5" strokeWidth={2.25} />
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
      className={({ isActive }) =>
        `flex h-12 min-w-0 flex-1 basis-0 flex-col items-center justify-center gap-0.5 rounded-full text-[10px] transition ${
          isActive ? 'text-ink' : 'text-faint'
        }`
      }
    >
      <Icon className="size-[18px]" strokeWidth={1.75} />
      {label.replace('How it works', 'Method')}
    </NavLink>
  )
}
