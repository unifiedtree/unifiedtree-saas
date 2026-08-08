import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { motion, LayoutGroup, useReducedMotion } from 'framer-motion'
import { ModuleDashboard, MODULE_VIEWS } from '../visuals/ModuleDashboard'

/**
 * StickyShowcase — the signature "sticky rail" section.
 *
 * On lg+ the left column pins while the right column scrolls a stack of
 * full-height product panels past it. Whichever panel owns the middle of the
 * viewport lights its row on the rail, and clicking a row scrolls its panel
 * back to centre. Below lg the rail disappears entirely and the panels simply
 * stack — each card already carries its own heading above its dashboard.
 *
 * Two deliberate implementation notes:
 *  - The panel backdrops are CSS gradients rather than <LandscapeScene />.
 *    LandscapeScene's SVG gradients use fixed element ids, so six instances on
 *    a page that already renders the dawn-toned hero scene would all resolve
 *    url(#ls-sky) to the *hero's* dawn gradient. Gradients keep the dusk look
 *    without the id collision.
 *  - Each ModuleDashboard is wrapped in a <LayoutGroup>, which namespaces the
 *    dashboard's internal layoutId="mdNavPill" per instance. Without it, six
 *    mounted dashboards would fight over one shared layout animation.
 */

/* ------------------------------------------------------------------ */
/*  Per-module narrative copy (client will replace)                    */
/* ------------------------------------------------------------------ */
const panelCopy: Record<string, { heading: string; body: string }> = {
  dashboard: {
    heading: 'One screen that already knows the answer.',
    body: 'Revenue, headcount, attendance and cash position all resolve from the same ledger — so the number on the dashboard is the number in the report. No reconciliation step, no stale export.',
  },
  hr: {
    heading: 'People records that stay correct on their own.',
    body: 'Onboarding, org structure, documents and role changes are entered once and propagate everywhere. Payroll, attendance and access control all read the same employee record.',
  },
  attendance: {
    heading: 'Attendance that works where the network does not.',
    body: 'Face capture runs on the device and queues locally, then syncs the moment you reconnect. Shifts, overtime and leave land straight in payroll without a spreadsheet in between.',
  },
  accounting: {
    heading: 'Books that close because nothing was ever loose.',
    body: 'Tax-compliant invoicing, ledgers and filings are generated from the transactions your team already recorded. Sales, purchases and payroll post themselves.',
  },
  inventory: {
    heading: 'Stock you can trust across every location.',
    body: 'Batch tracking, multi-warehouse transfers and reorder signals stay live as orders move — so what sales promises is what the warehouse can actually ship today.',
  },
  crm: {
    heading: 'Lead to invoice, in one unbroken thread.',
    body: 'Deals carry their own context into billing. The moment a deal is marked won, the invoice, the ledger entry and the delivery order are already waiting.',
  },
}

const EASE = [0.16, 1, 0.3, 1] as const

/* Design width the dashboard is scaled from on desktop. */
const MOCK_BASE_WIDTH = 1120
const DESKTOP_MQ = '(min-width: 1024px)'

