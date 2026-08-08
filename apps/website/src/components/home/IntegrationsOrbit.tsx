import { motion, useReducedMotion } from 'framer-motion'
import { LandscapeScene } from '../visuals/LandscapeScene'

/**
 * Integrations, told as an orbit rather than a logo wall.
 *
 * The UnifiedTree emblem sits glowing in a dusk valley and everything a
 * customer already runs circles it — which is the actual argument: we are the
 * centre the rest of the stack reports into, not another island.
 *
 * We have no licensed logo artwork, so each partner is a white disc carrying
 * its initials in a restrained brand-ish tint. Discs stay white so the section
 * reads as emerald + neutral, exactly like the rest of the site.
 */

interface Integration {
  /** Full product name — surfaced as a tooltip and to screen readers. */
  name: string
  /** Two-letter mark shown inside the disc. */
  mark: string
  /** Ink colour for the mark. Neutral / semantic hues only — never purple. */
  tint: string
}

const INTEGRATIONS: Integration[] = [
  { name: 'Tally', mark: 'TA', tint: '#1E40AF' },
  { name: 'Razorpay', mark: 'RP', tint: '#0C6BD6' },
  { name: 'WhatsApp Business', mark: 'WA', tint: '#128C4A' },
  { name: 'Gmail', mark: 'GM', tint: '#C5221F' },
  { name: 'Shopify', mark: 'SH', tint: '#5A8F29' },
  { name: 'Zoho', mark: 'ZO', tint: '#C8202D' },
  { name: 'Slack', mark: 'SL', tint: '#3F3F46' },
  { name: 'Google Sheets', mark: 'GS', tint: '#0F8A5F' },
  { name: 'Stripe', mark: 'ST', tint: '#2E3A59' },
  { name: 'QuickBooks', mark: 'QB', tint: '#1F7A34' },
  { name: 'Zapier', mark: 'ZP', tint: '#D9541E' },
  { name: 'Salesforce', mark: 'SF', tint: '#0176D3' },
]

/** Seconds for one full revolution — deliberately slow enough to feel ambient. */
const ORBIT_SECONDS = 60

/** Ring radius as a % of the (square) orbit box, measured from its centre. */
const RADIUS = 41

/**
 * The white disc. Kept transform-free at this level so the counter-rotation
 * wrapper above it owns `rotate` and this element owns only the hover lift.
 */
function LogoDisc({ item }: { item: Integration }) {
  return (
    <div
      title={item.name}
      className="flex h-14 w-14 items-center justify-center rounded-full bg-white shadow-lg ring-1 ring-black/5 transition-transform duration-300 hover:scale-110 lg:h-[68px] lg:w-[68px]"
    >
      <span
        aria-hidden
        className="font-heading text-[15px] font-extrabold lg:text-[17px]"
        style={{ color: item.tint, letterSpacing: '-0.02em' }}
      >
        {item.mark}
      </span>
      <span className="sr-only">{item.name}</span>
    </div>
  )
}

/** The glowing centre: soft bloom, gradient sphere, inverted wordmark logo. */
function Emblem({ float }: { float: boolean }) {
  return (
    <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
      <motion.div
        animate={float ? { y: [0, -12, 0] } : undefined}
        transition={float ? { duration: 6.5, repeat: Infinity, ease: 'easeInOut' } : undefined}
        className="relative"
      >
        {/* Outer bloom */}
        <div
          aria-hidden
          className="absolute left-1/2 top-1/2 h-[260px] w-[260px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#10B981]/40 blur-[64px]"
        />
        <div
          aria-hidden
          className="absolute left-1/2 top-1/2 h-[180px] w-[180px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#A7F3D0]/25 blur-[34px]"
        />
        <div
          className="relative flex h-[150px] w-[150px] items-center justify-center rounded-full ring-1 ring-white/30"
          style={{
            background:
              'radial-gradient(circle at 34% 28%, #6EE7B7 0%, #10B981 34%, #059669 62%, #04503A 100%)',
            boxShadow: '0 24px 60px -18px rgba(4,80,58,0.85), inset 0 -12px 28px rgba(2,44,34,0.45)',
          }}
        >
          <img
            src="/UnifiedTreeLogo.png"
            alt="UnifiedTree"
            className="h-[72px] w-auto brightness-0 invert drop-shadow-md"
          />
        </div>
      </motion.div>
    </div>
  )
}

