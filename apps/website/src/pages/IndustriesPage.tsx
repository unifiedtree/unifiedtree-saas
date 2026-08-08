import { useRef, useState } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import {
  Factory, ShoppingBag, Truck, Utensils, Building2,
  Stethoscope, BookOpen, Wrench, ArrowRight, Check,
} from 'lucide-react'
import { Navbar } from '../components/layout/Navbar'
import { Footer } from '../components/layout/Footer'
import { CTABanner } from '../components/home/CTABanner'
import { LandscapeScene } from '../components/visuals/LandscapeScene'

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

/** The ridge motif from LandscapeScene, reduced to a single stroke for card headers. */
function RidgeMotif() {
  return (
    <svg
      viewBox="0 0 400 120"
      preserveAspectRatio="none"
      aria-hidden
      className="pointer-events-none absolute inset-x-0 bottom-0 h-16 w-full"
    >
      <path
        d="M0 92 C 60 62, 110 88, 168 74 C 232 58, 282 34, 340 58 C 372 71, 388 70, 400 76 L400 120 L0 120 Z"
        fill="#FFFFFF"
        fillOpacity="0.10"
      />
      <path
        d="M0 110 C 80 84, 150 108, 224 96 C 300 84, 348 70, 400 88 L400 120 L0 120 Z"
        fill="#FFFFFF"
        fillOpacity="0.08"
      />
    </svg>
  )
}

