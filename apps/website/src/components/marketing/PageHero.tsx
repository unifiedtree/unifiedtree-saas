import type { ReactNode } from 'react'
import { motion, useReducedMotion } from 'framer-motion'

/**
 * PageHero — the opening band shared by every secondary page.
 *
 * Deliberately NOT scenery. There is no horizon, no ridge, no sky and no ghost
 * wordmark: the band is a deep emerald *surface* — wide soft light fields, a
 * vignette that seats the type, a fine film grain, and a thin emerald hairline
 * where it meets the page below. No ruled grid: depth comes from colour and
 * grain, which reads richer at scale and never moirés on a scaled display.
 */

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1]

/** Soft radial vignette: lift under the type, darkness at the corners. */
const VIGNETTE =
  'radial-gradient(105% 72% at 50% 8%, rgba(167,243,208,0.14), transparent 62%),' +
  'radial-gradient(120% 110% at 50% 46%, transparent 38%, rgba(2,40,30,0.55) 100%)'

/**
 * The reusable dark-band treatment: soft vignette + film grain, no linework.
 * Drop it inside any `relative overflow-hidden` emerald container (a
 * `surface-deep` section, or one carrying its own gradient) and keep the
 * content on `relative z-10`.
 */
export function EngineeredField({ className = '' }: { className?: string }) {
  return (
    <div aria-hidden className={`pointer-events-none absolute inset-0 ${className}`}>
      <div className="absolute inset-0" style={{ background: VIGNETTE }} />
      <span className="grain grain-dark" />
    </div>
  )
}

/**
 * The label above a hero heading.
 *
 * Previously a bordered chip with a dot and a backdrop blur — the single most
 * generic marketing component there is, and it read as placeholder rather than
 * design. It is now a typographic mark: wide-tracked mint caps between two
 * hairlines, which suits a centred band and looks deliberate.
 *
 * The backdrop-blur went with it, and that was not only cosmetic. Backdrop
 * filters force the compositor to re-sample everything behind them on every
 * frame; removing them measured as the single biggest scroll-jank win on the
 * home page (p95 24.6ms -> 18.3ms).
 */
export function Eyebrow({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-3 text-[11.5px] font-semibold uppercase tracking-[0.24em] text-lime ${className}`}
    >
      <span aria-hidden className="h-px w-7 bg-lime/45" />
      {children}
      <span aria-hidden className="h-px w-7 bg-lime/45" />
    </span>
  )
}

/** A one-pixel emerald rule, brightest in the middle — the band's bottom edge. */
export function EmeraldHairline({ className = '' }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-x-0 bottom-0 h-px ${className}`}
      style={{
        background:
          'linear-gradient(90deg, rgba(167,243,208,0) 0%, rgba(167,243,208,0.55) 50%, rgba(167,243,208,0) 100%)',
      }}
    />
  )
}

export interface PageHeroProps {
  /** Small uppercase chip above the heading. */
  eyebrow: ReactNode
  /** Display heading — accepts nodes so pages can keep their line breaks. */
  title: ReactNode
  /** Supporting paragraph under the heading. */
  lede: ReactNode
  /** Optional row of chips, stats or links below the lede. */
  children?: ReactNode
}

export function PageHero({ eyebrow, title, lede, children }: PageHeroProps) {
  const reduce = useReducedMotion()

  return (
    <section className="surface-deep relative overflow-hidden pb-24 pt-36 lg:pb-28 lg:pt-40">
      <EngineeredField />
      <EmeraldHairline />

      <div className="relative z-10 mx-auto max-w-5xl px-4 text-center sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: reduce ? 0 : 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="mb-7"
        >
          <Eyebrow>{eyebrow}</Eyebrow>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: reduce ? 0 : 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.75, ease: EASE }}
          className="font-heading font-bold text-white"
          style={{ fontSize: 'clamp(2.175rem, 4.752vw, 3.915rem)', lineHeight: 1.04, letterSpacing: '-0.035em' }}
        >
          {title}
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: reduce ? 0 : 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.75, delay: 0.1, ease: EASE }}
          className="mx-auto mt-7 max-w-2xl text-[15.5px] leading-relaxed text-white/85 sm:text-[17px]"
        >
          {lede}
        </motion.p>

        {children && (
          <motion.div
            initial={{ opacity: 0, y: reduce ? 0 : 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.75, delay: 0.18, ease: EASE }}
            className="mt-10"
          >
            {children}
          </motion.div>
        )}
      </div>
    </section>
  )
}
