import { useEffect, useRef, useState } from 'react'
import { motion, useInView, useReducedMotion } from 'framer-motion'
import { LandscapeScene } from '../visuals/LandscapeScene'

/**
 * The proof band — a deep dusk valley with the numbers standing in it.
 *
 * Counts ramp on a requestAnimationFrame easing rather than a fixed-interval
 * timer, so the ramp stays smooth on slow frames and lands exactly on target.
 * Under reduced motion the final value is set immediately.
 */

interface StatItem {
  value: number
  suffix: string
  label: string
}

const stats: StatItem[] = [
  { value: 2400, suffix: '+', label: 'Businesses' },
  { value: 40, suffix: '+', label: 'Countries' },
  { value: 12, suffix: '', label: 'Core Modules' },
  { value: 99.9, suffix: '%', label: 'Uptime SLA' },
]

const EASE = [0.16, 1, 0.3, 1] as const

function useCountUp(target: number, duration: number, triggered: boolean) {
  const reduce = useReducedMotion()
  const [count, setCount] = useState(0)

  useEffect(() => {
    if (!triggered) return

    if (reduce) {
      setCount(target)
      return
    }

    let frame = 0
    let startedAt: number | null = null
    // Ease-out cubic: quick off the mark, settles gently on the final figure.
    const ease = (t: number) => 1 - Math.pow(1 - t, 3)

    const tick = (now: number) => {
      if (startedAt === null) startedAt = now
      const progress = Math.min((now - startedAt) / duration, 1)
      setCount(target * ease(progress))
      if (progress < 1) frame = requestAnimationFrame(tick)
    }

    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [triggered, target, duration, reduce])

  return count
}

function StatCounter({
  value,
  suffix,
  label,
  triggered,
  index,
}: StatItem & { triggered: boolean; index: number }) {
  const reduce = useReducedMotion()
  const count = useCountUp(value, 2000, triggered)
  const display = value % 1 !== 0 ? count.toFixed(1) : Math.floor(count).toLocaleString('en-IN')

  return (
    <motion.div
      initial={{ opacity: 0, y: reduce ? 0 : 24 }}
      animate={triggered ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.6, delay: reduce ? 0 : index * 0.08, ease: EASE }}
      className="px-4 text-center sm:px-8"
    >
      <p
        className="font-heading font-extrabold tabular-nums text-white"
        style={{ fontSize: 'clamp(2.5rem, 4vw, 4rem)', lineHeight: 1.02, letterSpacing: '-0.035em' }}
      >
        {display}
        <span className="text-lime">{suffix}</span>
      </p>
      <p className="mt-3 text-[12.5px] font-semibold uppercase tracking-[0.14em] text-white/60">
        {label}
      </p>
    </motion.div>
  )
}

export function StatsSection() {
  const ref = useRef<HTMLDivElement>(null)
  const reduce = useReducedMotion()
  const inView = useInView(ref, { once: true, amount: 0.4 })

  return (
    <section ref={ref} className="relative overflow-hidden bg-[#04503A] py-24 lg:py-28">
      <LandscapeScene tone="dusk" />
      {/* Keeps the numbers off the brighter part of the horizon. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[#022C22]/45" />

      <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: reduce ? 0 : 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, ease: EASE }}
          className="mb-14 text-center lg:mb-16"
        >
          <span className="text-[12.5px] font-semibold uppercase tracking-[0.14em] text-white/70">
            The numbers so far
          </span>
          <h2
            className="mx-auto mt-4 max-w-2xl font-heading font-extrabold text-white"
            style={{ fontSize: 'clamp(1.75rem, 3vw, 2.75rem)', lineHeight: 1.08, letterSpacing: '-0.035em' }}
          >
            Built for teams that outgrew spreadsheets
          </h2>
        </motion.div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-12 sm:gap-x-8 lg:grid-cols-4 lg:gap-x-0 lg:divide-x lg:divide-white/15">
          {stats.map((stat, i) => (
            <StatCounter key={stat.label} {...stat} triggered={inView} index={i} />
          ))}
        </div>
      </div>
    </section>
  )
}
