import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Menu, X, Users, MapPin, Banknote, BarChart2, Package,
  Target, ShoppingCart, TrendingUp, Kanban, Settings, Monitor, PieChart,
  ChevronDown,
} from 'lucide-react'
import { Button } from '../ui/Button'
import { useAuthStore } from '../../store/authStore'

const navModules = [
  { id: 'hr',            name: 'HR & Employees',  icon: Users,        desc: 'Employee records & org chart' },
  { id: 'attendance',    name: 'Attendance',       icon: MapPin,       desc: 'GPS & face capture, offline sync' },
  { id: 'payroll',       name: 'Payroll',          icon: Banknote,     desc: 'PF, ESI, TDS, payslips' },
  { id: 'accounting',    name: 'Accounting',       icon: BarChart2,    desc: 'GST invoicing & bank reconciliation' },
  { id: 'inventory',     name: 'Inventory',        icon: Package,      desc: 'Stock, warehouses, batch tracking' },
  { id: 'crm',           name: 'CRM',              icon: Target,       desc: 'Leads, pipeline, quotations' },
  { id: 'purchase',      name: 'Purchase',         icon: ShoppingCart, desc: 'POs, GRN, vendor management' },
  { id: 'sales',         name: 'Sales',            icon: TrendingUp,   desc: 'Orders, delivery, pricing' },
  { id: 'projects',      name: 'Projects',         icon: Kanban,       desc: 'Tasks, milestones, timelines' },
  { id: 'manufacturing', name: 'Manufacturing',    icon: Settings,     desc: 'BOM, work orders, MRP' },
  { id: 'pos',           name: 'Point of Sale',    icon: Monitor,      desc: 'Billing, receipts, offline mode' },
  { id: 'reports',       name: 'Reports & BI',     icon: PieChart,     desc: 'Dashboards, KPIs, exports' },
]

/** UnifiedTree logo from brand image */
function UTLogo({ size = 32 }: { size?: number }) {
  return (
    <img
      src="/UnifiedTreeLogoWhite.png"
      alt="UnifiedTree logo"
      style={{ height: size, width: 'auto' }}
      className="object-contain"
    />
  )
}

