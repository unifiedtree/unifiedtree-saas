import { useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, useScroll, useTransform, useReducedMotion } from 'framer-motion'
import { ArrowRight } from 'lucide-react'
import { LandscapeScene } from '../visuals/LandscapeScene'
import { ModuleDashboard } from '../visuals/ModuleDashboard'

/**
 * Hero — a full-bleed emerald valley with the product sitting in it.
 *
 * The scene is layered SVG (see LandscapeScene) so it parallaxes properly and
 * costs nothing to load. The wordmark rises from behind the ridge as you
 * scroll, and the dashboard lifts out of the meadow — the "curtain" effect.
 */
export function HeroSection() {
  const navigate = useNavigate()
  const reduce = useReducedMotion()
  const ref = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] })

  // Copy drifts up and dims as the dashboard takes the stage.
  const copyY = useTransform(scrollYProgress, [0, 1], ['0%', reduce ? '0%' : '-40%'])
  const copyOpacity = useTransform(scrollYProgress, [0, 0.55], [1, reduce ? 1 : 0.15])
  const shellScale = useTransform(scrollYProgress, [0, 0.6], [1, reduce ? 1 : 1.04])

  return (
    <section
      ref={ref}
      className="relative flex min-h-screen flex-col items-center overflow-hidden pt-36 pb-0"
    >
      <LandscapeScene tone="dawn" wordmark="UnifiedTree" />
      {/* Blends the meadow into the next section instead of cutting it off.
          z-[5]: above the scene, below the product shell. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[5] h-44 bg-gradient-to-b from-transparent via-white/55 to-white" />

      {/* Copy */}
      <motion.div
        style={{ y: copyY, opacity: copyOpacity }}
        className="relative z-10 mx-auto w-full max-w-4xl px-4 text-center sm:px-6 lg:px-8"
      >
        <motion.span
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="mb-7 inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-4 py-1.5 text-[12.5px] font-semibold uppercase tracking-[0.14em] text-white/90 backdrop-blur-sm"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-[#A7F3D0]" />
          One platform · every department
        </motion.span>

        <motion.h1
          initial={{ opacity: 0, y: 26 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.75, ease: [0.16, 1, 0.3, 1] }}
          className="font-heading font-extrabold text-white"
          style={{ fontSize: 'clamp(2.393rem, 5.632vw, 4.785rem)', lineHeight: 1.02, letterSpacing: '-0.038em' }}
        >
          The operating system
          <br />
          for growing businesses
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 22 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.75, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
          className="mx-auto mt-7 max-w-3xl text-[15.5px] leading-relaxed text-white/85 sm:text-[17px]"
        >
          HR, attendance, payroll, accounting, inventory and CRM on one connected core.
          Activate only what you need — it all shares the same data, the same day.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.75, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
          className="mt-10 flex flex-wrap items-center justify-center gap-4"
        >
          <button
            onClick={() => navigate('/signup')}
            className="group inline-flex items-center gap-2 rounded-xl bg-white px-7 py-3.5 text-[15px] font-bold text-[#04503A] shadow-lg transition-all hover:gap-3 hover:bg-[#ECFDF5]"
          >
            Start free trial
            <ArrowRight size={17} className="transition-transform group-hover:translate-x-0.5" />
          </button>
          <button
            onClick={() => navigate('/talk-to-us?intent=demo')}
            className="rounded-xl border border-white/40 bg-white/10 px-7 py-3.5 text-[15px] font-bold text-white backdrop-blur-sm transition-all hover:bg-white/20"
          >
            Book a demo
          </button>
        </motion.div>
      </motion.div>

      {/* Product, sitting in the valley */}
      <motion.div
        style={{ scale: shellScale }}
        initial={{ opacity: 0, y: 60 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.9, delay: 0.32, ease: [0.16, 1, 0.3, 1] }}
        className="relative z-10 mt-16 w-full max-w-4xl px-4 sm:px-8"
      >
        <ModuleDashboard className="rounded-b-none" />
      </motion.div>
    </section>
  )
}
