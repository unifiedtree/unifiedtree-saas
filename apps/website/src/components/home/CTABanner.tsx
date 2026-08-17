import { useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, useReducedMotion, useScroll, useTransform } from 'framer-motion'
import { Button } from '../ui/Button'
import { CtaButton } from '../common/CtaButton'
import { useCtaMode } from '../../hooks/useCtaMode'

/**
 * The closing band — the page ends on the same argument it opened with.
 *
 * BY CLIENT REQUEST this one band carries a stylised tree-line — an agreed
 * exemption from the no-scenery rule (the client explicitly asked for trees
 * here). Three depths of rounded-canopy silhouettes rise from the bottom edge
 * of the shared deep-emerald ground: a pale haze at the back, deepest emerald
 * in front, with a soft glow behind the headline and grain on top. No sun and
 * no sky horizon — just trees standing on the surface-deep field. The depths
 * drift apart gently on scroll (disabled under reduced motion).
 *
 * Both CTAs keep their existing routing (useCtaMode drives the primary one);
 * only their skin changes to read on the dark ground.
 */

type TreeSpec = {
  /** Base x in the 1440-wide scene */
  x: number
  /** Scale — height is roughly 87·s (v0) / 95·s (v1) scene units */
  s: number
  /** Canopy variant: 0 broad, 1 tall */
  v?: 0 | 1
}

// Silhouette positions, back → front. The centre of the front rank stays low
// so the tree-line never crowds the CTA row above it.
const TREES_BACK: TreeSpec[] = [
  { x: 36, s: 0.8 }, { x: 148, s: 1.0, v: 1 }, { x: 252, s: 0.72 },
  { x: 390, s: 0.95 }, { x: 505, s: 0.78, v: 1 }, { x: 625, s: 1.05 },
  { x: 748, s: 0.7 }, { x: 862, s: 0.98, v: 1 }, { x: 988, s: 0.8 },
  { x: 1108, s: 1.02 }, { x: 1232, s: 0.75, v: 1 }, { x: 1352, s: 0.95 },
  { x: 1436, s: 0.7 },
]
const TREES_MID: TreeSpec[] = [
  { x: 92, s: 1.28, v: 1 }, { x: 305, s: 1.1 }, { x: 452, s: 0.95, v: 1 },
  { x: 700, s: 1.05 }, { x: 935, s: 1.22, v: 1 }, { x: 1160, s: 1.08 },
  { x: 1385, s: 1.3 },
]
const TREES_FRONT: TreeSpec[] = [
  { x: 14, s: 1.85 }, { x: 218, s: 1.45, v: 1 }, { x: 560, s: 1.28 },
  { x: 905, s: 1.4, v: 1 }, { x: 1135, s: 1.6 }, { x: 1370, s: 1.9 },
]

/** One stylised tree: a short trunk under a cluster of rounded canopy blobs.
    Fill comes from the parent <g> so each depth is a single silhouette. */
function TreeShape({ x, s, v = 0 }: TreeSpec) {
  return (
    <g transform={`translate(${x} 260) scale(${s})`}>
      {v === 0 ? (
        <>
          <rect x="-2.5" y="-38" width="5" height="38" rx="2" />
          <circle cx="0" cy="-60" r="26" />
          <circle cx="-19" cy="-46" r="19" />
          <circle cx="19" cy="-46" r="19" />
          <circle cx="-9" cy="-72" r="15" />
          <circle cx="10" cy="-70" r="14" />
        </>
      ) : (
        <>
          <rect x="-2.5" y="-36" width="5" height="36" rx="2" />
          <circle cx="0" cy="-78" r="17" />
          <circle cx="0" cy="-58" r="22" />
          <circle cx="-14" cy="-44" r="16" />
          <circle cx="14" cy="-46" r="15" />
        </>
      )}
    </g>
  )
}

/** One depth of the tree-line. The ground strip under the trees bleeds past
    the viewBox so parallax never reveals a floating bottom edge. */
function TreeLayer({ trees, fill, opacity }: { trees: TreeSpec[]; fill: string; opacity: number }) {
  return (
    <svg
      viewBox="0 0 1440 300"
      preserveAspectRatio="xMidYMax slice"
      className="h-full w-full"
      aria-hidden
    >
      <g fill={fill} opacity={opacity}>
        {trees.map((t) => (
          <TreeShape key={t.x} {...t} />
        ))}
        <rect x="-60" y="256" width="1560" height="64" />
      </g>
    </svg>
  )
}

