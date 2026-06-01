import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown } from 'lucide-react'
import { Navbar } from '../components/layout/Navbar'
import { Footer } from '../components/layout/Footer'
import { PricingCalculator } from '../components/pricing/PricingCalculator'
import { PricingCard } from '../components/pricing/PricingCard'
import { presetPlans, faqItems } from '../data/pricing'

function FAQItem({ q, a, index }: { q: string; a: string; index: number }) {
  const [open, setOpen] = useState(false)
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ delay: index * 0.05 }}
      className="border-b border-border last:border-0"
    >
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center justify-between w-full py-6 text-left gap-4 group"
      >
        <span className="font-heading font-semibold text-text-primary group-hover:text-primary transition-colors">{q}</span>
        <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2 }} className="flex-shrink-0">
          <ChevronDown size={18} className="text-text-secondary" />
        </motion.span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <p className="pb-6 text-text-secondary font-body text-sm leading-relaxed">{a}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

export function PricingPage() {
  return (
    <div className="min-h-screen bg-bg">
      <Navbar />

      {/* Header */}
      <section className="pt-32 pb-16 bg-[#0F6E56] relative overflow-hidden">
        <div className="absolute inset-0 pattern-dots" />
        <div className="absolute glow-orb w-[500px] h-[500px] bg-accent top-[-200px] left-[40%]" />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center relative">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-body font-semibold uppercase tracking-[0.1em] text-white/70 bg-white/[0.08] border border-white/10 mb-6">
              Pricing
            </span>
            <h1
              className="font-heading font-extrabold text-white mb-5"
              style={{ fontSize: 'clamp(2.5rem, 5vw, 4rem)', letterSpacing: '-0.02em', lineHeight: 1.08 }}
            >
              Build your perfect plan
            </h1>
            <p className="text-lg text-white/75 font-body max-w-xl mx-auto">
              Select the modules you need and the number of employees. Your price updates instantly.
            </p>
          </motion.div>
        </div>
      </section>

      {/* Calculator */}
      <section className="py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <PricingCalculator />
        </div>
      </section>

      {/* Preset plans */}
      <section className="py-20 bg-surface-2">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-14"
          >
            <span className="section-badge mb-4 inline-block">Plans</span>
            <h2 className="font-heading font-bold text-text-primary text-3xl mb-3" style={{ letterSpacing: '-0.02em' }}>
              Or choose a <span className="gradient-text">preset plan</span>
            </h2>
            <p className="text-text-secondary font-body">Pre-configured for common business sizes</p>
          </motion.div>

          <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {presetPlans.map((plan, i) => (
              <PricingCard key={plan.id} plan={plan} index={i} />
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-20">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-14"
          >
            <span className="section-badge mb-4 inline-block">FAQ</span>
            <h2 className="font-heading font-bold text-text-primary text-3xl" style={{ letterSpacing: '-0.02em' }}>
              Frequently asked questions
            </h2>
          </motion.div>
          <div className="premium-card px-8 py-2">
            {faqItems.map((item, i) => (
              <FAQItem key={i} q={item.q} a={item.a} index={i} />
            ))}
          </div>
        </div>
      </section>

      <Footer />
    </div>
  )
}
