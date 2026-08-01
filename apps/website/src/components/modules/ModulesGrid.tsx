import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Users, MapPin, Banknote, BarChart2, Package, Target,
  ShoppingCart, TrendingUp, Kanban, Settings, Monitor, PieChart,
  Check, Lock, Plus, ChevronDown, ArrowRight, Factory, Store,
  Calculator, BarChart3, Contact, FolderKanban, Boxes, Fingerprint,
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
        {/* Category tabs */}
        <div className="mb-6 flex flex-wrap gap-2">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`relative rounded-full px-4 py-1.5 text-sm font-medium capitalize transition-colors ${
                activeCategory === cat ? 'text-white' : 'text-text-secondary hover:bg-primary-light hover:text-primary'
              }`}
            >
              {activeCategory === cat && (
                <motion.div layoutId="tabBg" className="absolute inset-0 rounded-full bg-primary" transition={{ type: 'spring', stiffness: 400, damping: 30 }} />
              )}
              <span className="relative z-10">{cat === 'all' ? 'All modules' : cat}</span>
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-40 animate-pulse rounded-2xl border border-border bg-surface" />)}
          </div>
        ) : (
          <motion.div layout className="grid gap-4 sm:grid-cols-2">
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
                    className={`group relative flex flex-col rounded-2xl border bg-surface p-4 transition-all ${
                      isSelected ? 'border-primary shadow-teal-lg ring-1 ring-primary/40' : 'border-border shadow-card hover:border-primary/30 hover:shadow-card-hover'
                    } ${!available ? 'opacity-90' : ''}`}
                  >
                    {/* top row: icon + status */}
                    <div className="flex items-start justify-between">
                      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-light text-primary">
                        <Icon size={20} />
                      </div>
                      {isSelected ? (
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-white shadow-sm"><Check size={13} /></span>
                      ) : !available ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700"><Lock size={9} /> Soon</span>
                      ) : null}
                    </div>

                    {/* name + tagline */}
                    <div className="mt-3">
                      <div className="flex items-center gap-2">
                        <h3 className="text-[15px] font-semibold leading-tight text-text-primary">{plan.displayName}</h3>
                        {plan.category && <span className="rounded-full bg-primary-light px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-primary">{plan.category}</span>}
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-text-secondary">{plan.tagline || plan.description}</p>
                    </div>

                    {/* expandable features */}
                    {plan.features?.length > 0 && (
                      <div>
                        <button
                          onClick={() => toggleExpand(plan.key)}
                          className="mt-2.5 inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline"
                        >
                          {isOpen ? 'Hide' : `What's included (${plan.features.length})`}
                          <ChevronDown size={12} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                        </button>
                        <AnimatePresence initial={false}>
                          {isOpen && (
                            <motion.ul
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.2 }}
                              className="overflow-hidden"
                            >
                              <div className="mt-2 space-y-1.5">
                                {plan.features.map((f) => (
                                  <li key={f} className="flex items-start gap-2 text-xs text-text-secondary">
                                    <Check size={12} className="mt-0.5 shrink-0 text-primary" /> {f}
                                  </li>
                                ))}
                              </div>
                            </motion.ul>
                          )}
                        </AnimatePresence>
                      </div>
                    )}

                    {/* footer: price + add */}
                    <div className="mt-auto flex items-center justify-between border-t border-border pt-3.5" style={{ marginTop: isOpen ? '0.875rem' : undefined }}>
                      <div>
                        {available ? (
                          <p className="text-base font-bold text-text-primary">
                            ₹{plan.priceInr.toLocaleString('en-IN')}
                            <span className="text-[11px] font-normal text-text-secondary">/user/mo</span>
                          </p>
                        ) : (
                          <p className="text-xs font-semibold text-amber-600">Coming soon</p>
                        )}
                      </div>
                      <button
                        disabled={!available}
                        onClick={() => available && togglePlan(plan.key)}
                        className={`inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                          !available
                            ? 'cursor-not-allowed bg-surface-2 text-text-tertiary'
                            : isSelected
                              ? 'bg-primary text-lime'
                              : 'bg-primary-light text-primary hover:bg-primary hover:text-lime'
                        }`}
                      >
                        {!available ? <><Lock size={12} /> Locked</> : isSelected ? <><Check size={13} /> Added</> : <><Plus size={13} /> Add</>}
                      </button>
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
          <div className="bg-primary px-5 py-4 text-white">
            <p className="text-sm font-semibold">Your plan</p>
            <p className="text-xs text-emerald-100/70">Mix &amp; match — pay only for what you use.</p>
          </div>

          <div className="p-5">
            {selectedPlans.length === 0 ? (
              <div className="py-6 text-center">
                <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-primary-light text-primary"><Plus size={18} /></div>
                <p className="text-sm font-medium text-text-primary">No modules yet</p>
                <p className="mt-1 text-xs text-text-secondary">Add modules from the left to build your plan.</p>
              </div>
            ) : (
              <>
                <ul className="space-y-2">
                  {selectedPlans.map((p) => {
                    const Icon = keyIconMap[p.key] ?? iconMap[p.icon ?? 'Users'] ?? Users
                    return (
                      <li key={p.key} className="flex items-center gap-2.5 rounded-lg bg-bg px-2.5 py-2">
                        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary-light text-primary"><Icon size={14} /></span>
                        <span className="flex-1 truncate text-[13px] font-medium text-text-primary">{p.displayName}</span>
                        <span className="text-xs font-semibold text-text-secondary">₹{p.priceInr.toLocaleString('en-IN')}</span>
                        <button onClick={() => togglePlan(p.key)} className="text-text-tertiary hover:text-danger" aria-label={`Remove ${p.displayName}`}>×</button>
                      </li>
                    )
                  })}
                </ul>
                <div className="mt-4 flex items-end justify-between border-t border-border pt-4">
                  <span className="text-sm text-text-secondary">Total</span>
                  <span className="text-xl font-bold text-text-primary">₹{perUserTotal.toLocaleString('en-IN')}<span className="text-xs font-normal text-text-secondary">/user/mo</span></span>
                </div>
              </>
            )}

            <button
              onClick={() => navigate('/pricing')}
              disabled={selectedPlans.length === 0}
              className="btn-shimmer mt-5 flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold text-lime shadow-sm transition-all disabled:cursor-not-allowed disabled:opacity-50"
            >
              Configure your plan <ArrowRight size={16} />
            </button>
            <p className="mt-2 text-center text-[11px] text-text-tertiary">14-day free trial · no card required</p>
          </div>
        </div>
      </aside>
    </div>
  )
}
