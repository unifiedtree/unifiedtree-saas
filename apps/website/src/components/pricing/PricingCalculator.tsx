import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Users, MapPin, Banknote, BarChart2, Package, Target,
  ShoppingCart, TrendingUp, Kanban, Settings, Monitor, PieChart,
  Truck, Warehouse, Megaphone,
  X, Lock, Plus, Minus,
} from 'lucide-react'
import { usePricingStore } from '../../store/pricingStore'
import { useModulePlans, computeMonthlyTotal, effectiveUnit, type ModulePlan } from '../../lib/plans'
import { Button } from '../ui/Button'
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
  return (
    <AnimatePresence mode="wait">
      <motion.span key={value} initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -10, opacity: 0 }} transition={{ duration: 0.2 }} className="inline-block">
        {value.toLocaleString('en-IN')}
      </motion.span>
    </AnimatePresence>
  )
}

export function PricingCalculator() {
  const navigate = useNavigate()
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

  return (
    <div className="grid lg:grid-cols-5 gap-8 items-start">
      {/* LEFT — selector */}
      <div className="lg:col-span-3 space-y-10">
        {/* Monthly/Annual toggle — Annual advertises a Save 10% badge */}
        <div className="flex items-center gap-4">
          <div className="relative flex bg-surface-2 rounded-xl p-1 border border-border">
            {(['monthly', 'annual'] as const).map((cycle) => (
              <button key={cycle} onClick={() => setBillingCycle(cycle)} className={`relative px-5 py-2 rounded-lg text-sm font-body font-medium capitalize ${billingCycle === cycle ? 'text-white' : 'text-text-secondary hover:text-primary'}`}>
                {billingCycle === cycle && <motion.div layoutId="cycleBg" className="absolute inset-0 bg-primary rounded-lg" transition={{ type: 'spring', stiffness: 400, damping: 30 }} />}
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

        {/* Plan cards — one flat grid, no Included/Add-on split. */}
        <div>
          <h3 className="font-heading font-bold text-text-primary text-lg mb-5">Choose your modules</h3>
          {isLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {Array.from({ length: 9 }).map((_, i) => <div key={i} className="h-24 rounded-xl bg-surface border border-border animate-pulse" />)}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {visiblePlans.map((plan) => {
                const Icon = iconMap[plan.icon ?? 'Users'] ?? Users
                const available = plan.status === 'AVAILABLE'
                const isSelected = available && selectedPlanKeys.includes(plan.key)
                return (
                  <motion.button
                    key={plan.key}
                    onClick={() => available && togglePlan(plan.key)}
                    whileHover={available ? { scale: 1.02 } : {}}
                    whileTap={available ? { scale: 0.98 } : {}}
                    disabled={!available}
                    className={`relative p-4 rounded-xl border-2 text-left transition-all ${
                      !available ? 'border-border bg-bg/40 opacity-70 cursor-not-allowed'
                        : isSelected ? 'border-primary bg-primary-light shadow-teal'
                        : 'border-border bg-surface hover:border-primary/40'
                    }`}
                  >
                    {isSelected && <div className="absolute top-2 right-2 w-5 h-5 bg-primary rounded-full flex items-center justify-center"><span className="text-lime text-[10px] font-bold">✓</span></div>}
                    {!available && <div className="absolute top-2 right-2 text-text-tertiary"><Lock size={13} /></div>}
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-2 ${isSelected ? 'bg-primary text-white' : 'bg-surface-2 text-text-tertiary'}`}>
                      <Icon size={16} />
                    </div>
                    <p className={`text-xs font-body font-semibold leading-tight ${isSelected ? 'text-primary' : 'text-text-primary'}`}>{plan.displayName}</p>
                    {plan.tagline && <p className="text-[10px] text-text-secondary mt-0.5 leading-tight">{plan.tagline}</p>}
                    {available ? (
                      <p className="mt-1 flex items-baseline gap-1 text-[11px] font-semibold">
                        <span className="text-text-tertiary line-through">₹{Math.round(plan.priceInr * 1.4)}</span>
                        <span className="text-primary">₹{plan.priceInr}</span>
                        <span className="font-normal text-text-secondary">/user/mo</span>
                      </p>
                    ) : (
                      <p className="mt-1 text-[11px] font-semibold text-text-tertiary">Launching soon</p>
                    )}
                  </motion.button>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* RIGHT — sticky summary */}
      <div className="lg:col-span-2 lg:sticky lg:top-24">
        <div className="bg-surface rounded-2xl border-2 border-primary/20 shadow-teal-lg overflow-hidden">
          <div className="bg-primary px-6 py-4">
            <h3 className="font-heading font-bold text-white text-lg">Your Plan Summary</h3>
            <p className="text-white/70 text-sm font-body">Updates in real-time</p>
          </div>
          <div className="p-6">
            {/* Users stepper — admin sets team size right here in the summary */}
            <div className="flex items-center justify-between mb-5 pb-5 border-b border-border">
              <div>
                <p className="text-sm font-heading font-bold text-text-primary">Users</p>
                <p className="text-xs text-text-secondary font-body">Your team size</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button" aria-label="Decrease users"
                  onClick={() => setSeats(seats - 1)} disabled={seats <= 1}
                  className="w-9 h-9 rounded-lg border border-border bg-bg flex items-center justify-center text-text-primary hover:border-primary hover:text-primary disabled:opacity-40 disabled:cursor-not-allowed transition-all active:scale-95"
                >
                  <Minus size={16} />
                </button>
                <input
                  type="number" min={1} value={seats} aria-label="Number of users"
                  onChange={(e) => setSeats(parseInt(e.target.value) || 1)}
                  className="w-16 h-9 text-center rounded-lg border border-border bg-surface font-heading font-bold text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
                <button
                  type="button" aria-label="Increase users"
                  onClick={() => setSeats(seats + 1)}
                  className="w-9 h-9 rounded-lg border border-border bg-bg flex items-center justify-center text-text-primary hover:border-primary hover:text-primary transition-all active:scale-95"
                >
                  <Plus size={16} />
                </button>
              </div>
            </div>

            {availableSelected.length === 0 ? (
              <div className="text-center py-8">
                <div className="text-4xl mb-3" style={{ filter: 'grayscale(1)', opacity: 0.55 }}>🌱</div>
                <p className="text-text-secondary font-body text-sm">Select an available module to see your price</p>
              </div>
            ) : (
              <>
                <div className="space-y-2 mb-4">
                  {availableSelected.map((plan: ModulePlan) => (
                    <div key={plan.key} className="flex items-center justify-between text-sm">
                      <span className="text-text-secondary font-body truncate">{plan.displayName}</span>
                      <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                        <span className="text-text-primary font-body font-medium">₹{plan.priceInr} × {seats}</span>
                        <button onClick={() => togglePlan(plan.key)} className="text-text-secondary hover:text-danger"><X size={14} /></button>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="border-t border-border pt-4">
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-text-secondary font-body">Per user / month</span>
                    <span className="font-body font-medium flex items-center gap-1.5">
                      {billingCycle === 'annual' && perUserAnnual < perUserMonthly && (
                        <span className="text-text-secondary/60 line-through text-xs">₹{perUserMonthly}</span>
                      )}
                      ₹<AnimatedPrice value={billingCycle === 'annual' ? perUserAnnual : perUserMonthly} />
                    </span>
                  </div>
                </div>
                <div className="mt-4 border-t border-border pt-4">
                  {billingCycle === 'monthly' ? (
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-heading font-bold text-text-primary">Monthly Total</span>
                      <span className="font-heading font-bold text-primary text-2xl tabular-nums">₹<AnimatedPrice value={monthlyTotal} /></span>
                    </div>
                  ) : (
                    <div className="flex items-baseline justify-between gap-2">
                      <div>
                        <p className="font-heading font-bold text-text-primary">Annual Total</p>
                        <p className="mt-0.5 text-xs font-semibold text-primary">Save 10% · billed yearly</p>
                      </div>
                      <span className="font-heading font-bold text-primary text-2xl tabular-nums">₹<AnimatedPrice value={annualTotal} /></span>
                    </div>
                  )}
                </div>
              </>
            )}
            <div className="mt-6 space-y-3">
              {/* Global rule: anon / signed-in-with-zero-workspaces sees TRIAL,
                  signed-in-with-workspaces sees PAID with the computed total. */}
              <div className="w-full [&_a]:w-full [&_a]:justify-center">
                <CtaButton
                  className="w-full justify-center"
                  trialLabel="Start 7-day Free Trial"
                  paidLabel={`Pay ₹${monthlyTotal.toLocaleString('en-IN')}/${billingCycle === 'annual' ? 'yr' : 'mo'} & Create Workspace`}
                />
              </div>
              <p className="text-xs text-text-secondary font-body text-center">Secure payment via Razorpay · activate instantly</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
