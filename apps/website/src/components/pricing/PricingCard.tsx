import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Check, Zap } from 'lucide-react'
import { Button } from '../ui/Button'

interface PricingCardProps {
  plan: {
    id: string
    name: string
    price: number | null
    description: string
    users: string
    modules: string[]
    storage: string
    support: string
    extras: string[]
    popular: boolean
    cta: string
  }
  index: number
}

export function PricingCard({ plan, index }: PricingCardProps) {
  const navigate = useNavigate()

  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.5, delay: index * 0.1 }}
      whileHover={{ y: -4 }}
      className={`relative rounded-2xl p-8 flex flex-col transition-all duration-300 ${
        plan.popular
          ? 'bg-green-gradient text-white shadow-premium'
          : 'premium-card'
      }`}
    >
      {plan.popular && (
        <div className="absolute -top-4 left-1/2 -translate-x-1/2">
          <div className="flex items-center gap-1.5 bg-gradient-to-r from-accent to-emerald-400 text-primary-dark text-xs font-extrabold tracking-wide px-4 py-1.5 rounded-full shadow-lg shadow-accent/20">
            <Zap size={14} className="fill-primary-dark" />
            Most Popular
          </div>
        </div>
      )}

      {/* Decorative background for popular card */}
      {plan.popular && (
        <div className="absolute inset-0 pattern-dots opacity-50 pointer-events-none rounded-2xl" />
      )}

      <div className="mb-6 relative z-10">
        <h3 className={`font-heading font-bold text-2xl mb-2 ${plan.popular ? 'text-white' : 'text-text-primary'}`}>
          {plan.name}
        </h3>
        <p className={`text-sm font-body ${plan.popular ? 'text-white/70' : 'text-text-secondary'}`}>
          {plan.description}
        </p>
      </div>

      {/* Price */}
      <div className="mb-8 relative z-10">
        {plan.price !== null ? (
          <>
            <span className={`text-5xl font-heading font-extrabold ${plan.popular ? 'text-white' : 'text-text-primary'}`}>
              ₹{plan.price.toLocaleString('en-IN')}
            </span>
            <span className={`text-base font-body ml-1 ${plan.popular ? 'text-white/70' : 'text-text-secondary'}`}>
              /mo
            </span>
            <p className={`text-xs mt-2 font-body ${plan.popular ? 'text-white/60' : 'text-text-secondary'}`}>
              Billed monthly · Save 20% annually
            </p>
          </>
        ) : (
          <span className={`text-5xl font-heading font-extrabold ${plan.popular ? 'text-white' : 'text-text-primary'}`}>
            Custom
          </span>
        )}
      </div>

      {/* Features */}
      <ul className="space-y-3.5 mb-10 flex-1 relative z-10">
        {[plan.users, ...plan.modules, plan.storage, plan.support, ...plan.extras].map((feature) => (
          <li key={feature} className="flex items-start gap-3">
            <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${
              plan.popular ? 'bg-white/20' : 'bg-primary-light'
            }`}>
              <Check size={11} className={plan.popular ? 'text-white' : 'text-primary'} />
            </div>
            <span className={`text-sm font-body ${plan.popular ? 'text-white/90' : 'text-text-secondary'}`}>
              {feature}
            </span>
          </li>
        ))}
      </ul>

      {/* CTA */}
      <div className="relative z-10">
        <Button
          variant={plan.popular ? 'outline' : 'filled'}
          fullWidth
          size="lg"
          onClick={() => navigate(plan.id === 'enterprise' ? '/signup' : '/signup')}
          className={plan.popular ? '!bg-white !text-primary !border-white hover:!bg-white/90 shadow-lg' : ''}
        >
          {plan.cta}
        </Button>
      </div>
    </motion.div>
  )
}
