import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Menu, X, Users, MapPin, Banknote, BarChart2, Package,
  Target, ShoppingCart, TrendingUp, Kanban, Settings, Monitor, PieChart,
  Truck, Warehouse, Megaphone,
  ChevronDown, ArrowRight,
} from 'lucide-react'
import { Button } from '../ui/Button'
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

export function Navbar() {
  const [menuOpen,      setMenuOpen]      = useState(false)
  const [modulesHover,  setModulesHover]  = useState(false)
  const navigate = useNavigate()
  const { accountToken, logoutAccount } = useAuthStore()

  // Modules mega-menu content — same source as /pricing and /modules pages:
  // platform.module_plans via the useModulePlans query. Filters RETIRED and
  // sorts by DB sort_order so ordering matches every other module surface
  // (client explicitly wants the merged view here, not the raw 12 modules).
  const { data: allPlans = [] } = useModulePlans()
  const navPlans = allPlans
    .filter((p) => p.status !== 'RETIRED')
    .slice()
    .sort((a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999))

  // Hide the header while scrolling DOWN, show it back the moment the reader
  // scrolls up even a little — matches the client's ask (they explicitly
  // rejected the earlier "shrink the logo" approach). Disabled while the
  // mobile drawer is open so its close button never disappears under a
  // slide-out header.
  const { hidden } = useScrollDirection({ disabled: menuOpen })

  const linkCls =
    'px-4 py-2.5 text-base font-medium text-text-secondary hover:text-text-primary rounded-lg hover:bg-surface-2 transition-colors duration-150'

  return (
    <nav
      className={`fixed inset-x-0 top-0 z-50 border-b border-border bg-[#ECFDF5]/90 backdrop-blur-xl shadow-sm transform-gpu transition-transform duration-300 ease-out ${
        hidden ? '-translate-y-full' : 'translate-y-0'
      }`}
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between sm:h-20">
          {/* Logo — fixed size; no more shrink-on-scroll. */}
          <Link to="/" className="flex items-center gap-3">
            <img src="/UnifiedTreeLogo.png" alt="UnifiedTree" className="h-8 w-auto sm:h-10" />
          </Link>

          {/* Desktop nav links */}
          <div className="hidden items-center gap-0.5 lg:flex">
            {links.map((item) => (
              <Link key={item.label} to={item.to} className={linkCls}>
                {item.label}
              </Link>
            ))}

            {/* Modules mega-menu */}
            <div
              className="relative"
              onMouseEnter={() => setModulesHover(true)}
              onMouseLeave={() => setModulesHover(false)}
            >
              <button
                className={`flex items-center gap-1 ${linkCls}`}
                aria-haspopup="true"
                aria-expanded={modulesHover}
              >
                Modules
                <motion.span animate={{ rotate: modulesHover ? 180 : 0 }} transition={{ duration: 0.2 }} className="flex items-center">
                  <ChevronDown size={14} />
                </motion.span>
              </button>

              <AnimatePresence>
                {modulesHover && (
                  <motion.div
                    initial={{ opacity: 0, y: -6, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0,  scale: 1    }}
                    exit={  { opacity: 0, y: -6, scale: 0.98 }}
                    transition={{ duration: 0.18, ease: 'easeOut' }}
                    className="absolute top-full mt-2 w-[660px] rounded-2xl border border-border bg-white p-5 shadow-card-hover"
                    style={{ right: '-260px' }}
                  >
                    <div className="grid grid-cols-3 gap-1.5">
                      {navPlans.length === 0
                        ? Array.from({ length: 6 }).map((_, i) => (
                            <div key={i} className="h-14 animate-pulse rounded-xl bg-surface" />
                          ))
                        : navPlans.map((plan) => {
                            const Icon = (plan.icon && iconMap[plan.icon]) || Users
                            const desc = plan.tagline || plan.description || ''
                            return (
                              <Link
                                key={plan.key}
                                to="/modules"
                                className="group flex items-start gap-3 rounded-xl p-3 transition-colors duration-150 hover:bg-primary-light"
                              >
                                <div className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-primary-light text-primary transition-colors group-hover:bg-primary group-hover:text-white">
                                  <Icon size={16} />
                                </div>
                                <div className="min-w-0">
                                  <p className="text-sm font-semibold leading-tight text-text-primary transition-colors group-hover:text-primary">
                                    {plan.displayName}
                                  </p>
                                  <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-text-secondary">
                                    {desc}
                                  </p>
                                </div>
                              </Link>
                            )
                          })}
                    </div>
                    <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
                      <div className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full bg-primary" />
                        <span className="text-xs text-text-secondary">
                          {navPlans.length > 0 ? `${navPlans.length} modules · Mix and match` : 'Loading modules…'}
                        </span>
                      </div>
                      <Link to="/modules" className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline">
                        View all modules <ArrowRight size={13} />
                      </Link>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Desktop CTA */}
          <div className="hidden items-center gap-3 lg:flex">
            {accountToken ? (
              <>
                <Link to="/workspaces" className={linkCls}>Workspaces</Link>
                <button
                  onClick={() => { logoutAccount(); navigate('/login') }}
                  className="px-4 py-2.5 text-base font-medium text-text-tertiary transition-colors hover:text-danger"
                >
                  Sign Out
                </button>
              </>
            ) : (
              <>
                <Link to="/login" className={linkCls}>Sign in</Link>
                <CtaButton
                  trialLabel="Start free trial"
                  paidLabel="Create workspace"
                  className="font-semibold px-6"
                />
              </>
            )}
          </div>
          <WorkspaceBootstrap />

          {/* Mobile hamburger */}
          <button
            className="rounded-lg p-2 text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary lg:hidden"
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label="Toggle menu"
          >
            {menuOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </div>

      {/* Mobile drawer */}
      <AnimatePresence>
        {menuOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25, ease: 'easeInOut' }}
            className="overflow-hidden border-t border-border bg-white lg:hidden"
          >
            <div className="space-y-1 px-4 py-4">
              {[...links, { label: 'Modules', to: '/modules' }].map((item) => (
                <Link
                  key={item.label}
                  to={item.to}
                  className="block rounded-lg px-4 py-3 text-sm font-medium text-text-secondary transition-all hover:bg-primary-light hover:text-primary"
                  onClick={() => setMenuOpen(false)}
                >
                  {item.label}
                </Link>
              ))}
              <div className="space-y-2 pt-3">
                {accountToken ? (
                  <>
                    <Link to="/workspaces" className="block w-full rounded-lg border border-border px-4 py-3 text-center text-sm font-medium text-text-secondary transition-all hover:border-primary hover:text-primary" onClick={() => setMenuOpen(false)}>Workspaces</Link>
                    <button className="block w-full rounded-lg bg-red-50 px-4 py-3 text-center text-sm font-medium text-danger transition-all hover:bg-red-100" onClick={() => { setMenuOpen(false); logoutAccount(); navigate('/login') }}>Sign Out</button>
                  </>
                ) : (
                  <>
                    <Link to="/login" className="block w-full rounded-lg border border-border px-4 py-3 text-center text-sm font-medium text-text-secondary transition-all hover:border-primary hover:text-primary" onClick={() => setMenuOpen(false)}>Sign in</Link>
                    <div className="w-full" onClick={() => setMenuOpen(false)}>
                      <CtaButton trialLabel="Start free trial" paidLabel="Create workspace" className="w-full text-center justify-center" />
                    </div>
                  </>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  )
}