export function Navbar() {
  const [scrolled,      setScrolled]      = useState(false)
  const [menuOpen,      setMenuOpen]      = useState(false)
  const [modulesHover,  setModulesHover]  = useState(false)
  const navigate = useNavigate()
  const { accountToken, logoutAccount } = useAuthStore()

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 60)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled
          ? 'bg-[#0F6E56] backdrop-blur-md shadow-sm border-b border-border'
          : 'bg-[#0F6E56]'
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">

          {/* ── Logo ───────────────────────────── */}
          <Link to="/" className="flex items-center gap-2">
            <UTLogo size={42} />
          </Link>

          {/* ── Desktop nav links ──────────────── */}
          <div className="hidden lg:flex items-center gap-0.5">
            {[
              { label: 'Features',   to: '/features'   },
              { label: 'Pricing',    to: '/pricing'     },
              { label: 'Industries', to: '/industries'  },
              { label: 'About',      to: '/about'       },
            ].map((item) => (
              <Link
                key={item.label}
                to={item.to}
                className="px-4 py-2 text-sm font-body font-medium text-white hover:text-primary rounded-lg hover:bg-primary-light transition-all duration-150"
              >
                {item.label}
              </Link>
            ))}

            {/* ── Modules mega-menu ────────────── */}
            {/*
                Positioning strategy:
                The trigger is inside the nav flex row.
                The dropdown is 640 px wide and right-anchored to the
                NAVBAR container edge (not the button) via a portal-like
                fixed-width absolute panel with right: 0 on the wrapper.
            */}
            <div
              className="relative"
              onMouseEnter={() => setModulesHover(true)}
              onMouseLeave={() => setModulesHover(false)}
            >
              <button
                className="flex items-center gap-1 px-4 py-2 text-sm font-body font-medium text-white hover:text-primary rounded-lg hover:bg-primary-light transition-all duration-150"
                aria-haspopup="true"
                aria-expanded={modulesHover}
              >
                Modules
                <motion.span
                  animate={{ rotate: modulesHover ? 180 : 0 }}
                  transition={{ duration: 0.2 }}
                  className="flex items-center"
                >
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
                    /*
                      right: 0  → right edge of dropdown aligns with
                      right edge of the trigger's nearest positioned
                      ancestor (this relative div).
                      We then shift it further right with a negative
                      right value so it stays within the viewport and
                      aligns nicely under the full nav.
                    */
                    className="absolute top-full right-0 mt-2 w-[660px] bg-white rounded-2xl shadow-card-hover border border-border p-6"
                    style={{ right: '-320px' }}   /* centres panel under nav */
                  >
                    {/* 4-col compact grid for tighter, friendlier layout */}
                    <div className="grid grid-cols-3 gap-2">
                      {navModules.map((mod) => {
                        const Icon = mod.icon
                        return (
                          <Link
                            key={mod.id}
                            to="/modules"
                            className="flex items-start gap-3 p-3 rounded-xl hover:bg-primary-light group transition-all duration-150"
                          >
                            <div className="w-8 h-8 rounded-lg bg-primary-light flex items-center justify-center flex-shrink-0 group-hover:bg-primary/10 transition-colors mt-0.5">
                              <Icon size={15} className="text-primary" />
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-body font-semibold text-text-primary group-hover:text-primary transition-colors leading-tight">
                                {mod.name}
                              </p>
                              <p className="text-[11px] text-text-secondary mt-0.5 leading-snug line-clamp-2">
                                {mod.desc}
                              </p>
                            </div>
                          </Link>
                        )
                      })}
                    </div>

                    {/* Footer row */}
                    <div className="mt-4 pt-4 border-t border-border flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-success" />
                        <span className="text-xs text-text-secondary font-body">12 modules · Mix and match</span>
                      </div>
                      <Link
                        to="/modules"
                        className="text-sm text-primary font-body font-semibold hover:underline inline-flex items-center gap-1"
                      >
                        View all modules →
                      </Link>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* ── Desktop CTA ────────────────────── */}
          <div className="hidden lg:flex items-center gap-3">
            {accountToken ? (
              <>
                <Link
                  to="/workspaces"
                  className="px-4 py-2 text-sm font-body font-medium text-white hover:text-primary hover:bg-primary-light rounded-lg transition-all duration-150"
                >
                  Workspaces
                </Link>
                <button
                  onClick={() => {
                    logoutAccount()
                    navigate('/login')
                  }}
                  className="px-4 py-2 text-sm font-body font-medium text-red-200 hover:text-red-100 transition-colors"
                >
                  Sign Out
                </button>
              </>
            ) : (
              <>
                <Link
                  to="/login"
                  className="px-4 py-2 text-sm font-body font-medium text-white hover:text-primary hover:bg-primary-light rounded-lg transition-all duration-150"
                >
                  Sign In
                </Link>
                <Button size="sm" onClick={() => navigate('/pricing')} className="border-2 border-white/40 hover:border-white/60">
                  Start Free Trial
                </Button>
              </>
            )}
          </div>

          {/* ── Mobile hamburger ───────────────── */}
          <button
            className="lg:hidden p-2 rounded-lg text-text-secondary hover:text-primary hover:bg-primary-light transition-colors"
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label="Toggle menu"
          >
            {menuOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </div>

      {/* ── Mobile drawer ──────────────────────── */}
      <AnimatePresence>
        {menuOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25, ease: 'easeInOut' }}
            className="lg:hidden overflow-hidden bg-white border-t border-border"
          >
            <div className="px-4 py-4 space-y-1">
              {[
                { label: 'Features',        to: '/features'         },
                { label: 'Modules',         to: '/modules'          },
                { label: 'Pricing',         to: '/pricing'          },
                { label: 'Industries',      to: '/industries'       },
                { label: 'About',           to: '/about'            },
              ].map((item) => (
                <Link
                  key={item.label}
                  to={item.to}
                  className="block px-4 py-3 text-sm font-body font-medium text-text-secondary hover:text-primary hover:bg-primary-light rounded-lg transition-all"
                  onClick={() => setMenuOpen(false)}
                >
                  {item.label}
                </Link>
              ))}
              <div className="pt-3 space-y-2">
                {accountToken ? (
                  <>
                    <Link
                      to="/workspaces"
                      className="block w-full text-center px-4 py-3 border border-border rounded-lg text-sm font-medium text-text-secondary hover:border-primary hover:text-primary transition-all"
                      onClick={() => setMenuOpen(false)}
                    >
                      Workspaces
                    </Link>
                    <button
                      className="block w-full text-center px-4 py-3 bg-red-50 text-red-600 rounded-lg text-sm font-medium hover:bg-red-100 transition-all"
                      onClick={() => {
                        setMenuOpen(false)
                        logoutAccount()
                        navigate('/login')
                      }}
                    >
                      Sign Out
                    </button>
                  </>
                ) : (
                  <>
                    <Link
                      to="/login"
                      className="block w-full text-center px-4 py-3 border border-border rounded-lg text-sm font-medium text-text-secondary hover:border-primary hover:text-primary transition-all"
                      onClick={() => setMenuOpen(false)}
                    >
                      Sign In
                    </Link>
                    <Link
                      to="/pricing"
                      className="block w-full text-center px-4 py-3 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-dark transition-all"
                      onClick={() => setMenuOpen(false)}
                    >
                      Start Free Trial
                    </Link>
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
