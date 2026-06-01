import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Users, MapPin, Banknote, BarChart2, Package, Target,
  ShoppingCart, TrendingUp, Kanban, Settings, Monitor, PieChart, X,
} from 'lucide-react'
import { usePricingStore } from '../../store/pricingStore'
import { modules } from '../../data/modules'
import { sliderSnapPoints, getMultiplier } from '../../data/pricing'
import { Button } from '../ui/Button'

const iconMap: Record<string, React.ElementType> = {
  Users, MapPin, Banknote, BarChart2, Package, Target,
  ShoppingCart, TrendingUp, Kanban, Settings, Monitor, PieChart,
}

function AnimatedPrice({ value }: { value: number }) {
  return (
    <AnimatePresence mode="wait">
      <motion.span
        key={value}
        initial={{ y: 10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: -10, opacity: 0 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        className="inline-block"
      >
        {value.toLocaleString('en-IN')}
      </motion.span>
    </AnimatePresence>
  )
}

export function PricingCalculator() {
  const {
    selectedModules, toggleModule,
    employeeCount, setEmployeeCount,
    billingCycle, setBillingCycle,
    getBaseMonthly, getTotalPrice, isContactSales,
  } = usePricingStore()

  const navigate = useNavigate()
  const baseMonthly = getBaseMonthly()
  const multiplier = getMultiplier(employeeCount)
  const monthlyWithEmp = multiplier !== 'contact' ? Math.round(baseMonthly * (multiplier as number)) : 0
  const annual = Math.round(monthlyWithEmp * 12 * 0.8)
  const contact = isContactSales()

  const sliderMax = sliderSnapPoints[sliderSnapPoints.length - 1]
  const sliderValue = Math.min(employeeCount, sliderMax)

  const snapToClosest = (val: number) => {
    const closest = sliderSnapPoints.reduce((a, b) =>
      Math.abs(b - val) < Math.abs(a - val) ? b : a
    )
    setEmployeeCount(closest)
  }

  return (
    <div className="grid lg:grid-cols-5 gap-8 items-start">
      {/* LEFT — selector */}
      <div className="lg:col-span-3 space-y-10">
        {/* Monthly/Annual toggle */}
        <div className="flex items-center gap-4">
          <div className="relative flex bg-surface-2 rounded-xl p-1 border border-border">
            {(['monthly', 'annual'] as const).map((cycle) => (
              <button
                key={cycle}
                onClick={() => setBillingCycle(cycle)}
                className={`relative px-5 py-2 rounded-lg text-sm font-body font-medium transition-colors duration-200 capitalize ${
                  billingCycle === cycle ? 'text-white' : 'text-text-secondary hover:text-primary'
                }`}
              >
                {billingCycle === cycle && (
                  <motion.div
                    layoutId="cycleBg"
                    className="absolute inset-0 bg-primary rounded-lg"
                    transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                  />
                )}
                <span className="relative z-10">{cycle}</span>
              </button>
            ))}
          </div>
          {billingCycle === 'annual' && (
            <motion.span
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              className="text-xs font-body font-semibold bg-success/15 text-success px-3 py-1.5 rounded-full"
            >
              Save 20%
            </motion.span>
          )}
        </div>

        {/* Module toggle cards */}
        <div>
          <h3 className="font-heading font-bold text-text-primary text-lg mb-5">
            1. Choose your modules
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {modules.map((mod) => {
              const Icon = iconMap[mod.icon] ?? Users
              const isSelected = selectedModules.includes(mod.id)
              return (
                <motion.button
                  key={mod.id}
                  onClick={() => toggleModule(mod.id)}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  className={`relative p-4 rounded-xl border-2 text-left transition-all duration-200 ${
                    isSelected
                      ? 'border-primary bg-primary-light shadow-teal'
                      : 'border-border bg-surface hover:border-primary/40'
                  }`}
                >
                  {isSelected && (
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      className="absolute top-2 right-2 w-5 h-5 bg-primary rounded-full flex items-center justify-center"
                    >
                      <span className="text-white text-[10px] font-bold">✓</span>
                    </motion.div>
                  )}
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center mb-2"
                    style={{ backgroundColor: isSelected ? `${mod.color}25` : '#F1F5F9' }}
                  >
                    <Icon size={16} style={{ color: isSelected ? mod.color : '#64748B' }} />
                  </div>
                  <p className={`text-xs font-body font-semibold leading-tight ${isSelected ? 'text-primary' : 'text-text-primary'}`}>
                    {mod.name}
                  </p>
                  <p className="text-[11px] text-text-secondary mt-1">
                    ₹{mod.basePrice}/mo
                  </p>
                </motion.button>
              )
            })}
          </div>
        </div>

        {/* Employee slider */}
        <div>
          <h3 className="font-heading font-bold text-text-primary text-lg mb-5">
            2. Number of employees
          </h3>
          <div className="bg-surface rounded-2xl p-6 border border-border">
            <div className="flex items-center justify-between mb-6">
              <span className="text-sm text-text-secondary font-body">Employees</span>
              <motion.span
                key={employeeCount}
                initial={{ scale: 0.8 }}
                animate={{ scale: 1 }}
                className="text-2xl font-heading font-bold text-primary"
              >
                {employeeCount === sliderMax ? '1,000+' : employeeCount.toLocaleString('en-IN')}
              </motion.span>
            </div>
            <input
              type="range"
              min={sliderSnapPoints[0]}
              max={sliderMax}
              step={1}
              value={sliderValue}
              onChange={(e) => setEmployeeCount(parseInt(e.target.value))}
              onMouseUp={(e) => snapToClosest(parseInt((e.target as HTMLInputElement).value))}
              onTouchEnd={(e) => snapToClosest(parseInt((e.target as HTMLInputElement).value))}
              className="w-full"
              style={{
                background: `linear-gradient(to right, #0F6E56 0%, #0F6E56 ${((sliderValue - sliderSnapPoints[0]) / (sliderMax - sliderSnapPoints[0])) * 100}%, #E2E8F0 ${((sliderValue - sliderSnapPoints[0]) / (sliderMax - sliderSnapPoints[0])) * 100}%, #E2E8F0 100%)`,
              }}
            />
            <div className="flex justify-between mt-3">
              {sliderSnapPoints.map((pt) => (
                <button
                  key={pt}
                  onClick={() => setEmployeeCount(pt)}
                  className={`text-[10px] font-body transition-colors ${
                    employeeCount === pt ? 'text-primary font-semibold' : 'text-text-secondary hover:text-primary'
                  }`}
                >
                  {pt >= 1000 ? '1k+' : pt}
                </button>
              ))}
            </div>
            {multiplier !== 'contact' && multiplier !== 1.0 && (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="mt-4 text-xs text-text-secondary font-body text-center"
              >
                Tier multiplier: <span className="text-primary font-semibold">{multiplier}×</span> applied to base price
              </motion.p>
            )}
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
            {selectedModules.length === 0 ? (
              <div className="text-center py-8">
                <div className="text-4xl mb-3">🌱</div>
                <p className="text-text-secondary font-body text-sm">
                  Select modules to see your price
                </p>
              </div>
            ) : (
              <>
                {/* Module list */}
                <div className="space-y-2 mb-4">
                  {selectedModules.map((id) => {
                    const mod = modules.find((m) => m.id === id)
                    if (!mod) return null
                    return (
                      <div key={id} className="flex items-center justify-between text-sm">
                        <span className="text-text-secondary font-body truncate">{mod.name}</span>
                        <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                          <span className="text-text-primary font-body font-medium">
                            ₹{mod.basePrice.toLocaleString('en-IN')}
                          </span>
                          <button
                            onClick={() => toggleModule(id)}
                            className="text-text-secondary hover:text-danger transition-colors"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>

                <div className="border-t border-border pt-4 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-text-secondary font-body">Base monthly</span>
                    <span className="font-body font-medium">
                      ₹<AnimatedPrice value={baseMonthly} />
                    </span>
                  </div>
                  {multiplier !== 'contact' && multiplier !== 1.0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-text-secondary font-body">Employee tier ({multiplier}×)</span>
                      <span className="font-body font-medium text-warning">
                        +₹<AnimatedPrice value={monthlyWithEmp - baseMonthly} />
                      </span>
                    </div>
                  )}
                </div>

                <div className="border-t border-border mt-4 pt-4">
                  {contact ? (
                    <div className="text-center py-2">
                      <p className="text-lg font-heading font-bold text-primary">Custom Pricing</p>
                      <p className="text-xs text-text-secondary font-body mt-1">500+ employees - pricing shown for planning</p>
                    </div>
                  ) : (
                    <>
                      {billingCycle === 'monthly' ? (
                        <div className="flex justify-between items-center">
                          <span className="font-heading font-bold text-text-primary">Monthly Total</span>
                          <span className="font-heading font-bold text-primary text-2xl">
                            ₹<AnimatedPrice value={monthlyWithEmp} />
                          </span>
                        </div>
                      ) : (
                        <div className="flex justify-between items-center">
                          <div>
                            <p className="font-heading font-bold text-text-primary">Annual Total</p>
                            <p className="text-xs text-success font-body">20% discount applied</p>
                          </div>
                          <span className="font-heading font-bold text-primary text-2xl">
                            ₹<AnimatedPrice value={annual} />
                          </span>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </>
            )}

            <div className="mt-6 space-y-3">
              <Button fullWidth onClick={() => navigate('/signup')}>
                Create Free Workspace with This Plan
              </Button>
              <p className="text-xs text-text-secondary font-body text-center">
                Free workspace creation - no credit card required
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
