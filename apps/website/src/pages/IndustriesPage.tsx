import { useCallback, useRef, useState } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import {
  Factory, ShoppingBag, Truck, Utensils, Building2,
  Stethoscope, BookOpen, Wrench, Check, ChevronRight, Info,
} from 'lucide-react'
import { Navbar } from '../components/layout/Navbar'
import { Footer } from '../components/layout/Footer'
import { CTABanner } from '../components/home/CTABanner'
import { PageHero } from '../components/marketing/PageHero'

/**
 * Sector playbooks.
 *
 * 2026-08-17 (CRIT #5 audit): the eight per-sector testimonials were
 * removed. Each carried a named person, a named company, a specific ROI
 * number and a five-star rating, and none of those endorsements existed —
 * they were fabricated marketing copy, which India CPA §2(28) treats as a
 * misleading advertisement. Sector cards now show only the sector's real
 * playbook (use cases + recommended modules) and a launch-state tag that
 * matches what is actually shipping today.
 *
 * `launchState`:
 *   'live'    — the HR / Payroll / Attendance modules that this sector
 *               depends on are shipping today.
 *   'soon'    — the sector-specific modules (POS, Manufacturing, CRM etc.)
 *               are on the roadmap and marked "Launching soon" in
 *               module_plans. See ModulesOverview.
 */
type LaunchState = 'live' | 'soon'

