import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { ModulePanelCard, MODULE_VIEWS } from '../visuals/ModuleDashboard'

/**
 * StickyShowcase — the module workbench.
 *
 * The section sits on the shared light surface like its neighbours; the only
 * green in it is the product itself.
 *
 * The left column is ONE composition, not two stacked sections: a compact
 * masthead (eyebrow → section heading → intro) and then the active module as a
 * clearly subordinate block. The hierarchy is carried entirely by type scale
 * and vertical rhythm — the old horizontal rule and ruled "02 / 06" band are
 * gone, and the counter now reads as a quiet index above the module heading.
 *
 * The right column holds the module tabs directly above the dashboard card, so
 * the control sits on the thing it controls. Tabs size to their own labels —
 * never truncated — and the row scrolls horizontally (scrollbar hidden, edge
 * fades) when it cannot fit, so every label stays fully readable at every
 * width.
 *
 * Scroll does not drive anything — the user clicks, arrows or steps, which is
 * both simpler and honest about what the section is: a workbench you operate,
 * not a story that plays at you. Soft colour and grain only, no linework.
 */

/* ------------------------------------------------------------------ */
/*  Per-module narrative copy (client will replace)                    */
/* ------------------------------------------------------------------ */
interface PanelCopy {
  heading: string
  body: string
  points: string[]
  /** One concrete proof line per module — dummy numbers the client will swap. */
  stat?: { value: string; label: string }
}

const panelCopy: Record<string, PanelCopy> = {
  dashboard: {
    heading: 'One screen that already knows the answer.',
    body: 'Revenue, headcount, attendance and cash position all resolve from the same ledger — so the number on the dashboard is the number in the report. No reconciliation step, no stale export.',
    points: ['Live cross-module KPIs', 'No exports to reconcile', 'Role-based visibility'],
    stat: { value: '6 hrs', label: 'saved per week — leadership stops chasing numbers across tools.' },
  },
  hr: {
    heading: 'People records that stay correct on their own.',
    body: 'Onboarding, org structure, documents and role changes are entered once and propagate everywhere. Payroll, attendance and access control all read the same employee record.',
    points: ['Enter once, propagates', 'Org chart & documents', 'Feeds payroll directly'],
    stat: { value: '3× faster', label: 'onboarding — new hires are payroll-ready on day one.' },
  },
  attendance: {
    heading: 'Attendance that works where the network does not.',
    body: 'Face capture runs on the device and queues locally, then syncs the moment you reconnect. Shifts, overtime and leave land straight in payroll without a spreadsheet in between.',
    points: ['Offline face capture', 'Shifts & overtime', 'Auto-syncs on reconnect'],
    stat: { value: '99.4%', label: 'capture accuracy on the floor — even fully offline.' },
  },
  accounting: {
    heading: 'Books that close because nothing was ever loose.',
    body: 'Tax-compliant invoicing, ledgers and filings are generated from the transactions your team already recorded. Sales, purchases and payroll post themselves.',
    points: ['Tax-compliant invoicing', 'Auto-posted entries', 'Filing-ready returns'],
    stat: { value: '12 days', label: 'faster monthly close for teams that switch to one ledger.' },
  },
  inventory: {
    heading: 'Stock you can trust across every location.',
    body: 'Batch tracking, multi-warehouse transfers and reorder signals stay live as orders move — so what sales promises is what the warehouse can actually ship today.',
    points: ['Multi-warehouse', 'Batch & expiry tracking', 'Reorder signals'],
    stat: { value: '31% fewer', label: 'stockouts within the first quarter of going live.' },
  },
  crm: {
    heading: 'Lead to invoice, in one unbroken thread.',
    body: 'Deals carry their own context into billing. The moment a deal is marked won, the invoice, the ledger entry and the delivery order are already waiting.',
    points: ['Pipeline to invoice', 'Quotes & follow-ups', 'No manual handover'],
    stat: { value: '2.4× more', label: 'deals invoiced the same day they close.' },
  },
}

const EASE = [0.16, 1, 0.3, 1] as const

const pad = (n: number) => String(n).padStart(2, '0')

