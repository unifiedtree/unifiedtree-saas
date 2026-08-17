import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import {
  Users, MapPin, Banknote, BarChart2, Package, Target,
  ShoppingCart, TrendingUp, Kanban, Settings, Monitor, PieChart,
  Truck, Warehouse, Megaphone,
  X, Lock, Plus, Minus,
} from 'lucide-react'
import { usePricingStore } from '../../store/pricingStore'
import { useModulePlans, computeMonthlyTotal, effectiveUnit, type ModulePlan } from '../../lib/plans'
import { CtaButton } from '../common/CtaButton'

// Keep this in sync with the `icon` string values seeded in platform.module_plans.
// New modules added 2026-07-31: Truck (SCM), Warehouse (inventory-warehouse),
// Megaphone (Marketing). Unknown values fall back to Users (see plan render).
const iconMap: Record<string, React.ElementType> = {
  Users, MapPin, Banknote, BarChart2, Package, Target,
  ShoppingCart, TrendingUp, Kanban, Settings, Monitor, PieChart,
  Truck, Warehouse, Megaphone,
}

function AnimatedPrice({ value }: { value: number }) {
  const reduce = useReducedMotion()
  if (reduce) return <span className="inline-block">{value.toLocaleString('en-IN')}</span>
  return (
    <AnimatePresence mode="wait">
      <motion.span key={value} initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -10, opacity: 0 }} transition={{ duration: 0.2 }} className="inline-block">
        {value.toLocaleString('en-IN')}
      </motion.span>
    </AnimatePresence>
  )
}

/**
 * Fixed split-screen configurator (client ask 2026-08): module chooser on the
 * LEFT, live summary + team size + pay on the RIGHT, everything inside one
 * viewport on desktop. The selection state, price math, and stepper semantics
 * are unchanged from the previous long-scroll layout — only the composition
 * moved (stepper relocated into the plan card, client correction 2026-08).
 */