const industries: Array<{
  id: string
  icon: typeof Factory
  name: string
  tagline: string
  description: string
  useCases: string[]
  modules: string[]
  launchState: LaunchState
}> = [
  {
    id: 'manufacturing',
    icon: Factory,
    name: 'Manufacturing',
    tagline: 'From BOM to dispatch — one connected core.',
    description:
      'UnifiedTree is being built to manage the manufacturing lifecycle: procurement, Bill of Materials, work orders, quality checks, and finished-goods inventory. HR & Payroll for shop-floor staff is live today; the manufacturing-specific modules are launching soon.',
    useCases: [
      'Multi-level Bill of Materials with variants',
      'Work order creation and shop floor tracking',
      'MRP — automatic material requirements planning',
      'Quality control at each production stage',
      'Scrap and waste tracking',
      'Machine and workcenter scheduling',
    ],
    modules: ['Manufacturing', 'Inventory', 'Purchase', 'Accounting', 'HR & Employees'],
    launchState: 'soon',
  },
  {
    id: 'retail',
    icon: ShoppingBag,
    name: 'Retail & Distribution',
    tagline: 'Point of Sale is launching soon.',
    description:
      'Run a single store or a chain. Offline POS, multi-store inventory and central sales visibility are on the roadmap. HR & Payroll for store staff is live today.',
    useCases: [
      'Offline POS — billing without internet',
      'Multi-store inventory management',
      'Customer loyalty points and discounts',
      'Daily sales reports and end-of-day',
      'Reorder alerts and purchase automation',
      'GST-compliant receipts and invoices',
    ],
    modules: ['Point of Sale', 'Inventory', 'Accounting', 'CRM', 'Reports & BI'],
    launchState: 'soon',
  },
  {
    id: 'trading',
    icon: Truck,
    name: 'Trading & Distribution',
    tagline: 'Buy right. Sell faster. Track everything.',
    description:
      'Vendor POs, 3-way matching, batch tracking and multi-location inventory are on the roadmap for trading and distribution operators. HR & Payroll for back-office and warehouse teams is live today.',
    useCases: [
      'Purchase order and vendor management',
      'Goods receipt and 3-way matching',
      'Multi-warehouse stock transfers',
      'Customer order fulfillment tracking',
      'Batch and serial number tracking',
      'GST e-way bill generation',
    ],
    modules: ['Purchase', 'Inventory', 'Sales', 'Accounting', 'CRM'],
    launchState: 'soon',
  },
  {
    id: 'hospitality',
    icon: Utensils,
    name: 'Hospitality & Food',
    tagline: 'Fast billing. Happy tables. Zero chaos.',
    description:
      'KOT management, table billing and offline receipts for restaurants, cloud kitchens and hotels are on the roadmap. HR & Payroll for kitchen and service staff is live today.',
    useCases: [
      'KOT (Kitchen Order Ticket) management',
      'Table and seat management',
      'Offline billing during connectivity issues',
      'Recipe and ingredient costing',
      'Daily cash register management',
      'Third-party aggregator order integration',
    ],
    modules: ['Point of Sale', 'Inventory', 'Accounting', 'HR & Employees', 'Payroll'],
    launchState: 'soon',
  },
  {
    id: 'services',
    icon: Building2,
    name: 'Professional Services',
    tagline: 'People management today, projects & billing next.',
    description:
      'IT firms, consultancies, architects and agencies can run HR, Attendance and Payroll on UnifiedTree today. Project-based time tracking, milestone billing and utilisation dashboards are launching soon.',
    useCases: [
      'Project milestones and task tracking',
      'Timesheet and billable hours',
      'Project-based invoicing',
      'Employee utilization dashboards',
      'Retainer and advance billing',
      'GST invoicing with TDS deduction',
    ],
    modules: ['Projects', 'Accounting', 'HR & Employees', 'Payroll', 'CRM'],
    launchState: 'live',
  },
  {
    id: 'healthcare',
    icon: Stethoscope,
    name: 'Healthcare & Pharma',
    tagline: 'Staff management today, batch/expiry tracking next.',
    description:
      'Hospitals, clinics and pharma distributors can manage staff attendance and payroll on UnifiedTree today. Batch and expiry tracking, controlled-substance management and FIFO stock valuation are on the roadmap.',
    useCases: [
      'Batch and expiry date tracking',
      'Controlled substance tracking',
      'FIFO stock valuation for medicines',
      'Staff attendance and shift management',
      'Vendor compliance documentation',
      'Purchase of scheduled drugs tracking',
    ],
    modules: ['Inventory', 'Purchase', 'HR & Employees', 'Attendance', 'Accounting'],
    launchState: 'live',
  },
  {
    id: 'education',
    icon: BookOpen,
    name: 'Education',
    tagline: 'Run your institution. Not your spreadsheets.',
    description:
      'Schools, colleges and coaching institutes can run staff attendance, statutory payroll (PF, ESI, TDS) and shift management on UnifiedTree today. Fee management and asset tracking are on the roadmap.',
    useCases: [
      'Staff attendance and payroll',
      'PF, ESI for teaching and non-teaching staff',
      'Expense and budget management',
      'Vendor and supplier management',
      'Asset tracking across campuses',
      'Multi-branch consolidated reports',
    ],
    modules: ['HR & Employees', 'Attendance', 'Payroll', 'Accounting', 'Reports & BI'],
    launchState: 'live',
  },
  {
    id: 'construction',
    icon: Wrench,
    name: 'Construction & Real Estate',
    tagline: 'GPS attendance today, project costing next.',
    description:
      'GPS-based labour attendance and payroll for on-site staff work today via the mobile app. Project-wise material tracking, sub-contractor billing and progress billing are on the roadmap.',
    useCases: [
      'GPS-based labour attendance on site',
      'Material procurement and site stock',
      'Project-wise budget vs actuals',
      'Sub-contractor billing and PO management',
      'Equipment tracking',
      'Progress billing and retention management',
    ],
    modules: ['Attendance', 'Purchase', 'Inventory', 'Projects', 'Accounting'],
    launchState: 'live',
  },
]

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1]

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * Card-header surface: the card-scale version of the page's deep emerald band —
 * soft light fields and a grain, no linework.
 */
function HeaderField() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(90% 120% at 82% -10%, rgba(167,243,208,0.20), transparent 62%),' +
            'radial-gradient(80% 120% at 6% 118%, rgba(2,40,30,0.34), transparent 70%)',
        }}
      />
      <span className="grain grain-dark" />
    </div>
  )
}

/**
 * The sector name is set with its metrics pinned inline — `opsz` included — so
 * the invisible sizer copies (rendered as <p>, to keep a single <h3> in the
 * live panel) wrap at exactly the same points as the live <h3>. Without pinning
 * opsz the two tags inherit different optical sizes and the reservation drifts.
 */
const NAME_STYLE = {
  fontSize: 'clamp(1.32rem, 1.75vw, 1.66rem)',
  lineHeight: 1.08,
  letterSpacing: '-0.03em',
  fontVariationSettings: "'opsz' 40",
} as const
const NAME_CLASS = 'font-heading font-extrabold text-white'

