import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Users, MapPin, Banknote, BarChart2, Package, Target,
  ShoppingCart, TrendingUp, Kanban, Settings, Monitor, PieChart,
  Check, Lock, Plus, ChevronDown, ArrowRight, Factory, Store,
  Calculator, BarChart3, Contact, FolderKanban, Boxes, Fingerprint, X,
} from 'lucide-react'
import { useModulePlans } from '../../lib/plans'
import { usePricingStore } from '../../store/pricingStore'

const iconMap: Record<string, React.ElementType> = {
  Users, MapPin, Banknote, BarChart2, Package, Target,
  ShoppingCart, TrendingUp, Kanban, Settings, Monitor, PieChart,
}
const keyIconMap: Record<string, React.ElementType> = {
  hrms: Users, attendance: Fingerprint, payroll: Banknote, accounting: Calculator,
  inventory: Boxes, crm: Contact, purchase: ShoppingCart, sales: TrendingUp,
  projects: FolderKanban, manufacturing: Factory, pos: Store, reports: BarChart3,
}

export function ModulesGrid() {
  const [activeCategory, setActiveCategory] = useState<string>('all')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const { data: allPlans = [], isLoading } = useModulePlans()
  // Same filter as PricingCalculator: RETIRED rows are kept in the DB so
  // legacy tenants don't lose their selection, but hidden from prospects.
  const plans = allPlans.filter((p) => p.status !== 'RETIRED')
  const selectedPlanKeys = usePricingStore((s) => s.selectedPlanKeys)
  const togglePlan = usePricingStore((s) => s.togglePlan)
  const navigate = useNavigate()

  const categories = useMemo(() => {
    const set = new Set<string>()
    plans.forEach((p) => p.category && set.add(p.category))
    return ['all', ...Array.from(set)]
  }, [plans])

  const filtered = activeCategory === 'all' ? plans : plans.filter((p) => p.category === activeCategory)

  const selectedPlans = plans.filter((p) => selectedPlanKeys.includes(p.key) && p.status === 'AVAILABLE')
  const perUserTotal = selectedPlans.reduce((s, p) => s + (p.priceInr ?? 0), 0)

  const toggleExpand = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_320px] lg:items-start">
      {/* ── LEFT: tabs + compact module cards ─────────────────────────────── */}
      <div>
        {/* Category rail — a single pill slides between tabs (layoutId). */}
        <div className="mb-7 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <div className="inline-flex flex-wrap items-center gap-1 rounded-full border border-border bg-surface-2 p-1">
            {categories.map((cat) => {
              const on = activeCategory === cat
              return (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(cat)}
                  aria-pressed={on}
                  className={`relative rounded-full px-4 py-1.5 text-[13px] font-semibold capitalize transition-colors duration-200 ${
                    on ? 'text-white' : 'text-text-secondary hover:text-primary'
                  }`}
                >
                  {on && (
                    <motion.span
                      layoutId="modulesCategoryPill"
                      className="absolute inset-0 rounded-full bg-primary shadow-sm"
                      transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                    />
                  )}
                  <span className="relative z-10">{cat === 'all' ? 'All modules' : cat}</span>
                </button>
              )
            })}
          </div>

          {!isLoading && (
            <p className="text-[12px] font-medium tabular-nums text-text-tertiary">
              {filtered.length} {filtered.length === 1 ? 'module' : 'modules'}
            </p>
          )}
        </div>

        {isLoading ? (
          <div className="grid gap-5 sm:grid-cols-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-48 animate-pulse rounded-2xl border border-border bg-surface-2" />
            ))}
          </div>
        ) : (
          <motion.div layout className="grid gap-5 sm:grid-cols-2">
            <AnimatePresence mode="popLayout">
              {filtered.map((plan, i) => {
                const Icon = keyIconMap[plan.key] ?? iconMap[plan.icon ?? 'Users'] ?? Users
                const available = plan.status === 'AVAILABLE'
                const isSelected = available && selectedPlanKeys.includes(plan.key)
                const isOpen = expanded.has(plan.key)
                return (
                  <motion.div
                    key={plan.key}
                    layout
                    initial={{ opacity: 0, scale: 0.97 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.97 }}
                    transition={{ duration: 0.22, delay: i * 0.03 }}
                    className="group"
                  >
                    {/* The lift lives on an inner element so framer's layout
                        transform and the CSS hover transform never fight. */}
                    <div
                      className={`relative flex h-full flex-col rounded-2xl border p-5 shadow-card transition-all duration-300 hover:-translate-y-1 hover:shadow-card-hover ${
                        isSelected
                          ? 'border-primary bg-primary-light/50 ring-2 ring-primary/25'
                          : available
                            ? 'border-border bg-surface hover:border-primary/40'
                            : 'border-border bg-surface-2/60'
                      }`}
                    >
                      {/* top row: icon + status */}
                      <div className="flex items-start justify-between gap-3">
                        <span
                          className={`flex h-12 w-12 items-center justify-center rounded-xl transition-colors duration-300 ${
                            isSelected
                              ? 'bg-primary text-white'
                              : available
                                ? 'bg-primary-light text-primary'
                                : 'bg-surface-2 text-text-tertiary'
                          }`}
                        >
                          <Icon size={22} />
                        </span>

                        {isSelected ? (
                          <motion.span
                            initial={{ scale: 0.5, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            transition={{ type: 'spring', stiffness: 460, damping: 24 }}
                            className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-white shadow-sm"
                          >
                            <Check size={13} />
                          </motion.span>
                        ) : !available ? (
                          <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-text-tertiary">
                            <Lock size={9} /> Soon
                          </span>
                        ) : null}
                      </div>

                      {/* name + tagline */}
                      <div className="mt-4">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <h3
                            className="font-heading text-[15.5px] font-bold leading-tight text-text-primary"
                            style={{ letterSpacing: '-0.02em' }}
                          >
                            {plan.displayName}
                          </h3>
                          {plan.category && (
                            <span
                              className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em] ${
                                available ? 'bg-primary-light text-primary-darker' : 'bg-surface text-text-tertiary'
                              }`}
                            >
                              {plan.category}
                            </span>
                          )}
                        </div>
                        <p className="mt-1.5 line-clamp-2 text-[12.5px] leading-relaxed text-text-secondary">
                          {plan.tagline || plan.description}
                        </p>
                      </div>

                      {/* expandable features */}
                      {plan.features?.length > 0 && (
                        <div>
                          <button
                            onClick={() => toggleExpand(plan.key)}
                            aria-expanded={isOpen}
                            className="mt-3 inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-[0.06em] text-primary transition-colors hover:text-primary-dark"
                          >
                            {isOpen ? 'Hide' : `What's included (${plan.features.length})`}
                            <ChevronDown size={12} className={`transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`} />
                          </button>
                          <AnimatePresence initial={false}>
                            {isOpen && (
                              <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                                className="overflow-hidden"
                              >
                                <ul className="mt-3 space-y-2 rounded-xl border border-border bg-surface-2/70 p-3">
                                  {plan.features.map((f) => (
                                    <li key={f} className="flex items-start gap-2 text-[12px] leading-relaxed text-text-secondary">
                                      <Check size={12} className="mt-0.5 shrink-0 text-primary" /> {f}
                                    </li>
                                  ))}
                                </ul>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      )}

                      {/* footer: price + add */}
                      <div
                        className="mt-auto flex items-center justify-between gap-3 border-t border-border pt-4"
                        style={{ marginTop: isOpen ? '1rem' : undefined }}
                      >
                        <div>
                          {available ? (
                            <p
                              className="font-heading text-[17px] font-extrabold tabular-nums text-text-primary"
                              style={{ letterSpacing: '-0.025em' }}
                            >
                              ₹{plan.priceInr.toLocaleString('en-IN')}
                              <span className="ml-0.5 text-[11px] font-medium tracking-normal text-text-tertiary">/user/mo</span>
                            </p>
                          ) : (
                            <p className="text-[12px] font-semibold text-text-tertiary">Coming soon</p>
                          )}
                        </div>
                        <button
                          disabled={!available}
                          onClick={() => available && togglePlan(plan.key)}
                          className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3.5 py-2 text-[12px] font-bold transition-all duration-200 ${
                            !available
                              ? 'cursor-not-allowed bg-surface text-text-tertiary'
                              : isSelected
                                ? 'bg-primary text-white shadow-sm hover:bg-primary-dark'
                                : 'bg-primary-light text-primary hover:bg-primary hover:text-white'
                          }`}
                        >
                          {!available ? <><Lock size={12} /> Locked</> : isSelected ? <><Check size={13} /> Added</> : <><Plus size={13} /> Add</>}
                        </button>
                      </div>
                    </div>
                  </motion.div>
                )
              })}
            </AnimatePresence>
          </motion.div>
        )}
      </div>

      {/* ── RIGHT: sticky plan summary ────────────────────────────────────── */}
      <aside className="lg:sticky lg:top-24">
        <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
          {/* Emerald header */}
          <div className="relative overflow-hidden bg-gradient-to-br from-primary-darker via-primary-dark to-primary px-5 py-5 text-white">
            <span aria-hidden className="pointer-events-none absolute -right-10 -top-12 h-32 w-32 rounded-full bg-white/15 blur-2xl" />
            <div className="relative flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-lime">Your plan</p>
                <p className="mt-1.5 font-heading text-xl font-extrabold" style={{ letterSpacing: '-0.03em' }}>
                  Mix &amp; match
                </p>
              </div>
              <span className="flex h-9 min-w-9 items-center justify-center rounded-xl border border-white/20 bg-white/10 px-2 text-sm font-bold tabular-nums backdrop-blur-sm">
                {selectedPlans.length}
              </span>
            </div>
            <p className="relative mt-2 text-[12.5px] leading-relaxed text-white/80">
              Pay only for what you use.
            </p>
          </div>

          <div className="p-5">
            {selectedPlans.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border py-7 text-center">
                <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-primary-light text-primary">
                  <Plus size={18} />
                </div>
                <p className="text-[13.5px] font-semibold text-text-primary">No modules yet</p>
                <p className="mx-auto mt-1 max-w-[15rem] text-[12px] leading-relaxed text-text-secondary">
                  Add modules from the left to build your plan.
                </p>
              </div>
            ) : (
              <>
                <ul className="space-y-2">
                  <AnimatePresence initial={false}>
                    {selectedPlans.map((p) => {
                      const Icon = keyIconMap[p.key] ?? iconMap[p.icon ?? 'Users'] ?? Users
                      return (
                        <motion.li
                          key={p.key}
                          layout
                          initial={{ opacity: 0, y: -6 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, x: 10 }}
                          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                          className="flex items-center gap-2.5 rounded-xl border border-border bg-surface-2/60 px-2.5 py-2 transition-colors hover:border-primary/30"
                        >
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary-light text-primary">
                            <Icon size={14} />
                          </span>
                          <span className="flex-1 truncate text-[13px] font-semibold text-text-primary">{p.displayName}</span>
                          <span className="text-[12px] font-bold tabular-nums text-text-secondary">
                            ₹{p.priceInr.toLocaleString('en-IN')}
                          </span>
                          <button
                            onClick={() => togglePlan(p.key)}
                            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-text-tertiary transition-colors hover:bg-danger/10 hover:text-danger"
                            aria-label={`Remove ${p.displayName}`}
                          >
                            <X size={13} />
                          </button>
                        </motion.li>
                      )
                    })}
                  </AnimatePresence>
                </ul>

                <div className="mt-4 rounded-xl border border-primary/20 bg-primary-light px-4 py-3.5">
                  <div className="flex items-end justify-between gap-3">
                    <span className="text-[13px] font-semibold text-text-secondary">Total</span>
                    <span
                      className="font-heading text-2xl font-extrabold tabular-nums text-primary-darker"
                      style={{ letterSpacing: '-0.035em' }}
                    >
                      ₹{perUserTotal.toLocaleString('en-IN')}
                      <span className="ml-0.5 text-[11px] font-semibold tracking-normal text-text-secondary">/user/mo</span>
                    </span>
                  </div>
                </div>
              </>
            )}

            {/* No signup CTA here. /modules is a read-only informational
                surface — the only signup entry point is the Navbar
                "Start Free Trial" button (client decision 2026-08-07). */}
            <p className="mt-5 text-center text-[11px] leading-relaxed text-text-tertiary">
              Modules unlock inside your workspace after autopay setup.
            </p>
          </div>
        </div>
      </aside>
    </div>
  )
}
