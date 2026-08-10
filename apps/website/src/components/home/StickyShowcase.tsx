import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { motion, AnimatePresence, LayoutGroup, useReducedMotion } from 'framer-motion'
import { ModuleDashboard, MODULE_VIEWS } from '../visuals/ModuleDashboard'

/**
 * StickyShowcase — the module workbench.
 *
 * One large product panel that stays put while the reader steps through the
 * modules with a horizontal segmented control above it; the module's argument
 * sits beside the panel. Scroll does not drive anything — the user clicks (or
 * arrows), which is both simpler and honest about what the section is: a
 * workbench you operate, not a story that plays at you.
 *
 * The section sits on the shared light surface; the workbench frame is the
 * shared deep-emerald surface with a vignette and a fine grain over it — soft
 * colour only, no linework. No horizon, no ridge, no ghost wordmark.
 */

/* ------------------------------------------------------------------ */
/*  Per-module narrative copy (client will replace)                    */
/* ------------------------------------------------------------------ */
const panelCopy: Record<string, { heading: string; body: string; points: string[] }> = {
  dashboard: {
    heading: 'One screen that already knows the answer.',
    body: 'Revenue, headcount, attendance and cash position all resolve from the same ledger — so the number on the dashboard is the number in the report. No reconciliation step, no stale export.',
    points: ['Live cross-module KPIs', 'No exports to reconcile', 'Role-based visibility'],
  },
  hr: {
    heading: 'People records that stay correct on their own.',
    body: 'Onboarding, org structure, documents and role changes are entered once and propagate everywhere. Payroll, attendance and access control all read the same employee record.',
    points: ['Enter once, propagates', 'Org chart & documents', 'Feeds payroll directly'],
  },
  attendance: {
    heading: 'Attendance that works where the network does not.',
    body: 'Face capture runs on the device and queues locally, then syncs the moment you reconnect. Shifts, overtime and leave land straight in payroll without a spreadsheet in between.',
    points: ['Offline face capture', 'Shifts & overtime', 'Auto-syncs on reconnect'],
  },
  accounting: {
    heading: 'Books that close because nothing was ever loose.',
    body: 'Tax-compliant invoicing, ledgers and filings are generated from the transactions your team already recorded. Sales, purchases and payroll post themselves.',
    points: ['Tax-compliant invoicing', 'Auto-posted entries', 'Filing-ready returns'],
  },
  inventory: {
    heading: 'Stock you can trust across every location.',
    body: 'Batch tracking, multi-warehouse transfers and reorder signals stay live as orders move — so what sales promises is what the warehouse can actually ship today.',
    points: ['Multi-warehouse', 'Batch & expiry tracking', 'Reorder signals'],
  },
  crm: {
    heading: 'Lead to invoice, in one unbroken thread.',
    body: 'Deals carry their own context into billing. The moment a deal is marked won, the invoice, the ledger entry and the delivery order are already waiting.',
    points: ['Pipeline to invoice', 'Quotes & follow-ups', 'No manual handover'],
  },
}

const EASE = [0.16, 1, 0.3, 1] as const

/* Design width the dashboard is scaled from on desktop. */
const MOCK_BASE_WIDTH = 1120
const DESKTOP_MQ = '(min-width: 1024px)'

const pad = (n: number) => String(n).padStart(2, '0')

