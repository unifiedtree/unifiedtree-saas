import { useRef } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { CheckCircle2, XCircle } from 'lucide-react'

/**
 * "The gap in business software" — the section that has to make a visitor feel
 * the difference rather than read about it.
 *
 * Design intent: two cards facing off across a seam, not a table. The old way
 * is deliberately drained and inset — flat grey ground, no shadow, shorter than
 * its neighbour. Ours is white, emerald-edged and taller, so it overhangs the
 * other card top and bottom. The contrast does the arguing; a single VS badge
 * sits on the seam to name the comparison.
 *
 * Density: the cards carry five short lines each, so they are sized to their
 * content — narrower measure, tighter padding, hairline-separated rows. The
 * overhang now comes from the right card genuinely holding more (a proof strip
 * under its list), not from leftover empty space, and the left card is
 * self-centred so it is never stretched into dead air.
 */

/** The five frictions a buyer lives with today, and their answer. */
const OLD_WAY = [
  'Scattered tools',
  'Manual reconciling',
  'Six-month rollout',
  'Breaks when offline',
  'Pay for the whole suite',
] as const

const OUR_WAY = [
  'One source of truth',
  'Books close themselves',
  'Live the same day',
  'Works offline',
  'Pay per module',
] as const

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1]

export function WhyDifferent() {
  const reduce = useReducedMotion()
  const ref = useRef<HTMLDivElement>(null)

  return (
    <section className="surface-soft relative overflow-hidden py-16 lg:py-20">
      <span aria-hidden className="grain" />
      {/* A soft warm field under the right-hand card — the winning side is lit,
          felt before a word is read. Colour only, no linework. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(52% 54% at 82% 62%, rgba(16,185,129,0.13), transparent 72%)',
        }}
      />

      <div ref={ref} className="relative z-10 mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
        {/* ── Header, left-aligned ───────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: reduce ? 0 : 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.2 }}
          transition={{ duration: 0.6, ease: EASE }}
        >
          <span className="font-mono text-[10.5px] font-medium uppercase tracking-[0.2em] text-text-tertiary sm:text-[11px]">
            The gap in business software
          </span>
          <h2
            className="mt-4 max-w-[52rem] font-heading font-bold text-text-primary"
            style={{
              fontSize: 'clamp(1.75rem, 3.3vw, 2.75rem)',
              lineHeight: 1.06,
              letterSpacing: '-0.032em',
            }}
          >
            Running software is not the same
            <br />
            <span className="text-primary">as running your business.</span>
          </h2>
        </motion.div>

        {/* ── The face-off ───────────────────────────────────────── */}
        <div className="relative mt-9 grid grid-cols-1 gap-4 md:mt-10 md:grid-cols-2 md:gap-8 lg:gap-10">
          {/* ── Left: the old way. Flat, drained, inert — and sized to
                 its own content, so it never stretches into dead space. ── */}
          <motion.div
            initial={{ opacity: 0, y: reduce ? 0 : 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.2 }}
            transition={{ duration: 0.6, ease: EASE }}
            className="rounded-[22px] border border-border bg-surface-2 p-6 shadow-none md:self-center"
          >
            <h3 className="font-heading text-[19px] font-bold leading-tight tracking-[-0.02em] text-text-tertiary">
              The Old Way
            </h3>
            <p className="mt-2.5 text-[14px] leading-[1.6] text-text-tertiary sm:text-[14.5px]">
              Five systems that were never designed to meet. You buy tools, then spend the month
              making them agree.
            </p>

            <ul className="mt-4 divide-y divide-border/70 border-t border-border/70">
              {OLD_WAY.map((label, i) => (
                <motion.li
                  key={label}
                  initial={{ opacity: 0, y: reduce ? 0 : 12 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, amount: 0.4 }}
                  transition={{ duration: 0.45, delay: reduce ? 0 : 0.1 + i * 0.06, ease: EASE }}
                  className="flex items-center gap-2.5 py-2"
                >
                  <span aria-hidden className="flex h-5 w-5 shrink-0 items-center justify-center">
                    <XCircle size={16} strokeWidth={1.75} className="text-[#A3A3A3]" />
                  </span>
                  <span className="text-[14px] leading-snug text-text-tertiary sm:text-[14.5px]">
                    {label}
                  </span>
                </motion.li>
              ))}
            </ul>
          </motion.div>

          {/* ── The seam badge (desktop) ─────────────────────────── */}
          <span
            aria-hidden
            className="absolute left-1/2 top-1/2 z-20 hidden h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-surface text-[11.5px] font-bold uppercase tracking-[0.08em] text-text-tertiary shadow-card md:flex"
          >
            VS
          </span>

          {/* ── The seam chip (mobile, cards stack) ──────────────── */}
          <div aria-hidden className="flex items-center justify-center md:hidden">
            <span className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-surface text-[11px] font-bold uppercase tracking-[0.08em] text-text-tertiary shadow-card">
              VS
            </span>
          </div>

          {/* ── Right: ours. Elevated, taller, lifts on hover. ───── */}
          <motion.div
            initial={{ opacity: 0, y: reduce ? 0 : 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.2 }}
            transition={{ duration: 0.6, delay: reduce ? 0 : 0.08, ease: EASE }}
            whileHover={reduce ? undefined : { y: -6, transition: { duration: 0.35, ease: EASE } }}
            className="group rounded-[22px] border border-primary/20 bg-surface p-6 shadow-[0_1px_2px_0_rgba(5,150,105,0.06),0_22px_46px_-20px_rgba(5,150,105,0.30)] transition-shadow duration-300 hover:shadow-[0_2px_4px_0_rgba(5,150,105,0.08),0_30px_58px_-22px_rgba(5,150,105,0.40)] sm:p-7"
          >
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
              <h3 className="font-heading text-[19px] font-bold leading-tight tracking-[-0.02em] text-primary">
                UnifiedTree
              </h3>
              <span className="rounded-full bg-primary-light px-2 py-[3px] text-[10px] font-bold uppercase tracking-[0.14em] text-primary">
                Smarter
              </span>
            </div>
            <p className="mt-2.5 text-[14px] leading-[1.6] text-text-secondary sm:text-[14.5px]">
              One connected core. Every module writes to the same record, so the numbers agree the
              first time you look at them.
            </p>

            <ul className="mt-4 divide-y divide-primary/10 border-t border-primary/10">
              {OUR_WAY.map((label, i) => (
                <motion.li
                  key={label}
                  initial={{ opacity: 0, y: reduce ? 0 : 12 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, amount: 0.4 }}
                  transition={{ duration: 0.45, delay: reduce ? 0 : 0.18 + i * 0.06, ease: EASE }}
                  className="flex items-center gap-2.5 py-2"
                >
                  <span aria-hidden className="flex h-5 w-5 shrink-0 items-center justify-center">
                    <CheckCircle2
                      size={18}
                      strokeWidth={2.25}
                      className="text-primary transition-transform duration-300 group-hover:scale-110"
                    />
                  </span>
                  <span className="text-[14.5px] font-semibold leading-snug tracking-[-0.01em] text-text-primary sm:text-[15px]">
                    {label}
                  </span>
                </motion.li>
              ))}
            </ul>

            {/* One compact proof line, so the card closes on something
                concrete instead of trailing off after the last tick. */}
            <div className="mt-4 flex items-center gap-3 rounded-xl bg-primary-light px-3.5 py-2.5">
              <span className="font-heading text-[17px] font-bold leading-none text-primary">
                1 day
              </span>
              <span aria-hidden className="h-4 w-px shrink-0 bg-primary/20" />
              <span className="text-[12.5px] leading-snug text-text-secondary">
                Median go-live for a new workspace
              </span>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  )
}
