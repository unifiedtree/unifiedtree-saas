import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion, useScroll, useTransform, useReducedMotion } from 'framer-motion'
import { ArrowRight } from 'lucide-react'
import { LandscapeScene } from '../visuals/LandscapeScene'
import { ModuleDashboard } from '../visuals/ModuleDashboard'
import { Eyebrow } from '../marketing/PageHero'
import { useCtaMode } from '../../hooks/useCtaMode'

/**
 * The closing phrase of the headline cycles so the hero demonstrates breadth —
 * the same core, five very different businesses. Order is deliberate: the
 * generic promise first, then progressively more specific proof.
 */
const HERO_PHRASES = [
  'growing businesses',
  'busy factories',
  'retail chains',
  'finance teams',
  'field operations',
] as const

/** The widest phrase — rendered invisibly to reserve the slot so the line never reflows. */
const WIDEST_PHRASE = HERO_PHRASES.reduce((a, b) => (b.length > a.length ? b : a))

const PHRASE_MS = 2600

/**
 * Hero — a full-bleed emerald valley with the product sitting in it.
 *
 * The scene is layered SVG (see LandscapeScene) so it parallaxes properly and
 * costs nothing to load. The wordmark rises from behind the ridge as you
 * scroll, and the dashboard lifts out of the meadow — the "curtain" effect.
 */
export function HeroSection() {
  const navigate = useNavigate()
  /* One source of truth for where "start free trial" goes — the same hook the
     header CTA uses, so the two can never diverge again.
     Also gives us `mode` + `ready` so the button label doesn't flash "Start
     free trial" for a beat when a signed-in user with workspaces reloads the
     home page. */
  const { mode: ctaMode, href: ctaHref, ready: ctaReady } = useCtaMode()
  const ctaLabel = ctaMode === 'trial' ? 'Start free trial' : 'Open your workspace'
  const reduce = useReducedMotion()
  const ref = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] })

  // Rotating headline phrase. Held still entirely when motion is reduced.
  const [phraseIndex, setPhraseIndex] = useState(0)
  useEffect(() => {
    if (reduce) return
    const id = window.setInterval(
      () => setPhraseIndex((i) => (i + 1) % HERO_PHRASES.length),
      PHRASE_MS,
    )
    return () => window.clearInterval(id)
  }, [reduce])
  const phrase = HERO_PHRASES[reduce ? 0 : phraseIndex]

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
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="mb-7"
        >
          <Eyebrow>One platform · every department</Eyebrow>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 26 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.75, ease: [0.16, 1, 0.3, 1] }}
          /* flow-root keeps the slot's negative margins inside the heading —
             left to collapse, the bottom one steals space from the paragraph. */
          className="flow-root font-heading font-extrabold text-white"
          style={{ fontSize: 'clamp(2.393rem, 5.632vw, 4.785rem)', lineHeight: 1.02, letterSpacing: '-0.038em' }}
        >
          {/* nbsp keeps "for" tied to "system" so it never orphans on a line of
              its own when the heading wraps on small screens. */}
          The operating system&nbsp;for
          {/* The rotating phrase takes the second line on its own so the reserved
              width stays invisible — an invisible copy of the longest phrase sizes
              the slot, the live phrase is centred inside it, and nothing on the page
              moves as the words swap. overflow-hidden masks the travel; the em
              padding/negative-margin pair buys descender room back without shifting
              the line. */}
          <span
            aria-live="polite"
            className="mx-auto grid w-fit max-w-full overflow-hidden text-[#A7F3D0]"
            style={{
              paddingTop: '0.16em',
              paddingBottom: '0.22em',
              marginTop: '-0.16em',
              marginBottom: '-0.22em',
            }}
          >
            <span aria-hidden className="invisible col-start-1 row-start-1">
              {WIDEST_PHRASE}
            </span>
            {reduce ? (
              <span className="col-start-1 row-start-1">{phrase}</span>
            ) : (
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={phrase}
                  className="col-start-1 row-start-1"
                  /* No animated blur here. It looked good but re-rasterises the
                     display type on every frame of every swap, and this loops
                     for as long as the hero is on screen — a permanent cost on
                     the heaviest-painting part of the page. Opacity and travel
                     carry the same gesture and composite on the GPU. */
                  initial={{ opacity: 0, y: '55%' }}
                  animate={{ opacity: 1, y: '0%' }}
                  exit={{ opacity: 0, y: '-55%' }}
                  transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
                >
                  {phrase}
                </motion.span>
              </AnimatePresence>
            )}
          </span>
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
          {/* Both CTAs carry the same 1.5px border box, padding and radius so the
              pair sits on one optical baseline — the primary's border is white on
              white, present only to match the secondary's height exactly. */}
          {ctaReady ? (
            <button
              /* Route through the same rule the header uses. Hardcoding
                 "/signup" dropped the ?mode= param, which landed the visitor on a
                 different form state than every other CTA on the site.
                 `ctaReady` gates the render so a signed-in user with
                 workspaces never sees "Start free trial" flash for a
                 beat before flipping to "Open your workspace". */
              onClick={() => navigate(ctaHref)}
              className="group inline-flex items-center gap-2 rounded-xl border-[1.5px] border-white bg-white px-7 py-3.5 text-[15px] font-bold text-[#04503A] shadow-lg transition-all duration-200 hover:-translate-y-0.5 hover:gap-3 hover:bg-[#ECFDF5] hover:shadow-[0_16px_32px_-14px_rgba(0,0,0,0.55)] active:translate-y-0"
            >
              {ctaLabel}
              <ArrowRight size={17} className="transition-transform group-hover:translate-x-0.5" />
            </button>
          ) : (
            // Skeleton keeps the layout stable while useCtaMode resolves
            // the signed-in user's workspace list on hard-refresh.
            <div
              aria-hidden
              className="inline-block h-[52px] w-56 rounded-xl bg-white/40 animate-pulse"
            />
          )}
          {/* Secondary CTA — solid deep-emerald fill with a crisp white border so
              it reads on the vivid band, while the white primary stays dominant.
              Hover deepens the fill and brightens the rim: it gains presence, it
              never drifts toward white (that washed the label out). */}
          <button
            onClick={() => navigate('/talk-to-us?intent=demo')}
            className="rounded-xl border-[1.5px] border-white/70 bg-[#04503A] px-7 py-3.5 text-[15px] font-bold text-white shadow-lg transition-all duration-200 hover:-translate-y-0.5 hover:border-white hover:bg-[#033B2A] hover:shadow-[0_0_0_4px_rgba(255,255,255,0.16),0_16px_32px_-14px_rgba(0,0,0,0.55)] active:translate-y-0"
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
