import { History, House, ImagePlus, Lightbulb, Moon, PanelLeftClose, PanelLeftOpen, Plus, Settings, Sun, X } from 'lucide-react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Toaster } from 'sonner'
import { useServerStatus, type ServerState } from '../lib/hooks'
import { setPref, usePrefs } from '../lib/prefs'
import { useThemeSync } from '../lib/theme'
import { SummariesProvider } from './SummariesProvider'
import { Logo, Mark, ThemeToggle } from './ui'

const NAV = [
  { to: '/', label: 'Overview', icon: House, end: true },
  { to: '/new', label: 'New analysis', icon: ImagePlus, hint: 'N' },
  { to: '/history', label: 'History', icon: History },
  { to: '/method', label: 'Method', icon: Lightbulb },
  { to: '/settings', label: 'Settings', icon: Settings },
]

const desktop = typeof window !== 'undefined' ? window.matchMedia('(min-width: 1024px)') : null
function useDesktop() {
  return useSyncExternalStore(
    (l) => {
      desktop?.addEventListener('change', l)
      return () => desktop?.removeEventListener('change', l)
    },
    () => desktop?.matches ?? false,
  )
}

/** A field that can take the "/" shortcut: the overview's search, or the history list's own. */
const searchField = () =>
  [document.getElementById('global-search'), document.getElementById('history-search')].find((el) => el?.offsetParent) ?? null

/**
 * The frame of every screen, after the smart-home reference: a grainy room lies under everything,
 * and one large pane of frosted glass in front of it holds the page. On a desktop the pane floats
 * inside the window with the room round its edge, and a rail of icons runs down its left side,
 * opening out to the screens' names on request. Phones and tablets get the glass edge to edge, a
 * slim top bar, and a floating tab bar along the bottom with a lime button for a new analysis.
 */
export function Shell() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const theme = useThemeSync()
  const isDesktop = useDesktop()
  const { railOpen } = usePrefs()
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])

  const [shortcuts, setShortcuts] = useState(false)

  // Keyboard shortcuts, unless the keystroke is meant for a text field: N starts a new analysis,
  // / searches the history, [ opens or closes the rail, ? lists the shortcuts, Escape closes that list.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const el = e.target as HTMLElement
      if (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return
      if (e.key === 'Escape') setShortcuts(false)
      else if (e.key === '?') setShortcuts((open) => !open)
      else if (e.key === '[') setPref('railOpen', !railOpen)
      else if (e.key === '/') {
        e.preventDefault()
        setShortcuts(false)
        const field = searchField()
        if (field) field.focus()
        else navigate('/history', { state: { focus: true } })
      } else if (e.key.toLowerCase() === 'n') {
        setShortcuts(false)
        navigate('/new')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate, railOpen])

  useSheen()

  return (
    <SummariesProvider>
      <div className="min-h-dvh lg:p-4 print:p-0">
        <div className="backdrop" aria-hidden>
          <span />
          <span />
          <span />
          <span />
        </div>
        <a href="#main" className="btn-primary fixed top-3 left-3 z-[60] -translate-y-20 focus-visible:translate-y-0">
          Skip to content
        </a>
        <div className="relative lg:grid lg:min-h-[calc(100dvh-32px)] lg:grid-cols-[auto_minmax(0,1fr)] lg:gap-5 lg:rounded-[40px] lg:p-4 print:block print:p-0">
          <div className="frame-glass" aria-hidden />
          {/* One navigation at a time, so its server check and its links exist once. */}
          {isDesktop && <Rail theme={theme} open={railOpen} />}
          <div className="min-w-0">
            {!isDesktop && <TopBar theme={theme} />}
            <main
              id="main"
              tabIndex={-1}
              className="@container mx-auto w-full max-w-[1320px] px-4 pt-2 pb-[calc(112px+env(safe-area-inset-bottom))] outline-none sm:px-6 lg:px-2 lg:pt-3 lg:pb-3"
            >
              <Outlet />
            </main>
          </div>
        </div>
        {!isDesktop && <Dock />}
        {shortcuts && <Shortcuts onClose={() => setShortcuts(false)} />}
        {/* Bottom centre, clear of the phone bar. */}
        <Toaster theme="dark" position="bottom-center" offset={{ bottom: isDesktop ? 32 : 100 }} mobileOffset={{ bottom: 100 }} />
      </div>
    </SummariesProvider>
  )
}

/**
 * The light on the glass: the glass card under a mouse pointer gets a soft highlight that follows
 * it (the card's --mx and --my). Not on touch screens, and not when motion is reduced.
 */
