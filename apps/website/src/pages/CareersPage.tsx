import { motion } from 'framer-motion'
import { Mail, Sparkles, Users, Zap, Heart } from 'lucide-react'
import { Navbar } from '../components/layout/Navbar'
import { Footer } from '../components/layout/Footer'

const perks = [
  { icon: Zap, title: 'Ship fast, ship real', body: 'Small team, high ownership. Your work reaches customers this week, not next quarter.' },
  { icon: Users, title: 'Remote-first', body: 'We meet in person a few times a year. Everything else runs async — writing, video, calm chat.' },
  { icon: Heart, title: 'You keep learning', body: 'Books, courses, conferences — annual learning budget is on us. Time to use it is on the calendar.' },
]

export function CareersPage() {
  return (
    <div className="min-h-screen bg-bg">
      <Navbar />

      <section className="pt-32 pb-16 surface-deep relative overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute inset-0 pattern-dots" />
        <span aria-hidden className="grain grain-dark" />
        <div className="relative z-10 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
            <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-body font-semibold uppercase tracking-[0.1em] text-white/70 bg-white/[0.08] border border-white/10 mb-6">
              <Sparkles size={12} /> Careers
            </span>
            <h1 className="font-heading font-extrabold text-white mb-6"
                style={{ fontSize: 'clamp(2.088rem, 3.96vw, 3.045rem)', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
              Build the ERP the world<br />actually wants.
            </h1>
            <p className="text-lg text-white/80 font-body leading-relaxed max-w-2xl mx-auto">
              We&apos;re a small team building a big product for growing enterprises worldwide. If shipping
              real software to real businesses excites you, we&apos;d love to hear from you.
            </p>
          </motion.div>
        </div>
      </section>

      <section className="py-20 surface-soft relative overflow-hidden">
        <span aria-hidden className="grain" />
        <div className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid md:grid-cols-3 gap-6">
            {perks.map((p, i) => {
              const Icon = p.icon
              return (
                <motion.div
                  key={p.title}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.08 }}
                  className="premium-card p-7"
                >
                  <div className="icon-box w-11 h-11 mb-4">
                    <Icon size={20} className="text-primary" />
                  </div>
                  <h3 className="font-heading font-bold text-text-primary text-lg mb-2">{p.title}</h3>
                  <p className="text-text-secondary text-sm font-body leading-relaxed">{p.body}</p>
                </motion.div>
              )
            })}
          </div>
        </div>
      </section>

      <section className="py-20 surface-tint relative overflow-hidden">
        <span aria-hidden className="grain" />
        <div className="relative z-10 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="premium-card p-10 text-center">
            <h2 className="font-heading font-bold text-text-primary text-2xl mb-3">No open roles listed today</h2>
            <p className="text-text-secondary font-body max-w-xl mx-auto mb-8">
              We hire when we find the right person, not when we post a job. If you think you&apos;d belong
              here — engineering, design, product, sales, support — send us a note. Include what you&apos;ve
              built, what you&apos;re looking for, and why UnifiedTree caught your eye.
            </p>
            <a
              href="mailto:careers@unifiedtree.com?subject=I%27d%20like%20to%20join%20UnifiedTree"
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-body font-semibold text-white hover:bg-primary-dark"
            >
              <Mail size={16} /> careers@unifiedtree.com
            </a>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  )
}
