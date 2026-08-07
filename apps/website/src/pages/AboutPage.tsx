import { motion } from 'framer-motion'
import { Heart, Target, Lightbulb, Users } from 'lucide-react'
import { Navbar } from '../components/layout/Navbar'
import { Footer } from '../components/layout/Footer'
import { CTABanner } from '../components/home/CTABanner'

const values = [
  {
    icon: Heart,
    title: 'Built for the Global Market',
    description:
      'We built UnifiedTree for businesses operating in dynamic, fast-paced markets worldwide — companies that deal with power fluctuations, shifting local regulations, and patchy internet zones. Every feature is designed with this operational reality in mind.',
  },
  {
    icon: Target,
    title: 'Radical Simplicity',
    description:
      'ERP software has a reputation for being complex and expensive to implement. We reject that. UnifiedTree should be live in your business within a day — not months.',
  },
  {
    icon: Lightbulb,
    title: 'Offline-First Philosophy',
    description:
      'Most SaaS assumes perfect internet. We don\'t. Our core principle: if it\'s critical to your business, it must work offline. Sync is a feature, not a requirement.',
  },
  {
    icon: Users,
    title: 'Customer Obsession',
    description:
      'Every feature on our roadmap comes from a customer conversation. We visit businesses, sit with accountants, and walk factory floors. We build what\'s needed — nothing more.',
  },
]

export function AboutPage() {
  return (
    <div className="min-h-screen bg-bg">
      <Navbar />

      {/* Hero — DARK gradient for clear text visibility */}
      <section className="pt-32 pb-24 hero-gradient relative overflow-hidden">
        {/* Decorative elements */}
        <div className="absolute inset-0 pattern-dots" />
        <div className="absolute glow-orb w-[500px] h-[500px] bg-lime top-[-200px] right-[-100px]" />
        <div className="absolute glow-orb w-[300px] h-[300px] bg-primary bottom-[-100px] left-[10%]" />

        <div className="absolute inset-0 opacity-[0.06]">
          <div className="absolute top-10 right-10 w-96 h-96 rounded-full border-2 border-white" />
          <div className="absolute bottom-0 left-20 w-64 h-64 rounded-full border-2 border-white" />
          <div className="absolute top-1/2 left-1/2 w-48 h-48 rounded-full border border-white -translate-x-1/2 -translate-y-1/2" />
        </div>

        <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-body font-semibold uppercase tracking-[0.1em] text-white/70 bg-white/[0.08] border border-white/10 mb-6">
              Our Story
            </span>
            <h1
              className="font-heading font-extrabold text-white mb-8"
              style={{ fontSize: 'clamp(2.8rem, 5.5vw, 4.5rem)', letterSpacing: '-0.02em', lineHeight: 1.08 }}
            >
              We built the ERP we
              <br />
              wished we had.
            </h1>
            <p className="text-xl text-white/80 font-body leading-relaxed max-w-2xl mx-auto">
              UnifiedTree was born out of frustration. We watched growing businesses worldwide suffer
              through clunky, expensive ERP systems that assumed perfect infrastructure and unlimited
              IT budgets. We decided to build something different.
            </p>
          </motion.div>
        </div>
      </section>

      {/* Mission */}
      <section className="py-24 bg-surface">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
          >
            <div className="w-20 h-1 bg-gradient-to-r from-primary to-accent rounded-full mx-auto mb-10" />
            <h2 className="font-heading font-bold text-text-primary text-3xl mb-6" style={{ letterSpacing: '-0.02em' }}>Our Mission</h2>
            <p className="text-xl text-text-secondary font-body leading-relaxed">
              To give every growing enterprise — whether in London or Lima, with 10 employees or
              10,000 — access to world-class business management software that actually fits the
              way they work.
            </p>
          </motion.div>
        </div>
      </section>

      {/* Values */}
      <section className="py-24 bg-bg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-16"
          >
            <span className="section-badge mb-4 inline-block">Our values</span>
            <h2 className="font-heading font-bold text-text-primary text-3xl" style={{ letterSpacing: '-0.02em' }}>
              What we <span className="gradient-text">believe</span>
            </h2>
          </motion.div>
          <div className="grid md:grid-cols-2 gap-7">
            {values.map((val, i) => {
              const Icon = val.icon
              return (
                <motion.div
                  key={val.title}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.1 }}
                  className="premium-card p-8 flex gap-5"
                >
                  <div className="icon-box w-12 h-12 flex-shrink-0 mt-1">
                    <Icon size={22} className="text-primary" />
                  </div>
                  <div>
                    <h3 className="font-heading font-bold text-text-primary text-xl mb-2">{val.title}</h3>
                    <p className="text-text-secondary font-body leading-relaxed">{val.description}</p>
                  </div>
                </motion.div>
              )
            })}
          </div>
        </div>
      </section>

      <CTABanner />
      <Footer />
    </div>
  )
}
