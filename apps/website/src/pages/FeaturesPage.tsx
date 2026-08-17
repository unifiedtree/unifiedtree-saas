import { motion, useReducedMotion } from 'framer-motion'
import {
  Wifi, ShieldCheck, Smartphone, Globe, Zap, BarChart2,
  Lock, RefreshCw, Bell, FileText, Users, Settings, Check,
} from 'lucide-react'
import { Navbar } from '../components/layout/Navbar'
import { Footer } from '../components/layout/Footer'
import { CTABanner } from '../components/home/CTABanner'
import { PageHero, EngineeredField } from '../components/marketing/PageHero'
import { ModuleDashboard } from '../components/visuals/ModuleDashboard'

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1]

const pillars = [
  {
    icon: Wifi,
    title: 'Offline-First Architecture',
    description:
      'Every critical operation — attendance, billing, inventory — works without internet. Data syncs automatically the moment connectivity resumes. Built on PWA technology.',
    points: ['Face capture attendance offline', 'POS billing without internet', 'Auto-sync when back online', 'Conflict-free data merge'],
  },
  {
    icon: ShieldCheck,
    title: 'Statutory Compliance Built-In',
    description:
      'Tax-compliant invoicing, statutory payroll deductions, and country-specific filings — all built in. Stay compliant without hiring a specialist. Region packs available, starting with India (GST, PF, ESI, TDS).',
    points: ['Tax-compliant e-invoicing', 'Region-specific return filings', 'Automated statutory deductions', 'Payslip & year-end tax forms'],
  },
  {
    icon: Smartphone,
    title: 'Mobile-First Experience',
    description:
      'Every module has a fully responsive mobile interface. Your team can work from anywhere — field, factory, or office.',
    points: ['Responsive across all devices', 'Native-like PWA on mobile', 'GPS location tracking', 'Push notifications'],
  },
  {
    icon: Globe,
    title: 'Multi-Location & Multi-Branch',
    description:
      'Manage multiple warehouses, offices, and branches from a single dashboard. Centralized control with location-level granularity.',
    points: ['Multi-warehouse inventory', 'Branch-level P&L reporting', 'Inter-branch transfers', 'Consolidated dashboards'],
  },
  {
    icon: Zap,
    title: 'Real-Time Data & Automation',
    description:
      'Trigger workflows, automate approvals, and get live dashboards. Reduce manual work by up to 80%.',
    points: ['Automated approval workflows', 'Scheduled reports via email', 'WhatsApp & SMS alerts', 'Event-driven triggers'],
  },
  {
    icon: BarChart2,
    title: 'Business Intelligence Built In',
    description:
      'No need for a separate BI tool. Build custom dashboards, set KPI targets, and export in any format.',
    points: ['Drag-and-drop dashboard builder', 'Cross-module KPI tracking', 'Excel, PDF, CSV export', 'Role-based data visibility'],
  },
]

const technicalFeatures = [
  { icon: Lock, label: 'AES-256 encryption at rest' },
  { icon: RefreshCw, label: 'Automated daily backups' },
  { icon: Bell, label: 'Real-time push notifications' },
  { icon: FileText, label: 'Audit trail on every action' },
  { icon: Users, label: 'Role-based access control' },
  { icon: Settings, label: 'REST API + Webhooks' },
  { icon: Globe, label: 'Multi-currency support' },
  { icon: ShieldCheck, label: '99.5% uptime SLA' },
]

const heroChips = ['Works offline', 'Compliance built in', 'One connected core']

