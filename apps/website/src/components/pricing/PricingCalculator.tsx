import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Users, MapPin, Banknote, BarChart2, Package, Target,
  ShoppingCart, TrendingUp, Kanban, Settings, Monitor, PieChart, X, Lock,
} from 'lucide-react'
import { usePricingStore } from '../../store/pricingStore'
import { useModulePlans, computeMonthlyTotal, type ModulePlan } from '../../lib/plans'
import { Button } from '../ui/Button'

const iconMap: Record<string, React.ElementType> = {
  Users, MapPin, Banknote, BarChart2, Package, Target,
  ShoppingCart, TrendingUp, Kanban, Settings, Monitor, PieChart,
}

const SEAT_SNAPS = [1, 5, 10, 25, 50, 100, 250, 500]

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

  const availableSelected = plans.filter((p) => p.status === 'AVAILABLE' && selectedPlanKeys.includes(p.key))
  const monthlyTotal = computeMonthlyTotal(plans, selectedPlanKeys, seats)
  const annual = Math.round(monthlyTotal * 12 * 0.8)

  const sliderMax = SEAT_SNAPS[SEAT_SNAPS.length - 1]
  const sliderValue = Math.min(seats, sliderMax)
  const snapToClosest = (val: number) => {
    const closest = SEAT_SNAPS.reduce((a, b) => (Math.abs(b - val) < Math.abs(a - val) ? b : a))
    setSeats(closest)
  }

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
          {billingCycle === 'annual' && <span className="text-xs font-body font-semibold bg-success/15 text-success px-3 py-1.5 rounded-full">Save 20%</span>}
        </div>

        {/* Plan cards */}
        <div>
          <h3 className="font-heading font-bold text-text-primary text-lg mb-5">1. Choose your modules</h3>
          {isLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {Array.from({ length: 9 }).map((_, i) => <div key={i} className="h-24 rounded-xl bg-surface border border-border animate-pulse" />)}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {plans.map((plan) => {
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
                      <Icon size={16} style={{ color: isSelected ? plan.color ?? '#0F6E56' : '#64748B' }} />
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

        {/* Users (seats) slider */}
        <div>
          <h3 className="font-heading font-bold text-text-primary text-lg mb-5">2. Number of users</h3>
          <div className="bg-surface rounded-2xl p-6 border border-border">
            <div className="flex items-center justify-between mb-6">
              <span className="text-sm text-text-secondary font-body">Users</span>
              <motion.span key={seats} initial={{ scale: 0.8 }} animate={{ scale: 1 }} className="text-2xl font-heading font-bold text-primary">
                {seats.toLocaleString('en-IN')}
              </motion.span>
            </div>
            <input
              type="range" min={SEAT_SNAPS[0]} max={sliderMax} step={1} value={sliderValue}
              onChange={(e) => setSeats(parseInt(e.target.value))}
              onMouseUp={(e) => snapToClosest(parseInt((e.target as HTMLInputElement).value))}
              onTouchEnd={(e) => snapToClosest(parseInt((e.target as HTMLInputElement).value))}
              className="w-full"
              style={{ background: `linear-gradient(to right, #0F6E56 0%, #0F6E56 ${((sliderValue - SEAT_SNAPS[0]) / (sliderMax - SEAT_SNAPS[0])) * 100}%, #E2E8F0 ${((sliderValue - SEAT_SNAPS[0]) / (sliderMax - SEAT_SNAPS[0])) * 100}%, #E2E8F0 100%)` }}
            />
            <div className="flex justify-between mt-3">
              {SEAT_SNAPS.map((pt) => (
                <button key={pt} onClick={() => setSeats(pt)} className={`text-[10px] font-body ${seats === pt ? 'text-primary font-semibold' : 'text-text-secondary hover:text-primary'}`}>{pt}</button>
              ))}
            </div>
            <p className="mt-4 text-xs text-text-secondary font-body text-center">Billed per user at each module's per-seat price.</p>
          </div>
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
                  <div className="flex justify-between text-sm">
                    <span className="text-text-secondary font-body">Per user / month</span>
                    <span className="font-body font-medium">₹<AnimatedPrice value={availableSelected.reduce((s, p) => s + p.priceInr, 0)} /></span>
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
                      <div><p className="font-heading font-bold text-text-primary">Annual Total</p><p className="text-xs text-success font-body">20% discount applied</p></div>
                      <span className="font-heading font-bold text-primary text-2xl">₹<AnimatedPrice value={annual} /></span>
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
