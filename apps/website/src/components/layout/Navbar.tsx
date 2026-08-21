import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import {
  AnimatePresence, motion, useMotionValueEvent, useReducedMotion, useScroll,
} from 'framer-motion'
import {
  Menu, X, Users, MapPin, Banknote, BarChart2, Package,
  Target, ShoppingCart, TrendingUp, Kanban, Settings, Monitor, PieChart,
  Truck, Warehouse, Megaphone,
  ChevronDown, ArrowRight,
} from 'lucide-react'
import { useAuthStore } from '../../store/authStore'
import { useScrollDirection } from '../../hooks/useScrollDirection'
import { CtaButton } from '../common/CtaButton'
import { WorkspaceBootstrap } from './WorkspaceBootstrap'
import { useModulePlans } from '../../lib/plans'

// Icon lookup: the DB stores an icon *name* per plan (module_plans.icon)
// and PricingCalculator uses the same map. Unknown names fall back to Users.
const iconMap: Record<string, React.ElementType> = {
  Users, MapPin, Banknote, BarChart2, Package, Target,
  ShoppingCart, TrendingUp, Kanban, Settings, Monitor, PieChart,
  Truck, Warehouse, Megaphone,
}

const links = [
  { label: 'Features',   to: '/features'   },
  { label: 'Pricing',    to: '/pricing'     },
  { label: 'Industries', to: '/industries'  },
  { label: 'About',      to: '/about'       },
]

/** Distance (px) after which the header stops floating and becomes a solid bar. */
const SOLID_AFTER = 40

/**
 * Routes whose first screenful is a LIGHT surface. Everything else opens on a
 * dark emerald landscape / gradient, so the header floats transparently with
 * white type. Pages can always override this by rendering `<Navbar tone="…" />`.
 */
const LIGHT_TOP_ROUTES = new Set([
  '/pricing',
  '/talk-to-us',
  '/login',
  '/workspaces',
  '/start-free-trial',
])

type Tone = 'dark' | 'light'

interface Props {
  /**
   * Tone of the surface sitting BEHIND the header at scroll-top.
   * `dark` (default for most routes) floats the header transparently with
   * white type over the hero landscape; `light` renders the solid white bar
   * immediately. Omit to let the route decide.
   */
  tone?: Tone
}

