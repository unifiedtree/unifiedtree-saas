import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Menu, X, Users, MapPin, Banknote, BarChart2, Package,
  Target, ShoppingCart, TrendingUp, Kanban, Settings, Monitor, PieChart,
  ChevronDown, ArrowRight,
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

const links = [
  { label: 'Features',   to: '/features'   },
  { label: 'Pricing',    to: '/pricing'     },
  { label: 'Industries', to: '/industries'  },
  { label: 'About',      to: '/about'       },
]

export function Navbar() {
  const [scrolled,      setScrolled]      = useState(false)
  const [menuOpen,      setMenuOpen]      = useState(false)
  const [modulesHover,  setModulesHover]  = useState(false)
  const navigate = useNavigate()
  const { accountToken, logoutAccount } = useAuthStore()

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const linkCls =
    'px-4 py-2.5 text-base font-medium text-text-secondary hover:text-text-primary rounded-lg hover:bg-surface-2 transition-colors duration-150'

  return (
    <nav
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${
        scrolled
          ? 'border-b border-border bg-[#F4FAED]/90 backdrop-blur-xl shadow-sm'
          : 'border-b border-transparent bg-[#F4FAED] backdrop-blur-sm'
      }`}
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className={`flex items-center justify-between transition-all duration-300 ${scrolled ? 'h-12 sm:h-14' : 'h-16 sm:h-20'}`}>
          {/* Logo */}
          <Link to="/" className="flex items-center gap-3">
            <img src="/UnifiedTreeLogo.png" alt="UnifiedTree" className={`w-auto transition-all duration-300 ${scrolled ? 'h-6 sm:h-7' : 'h-8 sm:h-10'}`} />
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
                      {navModules.map((mod) => {
                        const Icon = mod.icon
                        return (
                          <Link
                            key={mod.id}
                            to="/modules"
                            className="group flex items-start gap-3 rounded-xl p-3 transition-colors duration-150 hover:bg-primary-light"
                          >
                            <div className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-primary-light text-primary transition-colors group-hover:bg-primary group-hover:text-white">
                              <Icon size={16} />
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-semibold leading-tight text-text-primary transition-colors group-hover:text-primary">
                                {mod.name}
                              </p>
                              <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-text-secondary">
                                {mod.desc}
                              </p>
                            </div>
                          </Link>
                        )
                      })}
                    </div>
                    <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
                      <div className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full bg-primary" />
                        <span className="text-xs text-text-secondary">12 modules · Mix and match</span>
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
                <Button size="lg" onClick={() => navigate('/trial-signup')} className="font-semibold px-6">
                  Start free trial <ArrowRight size={18} />
                </Button>
              </>
            )}
          </div>

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
                    <Link to="/trial-signup" className="block w-full rounded-lg bg-primary px-4 py-3 text-center text-sm font-semibold text-white transition-all hover:bg-primary-dark" onClick={() => setMenuOpen(false)}>Start free trial</Link>
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
