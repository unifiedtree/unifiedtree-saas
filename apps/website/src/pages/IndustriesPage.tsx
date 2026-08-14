import { useCallback, useRef, useState } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import {
  Factory, ShoppingBag, Truck, Utensils, Building2,
  Stethoscope, BookOpen, Wrench, Check, ChevronRight,
} from 'lucide-react'
import { Navbar } from '../components/layout/Navbar'
import { Footer } from '../components/layout/Footer'
import { CTABanner } from '../components/home/CTABanner'
import { PageHero } from '../components/marketing/PageHero'

const industries = [
  {
    id: 'manufacturing',
    icon: Factory,
    name: 'Manufacturing',
    tagline: 'From BOM to dispatch — fully automated.',
    description:
      'UnifiedTree manages your entire manufacturing lifecycle: raw material procurement, Bill of Materials, work orders, quality checks, and finished goods inventory — all in one system.',
    useCases: [
      'Multi-level Bill of Materials with variants',
      'Work order creation and shop floor tracking',
      'MRP — automatic material requirements planning',
      'Quality control at each production stage',
      'Scrap and waste tracking',
      'Machine and workcenter scheduling',
    ],
    modules: ['Manufacturing', 'Inventory', 'Purchase', 'Accounting', 'HR & Employees'],
    testimonial: {
      quote: "Our production efficiency improved 28% in 3 months. BOM management alone saved us 40 hours per month of manual work.",
      name: 'Rajesh Agarwal',
      company: 'Agarwal Auto Parts, Pune',
    },
  },
  {
    id: 'retail',
    icon: ShoppingBag,
    name: 'Retail & Distribution',
    tagline: 'Never miss a sale — even offline.',
    description:
      'Run a single store or a chain of 50. UnifiedTree POS works offline, syncs inventory centrally, and gives you real-time sales visibility across all locations.',
    useCases: [
      'Offline POS — billing without internet',
      'Multi-store inventory management',
      'Customer loyalty points and discounts',
      'Daily sales reports and end-of-day',
      'Reorder alerts and purchase automation',
      'GST-compliant receipts and invoices',
    ],
    modules: ['Point of Sale', 'Inventory', 'Accounting', 'CRM', 'Reports & BI'],
    testimonial: {
      quote: "We have 8 stores across Maharashtra. UnifiedTree POS handles peak season billing flawlessly — even when the internet goes down.",
      name: 'Kiran Desai',
      company: 'Desai Retail Group',
    },
  },
  {
    id: 'trading',
    icon: Truck,
    name: 'Trading & Distribution',
    tagline: 'Buy right. Sell faster. Track everything.',
    description:
      'From vendor POs to customer delivery, UnifiedTree manages your entire trading operation. 3-way matching, batch tracking, and multi-location inventory built in.',
    useCases: [
      'Purchase order and vendor management',
      'Goods receipt and 3-way matching',
      'Multi-warehouse stock transfers',
      'Customer order fulfillment tracking',
      'Batch and serial number tracking',
      'GST e-way bill generation',
    ],
    modules: ['Purchase', 'Inventory', 'Sales', 'Accounting', 'CRM'],
    testimonial: {
      quote: "Stock reconciliation used to take 3 days every month. With UnifiedTree, it's live — always accurate, always updated.",
      name: 'Priya Shah',
      company: 'Shah Trading Co., Surat',
    },
  },
  {
    id: 'hospitality',
    icon: Utensils,
    name: 'Hospitality & Food',
    tagline: 'Fast billing. Happy tables. Zero chaos.',
    description:
      'Restaurant chains, cloud kitchens, and hotels use UnifiedTree POS for KOT management, table billing, and daily operations. Works seamlessly even during rush hours.',
    useCases: [
      'KOT (Kitchen Order Ticket) management',
      'Table and seat management',
      'Offline billing during connectivity issues',
      'Recipe and ingredient costing',
      'Daily cash register management',
      'Zomato and Swiggy order integration',
    ],
    modules: ['Point of Sale', 'Inventory', 'Accounting', 'HR & Employees', 'Payroll'],
    testimonial: {
      quote: "Our cloud kitchen runs on UnifiedTree. From ordering ingredients to billing — everything in one place. Game changer.",
      name: 'Ananya Mehta',
      company: 'Spice Route Kitchens, Bengaluru',
    },
  },
  {
    id: 'services',
    icon: Building2,
    name: 'Professional Services',
    tagline: 'Project-based billing. Streamlined.',
    description:
      'IT firms, consultancies, architects, and agencies use UnifiedTree to manage projects, track time, invoice clients, and run payroll — all connected.',
    useCases: [
      'Project milestones and task tracking',
      'Timesheet and billable hours',
      'Project-based invoicing',
      'Employee utilization dashboards',
      'Retainer and advance billing',
      'GST invoicing with TDS deduction',
    ],
    modules: ['Projects', 'Accounting', 'HR & Employees', 'Payroll', 'CRM'],
    testimonial: {
      quote: "Tracking billable hours across 12 projects was a nightmare. UnifiedTree Projects solved it in the first week.",
      name: 'Rohan Verma',
      company: 'Verma IT Solutions, Hyderabad',
    },
  },
  {
    id: 'healthcare',
    icon: Stethoscope,
    name: 'Healthcare & Pharma',
    tagline: 'Compliance-ready. Patient-safe.',
    description:
      'Hospitals, clinics, and pharma distributors rely on UnifiedTree for batch tracking, expiry management, compliance reporting, and staff management.',
    useCases: [
      'Batch and expiry date tracking',
      'Controlled substance tracking',
      'FIFO stock valuation for medicines',
      'Staff attendance and shift management',
      'Vendor compliance documentation',
      'Purchase of scheduled drugs tracking',
    ],
    modules: ['Inventory', 'Purchase', 'HR & Employees', 'Attendance', 'Accounting'],
    testimonial: {
      quote: "Expiry management for 3,000+ SKUs was a compliance risk. UnifiedTree's inventory solved it completely.",
      name: 'Dr. Pradeep Kumar',
      company: 'MediCure Distributors, Delhi',
    },
  },
  {
    id: 'education',
    icon: BookOpen,
    name: 'Education',
    tagline: 'Run your institution. Not your spreadsheets.',
    description:
      'Schools, colleges, and coaching institutes use UnifiedTree for staff payroll, attendance, fee management, and expense tracking.',
    useCases: [
      'Staff attendance and payroll',
      'PF, ESI for teaching and non-teaching staff',
      'Expense and budget management',
      'Vendor and supplier management',
      'Asset tracking across campuses',
      'Multi-branch consolidated reports',
    ],
    modules: ['HR & Employees', 'Attendance', 'Payroll', 'Accounting', 'Reports & BI'],
    testimonial: {
      quote: "We manage payroll for 280 staff across 6 campuses. UnifiedTree made it a one-click process.",
      name: 'Sunita Pillai',
      company: 'Pillai Group of Schools, Mumbai',
    },
  },
  {
    id: 'construction',
    icon: Wrench,
    name: 'Construction & Real Estate',
    tagline: 'Projects on time. Costs in control.',
    description:
      'Construction firms use UnifiedTree to manage labour attendance, material procurement, project budgets, and sub-contractor billing.',
    useCases: [
      'GPS-based labour attendance on site',
      'Material procurement and site stock',
      'Project-wise budget vs actuals',
      'Sub-contractor billing and PO management',
      'Equipment tracking',
      'Progress billing and retention management',
    ],
    modules: ['Attendance', 'Purchase', 'Inventory', 'Projects', 'Accounting'],
    testimonial: {
      quote: "GPS attendance at remote construction sites changed everything for us. No more proxy marking. Attendance is now 100% accurate.",
      name: 'Ramesh Joshi',
      company: 'Joshi Construction Pvt. Ltd.',
    },
  },
]

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1]