function useSheen() {
  useEffect(() => {
    if (!matchMedia('(pointer: fine)').matches || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let lit: HTMLElement | null = null
    let frame = 0
    const onMove = (e: PointerEvent) => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const card = (e.target as Element | null)?.closest?.<HTMLElement>('.panel') ?? null
        if (lit && lit !== card) {
          lit.style.removeProperty('--mx')
          lit.style.removeProperty('--my')
        }
        lit = card
        if (!card) return
        const box = card.getBoundingClientRect()
        card.style.setProperty('--mx', `${e.clientX - box.left}px`)
        card.style.setProperty('--my', `${e.clientY - box.top}px`)
      })
    }
    document.addEventListener('pointermove', onMove, { passive: true })
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('pointermove', onMove)
    }
  }, [])
}

const SERVER_LABEL: Record<ServerState, { text: string; dot: string }> = {
  checking: { text: 'Connecting', dot: 'bg-dot-neutral animate-pulse' },
  waking: { text: 'Waking server…', dot: 'bg-dot-edited animate-pulse' },
  online: { text: 'API online', dot: 'bg-dot-authentic' },
  offline: { text: 'API offline', dot: 'bg-dot-ai' },
}

/** `compact`: only the dot below 380px, where the words don't fit beside the name. */
export function ServerBadge({ compact = false }: { compact?: boolean }) {
  const state = useServerStatus()
  const s = SERVER_LABEL[state]
  return (
    <span className="flex items-center gap-2 text-[13px] text-muted" title={s.text}>
      <span className={`size-2 shrink-0 rounded-full ${s.dot}`} />
      <span className={compact ? 'whitespace-nowrap max-[379px]:sr-only' : 'whitespace-nowrap'}>{s.text}</span>
    </span>
  )
}

/**
 * The rail, after the reference's left panel: a column of glass with the screens as icons, the
 * chosen one on a lighter tile. Opened out, it shows their names; the server's state, the theme
 * and the switch that opens it sit at its foot, where the reference keeps its power button. The
 * names stay in the page while it is closed, so every icon keeps its name for screen readers.
 */
function Rail({ theme, open }: { theme: 'light' | 'dark'; open: boolean }) {
  const next = theme === 'dark' ? 'light' : 'dark'
  const ThemeIcon = theme === 'dark' ? Sun : Moon
  const Toggle = open ? PanelLeftClose : PanelLeftOpen
  const toggle = open ? 'Collapse sidebar' : 'Expand sidebar'
  return (
    <aside className="no-print sticky top-8 h-[calc(100dvh-64px)] self-start">
      <div className="rail flex h-full flex-col rounded-[30px] p-3" data-open={open}>
        <Link to="/" aria-label="MetaProof" title={open ? undefined : 'MetaProof, overview'} className="rail-item !px-[19px] !text-ink hover:!bg-transparent">
          <Mark className="size-[26px] shrink-0" />
          <span translate="no" className="rail-label !text-[17px] !font-semibold tracking-[-0.015em]">
            MetaProof
          </span>
        </Link>
        <nav aria-label="Main" className="mt-5 flex flex-col gap-2">
          {NAV.map((item) => (
            <RailLink key={item.to} {...item} open={open} />
          ))}
        </nav>
        <div className="mt-auto flex flex-col gap-2">
          <ServerLine open={open} />
          <button type="button" onClick={() => setPref('theme', next)} aria-label={`Switch to ${next} theme`} title={open ? undefined : `Switch to ${next} theme`} className="rail-item">
            <ThemeIcon className="size-6 shrink-0" strokeWidth={1.6} aria-hidden />
            <span className="rail-label">{next === 'dark' ? 'Dark theme' : 'Light theme'}</span>
          </button>
          <button type="button" onClick={() => setPref('railOpen', !open)} aria-label={toggle} title={`${toggle} ([)`} className="rail-item">
            <Toggle className="size-6 shrink-0" strokeWidth={1.6} aria-hidden />
            <span className="rail-label">Collapse</span>
          </button>
        </div>
      </div>
    </aside>
  )
}

function RailLink({ to, label, icon: Icon, end, hint, open }: (typeof NAV)[number] & { open: boolean }) {
  // An analysis belongs to the history it was opened from.
  const inHistory = useLocation().pathname.startsWith('/analysis/') && to === '/history'
  return (
    <NavLink
      to={to}
      end={end}
      title={open ? (hint ? `${label} (${hint})` : undefined) : hint ? `${label} (${hint})` : label}
      className={({ isActive }) => `rail-item ${isActive || inHistory ? 'is-on' : ''}`}
    >
      <Icon className="size-6 shrink-0" strokeWidth={1.6} aria-hidden />
      <span className="rail-label min-w-0 flex-1">{label}</span>
      {hint && (
        <kbd className="kbd rail-label" aria-hidden>
          {hint}
        </kbd>
      )}
    </NavLink>
  )
}