export function CTABanner() {
  const navigate = useNavigate()
  const { mode } = useCtaMode()
  const reduce = useReducedMotion()

  // Gentle parallax between the depths — back drifts least, front most,
  // matching the ordering the hero's LandscapeScene uses.
  const ref = useRef<HTMLElement>(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] })
  const yBack = useTransform(scrollYProgress, [0, 1], reduce ? [0, 0] : [6, -3])
  const yMid = useTransform(scrollYProgress, [0, 1], reduce ? [0, 0] : [14, -7])
  const yFront = useTransform(scrollYProgress, [0, 1], reduce ? [0, 0] : [22, -11])

  return (
    <section ref={ref} className="surface-deep relative overflow-hidden pt-28 pb-44 lg:pt-36 lg:pb-52">
      {/* Soft light fields: a warm lift from the top, a glow behind the
          headline, and a low backlight that the front silhouettes cut into. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(72% 58% at 50% -12%, rgba(52,211,153,0.22), transparent 68%), radial-gradient(52% 40% at 50% 26%, rgba(52,211,153,0.24), transparent 70%), radial-gradient(70% 32% at 50% 100%, rgba(52,211,153,0.20), transparent 70%)',
        }}
      />

      {/* The tree-line, back → front (client-requested — see note above) */}
      <div aria-hidden className="pointer-events-none absolute inset-0 select-none">
        <motion.div style={{ y: yBack }} className="absolute inset-x-0 bottom-[-20px] h-[300px]">
          <TreeLayer trees={TREES_BACK} fill="#6EE7B7" opacity={0.2} />
        </motion.div>
        <motion.div style={{ y: yMid }} className="absolute inset-x-0 bottom-[-20px] h-[300px]">
          <TreeLayer trees={TREES_MID} fill="#059669" opacity={0.42} />
        </motion.div>
        <motion.div style={{ y: yFront }} className="absolute inset-x-0 bottom-[-20px] h-[300px]">
          <TreeLayer trees={TREES_FRONT} fill="#02231A" opacity={0.92} />
        </motion.div>
      </div>

      {/* Grain sits on top of the scene */}
      <span aria-hidden className="grain grain-dark" />
      {/* Hairline rule — closes the band off from the section above */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/10" />

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
            style={{ fontSize: 'clamp(1.74rem, 3.872vw, 3.263rem)', lineHeight: 1.04, letterSpacing: '-0.035em' }}
          >
            {mode === 'trial'
              ? 'Ready to grow your business like a tree?'
              : 'Ready to add another workspace?'}
          </h2>

          <p className="mx-auto mt-6 max-w-xl text-[15.5px] leading-relaxed text-white/85 sm:text-[17px]">
            {mode === 'trial'
              ? 'HR & Payroll live today. Start on a 7-day trial. Autopay is set up at signup via Razorpay; cancel any time before your trial ends.'
              : 'Spin up a workspace for a new team or entity in minutes.'}
          </p>

          <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
            <CtaButton
              trialLabel="Start Free Trial"
              paidLabel="Create Workspace"
              className="!h-[52px] !bg-white !px-7 !text-[15px] !font-bold !text-[#04503A] shadow-lg transition-colors hover:!bg-[#ECFDF5]"
            />
            {/* Secondary CTA — solid deep-emerald fill with a crisp white border
                so it reads on the dark band; the white primary stays dominant. */}
            <Button
              size="lg"
              variant="ghost"
              onClick={() => navigate('/talk-to-us?intent=demo')}
              className="!rounded-xl !border-[1.5px] !border-white !bg-[#04503A] !font-bold !text-white shadow-lg hover:!border-white hover:!bg-white/25"
            >
              Book a Demo
            </Button>
          </div>

          {mode === 'trial' && (
            <p className="mt-7 text-sm text-white/70">
              7-day free trial · Autopay set up at signup via Razorpay · Cancel anytime
            </p>
          )}
        </motion.div>
      </div>
    </section>
  )
}
