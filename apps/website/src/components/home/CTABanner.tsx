import { useNavigate } from 'react-router-dom'
import { motion, useReducedMotion } from 'framer-motion'
import { Button } from '../ui/Button'
import { CtaButton } from '../common/CtaButton'
import { useCtaMode } from '../../hooks/useCtaMode'
import { LandscapeScene } from '../visuals/LandscapeScene'

/**
 * The closing band — the page ends where it started, inside the valley.
 *
 * The dusk landscape carries the wordmark rising from behind the ridge, so the
 * old greyscale leaf particles are gone: the scene does that work now. Both
 * CTAs keep their existing routing (useCtaMode drives the primary one); only
 * their skin changes to read on the dark backdrop.
 */
export function CTABanner() {
  const navigate = useNavigate()
  const { mode } = useCtaMode()
  const reduce = useReducedMotion()

  return (
    <section className="relative overflow-hidden bg-[#022C22] py-28 lg:py-36">
      <LandscapeScene tone="dusk" wordmark="UnifiedTree" />

      {/* Scrim — guarantees the display type reads at every viewport height */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[#022C22]/75 via-transparent to-[#011E17]/55"
      />

      <div className="relative z-10 mx-auto max-w-4xl px-4 text-center sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: reduce ? 0 : 26 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.35 }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        >
          <span className="mb-7 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-1.5 text-[12.5px] font-semibold uppercase tracking-[0.14em] text-white/90 backdrop-blur-sm">
            <span className="h-1.5 w-1.5 rounded-full bg-lime" />
            {mode === 'trial' ? 'Start in minutes' : 'Add a workspace'}
          </span>

          <h2
            className="font-heading font-extrabold text-white"
            style={{ fontSize: 'clamp(2rem, 4.4vw, 3.75rem)', lineHeight: 1.04, letterSpacing: '-0.035em' }}
          >
            {mode === 'trial'
              ? 'Ready to grow your business like a tree?'
              : 'Ready to add another workspace?'}
          </h2>

          <p className="mx-auto mt-6 max-w-xl text-[17px] leading-relaxed text-white/80 sm:text-[19px]">
            {mode === 'trial'
              ? 'Join 2,400+ companies. Start free. No credit card required.'
              : 'Spin up a workspace for a new team or entity in minutes.'}
          </p>

          <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
            <CtaButton
              trialLabel="Start Free Trial"
              paidLabel="Create Workspace"
              className="!h-[52px] !bg-white !px-7 !text-[15px] !font-bold !text-[#04503A] shadow-lg transition-colors hover:!bg-[#ECFDF5]"
            />
            <Button
              size="lg"
              variant="ghost"
              onClick={() => navigate('/talk-to-us?intent=demo')}
              className="!rounded-xl !border-white/40 !bg-white/10 !font-bold !text-white backdrop-blur-sm hover:!border-white/60 hover:!bg-white/20"
            >
              Book a Demo
            </Button>
          </div>

          {mode === 'trial' && (
            <p className="mt-7 text-sm text-white/70">
              7-day free trial · Autopay activates on day 8 · Cancel anytime
            </p>
          )}
        </motion.div>
      </div>
    </section>
  )
}