export function IntegrationsOrbit() {
  const reduce = useReducedMotion()

  // One shared linear loop drives the ring; every disc runs the exact inverse
  // so its initials never tip over. Both are suppressed for reduced motion.
  const spin = reduce ? undefined : { rotate: 360 }
  const counterSpin = reduce ? undefined : { rotate: -360 }
  const spinTransition = reduce
    ? undefined
    : { duration: ORBIT_SECONDS, repeat: Infinity, ease: 'linear' as const }

  return (
    <section className="relative overflow-hidden py-24 sm:py-28 lg:py-32">
      <LandscapeScene tone="dusk" />

      {/* Vignette — pulls focus to the emblem and keeps the copy legible over
          whichever ridge happens to sit behind it. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(60% 55% at 50% 62%, rgba(2,44,34,0) 0%, rgba(2,44,34,0.55) 100%)',
        }}
      />

      <div className="relative z-10 mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* ── Copy ─────────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 26 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.2 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="mx-auto max-w-3xl text-center"
        >
          <span className="text-[12.5px] font-semibold uppercase tracking-[0.14em] text-lime">
            Integrations
          </span>
          <h2
            className="mt-4 font-heading font-extrabold text-white"
            style={{ fontSize: 'clamp(2rem, 4vw, 3.5rem)', lineHeight: 1.04, letterSpacing: '-0.035em' }}
          >
            Works with the tools you already run
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-[17px] leading-relaxed text-white/75 sm:text-[19px]">
            Payments, accounting, messaging, storage and spreadsheets — 100+ integrations
            keep data flowing both ways, so UnifiedTree becomes the centre of your stack
            instead of one more place to update.
          </p>
        </motion.div>

        {/* ── Orbit (sm and up) ────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, scale: 0.94 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true, amount: 0.2 }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          className="relative mx-auto mt-14 hidden aspect-square w-full max-w-[620px] sm:block"
        >
          {/* Decorative orbit paths */}
          <div
            aria-hidden
            className="absolute rounded-full border border-dashed border-white/15"
            style={{ inset: `${50 - RADIUS}%` }}
          />
          <div aria-hidden className="absolute inset-[30%] rounded-full border border-white/10" />

          <Emblem float={!reduce} />

          {/* The ring itself. Discs ride it; each one unwinds the rotation so
              the initials stay upright the whole way round. */}
          <motion.div
            className="absolute inset-0"
            animate={spin}
            transition={spinTransition}
          >
            {INTEGRATIONS.map((item, i) => {
              const angle = (i / INTEGRATIONS.length) * Math.PI * 2 - Math.PI / 2
              const left = 50 + RADIUS * Math.cos(angle)
              const top = 50 + RADIUS * Math.sin(angle)
              return (
                <div
                  key={item.name}
                  className="absolute -translate-x-1/2 -translate-y-1/2"
                  style={{ left: `${left}%`, top: `${top}%` }}
                >
                  <motion.div animate={counterSpin} transition={spinTransition}>
                    <LogoDisc item={item} />
                  </motion.div>
                </div>
              )
            })}
          </motion.div>
        </motion.div>

        {/* ── Mobile fallback: emblem + a plain grid, no rotation ── */}
        <div className="mt-12 sm:hidden">
          <div className="relative mx-auto h-[190px] w-full max-w-[280px]">
            <Emblem float={!reduce} />
          </div>
          <div className="mt-10 grid grid-cols-3 gap-x-4 gap-y-6">
            {INTEGRATIONS.map((item) => (
              <div key={item.name} className="flex flex-col items-center gap-2 text-center">
                <LogoDisc item={item} />
                <span className="text-[11px] font-medium leading-tight text-white/70">
                  {item.name}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Footnote chips ───────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.4 }}
          transition={{ duration: 0.6, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
          className="mt-14 flex flex-wrap items-center justify-center gap-3"
        >
          {['REST API', 'Webhooks', 'Two-way sync', 'SSO / SAML'].map((chip) => (
            <span
              key={chip}
              className="rounded-full border border-white/20 bg-white/10 px-4 py-1.5 text-[13px] font-semibold text-white/85 backdrop-blur-sm"
            >
              {chip}
            </span>
          ))}
        </motion.div>
      </div>
    </section>
  )
}