/* ------------------------------------------------------------------ */
/*  ScaledMock — renders the real dashboard at its desktop design      */
/*  width and scales it to fit the card, like a framed screenshot.     */
/* ------------------------------------------------------------------ */
function ScaledMock({ index, desktop }: { index: number; desktop: boolean }) {
  const outerRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ width: MOCK_BASE_WIDTH, scale: 1, height: 0 })

  useLayoutEffect(() => {
    const outer = outerRef.current
    const inner = innerRef.current
    if (!outer || !inner) return

    const measure = () => {
      const available = outer.clientWidth
      if (!available) return
      // Below lg the dashboard renders its own stacked responsive layout, so
      // let it fill the card at 1:1 instead of shrinking desktop chrome.
      const width = desktop ? MOCK_BASE_WIDTH : available
      const scale = Math.min(1, available / width)
      const height = Math.round(inner.offsetHeight * scale)
      setBox((prev) =>
        prev.width === width && Math.abs(prev.scale - scale) < 0.001 && prev.height === height
          ? prev
          : { width, scale, height },
      )
    }

    measure()

    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(outer)
    ro.observe(inner)
    return () => ro.disconnect()
  }, [desktop])

  return (
    <div
      ref={outerRef}
      className="relative w-full"
      style={{ height: box.height || undefined }}
    >
      <div
        ref={innerRef}
        className="absolute left-0 top-0 origin-top-left"
        style={{ width: box.width, transform: `scale(${box.scale})` }}
      >
        {/* Namespaced so each dashboard keeps its own nav-pill layout animation. */}
        <LayoutGroup id={`showcase-mock-${index}`}>
          <ModuleDashboard active={index} autoCycle={false} />
        </LayoutGroup>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */
export function StickyShowcase() {
  const reduce = useReducedMotion()
  const [active, setActive] = useState(0)
  const panelRefs = useRef<(HTMLDivElement | null)[]>([])

  /* Track the lg breakpoint once for all six mocks. Resolved during the first
     render so the mock never measures itself against the wrong layout. */
  const [desktop, setDesktop] = useState(
    () => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(DESKTOP_MQ).matches,
  )

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia(DESKTOP_MQ)
    const sync = () => setDesktop(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  const reveal = {
    initial: reduce ? { opacity: 0 } : { opacity: 0, y: 26 },
    whileInView: { opacity: 1, y: 0 },
    transition: { duration: 0.6, ease: EASE },
  }

  /* Whichever panel sits closest to the middle of the viewport wins. The
     observer is only a cheap trigger — the decision is a measurement. */
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return

    const pick = () => {
      const mid = window.innerHeight / 2
      let best = 0
      let bestDistance = Number.POSITIVE_INFINITY
      panelRefs.current.forEach((el, i) => {
        if (!el) return
        const rect = el.getBoundingClientRect()
        const distance = Math.abs(rect.top + rect.height / 2 - mid)
        if (distance < bestDistance) {
          bestDistance = distance
          best = i
        }
      })
      setActive((prev) => (prev === best ? prev : best))
    }

    const io = new IntersectionObserver(pick, {
      // A thin band across the vertical centre of the viewport.
      rootMargin: '-45% 0px -45% 0px',
      threshold: 0,
    })
    const observed = panelRefs.current.filter((el): el is HTMLDivElement => Boolean(el))
    observed.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [])

  const goTo = useCallback(
    (i: number) => {
      setActive(i)
      panelRefs.current[i]?.scrollIntoView({
        behavior: reduce ? 'auto' : 'smooth',
        block: 'center',
      })
    },
    [reduce],
  )

  // Note: no overflow-hidden on the section — it would become the scrollport
  // for the sticky rail and kill the pin. Cards clip their own mocks instead.
  return (
    <section className="relative bg-surface py-24 lg:py-32">
      {/* Soft emerald wash so the dark panels sit on something, not nothing. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[520px] bg-[radial-gradient(70%_100%_at_50%_0%,#ECFDF5_0%,rgba(236,253,245,0)_100%)]"
      />

      <div className="relative z-10 mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* ── Section header ─────────────────────────────────────── */}
        <motion.div {...reveal} viewport={{ once: true, amount: 0.2 }} className="max-w-3xl">
          <span className="mb-5 inline-flex items-center gap-2 text-[12.5px] font-semibold uppercase tracking-[0.14em] text-primary">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            Built as one system
          </span>
          <h2
            className="font-heading font-extrabold text-text-primary"
            style={{ fontSize: 'clamp(2rem, 4vw, 3.5rem)', lineHeight: 1.06, letterSpacing: '-0.035em' }}
          >
            Every module, the same
            <br className="hidden sm:block" /> single source of truth.
          </h2>
          <p className="mt-6 max-w-2xl text-[17px] leading-relaxed text-text-secondary sm:text-[19px]">
            Nothing here is an integration. Each module writes to the same core, which is why the
            numbers agree the first time you look at them — and keep agreeing as you switch more on.
          </p>
        </motion.div>

        {/* ── Rail + panels ──────────────────────────────────────── */}
        <div className="mt-16 grid grid-cols-1 gap-y-8 lg:mt-24 lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)] lg:gap-x-16 xl:gap-x-20">
          {/* LEFT — sticky rail (desktop only) */}
          <div className="hidden lg:block">
            <div className="lg:sticky lg:top-28">
              <p className="mb-6 text-[12.5px] font-semibold uppercase tracking-[0.14em] text-text-tertiary">
                Six modules · one core
              </p>

              <div className="relative">
                {MODULE_VIEWS.map((m, i) => {
                  const on = i === active
                  return (
                    <button
                      key={m.key}
                      type="button"
                      onClick={() => goTo(i)}
                      aria-current={on || undefined}
                      className="group relative block w-full border-b border-border py-5 pl-5 pr-1 text-left last:border-b-0"
                    >
                      {/* Moving indicator bar */}
                      {on && (
                        <motion.span
                          layoutId="stickyShowcaseBar"
                          className="absolute left-0 top-3 bottom-3 w-[3px] rounded-full bg-primary"
                          transition={
                            reduce
                              ? { duration: 0 }
                              : { type: 'spring', stiffness: 420, damping: 38 }
                          }
                        />
                      )}

                      <span
                        className={`flex items-start gap-4 transition-transform duration-300 ${
                          reduce ? '' : 'group-hover:translate-x-1'
                        }`}
                      >
                        <span className="min-w-0 flex-1">
                          <span
                            className={`block font-heading text-[19px] font-bold transition-colors duration-300 ${
                              on ? 'text-primary' : 'text-text-primary/70 group-hover:text-text-primary'
                            }`}
                            style={{ letterSpacing: '-0.025em' }}
                          >
                            {m.label}
                          </span>
                          <span
                            className={`mt-1.5 block text-[13.5px] leading-relaxed transition-colors duration-300 ${
                              on ? 'text-text-secondary' : 'text-text-tertiary'
                            }`}
                          >
                            {m.blurb}
                          </span>
                        </span>

                        {/* Right-hand dot */}
                        <span
                          className={`mt-2 h-2.5 w-2.5 flex-shrink-0 rounded-full transition-all duration-300 ${
                            on
                              ? 'bg-primary ring-4 ring-primary/15'
                              : 'bg-border group-hover:bg-primary/40'
                          }`}
                        />
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          {/* RIGHT — the scrolling stack */}
          <div className="min-w-0">
            {MODULE_VIEWS.map((m, i) => {
              const copy = panelCopy[m.key] ?? { heading: m.title, body: m.blurb }
              return (
                <div
                  key={m.key}
                  ref={(el) => {
                    panelRefs.current[i] = el
                  }}
                  className="scroll-mt-28 py-6 first:pt-0 lg:flex lg:min-h-[78vh] lg:flex-col lg:justify-center lg:py-10"
                >
                  <motion.article
                    {...reveal}
                    viewport={{ once: true, amount: 0.15 }}
                    className="relative overflow-hidden rounded-3xl border border-white/10 bg-[linear-gradient(158deg,#065F46_0%,#04503A_48%,#022C22_100%)] shadow-glow-brand"
                  >
                    {/* Painted depth — pure CSS, so no SVG id collisions with
                        the hero's LandscapeScene. */}
                    <span
                      aria-hidden
                      className="pointer-events-none absolute inset-0 bg-[radial-gradient(62%_52%_at_88%_-8%,rgba(167,243,208,0.22),transparent_70%)]"
                    />
                    <span
                      aria-hidden
                      className="pointer-events-none absolute inset-0 bg-[radial-gradient(72%_60%_at_6%_104%,rgba(16,185,129,0.24),transparent_72%)]"
                    />
                    {/* A ridge, echoing the valley. */}
                    <svg
                      aria-hidden
                      viewBox="0 0 1200 260"
                      preserveAspectRatio="none"
                      className="pointer-events-none absolute inset-x-0 bottom-0 h-[38%] w-full"
                    >
                      <path
                        d="M0 168 C 180 108, 340 158, 520 140 C 720 120, 860 66, 1040 112 C 1120 132, 1170 128, 1200 136 L1200 260 L0 260 Z"
                        fill="#022C22"
                        fillOpacity="0.42"
                      />
                      <path
                        d="M0 216 C 240 176, 470 220, 700 202 C 920 184, 1060 196, 1200 190 L1200 260 L0 260 Z"
                        fill="#011E17"
                        fillOpacity="0.5"
                      />
                    </svg>
                    <span
                      aria-hidden
                      className="pointer-events-none absolute inset-0 rounded-3xl ring-1 ring-inset ring-white/10"
                    />

                    <div className="relative z-10 p-6 sm:p-9 lg:p-10">
                      <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3.5 py-1.5 text-[12.5px] font-semibold uppercase tracking-[0.14em] text-white/80 backdrop-blur-sm">
                        <span className="h-1.5 w-1.5 rounded-full bg-lime" />
                        {m.label}
                      </span>

                      <h3
                        className="mt-6 max-w-xl font-heading font-extrabold text-white"
                        style={{
                          fontSize: 'clamp(1.6rem, 2.6vw, 2.5rem)',
                          lineHeight: 1.08,
                          letterSpacing: '-0.035em',
                        }}
                      >
                        {copy.heading}
                      </h3>

                      <p className="mt-4 max-w-2xl text-[15.5px] leading-relaxed text-white/80 sm:text-[16.5px]">
                        {copy.body}
                      </p>

                      <div className="mt-8 lg:mt-10">
                        <ScaledMock index={i} desktop={desktop} />
                      </div>
                    </div>
                  </motion.article>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </section>
  )
}