const pad = (n: number) => String(n).padStart(2, '0')

/** Initials for the testimonial avatar, minus any honorific. */
const initials = (name: string) =>
  name.replace(/^Dr\.\s*/, '').split(' ').map((n) => n[0]).join('').slice(0, 2)

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
            height, so the testimonial always sits on the card's floor rather
            than leaving a ragged gap under it. */}
        <div aria-hidden className="min-h-[1.75rem] flex-1" />

        {/* Testimonial — laid out across the panel so no side is left empty */}
        {ind.testimonial && (
          <figure className="flex flex-col gap-4 rounded-2xl bg-primary-light px-5 py-4 sm:flex-row sm:items-center sm:gap-6 sm:px-6">
            <blockquote className="min-w-0 flex-1 text-[14px] leading-relaxed text-text-secondary">
              &ldquo;{ind.testimonial.quote}&rdquo;
            </blockquote>
            {/* Proportional, not fixed: at lg the dossier column is at its
                narrowest, and a fixed 13.5rem there squeezed the quote into a
                five-line ribbon beside a half-empty attribution. */}
            <figcaption className="flex flex-shrink-0 items-center gap-3 sm:w-[36%] sm:max-w-[13.5rem] sm:border-l sm:border-primary/20 sm:pl-5">
              <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-primary text-[12px] font-bold text-white">
                {initials(ind.testimonial.name)}
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] font-bold leading-snug text-text-primary">
                  {ind.testimonial.name}
                </span>
                <span className="block text-[12px] leading-snug text-text-tertiary">
                  {ind.testimonial.company}
                </span>
              </span>
            </figcaption>
          </figure>
        )}
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
            <span className="text-lime">Every industry.</span>
          </>
        }
        lede={
          <>
            UnifiedTree is trusted across 8 major industries. Same platform, purpose-built
            workflows for each sector.
          </>
        }
      >
        <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-[13px] font-medium text-white/70">
          <span>8 sectors live today</span>
          <span className="hidden h-1 w-1 rounded-full bg-white/40 sm:block" />
          <span>Same core, different playbook</span>
          <span className="hidden h-1 w-1 rounded-full bg-white/40 sm:block" />
          <span>Go live in a day</span>
        </div>
      </PageHero>

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