export function IndustriesPage() {
  const [selected, setSelected] = useState(industries[0].id)
  const active = industries.find((i) => i.id === selected)!
  const reduce = useReducedMotion()
  const explorerRef = useRef<HTMLDivElement>(null)

  const pick = (id: string, scroll = false) => {
    setSelected(id)
    if (scroll) {
      explorerRef.current?.scrollIntoView({
        behavior: reduce ? 'auto' : 'smooth',
        block: 'start',
      })
    }
  }

  const pillTransition = reduce
    ? { duration: 0 }
    : { type: 'spring' as const, stiffness: 420, damping: 34 }

  return (
    <div className="min-h-screen bg-bg">
      <Navbar />

      {/* ── Hero — the valley ─────────────────────────────────────────── */}
      <section className="relative overflow-hidden pt-40 pb-28 sm:pb-36">
        <LandscapeScene tone="dusk" />

        <div className="relative z-10 mx-auto max-w-5xl px-4 text-center sm:px-6 lg:px-8">
          <motion.span
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="mb-7 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-1.5 text-[12.5px] font-semibold uppercase tracking-[0.14em] text-white/90 backdrop-blur-sm"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-lime" />
            Industries
          </motion.span>

          <motion.h1
            initial={{ opacity: 0, y: 26 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.75, ease: [0.16, 1, 0.3, 1] }}
            className="font-heading font-extrabold text-white"
            style={{ fontSize: 'clamp(2.5rem, 5.6vw, 4.75rem)', lineHeight: 1.03, letterSpacing: '-0.038em' }}
          >
            One platform.
            <br />
            <span className="text-lime">Every industry.</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 22 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.75, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
            className="mx-auto mt-7 max-w-2xl text-[17px] leading-relaxed text-white/85 sm:text-[19px]"
          >
            UnifiedTree is trusted across 8 major industries. Same platform, purpose-built
            workflows for each sector.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.75, delay: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="mt-10 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-[13px] font-medium text-white/70"
          >
            <span>8 sectors live today</span>
            <span className="hidden h-1 w-1 rounded-full bg-white/40 sm:block" />
            <span>Same core, different playbook</span>
            <span className="hidden h-1 w-1 rounded-full bg-white/40 sm:block" />
            <span>Go live in a day</span>
          </motion.div>
        </div>
      </section>

      {/* ── Explorer — pill rail + detail panel ───────────────────────── */}
      <section ref={explorerRef} className="scroll-mt-28 bg-white py-20 sm:py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: 26 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.2 }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            className="mx-auto max-w-2xl text-center"
          >
            <p className="text-[12.5px] font-semibold uppercase tracking-[0.14em] text-primary">
              Pick your sector
            </p>
            <h2
              className="mt-4 font-heading font-extrabold text-text-primary"
              style={{ fontSize: 'clamp(2rem, 4vw, 3.25rem)', lineHeight: 1.06, letterSpacing: '-0.035em' }}
            >
              Built for how your floor actually runs
            </h2>
          </motion.div>

          {/* Pill rail */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.2 }}
            transition={{ duration: 0.6, delay: 0.08, ease: [0.16, 1, 0.3, 1] }}
            className="mx-auto mt-10 flex max-w-5xl flex-wrap justify-center gap-2.5"
            role="tablist"
            aria-label="Industries"
          >
            {industries.map((ind) => {
              const Icon = ind.icon
              const isActive = ind.id === selected
              return (
                <button
                  key={ind.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => pick(ind.id)}
                  className={`relative whitespace-nowrap rounded-full border px-4 py-2.5 text-[13.5px] font-semibold transition-colors duration-200 sm:px-5 ${
                    isActive
                      ? 'border-primary text-white'
                      : 'border-border bg-white text-text-secondary shadow-card hover:border-primary/40 hover:text-primary'
                  }`}
                >
                  {isActive && (
                    <motion.span
                      layoutId="industryPill"
                      className="absolute inset-0 rounded-full bg-primary shadow-[0_10px_22px_-10px_rgba(5,150,105,0.75)]"
                      transition={pillTransition}
                    />
                  )}
                  <span className="relative z-10 flex items-center gap-2">
                    <Icon size={15} />
                    {ind.name}
                  </span>
                </button>
              )
            })}
          </motion.div>

          {/* Detail panel */}
          <div className="mt-10">
            <AnimatePresence mode="wait">
              <motion.article
                key={active.id}
                initial={{ opacity: 0, y: reduce ? 0 : 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: reduce ? 0 : -12 }}
                transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                className="overflow-hidden rounded-3xl border border-border bg-white shadow-card"
              >
                {/* Emerald gradient header strip */}
                <div className="relative overflow-hidden bg-gradient-to-br from-[#04503A] via-primary-dark to-primary px-6 py-9 sm:px-10 sm:py-11">
                  <RidgeMotif />
                  <div className="relative z-10 flex flex-col gap-5 sm:flex-row sm:items-center">
                    <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-2xl border border-white/20 bg-white/10 backdrop-blur-sm">
                      <active.icon size={26} className="text-white" />
                    </div>
                    <div className="min-w-0">
                      <h3
                        className="font-heading font-extrabold text-white"
                        style={{ fontSize: 'clamp(1.6rem, 2.6vw, 2.25rem)', letterSpacing: '-0.035em', lineHeight: 1.06 }}
                      >
                        {active.name}
                      </h3>
                      <p className="mt-2 text-[15px] font-semibold text-lime">{active.tagline}</p>
                    </div>
                  </div>
                </div>

                <div className="p-6 sm:p-10">
                  <p className="max-w-3xl text-[17px] leading-relaxed text-text-secondary">
                    {active.description}
                  </p>

                  <div className="mt-10 grid gap-10 lg:grid-cols-2">
                    <div>
                      <h4 className="text-[12.5px] font-semibold uppercase tracking-[0.14em] text-primary">
                        Key use cases
                      </h4>
                      <ul className="mt-5 space-y-3">
                        {active.useCases.map((uc, i) => (
                          <motion.li
                            key={uc}
                            initial={{ opacity: 0, x: reduce ? 0 : -8 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ duration: 0.4, delay: 0.06 * i, ease: [0.16, 1, 0.3, 1] }}
                            className="flex items-start gap-3 text-[15px] leading-relaxed text-text-secondary"
                          >
                            <span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md bg-primary-light">
                              <Check size={12} className="text-primary" strokeWidth={3} />
                            </span>
                            {uc}
                          </motion.li>
                        ))}
                      </ul>
                    </div>

                    <div>
                      <h4 className="text-[12.5px] font-semibold uppercase tracking-[0.14em] text-primary">
                        Recommended modules
                      </h4>
                      <div className="mt-5 flex flex-wrap gap-2">
                        {active.modules.map((mod) => (
                          <span
                            key={mod}
                            className="rounded-full border border-primary/20 bg-primary-light px-3.5 py-1.5 text-[12.5px] font-semibold text-primary"
                          >
                            {mod}
                          </span>
                        ))}
                      </div>

                      {/* Testimonial */}
                      <figure className="relative mt-8 overflow-hidden rounded-2xl border border-border bg-[#ECFDF5] p-6">
                        <span
                          aria-hidden
                          className="pointer-events-none absolute -top-3 right-4 select-none font-heading font-extrabold leading-none text-primary/10"
                          style={{ fontSize: '5rem' }}
                        >
                          &ldquo;
                        </span>
                        <blockquote className="relative z-10 text-[15px] leading-relaxed text-text-secondary">
                          &ldquo;{active.testimonial.quote}&rdquo;
                        </blockquote>
                        <figcaption className="relative z-10 mt-5 flex items-center gap-3">
                          <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-primary text-[12px] font-bold text-white">
                            {active.testimonial.name
                              .replace(/^Dr\.\s*/, '')
                              .split(' ')
                              .map((n) => n[0])
                              .join('')
                              .slice(0, 2)}
                          </span>
                          <span className="min-w-0">
                            <span className="block text-[13.5px] font-bold text-text-primary">
                              {active.testimonial.name}
                            </span>
                            <span className="block text-[12.5px] text-text-tertiary">
                              {active.testimonial.company}
                            </span>
                          </span>
                        </figcaption>
                      </figure>
                    </div>
                  </div>
                </div>
              </motion.article>
            </AnimatePresence>
          </div>
        </div>
      </section>

      {/* ── The full set of sectors ───────────────────────────────────── */}
      <section className="bg-[#ECFDF5] py-20 sm:py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: 26 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.2 }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            className="max-w-2xl"
          >
            <p className="text-[12.5px] font-semibold uppercase tracking-[0.14em] text-primary">
              Every sector we serve
            </p>
            <h2
              className="mt-4 font-heading font-extrabold text-text-primary"
              style={{ fontSize: 'clamp(2rem, 4vw, 3.25rem)', lineHeight: 1.06, letterSpacing: '-0.035em' }}
            >
              Eight industries, one core
            </h2>
            <p className="mt-5 text-[17px] leading-relaxed text-text-secondary">
              The same ledger, the same people records, the same stock — configured around the
              way your sector actually works. Pick a card to open its playbook.
            </p>
          </motion.div>

          <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {industries.map((ind, i) => {
              const Icon = ind.icon
              const isActive = ind.id === selected
              return (
                <motion.button
                  key={ind.id}
                  type="button"
                  onClick={() => pick(ind.id, true)}
                  initial={{ opacity: 0, y: 26 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, amount: 0.2 }}
                  transition={{ duration: 0.6, delay: (i % 4) * 0.08, ease: [0.16, 1, 0.3, 1] }}
                  className={`group flex flex-col overflow-hidden rounded-3xl border bg-white text-left shadow-card transition-all duration-300 hover:-translate-y-1 hover:shadow-card-hover ${
                    isActive ? 'border-primary/40 ring-1 ring-primary/25' : 'border-border'
                  }`}
                >
                  {/* Emerald gradient header strip */}
                  <div className="relative h-24 overflow-hidden bg-gradient-to-br from-[#04503A] via-primary-dark to-primary">
                    <RidgeMotif />
                    <div className="absolute -bottom-6 left-6 flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-white text-primary shadow-card transition-transform duration-300 group-hover:scale-105">
                      <Icon size={24} />
                    </div>
                  </div>

                  <div className="flex flex-1 flex-col px-6 pb-6 pt-10">
                    <h3 className="font-heading text-[17px] font-bold leading-snug text-text-primary" style={{ letterSpacing: '-0.02em' }}>
                      {ind.name}
                    </h3>
                    <p className="mt-2 text-[14px] font-semibold leading-snug text-primary">
                      {ind.tagline}
                    </p>
                    <p className="mt-3 flex-1 text-[13.5px] leading-relaxed text-text-secondary">
                      {ind.useCases[0]} · {ind.useCases[1]}
                    </p>

                    <div className="mt-5 flex flex-wrap gap-1.5">
                      {ind.modules.slice(0, 2).map((mod) => (
                        <span
                          key={mod}
                          className="rounded-full bg-surface-2 px-2.5 py-1 text-[11.5px] font-semibold text-text-secondary"
                        >
                          {mod}
                        </span>
                      ))}
                      {ind.modules.length > 2 && (
                        <span className="rounded-full bg-primary-light px-2.5 py-1 text-[11.5px] font-semibold text-primary">
                          +{ind.modules.length - 2}
                        </span>
                      )}
                    </div>

                    <span className="mt-6 inline-flex items-center gap-1.5 text-[13px] font-bold text-primary">
                      See the playbook
                      <ArrowRight size={14} className="transition-transform duration-300 group-hover:translate-x-1" />
                    </span>
                  </div>
                </motion.button>
              )
            })}
          </div>
        </div>
      </section>

      <CTABanner />
      <Footer />
    </div>
  )
}