/* ------------------------------------------------------------------ */
/*  ScaledMock — renders the real dashboard at its desktop design      */
/*  width and scales it to fit the frame, like a calibrated bench.     */
/* ------------------------------------------------------------------ */
function ScaledMock({
  index,
  desktop,
  onSelect,
}: {
  index: number
  desktop: boolean
  onSelect: (i: number) => void
}) {
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
      // let it fill the frame at 1:1 instead of shrinking desktop chrome.
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
    <div ref={outerRef} className="relative w-full" style={{ height: box.height || undefined }}>
      <div
        ref={innerRef}
        className="absolute left-0 top-0 origin-top-left"
        style={{ width: box.width, transform: `scale(${box.scale})` }}
      >
        {/* Namespaced so the dashboard's nav-pill layout animation stays its own.
            The mock's own rail reports back, so it is a real control rather
            than a dead picture of one. */}
        <LayoutGroup id="workbench-mock">
          <ModuleDashboard active={index} onActiveChange={onSelect} autoCycle={false} />
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
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])

  /* Track the lg breakpoint once. Resolved during the first render so the mock
     never measures itself against the wrong layout. */
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
    initial: reduce ? { opacity: 0 } : { opacity: 0, y: 24 },
    whileInView: { opacity: 1, y: 0 },
    transition: { duration: 0.6, ease: EASE },
  }

  /* Roving focus across the segmented control, as a tablist should behave. */
  const onTabKeys = useCallback((e: React.KeyboardEvent<HTMLButtonElement>, i: number) => {
    const last = MODULE_VIEWS.length - 1
    let next: number | null = null
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = i === last ? 0 : i + 1
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = i === 0 ? last : i - 1
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = last
    if (next === null) return
    e.preventDefault()
    setActive(next)
    tabRefs.current[next]?.focus()
  }, [])

  const view = MODULE_VIEWS[active]
  const copy = panelCopy[view.key] ?? { heading: view.title, body: view.blurb }

  return (
    <section className="surface-soft relative overflow-x-clip py-24 lg:py-32">
      <span aria-hidden className="grain" />

      <div className="relative z-10 mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* ── Section header ─────────────────────────────────────── */}
        <motion.div {...reveal} viewport={{ once: true, amount: 0.2 }} className="max-w-3xl">
          <span className="mb-5 inline-flex items-center gap-2 text-[12.5px] font-semibold uppercase tracking-[0.14em] text-primary">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            Built as one system
          </span>
          <h2
            className="font-heading font-bold text-text-primary"
            style={{ fontSize: 'clamp(1.74rem, 3.52vw, 3.045rem)', lineHeight: 1.06, letterSpacing: '-0.035em' }}
          >
            Every module, the same
            <br className="hidden sm:block" /> single source of truth.
          </h2>
          <p className="mt-6 max-w-2xl text-[15.5px] leading-relaxed text-text-secondary sm:text-[17px]">
            Nothing here is an integration. Each module writes to the same core, which is why the
            numbers agree the first time you look at them — and keep agreeing as you switch more on.
          </p>
        </motion.div>

        {/* ── Segmented control ──────────────────────────────────── */}
        <motion.div
          {...reveal}
          viewport={{ once: true, amount: 0.4 }}
          className="mt-12 lg:mt-16"
        >
          <div className="mb-3 flex items-baseline justify-between gap-4">
            <p className="text-[12.5px] font-semibold uppercase tracking-[0.14em] text-text-tertiary">
              Six modules · one core
            </p>
            <p className="hidden text-[12.5px] text-text-tertiary sm:block">
              Pick a module to load it into the workbench
            </p>
          </div>

          <div
            role="tablist"
            aria-label="Modules"
            className="grid grid-cols-3 gap-1 rounded-2xl border border-border bg-surface-2 p-1.5 sm:grid-cols-6"
          >
            {MODULE_VIEWS.map((m, i) => {
              const Icon = m.icon
              const on = i === active
              return (
                <button
                  key={m.key}
                  ref={(el) => {
                    tabRefs.current[i] = el
                  }}
                  type="button"
                  role="tab"
                  id={`workbench-tab-${m.key}`}
                  aria-selected={on}
                  aria-controls="workbench-panel"
                  tabIndex={on ? 0 : -1}
                  onClick={() => setActive(i)}
                  onKeyDown={(e) => onTabKeys(e, i)}
                  className="relative rounded-xl px-2 py-2.5 text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 focus-visible:ring-offset-surface-2 sm:px-3"
                >
                  {on && (
                    <motion.span
                      layoutId="workbenchTab"
                      aria-hidden
                      className="absolute inset-0 rounded-xl border border-border bg-surface shadow-sm"
                      transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 460, damping: 40 }}
                    />
                  )}
                  <span
                    className={`relative z-10 flex items-center justify-center gap-2 text-[13.5px] font-semibold transition-colors duration-300 ${
                      on ? 'text-primary' : 'text-text-secondary hover:text-text-primary'
                    }`}
                    style={{ letterSpacing: '-0.01em' }}
                  >
                    <Icon size={15} className="flex-shrink-0" />
                    <span className="truncate">{m.label}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </motion.div>

        {/* ── The workbench ──────────────────────────────────────── */}
        <motion.div
          {...reveal}
          viewport={{ once: true, amount: 0.12 }}
          id="workbench-panel"
          role="tabpanel"
          aria-labelledby={`workbench-tab-${view.key}`}
          className="surface-deep relative mt-5 overflow-hidden rounded-[28px] shadow-glow-brand"
        >
          {/* Vignette, so the frame has weight at its edges. */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_90%_at_50%_0%,transparent_45%,rgba(2,44,34,0.45)_100%)]"
          />
          {/* Fine grain — the only texture on the surface. */}
          <span aria-hidden className="grain grain-dark" />
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-[28px] ring-1 ring-inset ring-white/10"
          />

          <div className="relative z-10 grid gap-8 p-5 sm:p-8 xl:grid-cols-[minmax(0,340px)_minmax(0,1fr)] xl:gap-12 xl:p-10">
            {/* Argument */}
            <div className="min-w-0 xl:flex xl:flex-col xl:justify-center">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={view.key}
                  initial={{ opacity: 0, y: reduce ? 0 : 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: reduce ? 0 : -8 }}
                  transition={{ duration: reduce ? 0 : 0.32, ease: EASE }}
                  className="min-h-[300px] sm:min-h-[260px] xl:min-h-[360px]"
                >
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-[12px] font-semibold tabular-nums text-lime/90">
                      {pad(active + 1)}
                      <span className="text-white/35"> / {pad(MODULE_VIEWS.length)}</span>
                    </span>
                    <span className="h-px flex-1 bg-white/15" />
                    <span className="inline-flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.14em] text-white/70">
                      <span className="h-1.5 w-1.5 rounded-full bg-lime" />
                      {view.label}
                    </span>
                  </div>

                  <h3
                    className="mt-6 font-heading font-bold text-white"
                    style={{
                      fontSize: 'clamp(1.305rem, 2.112vw, 1.87rem)',
                      lineHeight: 1.1,
                      letterSpacing: '-0.035em',
                    }}
                  >
                    {copy.heading}
                  </h3>

                  <p className="mt-4 max-w-2xl text-[14.5px] leading-relaxed text-white/75 sm:text-[15.5px]">
                    {copy.body}
                  </p>

                  {/* What this module actually gives you — concrete, per module */}
                  <ul className="mt-5 flex flex-wrap gap-2">
                    {copy.points.map((pt) => (
                      <li
                        key={pt}
                        className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-[12.5px] font-medium text-white/85 backdrop-blur-sm"
                      >
                        <span className="h-1 w-1 rounded-full bg-lime" />
                        {pt}
                      </li>
                    ))}
                  </ul>
                </motion.div>
              </AnimatePresence>

              <p className="mt-7 hidden items-center gap-2 text-[12.5px] text-white/45 xl:flex">
                <kbd className="rounded border border-white/20 bg-white/10 px-1.5 py-0.5 font-mono text-[11px] text-white/70">
                  ←
                </kbd>
                <kbd className="rounded border border-white/20 bg-white/10 px-1.5 py-0.5 font-mono text-[11px] text-white/70">
                  →
                </kbd>
                to step through the modules
              </p>
            </div>

            {/* The panel itself — one mock, held in place. */}
            <div className="min-w-0">
              <ScaledMock index={active} desktop={desktop} onSelect={setActive} />
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  )
}