export function FeaturesPage() {
  const reduce = useReducedMotion()
  const lift = reduce ? '' : 'hover:-translate-y-1'

  return (
    <div className="min-h-screen bg-bg">
      <Navbar />

      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <PageHero
        eyebrow="Platform Features"
        title={
          <>
            Built for the way
            <br />
            growing businesses actually work
          </>
        }
        lede={
          <>
            From offline attendance in remote factories to tax filings from an accountant's desk —
            UnifiedTree is engineered for real-world conditions, not demo environments.
          </>
        }
      >
        <div className="flex flex-wrap items-center justify-center gap-3">
          {heroChips.map((chip) => (
            <span
              key={chip}
              className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-[13.5px] font-semibold text-white/90 backdrop-blur-sm"
            >
              <Check size={13} strokeWidth={3} className="text-lime" />
              {chip}
            </span>
          ))}
        </div>
      </PageHero>

      {/* ── Core pillars ────────────────────────────────────────────── */}
      <section className="bg-white py-24 lg:py-28">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: reduce ? 0 : 26 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.2 }}
            transition={{ duration: 0.6, ease: EASE }}
            className="mx-auto mb-16 max-w-3xl text-center"
          >
            <span className="text-[12.5px] font-semibold uppercase tracking-[0.14em] text-primary">
              Core capabilities
            </span>
            <h2
              className="mt-4 font-heading font-extrabold text-text-primary"
              style={{ fontSize: 'clamp(1.74rem, 3.168vw, 2.828rem)', lineHeight: 1.06, letterSpacing: '-0.035em' }}
            >
              Six decisions that shape the product
            </h2>
            <p className="mx-auto mt-5 max-w-2xl text-[15.5px] leading-relaxed text-text-secondary">
              Not a feature list — the architectural choices your team feels every single day,
              from the shop floor to the finance desk.
            </p>
          </motion.div>

          <div className="grid gap-7 md:grid-cols-2 lg:grid-cols-3">
            {pillars.map((pillar, i) => {
              const Icon = pillar.icon
              return (
                <motion.div
                  key={pillar.title}
                  initial={{ opacity: 0, y: reduce ? 0 : 26 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, amount: 0.2 }}
                  transition={{ duration: 0.6, delay: (i % 3) * 0.08, ease: EASE }}
                  className={`group flex flex-col rounded-3xl border border-border bg-white p-8 shadow-card transition-all duration-300 hover:shadow-card-hover ${lift}`}
                >
                  <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-xl bg-primary-light text-primary transition-colors duration-300 group-hover:bg-primary group-hover:text-white">
                    <Icon size={24} />
                  </div>

                  <h3
                    className="font-heading text-xl font-bold text-text-primary"
                    style={{ letterSpacing: '-0.03em', lineHeight: 1.15 }}
                  >
                    {pillar.title}
                  </h3>
                  <p className="mt-3 text-[15px] leading-relaxed text-text-secondary">{pillar.description}</p>

                  <ul className="mt-6 space-y-3 border-t border-border pt-6">
                    {pillar.points.map((pt) => (
                      <li key={pt} className="flex items-start gap-3 text-[14.5px] leading-snug text-text-secondary">
                        <span className="mt-px flex h-5 w-5 flex-none items-center justify-center rounded-md bg-primary-light text-primary">
                          <Check size={12} strokeWidth={3} />
                        </span>
                        {pt}
                      </li>
                    ))}
                  </ul>
                </motion.div>
              )
            })}
          </div>
        </div>
      </section>

      {/* ── The product, on the engineered surface ──────────────────── */}
      <section className="bg-white pb-24 lg:pb-28">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: reduce ? 0 : 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.15 }}
            transition={{ duration: 0.7, ease: EASE }}
            className="relative overflow-hidden rounded-3xl px-5 py-14 sm:px-10 lg:px-14 lg:py-20"
            style={{ background: 'linear-gradient(158deg, #04503A 0%, #065F46 54%, #047857 100%)' }}
          >
            <EngineeredField />

            <div className="relative z-10">
              <div className="mx-auto max-w-3xl text-center">
                <span className="text-[12.5px] font-semibold uppercase tracking-[0.14em] text-white/70">
                  See it working
                </span>
                <h2
                  className="mt-4 font-heading font-extrabold text-white"
                  style={{ fontSize: 'clamp(1.631rem, 2.816vw, 2.501rem)', lineHeight: 1.08, letterSpacing: '-0.035em' }}
                >
                  Every capability, in one workspace
                </h2>
                <p className="mx-auto mt-5 max-w-xl text-[16px] leading-relaxed text-white/85 sm:text-[15.5px]">
                  Switch modules and watch the numbers stay connected — the same records, the same
                  ledger, no exports in between.
                </p>
              </div>

              <div className="mx-auto mt-12 w-full max-w-4xl">
                <ModuleDashboard />
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ── Technical features ──────────────────────────────────────── */}
      <section className="bg-tint py-24 lg:py-28">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: reduce ? 0 : 26 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.2 }}
            transition={{ duration: 0.6, ease: EASE }}
            className="mx-auto mb-14 max-w-3xl text-center"
          >
            <span className="text-[12.5px] font-semibold uppercase tracking-[0.14em] text-primary">
              Under the hood
            </span>
            <h2
              className="mt-4 font-heading font-extrabold text-text-primary"
              style={{ fontSize: 'clamp(1.74rem, 2.992vw, 2.61rem)', lineHeight: 1.06, letterSpacing: '-0.035em' }}
            >
              Enterprise-grade. Startup-friendly.
            </h2>
            <p className="mx-auto mt-5 max-w-xl text-[15.5px] leading-relaxed text-text-secondary">
              Security and reliability built into every layer.
            </p>
          </motion.div>

          <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:gap-5">
            {technicalFeatures.map((feat, i) => {
              const Icon = feat.icon
              return (
                <motion.div
                  key={feat.label}
                  initial={{ opacity: 0, y: reduce ? 0 : 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, amount: 0.2 }}
                  transition={{ duration: 0.5, delay: (i % 4) * 0.07, ease: EASE }}
                  className={`group flex flex-col gap-4 rounded-2xl border border-border bg-white p-6 shadow-card transition-all duration-300 hover:shadow-card-hover ${lift}`}
                >
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-light text-primary transition-colors duration-300 group-hover:bg-primary group-hover:text-white">
                    <Icon size={19} />
                  </div>
                  <span className="text-[14.5px] font-semibold leading-snug text-text-primary">
                    {feat.label}
                  </span>
                </motion.div>
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
