import { motion, useReducedMotion } from 'framer-motion'
import { Building2, Puzzle, Users } from 'lucide-react'

/**
 * Onboarding told as a numbered journey rather than three equal cards.
 *
 * The emerald chips sit ON a dashed rail that runs left-to-right across the
 * desktop layout, so the eye is walked through the sequence. On scroll the
 * sequence assembles itself: each chip pops in with a spring, then its rail
 * segment draws toward the next step. On hover a card lifts on a soft emerald
 * shadow, its ghost number tints deeper emerald, and the icon chip gives a
 * small spring scale. Each step's ghost number sits behind its copy at 10%
 * emerald to keep the count legible without competing with the headline.
 */

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

/** Emerald dashes for the rail that links one step to the next. */
const RAIL_DASHES =
  'repeating-linear-gradient(90deg, rgba(5,150,105,0.42) 0 10px, rgba(5,150,105,0) 10px 20px)'

const EASE = [0.16, 1, 0.3, 1] as const

/** Overshoot curve that makes the CSS hover scale on the icon chip feel sprung. */
const SPRING_BEZIER = '[transition-timing-function:cubic-bezier(0.34,1.56,0.64,1)]'

export function HowItWorks() {
  const reduce = useReducedMotion()

  return (
    <section className="surface-tint relative overflow-hidden py-24 lg:py-32">
      {/* Soft light off the horizon, so the band separates from the section above. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[420px]"
        style={{
          background:
            'radial-gradient(60% 100% at 50% 0%, rgba(255,255,255,0.7) 0%, rgba(255,255,255,0) 70%)',
        }}
      />
      <span aria-hidden className="grain" />

      <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: reduce ? 0 : 26 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.6, ease: EASE }}
          className="mx-auto max-w-3xl text-center"
        >
          <span className="mb-4 block text-[12.5px] font-semibold uppercase tracking-[0.14em] text-primary">
            How it works
          </span>
          <h2
            className="font-heading font-extrabold text-text-primary"
            style={{ fontSize: 'clamp(1.74rem, 3.52vw, 3.045rem)', lineHeight: 1.05, letterSpacing: '-0.035em' }}
          >
            Up and running in 3 simple steps
          </h2>
          <p className="mx-auto mt-6 max-w-2xl text-[15.5px] leading-relaxed text-text-secondary">
            No implementation project and no consultants. Create the account, switch on the
            modules that matter, and bring your people in.
          </p>
        </motion.div>

        <ol className="mt-20 grid grid-cols-1 gap-x-8 gap-y-14 lg:mt-24 lg:grid-cols-3">
          {steps.map((step, i) => {
            const Icon = step.icon
            const isLast = i === steps.length - 1

            return (
              <motion.li
                key={step.number}
                initial={{ opacity: 0, y: reduce ? 0 : 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.25 }}
                transition={{ duration: 0.6, delay: reduce ? 0 : i * 0.12, ease: EASE }}
                className="group relative"
              >
                {/* The rail — draws from this chip toward the next column's chip. */}
                {!isLast && (
                  <motion.span
                    aria-hidden
                    initial={{ scaleX: reduce ? 1 : 0 }}
                    whileInView={{ scaleX: 1 }}
                    viewport={{ once: true, amount: 0.25 }}
                    transition={{ duration: 0.7, delay: reduce ? 0 : 0.35 + i * 0.18, ease: EASE }}
                    className="pointer-events-none absolute left-[76px] top-[31px] hidden h-0.5 origin-left lg:block"
                    style={{ width: 'calc(100% + 2rem - 76px)', backgroundImage: RAIL_DASHES }}
                  />
                )}

                {/* Chip sits on the rail and masks it, which reads as a stop on the route.
                    The outer span springs in on scroll; the inner one carries the CSS
                    hover spring so the two transforms never fight. */}
                <motion.span
                  initial={{ scale: reduce ? 1 : 0.4, opacity: reduce ? 1 : 0 }}
                  whileInView={{ scale: 1, opacity: 1 }}
                  viewport={{ once: true, amount: 0.25 }}
                  transition={
                    reduce
                      ? { duration: 0 }
                      : { type: 'spring', stiffness: 320, damping: 22, delay: 0.12 + i * 0.18 }
                  }
                  className="relative z-10 block h-16 w-16"
                >
                  <span
                    className={`flex h-full w-full items-center justify-center rounded-2xl bg-primary text-white shadow-[0_14px_30px_-14px_rgba(5,150,105,0.8)] ring-1 ring-inset ring-white/20 ${
                      reduce ? '' : `transition-transform duration-500 ${SPRING_BEZIER} group-hover:scale-110`
                    }`}
                  >
                    <Icon size={26} strokeWidth={1.9} />
                  </span>
                </motion.span>

                <div
                  className={`relative mt-7 overflow-hidden rounded-3xl border border-border bg-white p-8 shadow-card transition-all duration-300 group-hover:border-primary/25 group-hover:shadow-[0_4px_10px_-4px_rgba(5,150,105,0.12),0_24px_48px_-18px_rgba(5,150,105,0.35)] ${
                    reduce ? '' : 'group-hover:-translate-y-1.5'
                  }`}
                >
                  <span
                    aria-hidden
                    className="pointer-events-none absolute right-5 top-3 select-none font-heading font-extrabold leading-none text-primary/10 transition-colors duration-300 group-hover:text-primary/25"
                    style={{ fontSize: 'clamp(3.48rem, 5.28vw, 4.785rem)', letterSpacing: '-0.05em' }}
                  >
                    {step.number}
                  </span>

                  <div className="relative z-10">
                    <h3
                      className="font-heading text-xl font-bold text-text-primary"
                      style={{ letterSpacing: '-0.025em' }}
                    >
                      {step.title}
                    </h3>
                    <p className="mt-3 text-[16px] leading-relaxed text-text-secondary">
                      {step.description}
                    </p>
                  </div>
                </div>
              </motion.li>
            )
          })}
        </ol>
      </div>
    </section>
  )
}