/** Micro-label above a block inside the dossier. Leading is pinned so the <h4>
 *  live version and the <p> sizer version reserve exactly the same height. */
const LABEL_CLASS =
  'text-[12px] font-semibold uppercase leading-[1.3] tracking-[0.14em] text-primary'

/* ------------------------------------------------------------------ */
/*  The dossier — one sector, in full                                  */
/* ------------------------------------------------------------------ */
/**
 * Rendered nine times: once live, and once per sector as an invisible sizer in
 * the same grid cell. The sizers reserve the height of the TALLEST sector, so
 * switching sectors never nudges the page — and, unlike a hard-coded min-height,
 * the reservation is exactly right at every width and font fallback.
 */
function Dossier({ index, sizer = false }: { index: number; sizer?: boolean }) {
  const ind = industries[index]
  const Icon = ind.icon
  /* Uppercase identifiers so TSX treats these as components, not intrinsics. */
  const Name = sizer ? 'p' : 'h3'
  const Label = sizer ? 'p' : 'h4'

  return (
    /* `h-full` + a growing body: the reserved cell is as tall as the TALLEST
       sector, so without this the white card's own bottom edge would still jump
       by up to 61px as sectors change. The slack lands as extra breathing room
       under the testimonial instead. */
    <article className="flex h-full flex-col overflow-hidden rounded-3xl border border-border bg-white shadow-card">
      {/* Emerald masthead — the sector, its promise, and its place in the index */}
      <div className="relative overflow-hidden bg-gradient-to-br from-[#04503A] via-primary-dark to-primary px-5 py-5 sm:px-8 sm:py-6">
        <HeaderField />
        <div className="relative z-10 flex items-center gap-4">
          <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl border border-white/20 bg-white/10 sm:h-12 sm:w-12">
            <Icon size={21} className="text-white" />
          </span>
          <div className="min-w-0 flex-1">
            <Name className={NAME_CLASS} style={NAME_STYLE}>
              {ind.name}
            </Name>
            <p className="mt-1.5 text-[14px] font-semibold leading-snug text-lime">{ind.tagline}</p>
          </div>
          <span
            aria-hidden
            className="hidden flex-shrink-0 self-start font-mono text-[11.5px] tabular-nums tracking-[0.1em] text-white/55 sm:block"
          >
            {pad(index + 1)} / {pad(industries.length)}
          </span>
        </div>
      </div>

      <div className="flex flex-1 flex-col px-5 py-6 sm:px-8 sm:py-7">
        <p className="max-w-3xl text-[15px] leading-relaxed text-text-secondary">
          {ind.description}
        </p>

        <Label className={`${LABEL_CLASS} mt-7`}>Key use cases</Label>
        <ul className="mt-4 grid gap-x-8 gap-y-2.5 sm:grid-cols-2">
          {ind.useCases.map((uc) => (
            <li
              key={uc}
              className="flex items-start gap-2.5 text-[14px] leading-snug text-text-secondary"
            >
              <span className="mt-px flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-md bg-primary-light">
                <Check size={11} className="text-primary" strokeWidth={3} />
              </span>
              {uc}
            </li>
          ))}
        </ul>

        <Label className={`${LABEL_CLASS} mt-7`}>Recommended modules</Label>
        <div className="mt-4 flex flex-wrap gap-2">
          {ind.modules.map((mod) => (
            <span
              key={mod}
              className="rounded-full border border-primary/20 bg-primary-light px-3 py-1.5 text-[12.5px] font-semibold text-primary"
            >
              {mod}
            </span>
          ))}
        </div>

        {/* Absorbs the slack between this sector's content and the reserved
            height, so the launch-state footer always sits on the card's
            floor rather than leaving a ragged gap under it. */}
        <div aria-hidden className="min-h-[1.75rem] flex-1" />

        {/* Launch-state footer — replaces the removed fabricated testimonial */}
        <div className="flex items-start gap-3 rounded-2xl bg-primary-light px-5 py-4 sm:px-6">
          <span className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-primary text-white">
            <Info size={13} />
          </span>
          <p className="min-w-0 flex-1 text-[13.5px] leading-relaxed text-text-secondary">
            {ind.launchState === 'live'
              ? 'HR, Attendance and Payroll for this sector are live today. Sector-specific modules on this list will unlock as they ship.'
              : 'HR, Attendance and Payroll for this sector are live today. The sector-specific modules on this list are launching soon — join early access to be first on the list.'}
          </p>
        </div>
      </div>
    </article>
  )
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */
export function IndustriesPage() {
  const reduce = useReducedMotion()
  const [active, setActive] = useState(0)
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])

  /* Roving focus across the index, as a tablist should behave. Both axes are
     bound because the list is one column beside the dossier at lg and up, and
     wraps to two columns below that. */
  const onTabKeys = useCallback((e: React.KeyboardEvent<HTMLButtonElement>, i: number) => {
    const last = industries.length - 1
    let next: number | null = null
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = i === last ? 0 : i + 1
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = i === 0 ? last : i - 1
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = last
    if (next === null) return
    e.preventDefault()
    setActive(next)
    tabRefs.current[next]?.focus()
  }, [])

  const current = industries[active]

  return (
    <div className="min-h-screen bg-bg">
      <Navbar />

      {/* ── Hero ──────────────────────────────────────────────────────── */}
      <PageHero
        eyebrow="Industries"
        title={
          <>
            One platform.
            <br />
            <span className="text-lime">Built for how you actually run.</span>
          </>
        }
        lede={
          <>
            UnifiedTree ships HR, Payroll and mobile Attendance today, with sector-specific
            modules launching by industry. Below is how each sector uses the parts that are
            live now — and what's coming next.
          </>
        }
      >
        <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-[13px] font-medium text-white/70">
          <span>HR &amp; Payroll live today</span>
          <span className="hidden h-1 w-1 rounded-full bg-white/40 sm:block" />
          <span>Attendance &amp; Face Verification on the mobile app</span>
          <span className="hidden h-1 w-1 rounded-full bg-white/40 sm:block" />
          <span>Sector modules launching soon</span>
        </div>
      </PageHero>

      {/* Launch-mode banner — sits under the hero so a visitor from any
          entry point sees, before scrolling into a sector, exactly which
          parts of the product they can use today. */}
      <div className="border-b border-primary/15 bg-primary-light/60">
        <div className="mx-auto flex max-w-7xl items-start gap-3 px-4 py-3.5 text-[13.5px] leading-snug text-text-secondary sm:items-center sm:px-6 lg:px-8">
          <Info size={16} className="mt-0.5 flex-shrink-0 text-primary sm:mt-0" aria-hidden />
          <p>
            <span className="font-semibold text-text-primary">
              HR &amp; Payroll are live today.
            </span>{' '}
            Attendance and Face Verification are available on the mobile app.
            Sector-specific modules (POS, Manufacturing, CRM, etc.) are launching soon.
          </p>
        </div>
      </div>

      {/* ── The index and the dossier, side by side ────────────────────
          One section, not two: every sector is listed at once on the left and
          the selected one is open in full on the right. Nothing is shown
          twice. */}
      <section
        data-explorer
        className="surface-soft relative overflow-hidden py-16 sm:py-20"
      >
        <span aria-hidden className="grain" />
        <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          {/* Both columns stretch to the same height, so the index and the
              dossier always end on the same line: whichever is intrinsically
              shorter absorbs the slack rather than leaving one card hanging. */}
          <div className="grid gap-x-12 gap-y-8 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)] lg:items-stretch xl:grid-cols-[minmax(0,380px)_minmax(0,1fr)] xl:gap-x-14">
            {/* ── Left: masthead over the index of all eight sectors ── */}
            <motion.div
              initial={{ opacity: 0, y: reduce ? 0 : 22 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.2 }}
              transition={{ duration: 0.6, ease: EASE }}
              className="min-w-0 lg:flex lg:flex-col"
            >
              <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-primary">
                Every sector we serve
              </p>
              <h2
                className="mt-3.5 font-heading font-extrabold text-text-primary"
                style={{
                  fontSize: 'clamp(1.68rem, 2.35vw, 2.2rem)',
                  lineHeight: 1.08,
                  letterSpacing: '-0.035em',
                }}
              >
                Built for how your floor actually runs
              </h2>
              <p className="mt-4 max-w-xl text-[14.5px] leading-relaxed text-text-secondary">
                The same ledger, the same people records, the same stock — configured around the
                way your sector actually works. Pick your sector to open its playbook.
              </p>

              <div
                role="tablist"
                aria-orientation="vertical"
                aria-label="Industries"
                className="mt-7 grid gap-1 rounded-3xl border border-border bg-white p-2 shadow-card sm:grid-cols-2 lg:grid-cols-1 lg:grid-rows-[repeat(8,minmax(0,1fr))] lg:flex-1"
              >
                {industries.map((ind, i) => {
                  const Icon = ind.icon
                  const on = i === active
                  /* `isolate` keeps the label's z-10 — which lifts it over the
                     sliding emerald fill — contained to this button. */
                  return (
                    <button
                      key={ind.id}
                      ref={(el) => {
                        tabRefs.current[i] = el
                      }}
                      type="button"
                      role="tab"
                      id={`sector-tab-${ind.id}`}
                      aria-selected={on}
                      aria-controls="sector-panel"
                      tabIndex={on ? 0 : -1}
                      onClick={() => setActive(i)}
                      onKeyDown={(e) => onTabKeys(e, i)}
                      className="group relative isolate flex min-w-0 items-center gap-2.5 rounded-xl px-3 py-2.5 text-left transition-colors duration-200 hover:bg-primary-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1"
                    >
                      {on && (
                        <motion.span
                          layoutId="sectorRow"
                          aria-hidden
                          className="absolute inset-0 rounded-xl bg-primary shadow-[0_10px_22px_-12px_rgba(5,150,105,0.85)]"
                          transition={
                            reduce ? { duration: 0 } : { type: 'spring', stiffness: 440, damping: 38 }
                          }
                        />
                      )}
                      <span
                        className={`relative z-10 font-mono text-[11px] tabular-nums transition-colors duration-200 ${
                          on ? 'text-lime' : 'text-text-tertiary/70'
                        }`}
                      >
                        {pad(i + 1)}
                      </span>
                      <Icon
                        size={14}
                        className={`relative z-10 flex-shrink-0 transition-colors duration-200 ${
                          on ? 'text-white' : 'text-primary/70'
                        }`}
                      />
                      <span
                        className={`relative z-10 truncate text-[13px] font-semibold transition-colors duration-200 ${
                          on ? 'text-white' : 'text-text-secondary'
                        }`}
                        style={{ letterSpacing: '-0.01em' }}
                      >
                        {ind.name}
                      </span>
                      <ChevronRight
                        size={14}
                        aria-hidden
                        className={`relative z-10 ml-auto flex-shrink-0 transition-colors duration-200 ${
                          on ? 'text-white/75' : 'text-text-tertiary/40 group-hover:text-primary'
                        }`}
                      />
                    </button>
                  )
                })}
              </div>
            </motion.div>

            {/* ── Right: the selected sector, in full ── */}
            <motion.div
              initial={{ opacity: 0, y: reduce ? 0 : 22 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.12 }}
              transition={{ duration: 0.6, delay: 0.08, ease: EASE }}
              className="grid min-w-0 grid-cols-1 grid-rows-1"
            >
              {/* Invisible sizers hold the cell at the height of the tallest
                  sector, so switching never moves the page. */}
              {industries.map((ind, i) => (
                <div key={ind.id} aria-hidden className="invisible col-start-1 row-start-1 min-w-0">
                  <Dossier index={i} sizer />
                </div>
              ))}

              <div
                id="sector-panel"
                role="tabpanel"
                aria-labelledby={`sector-tab-${current.id}`}
                className="col-start-1 row-start-1 min-w-0"
              >
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div
                    key={current.id}
                    initial={{ opacity: 0, y: reduce ? 0 : 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: reduce ? 0 : -8 }}
                    transition={{ duration: reduce ? 0 : 0.3, ease: EASE }}
                    className="h-full"
                  >
                    <Dossier index={active} />
                  </motion.div>
                </AnimatePresence>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      <CTABanner />
      <Footer />
    </div>
  )
}