/** The tab row's own ground (`surface-2`), faded out — used by the edge masks. */
const FADE_START = 'linear-gradient(to right, #F5F5F5 22%, rgba(245,245,245,0) 100%)'
const FADE_END = 'linear-gradient(to left, #F5F5F5 22%, rgba(245,245,245,0) 100%)'

/**
 * The module heading's metrics are pinned inline — including `opsz` — so the
 * invisible sizer copies (rendered as <p>, to keep one <h3> per section) wrap
 * at exactly the same points as the live <h3>. Without pinning opsz the two
 * tags inherit different optical sizes and the reservation drifts.
 */
const MODULE_HEADING_STYLE = {
  fontSize: 'clamp(1.18rem, 1.6vw, 1.45rem)',
  lineHeight: 1.18,
  letterSpacing: '-0.025em',
  fontVariationSettings: "'opsz' 40",
} as const

const MODULE_HEADING_CLASS = 'mt-3 font-heading font-bold text-text-primary'

/* ------------------------------------------------------------------ */
/*  The active module, as a block subordinate to the masthead          */
/* ------------------------------------------------------------------ */
/**
 * Rendered twice: once live, and once per module as an invisible sizer inside
 * the same grid cell. The sizers reserve the height of the TALLEST module, so
 * switching modules never nudges the page — and, unlike the hard-coded
 * `min-h-[370px]` this replaces, the reservation is exactly right at every
 * width, which is what stops the left column running long.
 */
