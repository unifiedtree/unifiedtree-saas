import { motion } from 'framer-motion'
import { Building2, Puzzle, Users } from 'lucide-react'

const steps = [
  {
    number: '01',
    icon: Building2,
    title: 'Register your company',
    description:
      'Set up in minutes. Add your company logo, define departments, configure your fiscal year, and set up your organizational hierarchy.',
  },
  {
    number: '02',
    icon: Puzzle,
    title: 'Choose your modules',
    description:
      'Pick only what you need. Activate HR, Accounting, Attendance, Inventory, and more. Pay only for what you use. Upgrade anytime.',
  },
  {
    number: '03',
    icon: Users,
    title: 'Invite your team',
    description:
      'Role-based access control. Everyone sees exactly what they need — admins, managers, and employees each get a tailored experience.',
  },
]

export function HowItWorks() {
  return (
    <section className="py-24 bg-bg">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <span className="text-primary font-body font-semibold text-sm uppercase tracking-widest mb-3 block">
            How it works
          </span>
          <h2 className="font-heading font-bold text-text-primary" style={{ fontSize: 'clamp(2rem, 3.5vw, 3rem)' }}>
            Up and running in 3 simple steps
          </h2>
        </motion.div>

        <div className="relative">
          {/* Connecting dashed line (desktop) */}
          <div className="hidden lg:block absolute top-16 left-[calc(16.67%+2rem)] right-[calc(16.67%+2rem)] h-px">
            <div className="w-full h-full border-t-2 border-dashed border-primary/30" />
          </div>

          <div className="grid lg:grid-cols-3 gap-8">
            {steps.map((step, i) => {
              const Icon = step.icon
              return (
                <motion.div
                  key={step.number}
                  initial={{ opacity: 0, y: 40 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, amount: 0.3 }}
                  transition={{ duration: 0.6, delay: i * 0.15, ease: 'easeOut' }}
                  className="relative"
                >
                  <div className="bg-surface rounded-2xl p-8 border border-border shadow-card hover:shadow-card-hover transition-shadow duration-300 text-center">
                    {/* Number badge */}
                    <div className="w-14 h-14 rounded-full bg-primary flex items-center justify-center mx-auto mb-5 relative z-10">
                      <span className="text-white font-heading font-bold text-lg">{step.number}</span>
                    </div>

                    {/* Icon */}
                    <div className="w-12 h-12 rounded-xl bg-primary-light flex items-center justify-center mx-auto mb-5">
                      <Icon size={22} className="text-primary" />
                    </div>

                    <h3 className="font-heading font-bold text-text-primary text-xl mb-3">{step.title}</h3>
                    <p className="text-text-secondary font-body leading-relaxed">{step.description}</p>
                  </div>
                </motion.div>
              )
            })}
          </div>
        </div>
      </div>
    </section>
  )
}