/** The server's state as a dot, with its words beside it once the rail is open. */
function ServerLine({ open }: { open: boolean }) {
  const s = SERVER_LABEL[useServerStatus()]
  return (
    <p className="flex h-11 items-center gap-3.5 overflow-hidden px-5 whitespace-nowrap" title={open ? undefined : s.text}>
      <span className="grid size-6 shrink-0 place-items-center" aria-hidden>
        <span className={`size-2.5 rounded-full ${s.dot}`} />
      </span>
      <span className="rail-label !text-[13.5px] !font-normal text-muted">{s.text}</span>
    </p>
  )
}

/** Phones and tablets: the name on the left; the server's state and the theme on the right. */
function TopBar({ theme }: { theme: 'light' | 'dark' }) {
  return (
    <header className="no-print relative z-30 px-4 pt-[env(safe-area-inset-top)] sm:px-6 lg:hidden">
      <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between gap-3">
        <Link to="/" className="rounded-full">
          <Logo />
        </Link>
        <div className="flex items-center gap-2">
          <span className="chip h-10 px-3.5 max-[379px]:w-10 max-[379px]:justify-center max-[379px]:px-0">
            <ServerBadge compact />
          </span>
          <ThemeToggle resolved={theme} />
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
 * The navigation on phones and tablets, after the floating tab bar reference: a glass capsule of
 * four screens where the current one opens into a white pill with its name and the others show
 * only their icon, and beside it, floating on its own, the lime button that starts a new analysis.
 */
function Dock() {
  const tabs = NAV.filter((n) => n.to !== '/new')
  return (
    <nav
      className="no-print fixed inset-x-0 bottom-0 z-40 flex items-center justify-center gap-2.5 pr-[max(16px,env(safe-area-inset-right))] pb-[calc(12px+env(safe-area-inset-bottom))] pl-[max(16px,env(safe-area-inset-left))] min-[400px]:gap-3 lg:hidden"
      aria-label="Main"
    >
      <div className="glass dock-bar flex h-16 w-full max-w-[360px] min-w-0 items-center gap-1 rounded-full p-1.5">
        {tabs.map((item) => (
          <Tab key={item.to} {...item} />
        ))}
      </div>
      <NavLink
        to="/new"
        aria-label="New analysis"
        title="New analysis (N)"
        onClick={releaseAfterTap}
        className="fab size-[58px] shrink-0 outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--ring)] min-[400px]:size-16"
      >
        <Plus className="size-7" strokeWidth={1.9} aria-hidden />
      </NavLink>
    </nav>
  )
}

/**
 * One screen in the bar. The current one grows to make room for its name on a white pill; the
 * others shrink to their icon, which keeps its name for screen readers and as a tooltip. Width,
 * pill and name all move on transitions, so a quick second tap retargets mid-flight.
 */
function Tab({ to, label, icon: Icon, end }: (typeof NAV)[number]) {
  // An analysis belongs to the history it was opened from.
  const inHistory = useLocation().pathname.startsWith('/analysis/') && to === '/history'
  return (
    <NavLink
      to={to}
      end={end}
      onClick={releaseAfterTap}
      title={label}
      className={({ isActive }) =>
        `tab group relative flex h-full min-w-11 basis-0 items-center justify-center rounded-full outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] ${
          isActive || inHistory ? 'is-on grow-[2.5]' : 'grow'
        }`
      }
    >
      <span className="tab-pill absolute inset-0 rounded-full" aria-hidden />
      <span className="relative flex min-w-0 items-center">
        <Icon className="tab-icon size-[22px] shrink-0" strokeWidth={1.7} aria-hidden />
        <span className="tab-label overflow-hidden text-[14.5px] font-semibold whitespace-nowrap">{label}</span>
      </span>
    </NavLink>
  )
}

const SHORTCUTS = [
  ['N', 'New analysis'],
  ['/', 'Search your history'],
  ['[', 'Open or close the sidebar'],
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
    <div className="fixed inset-0 z-50 grid place-items-center bg-[var(--scrim)] p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        onClick={(e) => e.stopPropagation()}
        className="glass animate-pop w-full max-w-sm rounded-[26px] p-5 sm:p-6"
      >
        <div className="relative flex items-center justify-between">
          <h2 id="shortcuts-title" className="text-[20px] font-semibold tracking-[-0.01em]">
            Keyboard shortcuts
          </h2>
          <button ref={close} type="button" onClick={onClose} className="icon-btn size-9" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>
        <dl className="relative mt-3 flex flex-col">
          {SHORTCUTS.map(([key, what]) => (
            <div key={key} className="flex items-center justify-between py-2.5">
              <dt className="text-[15px] text-muted">{what}</dt>
              <dd>
                <kbd className="kbd h-7 min-w-7 text-[13px] text-ink">{key}</kbd>
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  )
}
