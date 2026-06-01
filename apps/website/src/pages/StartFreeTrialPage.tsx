import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Check, ArrowRight, Zap, Shield, Clock } from 'lucide-react'
import { Navbar } from '../components/layout/Navbar'
import { Footer } from '../components/layout/Footer'
import { presetPlans } from '../data/pricing'

const perks = [
  { icon: Zap, label: 'Free access - core HRMS included', color: '#1DB985' },
  { icon: Shield, label: 'No credit card required', color: '#0F6E56' },
  { icon: Clock, label: 'Workspace activates instantly', color: '#1DB985' },
]

const steps = [
  { n: '01', title: 'Create your account', desc: 'Add company details and set up your admin profile.' },
  { n: '02', title: 'Pick your modules', desc: 'Choose only what you need. Start with 2, expand to 12.' },
  { n: '03', title: 'Invite your team', desc: 'Add employees, set roles, and go live.' },
]

export function StartFreeTrialPage() {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen bg-bg">
      <Navbar />

      {/* Hero */}
      <section className="pt-32 pb-24 relative overflow-hidden bg-gradient-to-br from-primary-light via-bg to-primary-light/40">
        {/* Decorative elements */}
        <div className="absolute top-10 -left-20 w-80 h-80 bg-accent rounded-full blur-[110px] opacity-20 pointer-events-none animate-pulse" style={{ animationDuration: '6s' }} />
        <div className="absolute bottom-10 -right-20 w-80 h-80 bg-primary-light rounded-full blur-[110px] opacity-35 pointer-events-none" />
        <div className="absolute inset-0 opacity-[0.03] pattern-dots pointer-events-none" />

        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center relative z-10">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.65 }}
          >
            <div className="section-badge mb-6 inline-flex">
              Start for free. Scale when ready.
            </div>
            
            <h1
              className="font-heading font-extrabold text-text-primary tracking-tight mb-5"
              style={{ fontSize: 'clamp(2.5rem, 5vw, 4.25rem)', lineHeight: 1.08 }}
            >
              Create your free company workspace
              <br />
              <span className="gradient-text">and log in right away.</span>
            </h1>
            <p className="text-lg text-text-secondary font-body mb-10 max-w-xl mx-auto leading-relaxed">
              No payment, no approval queue. Plans are displayed for pricing visibility,
              while signup creates an active workspace immediately.
            </p>

            {/* Interactive Perks in Glass Cards */}
            <div className="flex flex-wrap justify-center gap-4 mb-10 relative z-10">
              {perks.map(({ icon: Icon, label, color }) => (
                <motion.div
                  key={label}
                  whileHover={{ scale: 1.04, translateY: -1 }}
                  className="flex items-center gap-2.5 px-6 py-3 bg-white/70 backdrop-blur-md border border-border shadow-sm rounded-full group hover:border-primary/20 hover:bg-white transition-all duration-300"
                >
                  <div className="w-6 h-6 rounded-full flex items-center justify-center bg-primary/5 text-primary group-hover:scale-110 transition-transform">
                    <Icon size={14} style={{ color }} />
                  </div>
                  <span className="text-sm font-body font-semibold text-text-primary">{label}</span>
                </motion.div>
              ))}
            </div>

            <motion.button
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => navigate('/signup')}
              className="inline-flex items-center gap-3 px-12 py-4 bg-primary text-white rounded-xl font-body font-bold text-lg hover:bg-primary-dark transition-all shadow-teal hover:shadow-teal-lg btn-shimmer"
            >
              Create Free Account <ArrowRight size={20} />
            </motion.button>
          </motion.div>
        </div>
      </section>

      {/* How it works */}
      <section className="py-24 bg-surface relative">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-14"
          >
            <span className="section-badge mb-4 inline-block">Process</span>
            <h2 className="font-heading font-bold text-text-primary text-3xl mb-3 tracking-tight">
              Up and running in 3 steps
            </h2>
            <p className="text-text-secondary font-body font-medium text-base">Most customers go live within 48 hours.</p>
          </motion.div>

          <div className="grid md:grid-cols-3 gap-8">
            {steps.map((step, i) => (
              <motion.div
                key={step.n}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.12 }}
                className="premium-card p-8 flex flex-col items-center relative group"
              >
                {/* Top highlight bar on hover */}
                <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-primary to-accent opacity-0 group-hover:opacity-100 transition-opacity rounded-t-2xl" />

                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary to-accent flex items-center justify-center mb-5 shadow-md shadow-primary/20 group-hover:scale-110 transition-transform">
                  <span className="text-white font-heading font-extrabold text-lg">{step.n}</span>
                </div>
                <h3 className="font-heading font-bold text-text-primary text-xl mb-3">{step.title}</h3>
                <p className="text-text-secondary font-body text-sm leading-relaxed text-center">{step.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Plan selection teaser */}
      <section className="py-24 bg-bg relative">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-16"
          >
            <span className="section-badge mb-4 inline-block">Pricing teaser</span>
            <h2 className="font-heading font-bold text-text-primary text-3xl mb-3 tracking-tight">
              Plans are shown for reference
            </h2>
            <p className="text-text-secondary font-body font-medium text-base">Create and use your workspace for free today.</p>
          </motion.div>

          <div className="grid md:grid-cols-3 gap-6">
            {presetPlans.map((plan, i) => (
              <motion.div
                key={plan.id}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                whileHover={{ y: -6 }}
                className={`relative rounded-3xl p-8 border-2 transition-all duration-300 ${
                  plan.popular
                    ? 'border-primary bg-white shadow-xl shadow-teal/5'
                    : 'border-border bg-white shadow-md hover:shadow-lg'
                }`}
              >
                {plan.popular && (
                  <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                    <span className="bg-gradient-to-r from-primary to-accent text-white text-xs font-bold px-4 py-1.5 rounded-full shadow-md uppercase tracking-wider">Most Popular</span>
                  </div>
                )}
                <h3 className={`font-heading font-extrabold text-2xl mb-1.5 ${plan.popular ? 'text-primary' : 'text-text-primary'}`}>
                  {plan.name}
                </h3>
                <p className="text-text-secondary text-sm font-body mb-5 leading-relaxed">{plan.description}</p>
                
                <div className="mb-6">
                  {plan.price ? (
                    <p className="font-heading font-black text-3xl text-text-primary">
                      ₹{plan.price.toLocaleString('en-IN')}
                      <span className="text-sm font-body font-medium text-text-secondary">/month</span>
                    </p>
                  ) : (
                    <p className="font-heading font-black text-3xl text-text-primary">Custom Pricing</p>
                  )}
                </div>

                <div className="h-px bg-border mb-6" />

                <ul className="space-y-3.5 mb-8">
                  {[plan.users, ...plan.extras.slice(0, 3)].map((f) => (
                    <li key={f} className="flex items-center gap-3 text-sm text-text-secondary font-body font-medium">
                      <div className="w-5 h-5 rounded-full bg-primary-light flex items-center justify-center flex-shrink-0">
                        <Check size={12} className="text-primary" />
                      </div>
                      {f}
                    </li>
                  ))}
                </ul>

                <button
                  onClick={() => navigate('/signup')}
                  className={`w-full py-3.5 rounded-xl text-sm font-body font-bold transition-all duration-300 ${
                    plan.popular
                      ? 'bg-primary text-white hover:bg-primary-dark shadow-teal hover:shadow-teal-lg active:scale-98 transform btn-shimmer'
                      : 'border-2 border-primary text-primary hover:bg-primary-light active:scale-98 transform'
                  }`}
                >
                  {plan.cta}
                </button>
              </motion.div>
            ))}
          </div>

          <div className="text-center mt-12">
            <button
              onClick={() => navigate('/pricing')}
              className="text-primary font-body font-bold hover:text-primary-dark hover:underline text-sm inline-flex items-center gap-1.5 transition-colors"
            >
              Or compare the displayed plans with the pricing calculator
              <ArrowRight size={14} />
            </button>
          </div>
        </div>
      </section>

      {/* Trust signals */}
      <section className="py-16 bg-surface border-t border-border relative overflow-hidden">
        <div className="absolute inset-0 opacity-[0.02] pattern-dots pointer-events-none" />
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
            {[
              { val: '2,400+', label: 'Businesses Activated' },
              { val: 'Free', label: 'Workspace Access' },
              { val: '99.9%', label: 'Uptime Guarantee' },
              { val: 'Instant', label: 'Workspace Provision' },
            ].map((s) => (
              <div key={s.label} className="group">
                <p className="font-heading font-black text-primary text-3xl sm:text-4xl tracking-tight transition-transform duration-300 group-hover:scale-105">{s.val}</p>
                <p className="text-text-secondary font-body font-semibold text-xs uppercase tracking-wider mt-2">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <Footer />
    </div>
  )
}

