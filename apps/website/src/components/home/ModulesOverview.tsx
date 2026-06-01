import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  Users, MapPin, Banknote, BarChart2, Package, Target,
  ShoppingCart, TrendingUp, Kanban, Settings, Monitor, PieChart, ArrowRight,
} from 'lucide-react'
import { modules } from '../../data/modules'
import { Button } from '../ui/Button'

const iconMap: Record<string, React.ElementType> = {
  Users, MapPin, Banknote, BarChart2, Package, Target,
  ShoppingCart, TrendingUp, Kanban, Settings, Monitor, PieChart,
}

export function ModulesOverview() {
  const navigate = useNavigate()

  return (
    <section className="py-24 bg-bg">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.6 }}
          className="text-center mb-14"
        >
          <span className="text-primary font-body font-semibold text-sm uppercase tracking-widest mb-3 block">
            Platform modules
          </span>
          <h2 className="font-heading font-bold text-text-primary mb-4" style={{ fontSize: 'clamp(2rem, 3.5vw, 3rem)' }}>
            Everything your business needs.
            <br />
            Nothing it doesn't.
          </h2>
          <p className="text-text-secondary font-body text-lg max-w-xl mx-auto">
            Activate only the modules you need. Pay only for what you use.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {modules.map((mod, i) => {
            const Icon = iconMap[mod.icon] ?? Users
            return (
              <motion.div
                key={mod.id}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.15 }}
                transition={{ duration: 0.5, delay: i * 0.06, ease: 'easeOut' }}
                whileHover={{ y: -4, boxShadow: '0 12px 40px rgba(15,110,86,0.15)' }}
                className="group bg-surface rounded-xl p-6 border border-border shadow-card hover:border-primary/40 transition-all duration-300 cursor-pointer"
                onClick={() => navigate('/modules')}
              >
                <div className="w-11 h-11 rounded-xl bg-primary-light flex items-center justify-center mb-4 group-hover:bg-primary/15 transition-colors duration-200">
                  <Icon size={20} className="text-primary" />
                </div>
                <h3 className="font-heading font-bold text-text-primary text-base mb-2">{mod.name}</h3>
                <p className="text-text-secondary font-body text-sm leading-relaxed mb-4 line-clamp-2">
                  {mod.description}
                </p>
                <span className="text-primary text-sm font-body font-medium group-hover:underline inline-flex items-center gap-1">
                  Learn more <ArrowRight size={14} />
                </span>
              </motion.div>
            )
          })}
        </div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.3 }}
          className="flex justify-center mt-12"
        >
          <Button variant="ghost" size="lg" onClick={() => navigate('/modules')}>
            View all modules <ArrowRight size={18} />
          </Button>
        </motion.div>
      </div>
    </section>
  )
}
