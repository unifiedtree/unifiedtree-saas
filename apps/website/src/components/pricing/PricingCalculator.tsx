import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Users, MapPin, Banknote, BarChart2, Package, Target,
  ShoppingCart, TrendingUp, Kanban, Settings, Monitor, PieChart,
  Truck, Warehouse, Megaphone,
  X, Lock, Plus, Minus, CheckCircle2,
} from 'lucide-react'
import { usePricingStore } from '../../store/pricingStore'
import { useModulePlans, computeMonthlyTotal, effectiveUnit, type ModulePlan } from '../../lib/plans'
import { Button } from '../ui/Button'

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

  // Never show RETIRED plans on the pricing page. They still exist in
  // platform.module_plans so that a handful of legacy tenants who selected
  // them before the merge don't lose their selection, but new prospects
  // should only see the current catalog.
  const visiblePlans = plans.filter((p) => p.status !== 'RETIRED')
  // Included = the baseline bundle (HR, Attendance, Payroll today). They're
  // rendered as a small always-on row above the add-on toggle grid so
  // prospects see what ships with every subscription BEFORE picking add-ons.
  const includedPlans = visiblePlans.filter((p) => p.included === true)
  const addonPlans = visiblePlans.filter((p) => p.included !== true)

  const availableSelected = plans.filter((p) => p.status === 'AVAILABLE' && selectedPlanKeys.includes(p.key))
  const monthlyTotal = computeMonthlyTotal(plans, selectedPlanKeys, seats)

  // Per-user rates. Annual applies each plan's DB-driven discount (no hardcoded
  // percentage) — see effectiveUnit — and is billed for 12 months.
  const perUserMonthly = availableSelected.reduce((s, p) => s + effectiveUnit(p, 'monthly'), 0)
  const perUserAnnual = availableSelected.reduce((s, p) => s + effectiveUnit(p, 'annual'), 0)
  const annualTotal = perUserAnnual * Math.max(1, seats) * 12

  return (
    <div className="grid lg:grid-cols-5 gap-8 items-start">
      {/* LEFT — selector */}
      <div className="lg:col-span-3 space-y-10">
        {/* Monthly/Annual toggle */}
        <div className="flex items-center gap-4">
          <div className="relative flex bg-surface-2 rounded-xl p-1 border border-border">
            {(['monthly', 'annual'] as const).map((cycle) => (
              <button key={cycle} onClick={() => setBillingCycle(cycle)} className={`relative px-5 py-2 rounded-lg text-sm font-body font-medium capitalize ${billingCycle === cycle ? 'text-white' : 'text-text-secondary hover:text-primary'}`}>
                {billingCycle === cycle && <motion.div layoutId="cycleBg" className="absolute inset-0 bg-primary rounded-lg" transition={{ type: 'spring', stiffness: 400, damping: 30 }} />}
                <span className="relative z-10">{cycle}</span>
              </button>
            ))}
          </div>
          {billingCycle === 'annual' && <span className="text-xs font-body font-semibold bg-success/15 text-success px-3 py-1.5 rounded-full">Save 10%</span>}
        </div>

        {/* Included baseline — always-on cards that ship with every plan */}
        {!isLoading && includedPlans.length > 0 && (
          <div>
            <div className="mb-3 flex items-center gap-2">
              <h3 className="font-heading font-bold text-text-primary text-lg">Included in every plan</h3>
              <span className="inline-flex items-center gap-1 rounded-full bg-primary-light px-2 py-0.5 text-[10px] font-bold text-primary">
                <CheckCircle2 size={9} /> Always on
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {includedPlans.map((plan) => {
                const Icon = iconMap[plan.icon ?? 'Users'] ?? Users
                return (
                  <div
                    key={plan.key}
                    className="relative p-4 rounded-xl border-2 border-primary/40 bg-primary-light/50 text-left"
                  >
                    <div className="absolute top-2 right-2 flex h-5 w-5 items-center justify-center rounded-full bg-primary">
                      <CheckCircle2 size={11} className="text-white" />
                    </div>
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center mb-2" style={{ backgroundColor: `${plan.color ?? '#059669'}25` }}>
                      <Icon size={16} style={{ color: plan.color ?? '#059669' }} />
                    </div>
                    <p className="text-xs font-body font-semibold leading-tight text-primary">{plan.displayName}</p>
                    {plan.tagline && <p className="text-[10px] text-text-secondary mt-0.5 leading-tight">{plan.tagline}</p>}
                    <p className="text-[11px] mt-1 font-semibold text-primary">Included</p>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Add-on modules — the existing toggle grid */}
        <div>
          <h3 className="font-heading font-bold text-text-primary text-lg mb-5">
            {includedPlans.length > 0 ? 'Add-on modules' : 'Choose your modules'}
          </h3>
          {isLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {Array.from({ length: 9 }).map((_, i) => <div key={i} className="h-24 rounded-xl bg-surface border border-border animate-pulse" />)}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {addonPlans.map((plan) => {
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
                    {isSelected && <div className="absolute top-2 right-2 w-5 h-5 bg-primary rounded-full flex items-center justify-center"><span className="text-white text-[10px] font-bold">✓</span></div>}
                    {!available && <div className="absolute top-2 right-2 text-amber-500"><Lock size={13} /></div>}
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center mb-2" style={{ backgroundColor: isSelected ? `${plan.color}25` : '#F1F5F9' }}>
                      <Icon size={16} style={{ color: isSelected ? plan.color ?? '#059669' : '#64748B' }} />
                    </div>
                    <p className={`text-xs font-body font-semibold leading-tight ${isSelected ? 'text-primary' : 'text-text-primary'}`}>{plan.displayName}</p>
                    {plan.tagline && <p className="text-[10px] text-text-secondary mt-0.5 leading-tight">{plan.tagline}</p>}
                    <p className="text-[11px] mt-1 font-semibold">
                      {available ? <span className="text-primary">₹{plan.priceInr}/user/mo</span> : <span className="text-amber-600">Launching soon</span>}
                    </p>
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
                <div className="text-4xl mb-3">🌱</div>
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
                <div className="border-t border-border mt-4 pt-4">
                  {billingCycle === 'monthly' ? (
                    <div className="flex justify-between items-center">
                      <span className="font-heading font-bold text-text-primary">Monthly Total</span>
                      <span className="font-heading font-bold text-primary text-2xl">₹<AnimatedPrice value={monthlyTotal} /></span>
                    </div>
                  ) : (
                    <div className="flex justify-between items-center">
                      <div><p className="font-heading font-bold text-text-primary">Annual Total</p><p className="text-xs text-success font-body">10% off · billed yearly</p></div>
                      <span className="font-heading font-bold text-primary text-2xl">₹<AnimatedPrice value={annualTotal} /></span>
                    </div>
                  )}
                </div>
              </>
            )}
            <div className="mt-6 space-y-3">
              <Button fullWidth onClick={() => navigate('/signup')}>Create Workspace with This Plan</Button>
              <p className="text-xs text-text-secondary font-body text-center">Secure payment via Razorpay · activate instantly</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
