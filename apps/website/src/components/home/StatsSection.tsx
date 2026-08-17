import { useRef } from 'react'
import { motion, useInView, useReducedMotion } from 'framer-motion'

/**
 * The proof band — honest launch-mode copy on the deep emerald surface.
 *
 * Replaced the fabricated "2,400+ businesses / 40+ countries" band on
 * 2026-08-17 (audit CRIT #5): the numbers were not real and constituted a
 * misleading advertisement under India CPA §2(28). This version says what
 * is true: we're an India-first HR platform live with pilot customers.
 *
 * Background is the shared `surface-deep` field plus a fine film grain: soft
 * colour, no linework. A vignette on top pulls the corners down so the copy
 * sits forward and white type keeps its contrast.
 */

interface PillarItem {
  headline: string
  detail: string
}

const pillars: PillarItem[] = [
  {
    headline: 'Built by an India-first HR team',
    detail: 'GST, PF, ESI, TDS and shift-based attendance in the core — not an afterthought.',
  },
  {
    headline: 'Live with pilot customers',
    detail: 'Onboarding real teams today on HR, Payroll and mobile attendance.',
  },
  {
    headline: 'One connected core',
    detail: 'People, ledger, stock and customers share the same records from day one.',
  },
  {
    headline: 'Offline-first mobile',
    detail: 'Face-verified attendance keeps working when the signal drops, and syncs on return.',
  },
]

const EASE = [0.16, 1, 0.3, 1] as const

/** Soft vignette — pulls the corners down so the copy sits forward. */
const VIGNETTE: React.CSSProperties = {
  background:
    'radial-gradient(112% 84% at 50% 44%, rgba(2,44,34,0) 38%, rgba(2,44,34,0.52) 100%)',
}

function PillarCard({
  headline,
  detail,
  triggered,
  index,
}: PillarItem & { triggered: boolean; index: number }) {
  const reduce = useReducedMotion()

  return (
    <motion.div
      initial={{ opacity: 0, y: reduce ? 0 : 24 }}
      animate={triggered ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.6, delay: reduce ? 0 : index * 0.08, ease: EASE }}
      className="px-4 text-center sm:px-8"
    >
      <p
        className="font-heading font-extrabold text-white"
        style={{ fontSize: 'clamp(1.05rem, 1.4vw, 1.35rem)', lineHeight: 1.15, letterSpacing: '-0.02em' }}
      >
        {headline}
      </p>
      <p className="mt-3 text-[13.5px] leading-relaxed text-white/70">
        {detail}
      </p>
    </motion.div>
  )
}

export function StatsSection() {
  const ref = useRef<HTMLDivElement>(null)
  const reduce = useReducedMotion()
  const inView = useInView(ref, { once: true, amount: 0.4 })

  return (
    <section ref={ref} className="surface-deep relative overflow-hidden py-24 lg:py-28">
      <div aria-hidden className="pointer-events-none absolute inset-0" style={VIGNETTE} />
      <span aria-hidden className="grain grain-dark" />

      <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: reduce ? 0 : 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, ease: EASE }}
          className="mb-14 text-center lg:mb-16"
        >
          <span className="text-[12.5px] font-semibold uppercase tracking-[0.14em] text-white/70">
            Where we are today
          </span>
          <h2
            className="mx-auto mt-4 max-w-2xl font-heading font-extrabold text-white"
            style={{ fontSize: 'clamp(1.522rem, 2.64vw, 2.393rem)', lineHeight: 1.08, letterSpacing: '-0.035em' }}
          >
            Built for teams that outgrew spreadsheets
          </h2>
        </motion.div>

        <div className="grid grid-cols-1 gap-x-4 gap-y-12 sm:grid-cols-2 sm:gap-x-8 lg:grid-cols-4 lg:gap-x-0 lg:divide-x lg:divide-white/15">
          {pillars.map((p, i) => (
            <PillarCard key={p.headline} {...p} triggered={inView} index={i} />
          ))}
        </div>
      </div>
    </section>
  )
}