export function Navbar({ tone }: Props) {
  const [menuOpen,    setMenuOpen]    = useState(false)
  const [modulesOpen, setModulesOpen] = useState(false)
  const [scrolled,    setScrolled]    = useState(
    typeof window !== 'undefined' && window.scrollY > SOLID_AFTER,
  )
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const reduce = useReducedMotion()
  const { accountToken, signOut } = useAuthStore()

  // Full sign-out: clears the server-side httpOnly refresh cookie AND
  // drops in-memory tokens. Awaited so the cookie clear has a chance to
  // land before we navigate — but signOut() never throws, so the nav
  // still happens even if the network is down.
  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
  }

  // Modules mega-menu content — same source as /pricing and /modules pages:
  // platform.module_plans via the useModulePlans query. Filters RETIRED and
  // sorts by DB sort_order so ordering matches every other module surface
  // (client explicitly wants the merged view here, not the raw 12 modules).
  const { data: allPlans = [] } = useModulePlans()
  const navPlans = allPlans
    .filter((p) => p.status !== 'RETIRED')
    .slice()
    .sort((a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999))

  /**
   * The logo always returns you to the top of the hero.
   *
   * <ScrollToTop> handles this when the route actually changes, but clicking
   * the logo while already on "/" is a no-op navigation — React Router sees the
   * same path, nothing re-renders, and the reader stays where they scrolled to.
   * So on the home page we cancel the navigation and scroll instead.
   */
  const goHome = (e: React.MouseEvent) => {
    if (pathname !== '/') return // let the router navigate; ScrollToTop takes it from there
    e.preventDefault()
    window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' })
  }

  // Hide the header while scrolling DOWN, show it back the moment the reader
  // scrolls up even a little — matches the client's ask (they explicitly
  // rejected the earlier "shrink the logo" approach). Disabled while the
  // mobile sheet or the mega-menu is open so neither slides out from under
  // the pointer.
  const { hidden } = useScrollDirection({ disabled: menuOpen || modulesOpen })

  // Transparent over the hero, solid the moment the reader leaves it. The
  // heroes are full-bleed emerald landscapes now — a permanently white bar
  // would cut a hard line straight across the scene.
  const { scrollY } = useScroll()
  useMotionValueEvent(scrollY, 'change', (y) => setScrolled(y > SOLID_AFTER))

  const heroTone: Tone = tone ?? (LIGHT_TOP_ROUTES.has(pathname.replace(/\/+$/, '') || '/') ? 'light' : 'dark')
  const overDark = heroTone === 'dark' && !scrolled

  // Any navigation closes whatever is open (the header outlives route changes
  // on layouts that hoist it above the page).
  useEffect(() => {
    setMenuOpen(false)
    setModulesOpen(false)
  }, [pathname])

  // Esc closes the mega-menu / mobile sheet.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setModulesOpen(false)
      setMenuOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // The mobile sheet covers the viewport — the page behind it must not scroll.
  useEffect(() => {
    if (!menuOpen) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [menuOpen])

  const linkCls = [
    'rounded-lg px-3.5 py-2.5 text-[15px] font-medium transition-colors duration-200',
    overDark
      ? 'text-white/85 hover:bg-white/10 hover:text-white'
      : 'text-text-secondary hover:bg-surface-2 hover:text-text-primary',
  ].join(' ')

  const ctaCls = overDark
    ? '!rounded-full !bg-white !text-[#04503A] hover:!bg-[#ECFDF5] !shadow-lg !px-5 font-bold'
    : '!rounded-full !bg-primary !text-white hover:!bg-primary-dark !px-5 font-semibold'

  const mobileItems = [...links, { label: 'Modules', to: '/modules' }]

  return (
    <>
      <nav
        className={[
          'fixed inset-x-0 top-0 z-50 transform-gpu border-b',
          'transition-[transform,background-color,border-color,box-shadow] duration-300 ease-out',
          hidden ? '-translate-y-full' : 'translate-y-0',
          overDark
            ? 'border-transparent bg-transparent'
            : 'border-border bg-white/95 shadow-sm backdrop-blur-xl',
        ].join(' ')}
      >
        {/* The mega-panel is anchored to THIS container (page-centred, never
            wider than the viewport) rather than to the trigger, and closing is
            handled here so the pointer can travel trigger → panel freely. */}
        <div
          className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8"
          onMouseLeave={() => setModulesOpen(false)}
        >
          <div className="flex h-16 items-center justify-between sm:h-20">
            {/* Logo — inverted to solid white while the bar floats over the hero. */}
            <Link to="/" onClick={goHome} className="flex flex-shrink-0 items-center gap-3">
              <img
                src="/UnifiedTreeLogo.png"
                alt="UnifiedTree"
                className={`h-8 w-auto transition duration-300 sm:h-10 ${overDark ? 'brightness-0 invert' : ''}`}
              />
            </Link>

            {/* Desktop nav links */}
            <div className="hidden items-center gap-0.5 md:flex">
              {links.map((item) => (
                <Link
                  key={item.label}
                  to={item.to}
                  className={linkCls}
                  onMouseEnter={() => setModulesOpen(false)}
                >
                  {item.label}
                </Link>
              ))}

              {/* Modules mega-menu trigger */}
              <button
                type="button"
                className={`flex items-center gap-1.5 ${linkCls}`}
                aria-haspopup="true"
                aria-expanded={modulesOpen}
                onMouseEnter={() => setModulesOpen(true)}
                onClick={() => setModulesOpen((v) => !v)}
              >
                Modules
                <motion.span
                  animate={{ rotate: modulesOpen ? 180 : 0 }}
                  transition={{ duration: 0.2 }}
                  className="flex items-center"
                >
                  <ChevronDown size={14} />
                </motion.span>
              </button>
            </div>

            {/* Desktop CTA */}
            <div
              className="hidden flex-shrink-0 items-center gap-2 md:flex"
              onMouseEnter={() => setModulesOpen(false)}
            >
              {accountToken ? (
                <>
                  <Link to="/workspaces" className={linkCls}>Workspaces</Link>
                  <button
                    onClick={handleSignOut}
                    className={`rounded-lg px-3.5 py-2.5 text-[15px] font-medium transition-colors duration-200 ${
                      overDark ? 'text-white/70 hover:text-white' : 'text-text-tertiary hover:text-danger'
                    }`}
                  >
                    Sign Out
                  </button>
                </>
              ) : (
                <>
                  <Link
                    to="/login"
                    className={`rounded-lg px-3.5 py-2.5 text-[15px] font-medium transition-colors duration-200 ${
                      overDark ? 'text-white/85 hover:text-white' : 'text-text-secondary hover:text-text-primary'
                    }`}
                  >
                    Login
                  </Link>
                  <CtaButton
                    trialLabel="Start free trial"
                    paidLabel="Create workspace"
                    size="md"
                    icon={<ArrowRight size={15} />}
                    className={ctaCls}
                  />
                </>
              )}
            </div>
            <WorkspaceBootstrap />

            {/* Mobile hamburger */}
            <button
              className={`rounded-lg p-2 transition-colors duration-200 md:hidden ${
                overDark
                  ? 'text-white hover:bg-white/10'
                  : 'text-text-secondary hover:bg-surface-2 hover:text-text-primary'
              }`}
              onClick={() => setMenuOpen(true)}
              aria-label="Open menu"
              aria-expanded={menuOpen}
              aria-controls="mobile-menu"
            >
              <Menu size={22} />
            </button>
          </div>

          {/* Modules mega-panel. `pt-3` is the hover bridge between the trigger
              and the card — it keeps the pointer inside this container. */}
          <AnimatePresence>
            {modulesOpen && (
              <motion.div
                initial={{ opacity: 0, x: '-50%', y: reduce ? 0 : -8 }}
                animate={{ opacity: 1, x: '-50%', y: 0 }}
                exit={{ opacity: 0, x: '-50%', y: reduce ? 0 : -8 }}
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                className="absolute left-1/2 top-full hidden pt-3 md:block"
              >
                <div className="w-[min(820px,calc(100vw_-_3rem))] overflow-hidden rounded-2xl border border-border bg-white shadow-xl">
                  <div className="flex items-baseline justify-between px-6 pt-5">
                    <span className="text-[12.5px] font-semibold uppercase tracking-[0.14em] text-primary">
                      Modules
                    </span>
                    <span className="text-[12.5px] text-text-tertiary">
                      Activate only what you need
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-1 p-4">
                    {navPlans.length === 0
                      ? Array.from({ length: 6 }).map((_, i) => (
                          <div key={i} className="h-[62px] animate-pulse rounded-xl bg-surface-2" />
                        ))
                      : navPlans.map((plan) => {
                          const Icon = (plan.icon && iconMap[plan.icon]) || Users
                          const desc = plan.tagline || plan.description || ''
                          return (
                            <Link
                              key={plan.key}
                              to="/modules"
                              className="group flex items-start gap-3 rounded-xl p-3 transition-colors duration-200 hover:bg-primary-light"
                            >
                              <span className="mt-0.5 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-primary-light text-primary transition-colors duration-200 group-hover:bg-primary group-hover:text-white">
                                <Icon size={17} />
                              </span>
                              <span className="min-w-0">
                                <span className="block text-[14px] font-semibold leading-tight text-text-primary transition-colors duration-200 group-hover:text-primary">
                                  {plan.displayName}
                                </span>
                                <span className="mt-1 block truncate text-[12px] leading-snug text-text-secondary">
                                  {desc}
                                </span>
                              </span>
                            </Link>
                          )
                        })}
                  </div>

                  <div className="flex items-center justify-between border-t border-border bg-[#ECFDF5] px-6 py-4">
                    <span className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-primary" />
                      <span className="text-[13px] text-text-secondary">
                        {navPlans.length > 0
                          ? `${navPlans.length} modules · one shared core`
                          : 'Loading modules…'}
                      </span>
                    </span>
                    <Link
                      to="/modules"
                      className="group inline-flex items-center gap-1.5 text-[13.5px] font-semibold text-primary transition-colors hover:text-primary-dark"
                    >
                      View all modules
                      <ArrowRight size={14} className="transition-transform duration-200 group-hover:translate-x-0.5" />
                    </Link>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </nav>

      {/* Mobile sheet — full screen, deep emerald, rendered outside <nav> so the
          header's own transform never becomes its containing block. */}
      <AnimatePresence>
        {menuOpen && (
          <motion.div
            id="mobile-menu"
            initial={{ opacity: 0, y: reduce ? 0 : -16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: reduce ? 0 : -16 }}
            transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
            className="fixed inset-0 z-[60] flex flex-col overflow-y-auto bg-[#04503A] md:hidden"
          >
            <div className="flex h-16 flex-shrink-0 items-center justify-between px-4 sm:h-20 sm:px-6">
              <Link to="/" onClick={(e) => { setMenuOpen(false); goHome(e) }} className="flex items-center">
                <img
                  src="/UnifiedTreeLogo.png"
                  alt="UnifiedTree"
                  className="h-8 w-auto brightness-0 invert sm:h-10"
                />
              </Link>
              <button
                className="rounded-lg p-2 text-white transition-colors hover:bg-white/10"
                onClick={() => setMenuOpen(false)}
                aria-label="Close menu"
              >
                <X size={22} />
              </button>
            </div>

            <div className="flex flex-1 flex-col px-5 pb-10 pt-4 sm:px-7">
              <div className="border-t border-white/10">
                {mobileItems.map((item, i) => (
                  <motion.div
                    key={item.label}
                    initial={{ opacity: 0, y: reduce ? 0 : 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, delay: reduce ? 0 : 0.05 + i * 0.05, ease: [0.16, 1, 0.3, 1] }}
                  >
                    <Link
                      to={item.to}
                      onClick={() => setMenuOpen(false)}
                      className="flex items-center justify-between border-b border-white/10 py-4 font-heading text-[26px] font-bold text-white transition-colors hover:text-[#A7F3D0]"
                      style={{ letterSpacing: '-0.035em' }}
                    >
                      {item.label}
                      <ArrowRight size={18} className="text-white/40" />
                    </Link>
                  </motion.div>
                ))}
              </div>

              <motion.div
                initial={{ opacity: 0, y: reduce ? 0 : 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: reduce ? 0 : 0.32, ease: [0.16, 1, 0.3, 1] }}
                className="mt-8 space-y-3"
              >
                {accountToken ? (
                  <>
                    <Link
                      to="/workspaces"
                      onClick={() => setMenuOpen(false)}
                      className="block w-full rounded-xl border border-white/25 bg-white/10 px-4 py-3.5 text-center text-[15px] font-semibold text-white backdrop-blur-sm transition-colors hover:bg-white/20"
                    >
                      Workspaces
                    </Link>
                    <button
                      className="block w-full rounded-xl border border-white/15 px-4 py-3.5 text-center text-[15px] font-semibold text-white/70 transition-colors hover:border-white/30 hover:text-white"
                      onClick={() => { setMenuOpen(false); handleSignOut() }}
                    >
                      Sign Out
                    </button>
                  </>
                ) : (
                  <>
                    <Link
                      to="/login"
                      onClick={() => setMenuOpen(false)}
                      className="block w-full rounded-xl border border-white/25 bg-white/10 px-4 py-3.5 text-center text-[15px] font-semibold text-white backdrop-blur-sm transition-colors hover:bg-white/20"
                    >
                      Login
                    </Link>
                    <div className="w-full [&>div]:w-full" onClick={() => setMenuOpen(false)}>
                      <CtaButton
                        trialLabel="Start free trial"
                        paidLabel="Create workspace"
                        className="w-full justify-center !rounded-xl !bg-white !py-3.5 !text-[15px] !text-[#04503A] hover:!bg-[#ECFDF5] font-bold"
                      />
                    </div>
                  </>
                )}
              </motion.div>

              <p className="mt-8 text-[13px] leading-relaxed text-white/50">
                HR, attendance, payroll, accounting, inventory and CRM on one connected core.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