export function PricingCalculator() {
  const reduce = useReducedMotion()
  const { data: plans = [], isLoading } = useModulePlans()

  const selectedPlanKeys = usePricingStore((s) => s.selectedPlanKeys)
  const togglePlan = usePricingStore((s) => s.togglePlan)
  const seats = usePricingStore((s) => s.seats)
  const setSeats = usePricingStore((s) => s.setSeats)
  const billingCycle = usePricingStore((s) => s.billingCycle)
  const setBillingCycle = usePricingStore((s) => s.setBillingCycle)

  // Hide RETIRED rows from the pricing page. They're kept in the catalog
  // for a handful of legacy tenants that already selected them before the
  // merge — the tenant_modules rows aren't FK'd to module_plans, so
  // retiring the plan doesn't break their workspace.
  const visiblePlans = plans.filter((p) => p.status !== 'RETIRED')

  const availableSelected = visiblePlans.filter((p) => p.status === 'AVAILABLE' && selectedPlanKeys.includes(p.key))
  const monthlyTotal = computeMonthlyTotal(visiblePlans, selectedPlanKeys, seats)

  // Per-user rates. Annual applies each plan's DB-driven discount (no hardcoded
  // percentage) — see effectiveUnit — and is billed for 12 months.
  const perUserMonthly = availableSelected.reduce((s, p) => s + effectiveUnit(p, 'monthly'), 0)
  const perUserAnnual = availableSelected.reduce((s, p) => s + effectiveUnit(p, 'annual'), 0)
  const annualTotal = perUserAnnual * Math.max(1, seats) * 12

  const dueTotal = billingCycle === 'monthly' ? monthlyTotal : annualTotal
  const dueSuffix = billingCycle === 'monthly' ? '/mo' : '/yr'

  return (
    <div className="grid gap-6 lg:h-full lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-7 xl:grid-cols-[minmax(0,1fr)_420px]">
      {/* LEFT — module chooser + team size */}
      <div className="flex min-h-0 flex-col">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <h2 className="font-heading text-[15px] font-bold text-text-primary sm:text-base">Choose your modules</h2>
          {/* Monthly/Annual toggle — Annual advertises a Save 10% badge */}
          <div className="flex rounded-lg border border-border bg-surface-2 p-0.5">
            {(['monthly', 'annual'] as const).map((cycle) => (
              <button
                key={cycle}
                onClick={() => setBillingCycle(cycle)}
                className={`relative rounded-md px-3 py-1.5 font-body text-[12.5px] font-medium capitalize ${billingCycle === cycle ? 'text-white' : 'text-text-secondary hover:text-primary'}`}
              >
                {billingCycle === cycle && (
                  <motion.div
                    layoutId="cycleBg"
                    className="absolute inset-0 rounded-md bg-primary"
                    transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 400, damping: 30 }}
                  />
                )}
                <span className="relative z-10 flex items-center gap-1.5">
                  {cycle}
                  {cycle === 'annual' && (
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${billingCycle === 'annual' ? 'bg-lime text-primary' : 'bg-lime/25 text-primary'}`}>Save 10%</span>
                  )}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Plan tiles — one uniform grid, every module the same tile ("keep the
            modules line wise", client 2026-08). The AVAILABLE module uses the
            exact same tile shell as the launching-soon ones — it is simply
            selectable (price + tick) where the others carry a lock. Two tiles
            per line from sm up; auto-rows-fr shares the fold height on lg. */}
        {isLoading ? (
          <div className="mt-3 grid flex-1 grid-cols-1 gap-2.5 sm:grid-cols-2 lg:auto-rows-fr">
            {Array.from({ length: 10 }).map((_, i) => <div key={i} className="min-h-[64px] animate-pulse rounded-xl border border-border bg-surface" />)}
          </div>
        ) : (
          <div className="mt-3 grid flex-1 grid-cols-1 gap-2.5 sm:grid-cols-2 lg:auto-rows-fr">
            {visiblePlans.map((plan) => {
              const Icon = iconMap[plan.icon ?? 'Users'] ?? Users
              const available = plan.status === 'AVAILABLE'
              const isSelected = available && selectedPlanKeys.includes(plan.key)

              if (available) {
                return (
                  <motion.button
                    key={plan.key}
                    onClick={() => togglePlan(plan.key)}
                    whileHover={reduce ? {} : { scale: 1.01 }}
                    whileTap={reduce ? {} : { scale: 0.99 }}
                    className={`flex items-center gap-3 rounded-xl border-2 p-3 text-left transition-all ${
                      isSelected ? 'border-primary bg-primary-light shadow-teal' : 'border-border bg-surface hover:border-primary/40'
                    }`}
                  >
                    <div className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ${isSelected ? 'bg-primary text-white' : 'bg-surface-2 text-text-tertiary'}`}>
                      <Icon size={16} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className={`font-body text-[12.5px] font-semibold leading-tight ${isSelected ? 'text-primary' : 'text-text-primary'}`}>{plan.displayName}</p>
                      {plan.tagline && <p className="mt-0.5 truncate text-[10.5px] leading-tight text-text-secondary">{plan.tagline}</p>}
                      {/* Removed 2026-08-17 (CRIT #6): the previous
                          strike-through printed `plan.priceInr * 1.4` as a
                          fake MSRP so the live price could read as "40%
                          off". There is no real prior price — this is a
                          launch tariff. Show only the actual price. */}
                      <p className="mt-1 flex items-baseline gap-1 text-[11px]">
                        <span className="font-heading text-[13px] font-bold text-primary">₹{plan.priceInr}</span>
                        <span className="text-text-secondary">/user/mo</span>
                      </p>
                    </div>
                    {/* checkbox affordance — slot mirrors the lock slot on the
                        launching-soon tiles so every tile shares one silhouette */}
                    <div className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full transition-colors ${isSelected ? 'bg-primary' : 'border-2 border-border bg-surface'}`}>
                      {isSelected && <span className="text-[10px] font-bold text-lime">✓</span>}
                    </div>
                  </motion.button>
                )
              }

              return (
                <button
                  key={plan.key}
                  disabled
                  className="flex cursor-not-allowed items-center gap-3 rounded-xl border-2 border-border bg-bg/40 p-3 text-left opacity-70 transition-all"
                >
                  <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-surface-2 text-text-tertiary">
                    <Icon size={16} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-body text-[12.5px] font-semibold leading-tight text-text-primary">{plan.displayName}</p>
                    {plan.tagline && <p className="mt-0.5 truncate text-[10.5px] leading-tight text-text-secondary">{plan.tagline}</p>}
                    <p className="mt-1 text-[11px] font-semibold text-text-tertiary">Launching soon</p>
                  </div>
                  <div className="flex-shrink-0 text-text-tertiary"><Lock size={13} /></div>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* RIGHT — live summary + pay. Compact receipt card ("squares with curved
          edges", client 2026-08): it hugs its content instead of stretching the
          fold, and sits vertically centered in its column on desktop. */}
      <div className="flex min-h-0 flex-col lg:justify-center">
        <div className="flex flex-col overflow-hidden rounded-3xl border-2 border-primary/20 bg-surface shadow-teal-lg">
          <div className="flex items-baseline justify-between bg-primary px-5 py-3">
            <h3 className="font-heading text-[15px] font-bold text-white">Your plan</h3>
            <p className="font-body text-xs text-white/70">Updates live</p>
          </div>

          <div className="flex flex-col p-5">
            {availableSelected.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-4 text-center">
                <div className="mb-2 text-3xl" style={{ filter: 'grayscale(1)', opacity: 0.55 }}>🌱</div>
                <p className="font-body text-sm text-text-secondary">Select an available module to see your price</p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {availableSelected.map((plan: ModulePlan) => (
                  <div key={plan.key} className="flex items-center justify-between text-sm">
                    <span className="truncate font-body text-text-secondary">{plan.displayName}</span>
                    <div className="ml-2 flex flex-shrink-0 items-center gap-2">
                      <span className="font-body font-medium text-text-primary">₹{plan.priceInr} × {seats}</span>
                      <button onClick={() => togglePlan(plan.key)} aria-label={`Remove ${plan.displayName}`} className="text-text-secondary hover:text-danger"><X size={14} /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="pt-4">
              <div className="space-y-2.5 border-t border-border pt-3 text-sm">
                {/* Team-size stepper — lives in the card (client 2026-08); same
                    store binding and min/max semantics as before, just moved */}
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-body font-medium text-text-primary">Team size</p>
                    <p className="font-body text-[11px] text-text-secondary">Billed per user</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button" aria-label="Decrease users"
                      onClick={() => setSeats(seats - 1)} disabled={seats <= 1}
                      className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-bg text-text-primary transition-all hover:border-primary hover:text-primary active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Minus size={15} />
                    </button>
                    <input
                      type="number" min={1} value={seats} aria-label="Number of users"
                      onChange={(e) => setSeats(parseInt(e.target.value) || 1)}
                      className="h-8 w-12 rounded-lg border border-border bg-surface text-center font-heading font-bold text-text-primary [appearance:textfield] focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    />
                    <button
                      type="button" aria-label="Increase users"
                      onClick={() => setSeats(seats + 1)}
                      className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-bg text-text-primary transition-all hover:border-primary hover:text-primary active:scale-95"
                    >
                      <Plus size={15} />
                    </button>
                  </div>
                </div>
                {availableSelected.length > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="font-body text-text-secondary">Per user / month</span>
                    <span className="flex items-center gap-1.5 font-body font-medium">
                      {billingCycle === 'annual' && perUserAnnual < perUserMonthly && (
                        <span className="text-xs text-text-secondary/60 line-through">₹{perUserMonthly}</span>
                      )}
                      <span>₹<AnimatedPrice value={billingCycle === 'annual' ? perUserAnnual : perUserMonthly} /></span>
                    </span>
                  </div>
                )}
              </div>

              {availableSelected.length > 0 && (
                <div className="mt-3 border-t border-border pt-3">
                  {billingCycle === 'monthly' ? (
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-heading font-bold text-text-primary">Monthly total</span>
                      <span className="font-heading text-2xl font-bold tabular-nums text-primary">₹<AnimatedPrice value={monthlyTotal} /></span>
                    </div>
                  ) : (
                    <div className="flex items-baseline justify-between gap-2">
                      <div>
                        <p className="font-heading font-bold text-text-primary">Annual total</p>
                        <p className="mt-0.5 text-xs font-semibold text-primary">Save 10% · billed yearly</p>
                      </div>
                      <span className="font-heading text-2xl font-bold tabular-nums text-primary">₹<AnimatedPrice value={annualTotal} /></span>
                    </div>
                  )}
                </div>
              )}

              {/* Pay CTA — routes through useCtaMode's trial-vs-paid href like
                  every other CTA on the site (split-screen redesign, 2026-08:
                  the chooser ends in "pay" per the client's ask). */}
              <div className="mt-4" data-testid="pay-cta">
                {availableSelected.length === 0 ? (
                  <button type="button" disabled className="w-full cursor-not-allowed rounded-xl border border-border bg-surface-2 px-6 py-3 font-body text-[15px] font-semibold text-text-tertiary">
                    Select a module to continue
                  </button>
                ) : (
                  <div className="[&>div]:w-full">
                    <CtaButton
                      trialLabel="Start free trial"
                      paidLabel={`Pay ₹${dueTotal.toLocaleString('en-IN')}${dueSuffix}`}
                      size="md"
                      className="w-full justify-center !py-3"
                    />
                  </div>
                )}
              </div>

              <p className="mt-3 text-center font-body text-[11.5px] text-text-tertiary">
                Modules are unlocked and autopay is set up inside your workspace.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
