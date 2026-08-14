import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown } from 'lucide-react'
import { Navbar } from '../components/layout/Navbar'
import { Footer } from '../components/layout/Footer'
import { PricingCalculator } from '../components/pricing/PricingCalculator'
import { PricingCard } from '../components/pricing/PricingCard'
import { presetPlans, faqItems } from '../data/pricing'

// Hidden for now (per Anil, 2026-07-20): only HR & Employees is live, so the
// Starter/Growth/Enterprise preset bundles are not shown yet. Flip to true to
// bring them back once the other modules ship. Code is kept intentionally.
const SHOW_PRESET_PLANS = false

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
    <div className="min-h-screen bg-white relative">
      <Navbar />

      {/* Above-the-fold configurator (client ask 2026-08): one fixed split-screen
          composition — chooser left, live pricing card right — fully visible on
          arrival at desktop sizes. The heading is deliberately compact so the
          fold's height goes to the chooser and the card, not to a hero band.
          On short-but-wide viewports the min-height fallback lets the page
          scroll instead of clipping the pay button. */}
      <section className="surface-soft relative flex flex-col lg:h-screen lg:min-h-[660px]">
        <span aria-hidden className="grain" />

        <div className="relative z-10 mx-auto flex w-full max-w-7xl flex-1 flex-col px-4 pb-10 pt-20 sm:px-6 sm:pt-24 lg:min-h-0 lg:px-8 lg:pb-5">
          {/* Compact heading — small on purpose, the navbar stays above */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="mb-4 flex flex-wrap items-baseline gap-x-4 gap-y-1"
          >
            <h1
              className="font-heading font-extrabold text-text-primary text-[24px] sm:text-[27px]"
              style={{ letterSpacing: '-0.025em', lineHeight: 1.1 }}
            >
              Build your plan
            </h1>
            <p className="font-body text-[13.5px] text-text-secondary sm:text-sm">
              Pick modules and team size — your price updates live.
            </p>
          </motion.div>

          <div className="flex-1 lg:min-h-0">
            <PricingCalculator />
          </div>
        </div>
      </section>

      {/* Preset plans — hidden until the other modules ship (see SHOW_PRESET_PLANS) */}
      {SHOW_PRESET_PLANS && (
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
      )}

      {/* FAQ */}
      <section className="surface-tint relative overflow-hidden py-20">
        <span aria-hidden className="grain" />
        <div className="relative max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
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
