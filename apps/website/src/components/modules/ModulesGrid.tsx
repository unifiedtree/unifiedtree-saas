import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Users, MapPin, Banknote, BarChart2, Package, Target,
  ShoppingCart, TrendingUp, Kanban, Settings, Monitor, PieChart, Check,
} from 'lucide-react'
import { modules, categoryLabels } from '../../data/modules'
import { usePricingStore } from '../../store/pricingStore'
import { Button } from '../ui/Button'

const iconMap: Record<string, React.ElementType> = {
  Users, MapPin, Banknote, BarChart2, Package, Target,
  ShoppingCart, TrendingUp, Kanban, Settings, Monitor, PieChart,
}

const categories = ['all', 'finance', 'hr', 'operations', 'sales', 'productivity'] as const

export function ModulesGrid() {
  const [activeCategory, setActiveCategory] = useState<string>('all')
  const { selectedModules, toggleModule } = usePricingStore()
  const navigate = useNavigate()

  const filtered = activeCategory === 'all'
    ? modules
    : modules.filter((m) => m.category === activeCategory)

  return (
    <div>
      {/* Category tabs */}
      <div className="relative flex flex-wrap gap-2 mb-12 justify-center">
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={`relative px-6 py-2.5 rounded-full text-sm font-body font-medium transition-all duration-300 ${
              activeCategory === cat
                ? 'text-white shadow-md shadow-primary/20'
                : 'text-text-secondary hover:text-primary hover:bg-primary-light/50'
            }`}
          >
            {activeCategory === cat && (
              <motion.div
                layoutId="tabBg"
                className="absolute inset-0 bg-primary rounded-full"
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              />
            )}
            <span className="relative z-10">{categoryLabels[cat]}</span>
          </button>
        ))}
      </div>

      {/* Module grid */}
      <motion.div
        layout
        className="grid md:grid-cols-2 lg:grid-cols-3 gap-7 pb-28"
      >
        <AnimatePresence mode="popLayout">
          {filtered.map((mod, i) => {
            const Icon = iconMap[mod.icon] ?? Users
            const isSelected = selectedModules.includes(mod.id)
            return (
              <motion.div
                key={mod.id}
                layout
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.25, delay: i * 0.04 }}
                className={`relative premium-card p-7 transition-all duration-300 ${
                  isSelected ? 'border-primary shadow-teal ring-1 ring-primary' : ''
                }`}
              >
                {/* Selected badge */}
                {isSelected && (
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="absolute top-4 right-4 w-7 h-7 bg-primary rounded-full flex items-center justify-center shadow-md shadow-primary/30"
                  >
                    <Check size={14} className="text-white" />
                  </motion.div>
                )}

                {/* Header */}
                <div className="flex items-start gap-4 mb-5">
                  <div className="icon-box w-12 h-12 flex-shrink-0">
                    <Icon size={22} className="text-primary" />
                  </div>
                  <div>
                    <span
                      className="text-[10px] font-body font-bold uppercase tracking-wider px-2.5 py-1 rounded-full mb-1.5 inline-block bg-primary-light text-primary border border-primary/10"
                    >
                      {categoryLabels[mod.category]}
                    </span>
                    <h3 className="font-heading font-bold text-text-primary text-lg leading-tight">{mod.name}</h3>
                  </div>
                </div>

                <p className="text-text-secondary font-body text-sm leading-relaxed mb-6">{mod.description}</p>

                {/* Features */}
                <ul className="space-y-2.5 mb-7">
                  {mod.features.map((f) => (
                    <li key={f} className="flex items-start gap-2.5 text-sm text-text-secondary font-body">
                      <div className="w-5 h-5 rounded-lg bg-primary-light flex items-center justify-center flex-shrink-0 mt-0.5">
                        <Check size={11} className="text-primary" />
                      </div>
                      {f}
                    </li>
                  ))}
                </ul>

                {/* Footer */}
                <div className="flex items-center justify-between pt-5 border-t border-border">
                  <div>
                    <span className="text-xs text-text-secondary font-body font-medium">From</span>
                    <p className="text-xl font-heading font-bold text-text-primary">
                      ₹{mod.basePrice.toLocaleString('en-IN')}
                      <span className="text-sm font-body font-normal text-text-secondary">/mo</span>
                    </p>
                  </div>
                  <motion.button
                    whileHover={{ scale: 1.04, y: -1 }}
                    whileTap={{ scale: 0.96 }}
                    onClick={() => toggleModule(mod.id)}
                    className={`px-5 py-2.5 rounded-xl text-sm font-body font-semibold transition-all duration-300 shadow-sm ${
                      isSelected
                        ? 'bg-primary text-white shadow-primary/20'
                        : 'bg-primary-light text-primary hover:bg-primary hover:text-white'
                    }`}
                  >
                    {isSelected ? '✓ Added' : 'Add to Plan →'}
                  </motion.button>
                </div>
              </motion.div>
            )
          })}
        </AnimatePresence>
      </motion.div>

      {/* Sticky bottom bar */}
      <AnimatePresence>
        {selectedModules.length > 0 && (
          <motion.div
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="fixed bottom-8 left-1/2 -translate-x-1/2 z-40 bg-green-gradient text-white rounded-2xl p-4 pl-6 shadow-premium flex items-center gap-6 border border-white/10"
          >
            <div>
              <p className="text-sm font-body font-medium text-white/90">
                {selectedModules.length} module{selectedModules.length > 1 ? 's' : ''} selected
              </p>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => navigate('/pricing')}
              className="!text-white !border-white/30 !bg-white/10 hover:!bg-white/20"
            >
              Configure your plan →
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