function ModuleArgument({ index, sizer = false }: { index: number; sizer?: boolean }) {
  const view = MODULE_VIEWS[index]
  const copy: PanelCopy = panelCopy[view.key] ?? { heading: view.title, body: view.blurb, points: [] }

  return (
    <div>
      {/* Quiet index — echoes the masthead eyebrow instead of ruling off a band */}
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] font-semibold uppercase tracking-[0.16em] text-text-tertiary">
        <span className="font-mono tabular-nums tracking-normal text-primary">{pad(index + 1)}</span>
        <span className="font-mono tabular-nums tracking-normal text-text-tertiary/70">
          / {pad(MODULE_VIEWS.length)}
        </span>
        <span aria-hidden className="h-1 w-1 rounded-full bg-primary/60" />
        <span>{view.label}</span>
      </p>

      {sizer ? (
        <p className={MODULE_HEADING_CLASS} style={MODULE_HEADING_STYLE}>
          {copy.heading}
        </p>
      ) : (
        <h3 className={MODULE_HEADING_CLASS} style={MODULE_HEADING_STYLE}>
          {copy.heading}
        </h3>
      )}

      <p className="mt-3.5 max-w-xl text-[14.5px] leading-relaxed text-text-secondary sm:text-[15px]">
        {copy.body}
      </p>

      {/* One concrete proof line per module — a soft field, not a ruled quote */}
      {copy.stat && (
        <p className="mt-5 flex max-w-xl flex-wrap items-baseline gap-x-3 gap-y-1 rounded-xl bg-primary/[0.07] px-4 py-3">
          <span
            className="font-heading text-[22px] font-bold leading-none text-primary sm:text-[24px]"
            style={{ letterSpacing: '-0.02em' }}
          >
            {copy.stat.value}
          </span>
          <span className="max-w-md text-[13px] leading-snug text-text-secondary">{copy.stat.label}</span>
        </p>
      )}

      {/* What this module actually gives you — concrete, per module */}
      <ul className="mt-5 flex flex-wrap gap-2">
        {copy.points.map((pt) => (
          <li
            key={pt}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-[12.5px] font-medium text-text-secondary shadow-sm"
          >
            <span className="h-1 w-1 rounded-full bg-primary" />
            {pt}
          </li>
        ))}
      </ul>
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
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  /** Which edge of the tab row still has labels hidden past it. */
  const [edges, setEdges] = useState({ start: false, end: false })

  const reveal = {
    initial: reduce ? { opacity: 0 } : { opacity: 0, y: 24 },
    whileInView: { opacity: 1, y: 0 },
    transition: { duration: 0.6, ease: EASE },
  }

  /* The edge fades only appear on the side that actually has more tabs. */
  const syncEdges = useCallback(() => {
    const el = scrollerRef.current
    if (!el) return
    const max = el.scrollWidth - el.clientWidth
    const start = el.scrollLeft > 2
    const end = max > 2 && el.scrollLeft < max - 2
    setEdges((prev) => (prev.start === start && prev.end === end ? prev : { start, end }))
  }, [])

  useEffect(() => {
    syncEdges()
    const el = scrollerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(syncEdges)
    ro.observe(el)
    /* Also watch the tabs themselves: when the web fonts land the labels get
       wider while the row's own width is unchanged, so observing only the row
       would leave the fades stuck at their first-paint state. */
    for (const tab of Array.from(el.children)) ro.observe(tab)
    return () => ro.disconnect()
  }, [syncEdges])

  /* Keep the selected tab in view when the row is scrolled — arrows and clicks
     must never select a label the user cannot see. */
  useEffect(() => {
    const el = scrollerRef.current
    const tab = tabRefs.current[active]
    if (!el || !tab) return
    const behavior: ScrollBehavior = reduce ? 'auto' : 'smooth'
    const start = tab.offsetLeft - 12
    const end = tab.offsetLeft + tab.offsetWidth + 12
    if (start < el.scrollLeft) el.scrollTo({ left: Math.max(0, start), behavior })
    else if (end > el.scrollLeft + el.clientWidth) el.scrollTo({ left: end - el.clientWidth, behavior })
  }, [active, reduce])

  const step = useCallback((delta: number) => {
    setActive((i) => (i + delta + MODULE_VIEWS.length) % MODULE_VIEWS.length)
  }, [])

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

  return (
    <section className="surface-soft relative overflow-x-clip py-24 lg:py-32">
      <span aria-hidden className="grain" />
      {/* The tab row scrolls when it must; the bar itself is never shown, the
          edge fades carry that signal instead. Scoped to this row only. */}
      <style>{'.ut-tabrow::-webkit-scrollbar{display:none}'}</style>

      <div className="relative z-10 mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Both columns start on the same line (the two eyebrows align) and end
            on the same line — the right column stretches to the left's height
            and its step controls sit on the floor, so the card is never left
            hanging above a band of empty ground. */}
        <div className="grid gap-12 lg:grid-cols-[1fr_minmax(0,470px)] lg:items-stretch lg:gap-12 xl:grid-cols-[1fr_minmax(0,620px)] xl:gap-20">
          {/* ── Left: one composition — masthead, then the active module ── */}
          <motion.div {...reveal} viewport={{ once: true, amount: 0.2 }} className="min-w-0">
            <span className="mb-4 inline-flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.16em] text-primary">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              Built as one system
            </span>
            <h2
              className="font-heading font-bold text-text-primary"
              style={{ fontSize: 'clamp(1.74rem, 2.95vw, 2.6rem)', lineHeight: 1.07, letterSpacing: '-0.035em' }}
            >
              Every module, the same
              <br className="hidden sm:block" /> single source of truth.
            </h2>
            <p className="mt-5 max-w-2xl text-[15.5px] leading-relaxed text-text-secondary sm:text-[16.5px]">
              Nothing here is an integration. Each module writes to the same core, which is why the
              numbers agree the first time you look at them — and keep agreeing as you switch more on.
            </p>

            {/* Per-module argument — subordinate to the masthead by scale and
                spacing alone. The invisible sizers hold the cell at the height
                of the tallest module so nothing jumps as tabs change. */}
            <div className="mt-9 grid grid-cols-1 grid-rows-1 lg:mt-11">
              {MODULE_VIEWS.map((m, i) => (
                <div key={m.key} aria-hidden className="invisible col-start-1 row-start-1 min-w-0">
                  <ModuleArgument index={i} sizer />
                </div>
              ))}
              <div className="col-start-1 row-start-1 min-w-0">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div
                    key={view.key}
                    initial={{ opacity: 0, y: reduce ? 0 : 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: reduce ? 0 : -8 }}
                    transition={{ duration: reduce ? 0 : 0.32, ease: EASE }}
                  >
                    <ModuleArgument index={active} />
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>
          </motion.div>

          {/* ── Right: tabs, then the product (the only green) ────── */}
          <motion.div {...reveal} viewport={{ once: true, amount: 0.12 }} className="flex min-w-0 flex-col">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-text-tertiary">
                Six modules · one core
              </p>
              <p className="text-[12.5px] text-text-tertiary">Pick a module to load it</p>
            </div>

            {/* Segmented control — sits on the dashboard only. Tabs are sized by
                their labels; the row scrolls rather than clipping a word. */}
            <div className="relative">
              <div
                ref={scrollerRef}
                role="tablist"
                aria-label="Modules"
                onScroll={syncEdges}
                /* At lg the right column is 470px but six content-sized tabs need
                   ~608px, so the row would scroll and hide Inventory + CRM on a
                   desktop that has room to simply show them. Wrapping there costs
                   one extra row and hides nothing. xl has the width for a single
                   row, and below lg the horizontal scroll stays — a swipeable tab
                   row is the expected mobile pattern, and three stacked rows on a
                   358px column would push the dashboard far down the page. */
                className="ut-tabrow relative flex gap-1 overflow-x-auto rounded-2xl border border-border bg-surface-2 p-1.5 lg:flex-wrap xl:flex-nowrap"
                style={{ scrollbarWidth: 'none', msOverflowStyle: 'none', overscrollBehaviorX: 'contain' }}
              >
                {MODULE_VIEWS.map((m, i) => {
                  const Icon = m.icon
                  const on = i === active
                  /* `isolate` on the button keeps the label's z-10 (which lifts
                     it over the sliding pill) contained: without it that
                     z-index escapes to the section's stacking context and
                     paints the label on top of the edge fades. */
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
                      className="relative isolate flex-none rounded-xl px-3 py-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 focus-visible:ring-offset-surface-2"
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
                        className={`relative z-10 flex items-center gap-1.5 whitespace-nowrap text-[12.5px] font-semibold transition-colors duration-300 sm:text-[13px] ${
                          on ? 'text-primary' : 'text-text-secondary hover:text-text-primary'
                        }`}
                        style={{ letterSpacing: '-0.01em' }}
                      >
                        <Icon size={14} className="flex-shrink-0" />
                        {m.label}
                      </span>
                    </button>
                  )
                })}
              </div>

              {/* Edge fades — only on the side that still has labels past it */}
              <span
                aria-hidden
                className={`pointer-events-none absolute inset-y-px left-px z-10 w-9 rounded-l-2xl transition-opacity duration-300 ${
                  edges.start ? 'opacity-100' : 'opacity-0'
                }`}
                style={{ backgroundImage: FADE_START }}
              />
              <span
                aria-hidden
                className={`pointer-events-none absolute inset-y-px right-px z-10 w-9 rounded-r-2xl transition-opacity duration-300 ${
                  edges.end ? 'opacity-100' : 'opacity-0'
                }`}
                style={{ backgroundImage: FADE_END }}
              />
            </div>

            {/* The product — the only green thing in the section */}
            <div
              id="workbench-panel"
              role="tabpanel"
              aria-labelledby={`workbench-tab-${view.key}`}
              className="mt-5 min-w-0"
            >
              <ModulePanelCard active={active} />
            </div>

            {/* Step affordance — real controls, not just a keyboard hint.
                `mt-auto` drops it to the floor of the stretched column. */}
            <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2 lg:mt-auto lg:pt-6">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => step(-1)}
                  aria-label="Previous module"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border bg-surface text-text-secondary shadow-sm transition-colors hover:border-primary/40 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                >
                  <ChevronLeft size={15} />
                </button>
                <button
                  type="button"
                  onClick={() => step(1)}
                  aria-label="Next module"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border bg-surface text-text-secondary shadow-sm transition-colors hover:border-primary/40 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                >
                  <ChevronRight size={15} />
                </button>
              </div>
              <p className="min-w-0 text-[12.5px] leading-snug text-text-tertiary">
                Step through the modules
                <span className="hidden lg:inline">
                  {' — or press '}
                  <kbd className="rounded border border-border bg-surface px-1.5 py-0.5 font-mono text-[11px] text-text-secondary">
                    ←
                  </kbd>{' '}
                  <kbd className="rounded border border-border bg-surface px-1.5 py-0.5 font-mono text-[11px] text-text-secondary">
                    →
                  </kbd>
                </span>
              </p>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  )
}
