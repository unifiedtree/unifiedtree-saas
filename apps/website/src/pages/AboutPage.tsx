import { motion, useReducedMotion } from 'framer-motion'
import {
  Heart, Target, Lightbulb, Users,
  WifiOff, Clock, Receipt, Layers, ShieldCheck, Zap,
  Globe2, Rocket, Code2, Handshake, Headset, PenTool,
} from 'lucide-react'
import { Navbar } from '../components/layout/Navbar'
import { Footer } from '../components/layout/Footer'
import { CTABanner } from '../components/home/CTABanner'
import { PageHero, EngineeredField, EmeraldHairline } from '../components/marketing/PageHero'

const values = [
  {
    icon: Heart,
    title: 'Built for the Global Market',
    description:
      'We built UnifiedTree for businesses operating in dynamic, fast-paced markets worldwide — companies that deal with power fluctuations, shifting local regulations, and patchy internet zones. Every feature is designed with this operational reality in mind.',
  },
  {
    icon: Target,
    title: 'Radical Simplicity',
    description:
      'ERP software has a reputation for being complex and expensive to implement. We reject that. UnifiedTree should be live in your business within a day — not months.',
  },
  {
    icon: Lightbulb,
    title: 'Offline-First Philosophy',
    description:
      'Most SaaS assumes perfect internet. We don\'t. Our core principle: if it\'s critical to your business, it must work offline. Sync is a feature, not a requirement.',
  },
  {
    icon: Users,
    title: 'Customer Obsession',
    description:
      'Every feature on our roadmap comes from a customer conversation. We visit businesses, sit with accountants, and walk factory floors. We build what\'s needed — nothing more.',
  },
]

/** The three chapters of how UnifiedTree came to exist. */
const story = [
  {
    chapter: '01',
    eyebrow: 'The problem',
    title: 'Software written for a world our customers don’t work in',
    body:
      'We spent years implementing other people’s ERP inside factories, distribution warehouses and clinics. The pattern never changed: the demo assumed fibre internet, a full-time IT team and a budget measured in years. The shop floor had none of those.',
    points: [
      {
        icon: WifiOff,
        label: 'Billing stopped when the line dropped',
        detail: 'A four-hour outage turned into a day of handwritten receipts and a week of re-keying.',
      },
      {
        icon: Clock,
        label: 'Implementations measured in quarters',
        detail: 'Most of that time was spent migrating data nobody fully trusted afterwards.',
      },
      {
        icon: Receipt,
        label: 'Three systems, three versions of the truth',
        detail: 'Payroll, stock and the ledger disagreed — and month-end was the referee.',
      },
    ],
  },
  {
    chapter: '02',
    eyebrow: 'The decision',
    title: 'One core, modules on top, offline by default',
    body:
      'So we started again from the data model. One shared core that every module reads and writes — people, stock, ledger, customers. Activate a module and it inherits everything already there. Nothing to integrate, nothing to reconcile, nothing to export.',
    points: [
      {
        icon: Layers,
        label: 'A single record, everywhere',
        detail: 'An employee added in HR is already on the attendance roster and the payroll run.',
      },
      {
        icon: Zap,
        label: 'Local-first operations',
        detail: 'Billing and attendance keep working without a connection, then sync the moment it returns.',
      },
      {
        icon: ShieldCheck,
        label: 'Compliance built in, not bolted on',
        detail: 'Tax rules and statutory filings live with the ledger that produces them.',
      },
    ],
  },
  {
    chapter: '03',
    eyebrow: 'Where we are',
    title: 'A platform businesses switch on in an afternoon',
    body:
      'Today UnifiedTree runs manufacturing lines, retail chains, clinics, campuses and construction sites. The promise has not changed since the first install: pick the modules you need, keep the ones that earn their place, and be running the same day.',
    points: [
      {
        icon: Rocket,
        label: 'Live on day one',
        detail: 'Guided setup, sample data you can throw away, and your first invoice before lunch.',
      },
      {
        icon: Globe2,
        label: 'Local rules, global platform',
        detail: 'Multi-currency, multi-entity and region-specific tax handled by the same core.',
      },
      {
        icon: Handshake,
        label: 'Roadmap built in the open',
        detail: 'Every release note traces back to a customer conversation we can name.',
      },
    ],
  },
]

const stats = [
  { value: '2,400+', label: 'Businesses run on UnifiedTree', sub: 'from 4-person shops to 10,000-strong groups' },
  { value: '14', label: 'Countries with live workspaces', sub: 'multi-entity, multi-currency, one core' },
  { value: '99.9%', label: 'Platform uptime, trailing 12 months', sub: 'offline mode covers the rest' },
  { value: '1 day', label: 'Median time to first invoice', sub: 'not one quarter, not one month' },
]

const team = [
  {
    icon: Code2,
    group: 'Product & Engineering',
    count: '34 people',
    description:
      'Ships every second Tuesday. Half the team has implemented ERP on a factory floor, which is why the release notes read like operations notes.',
  },
  {
    icon: Handshake,
    group: 'Implementation',
    count: '18 people',
    description:
      'On site the week you sign. They migrate your ledger, train your supervisors, and hand the system over configured — not blank.',
  },
  {
    icon: Headset,
    group: 'Customer Support',
    count: '22 people',
    description:
      'Same-day response in your working hours, escalation paths that end at an engineer, and no ticket closed until the workflow runs.',
  },
  {
    icon: PenTool,
    group: 'Design & Research',
    count: '9 people',
    description:
      'They spend more time in warehouses than in Figma. Every screen is tested with the person who will actually use it at 6am.',
  },
]

export function AboutPage() {
  const reduce = useReducedMotion()

  return (
    <div className="min-h-screen bg-bg">
      <Navbar />

      {/* ── Hero ──────────────────────────────────────────────────────── */}
      <PageHero
        eyebrow="Our story"
        title={
          <>
            We built the ERP we
            <br />
            wished we had.
          </>
        }
        lede={
          <>
            UnifiedTree was born out of frustration. We watched growing businesses worldwide suffer
            through clunky, expensive ERP systems that assumed perfect infrastructure and unlimited
            IT budgets. We decided to build something different.
          </>
        }
      />

      {/* ── Mission + story share one continuous soft surface ─────────── */}
      <div className="surface-soft relative overflow-hidden">
        <span aria-hidden className="grain" />

        {/* ── Mission ───────────────────────────────────────────────────── */}
        <section className="relative py-24 sm:py-28">
          <div className="mx-auto max-w-4xl px-4 text-center sm:px-6 lg:px-8">
            <motion.div
              initial={{ opacity: 0, y: 26 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.3 }}
              transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            >
              {/* Clean emerald divider */}
              <span className="mx-auto mb-10 block h-1 w-16 rounded-full bg-primary" />

              <p className="text-[12.5px] font-semibold uppercase tracking-[0.14em] text-primary">
                Our mission
              </p>
              <h2
                className="mt-5 font-heading font-extrabold text-text-primary"
                style={{ fontSize: 'clamp(1.653rem, 3.168vw, 2.61rem)', lineHeight: 1.08, letterSpacing: '-0.035em' }}
              >
                World-class business software that fits the way you already work
              </h2>
              <p className="mx-auto mt-7 max-w-2xl text-[15.5px] leading-relaxed text-text-secondary sm:text-[17px]">
                To give every growing enterprise — whether in London or Lima, with 10 employees or
                10,000 — access to world-class business management software that actually fits the
                way they work.
              </p>
            </motion.div>
          </div>
        </section>

        {/* ── Story — alternating chapters ──────────────────────────────── */}
        <section className="relative pb-24 sm:pb-28">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="space-y-24 sm:space-y-32">
              {story.map((ch, i) => {
                const flipped = i % 2 === 1
                return (
                  <motion.div
                    key={ch.chapter}
                    initial={{ opacity: 0, y: 26 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true, amount: 0.2 }}
                    transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                    className="grid items-center gap-12 lg:grid-cols-2 lg:gap-20"
                  >
                    {/* Copy */}
                    <div className={flipped ? 'lg:order-2' : ''}>
                      <div className="flex items-center gap-4">
                        <span className="font-heading text-[13px] font-bold tracking-[0.14em] text-primary">
                          {ch.chapter}
                        </span>
                        <span className="h-px w-10 bg-primary/30" />
                        <span className="text-[12.5px] font-semibold uppercase tracking-[0.14em] text-text-tertiary">
                          {ch.eyebrow}
                        </span>
                      </div>

                      <h3
                        className="mt-6 font-heading font-extrabold text-text-primary"
                        style={{ fontSize: 'clamp(1.522rem, 2.816vw, 2.393rem)', lineHeight: 1.08, letterSpacing: '-0.035em' }}
                      >
                        {ch.title}
                      </h3>
                      <p className="mt-6 max-w-xl text-[15.5px] leading-relaxed text-text-secondary">
                        {ch.body}
                      </p>
                    </div>

                    {/* Panel */}
                    <div className={flipped ? 'lg:order-1' : ''}>
                      <div className="relative overflow-hidden rounded-3xl border border-border bg-[#ECFDF5] p-7 shadow-card sm:p-9">
                        <span
                          aria-hidden
                          className="pointer-events-none absolute -right-2 -top-6 select-none font-heading font-extrabold leading-none text-primary/10"
                          style={{ fontSize: 'clamp(5.22rem, 10.56vw, 7.83rem)', letterSpacing: '-0.045em' }}
                        >
                          {ch.chapter}
                        </span>

                        <div className="relative z-10 space-y-3">
                          {ch.points.map((p, j) => {
                            const Icon = p.icon
                            return (
                              <motion.div
                                key={p.label}
                                initial={{ opacity: 0, y: reduce ? 0 : 14 }}
                                whileInView={{ opacity: 1, y: 0 }}
                                viewport={{ once: true, amount: 0.4 }}
                                transition={{ duration: 0.5, delay: 0.08 * j, ease: [0.16, 1, 0.3, 1] }}
                                className="flex gap-4 rounded-2xl border border-border bg-white p-5 shadow-card transition-all duration-300 hover:-translate-y-1 hover:shadow-card-hover"
                              >
                                <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-primary-light text-primary">
                                  <Icon size={20} />
                                </span>
                                <span className="min-w-0">
                                  <span className="block font-heading text-[15px] font-bold leading-snug text-text-primary" style={{ letterSpacing: '-0.02em' }}>
                                    {p.label}
                                  </span>
                                  <span className="mt-1.5 block text-[13.5px] leading-relaxed text-text-secondary">
                                    {p.detail}
                                  </span>
                                </span>
                              </motion.div>
                            )
                          })}
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )
              })}
            </div>
          </div>
        </section>

      </div>

      {/* ── Stat band — deep emerald surface ──────────────────────────── */}
      <section className="surface-deep relative overflow-hidden py-24 sm:py-28">
        <EngineeredField />
        <EmeraldHairline />

        <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: 26 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.2 }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            className="max-w-2xl"
          >
            <p className="text-[12.5px] font-semibold uppercase tracking-[0.14em] text-white/70">
              By the numbers
            </p>
            <h2
              className="mt-4 font-heading font-extrabold text-white"
              style={{ fontSize: 'clamp(1.653rem, 3.168vw, 2.61rem)', lineHeight: 1.06, letterSpacing: '-0.035em' }}
            >
              Ten years of shop-floor lessons, running in production
            </h2>
          </motion.div>

          <div className="mt-14 grid gap-x-8 gap-y-12 sm:grid-cols-2 lg:grid-cols-4">
            {stats.map((s, i) => (
              <motion.div
                key={s.label}
                initial={{ opacity: 0, y: 26 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.3 }}
                transition={{ duration: 0.6, delay: i * 0.08, ease: [0.16, 1, 0.3, 1] }}
                className="border-t border-white/20 pt-6"
              >
                <p
                  className="font-heading font-extrabold text-white"
                  style={{ fontSize: 'clamp(2.175rem, 4.048vw, 3.263rem)', lineHeight: 1.02, letterSpacing: '-0.04em' }}
                >
                  {s.value}
                </p>
                <p className="mt-3 text-[15px] font-semibold leading-snug text-white">{s.label}</p>
                <p className="mt-1.5 text-[13.5px] leading-relaxed text-white/70">{s.sub}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Values ────────────────────────────────────────────────────── */}
      <section className="surface-tint relative overflow-hidden py-24 sm:py-28">
        <span aria-hidden className="grain" />
        <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: 26 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.2 }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            className="max-w-2xl"
          >
            <p className="text-[12.5px] font-semibold uppercase tracking-[0.14em] text-primary">
              Our values
            </p>
            <h2
              className="mt-4 font-heading font-extrabold text-text-primary"
              style={{ fontSize: 'clamp(1.74rem, 3.52vw, 2.828rem)', lineHeight: 1.06, letterSpacing: '-0.035em' }}
            >
              What we <span className="text-primary">believe</span>
            </h2>
          </motion.div>

          <div className="mt-14 grid gap-6 md:grid-cols-2">
            {values.map((val, i) => {
              const Icon = val.icon
              return (
                <motion.div
                  key={val.title}
                  initial={{ opacity: 0, y: 26 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, amount: 0.2 }}
                  transition={{ duration: 0.6, delay: (i % 2) * 0.08, ease: [0.16, 1, 0.3, 1] }}
                  className="flex gap-5 rounded-3xl border border-border bg-white p-8 shadow-card transition-all duration-300 hover:-translate-y-1 hover:shadow-card-hover"
                >
                  <span className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-primary-light text-primary">
                    <Icon size={22} />
                  </span>
                  <div className="min-w-0">
                    <h3 className="font-heading text-[17px] font-bold text-text-primary" style={{ letterSpacing: '-0.025em' }}>
                      {val.title}
                    </h3>
                    <p className="mt-3 text-[15px] leading-relaxed text-text-secondary">
                      {val.description}
                    </p>
                  </div>
                </motion.div>
              )
            })}
          </div>
        </div>
      </section>

      {/* ── The team ──────────────────────────────────────────────────── */}
      <section className="surface-soft relative overflow-hidden py-24 sm:py-28">
        <span aria-hidden className="grain" />
        <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: 26 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.2 }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            className="max-w-2xl"
          >
            <p className="text-[12.5px] font-semibold uppercase tracking-[0.14em] text-primary">
              The team
            </p>
            <h2
              className="mt-4 font-heading font-extrabold text-text-primary"
              style={{ fontSize: 'clamp(1.74rem, 3.52vw, 2.828rem)', lineHeight: 1.06, letterSpacing: '-0.035em' }}
            >
              Who you actually talk to
            </h2>
            <p className="mt-5 text-[15.5px] leading-relaxed text-text-secondary">
              No call centre, no ticket lottery. Four groups of people, all of whom have spent
              time inside the businesses they build for.
            </p>
          </motion.div>

          <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {team.map((t, i) => {
              const Icon = t.icon
              return (
                <motion.div
                  key={t.group}
                  initial={{ opacity: 0, y: 26 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, amount: 0.2 }}
                  transition={{ duration: 0.6, delay: i * 0.08, ease: [0.16, 1, 0.3, 1] }}
                  className="flex flex-col overflow-hidden rounded-3xl border border-border bg-white shadow-card transition-all duration-300 hover:-translate-y-1 hover:shadow-card-hover"
                >
                  <div className="relative h-20 overflow-hidden bg-gradient-to-br from-[#04503A] via-primary-dark to-primary">
                    {/* Soft top-light, no linework — the card-scale version of the band surface. */}
                    <div
                      aria-hidden
                      className="pointer-events-none absolute inset-0"
                      style={{
                        background:
                          'radial-gradient(95% 130% at 80% -20%, rgba(167,243,208,0.22), transparent 62%),' +
                          'radial-gradient(80% 120% at 8% 120%, rgba(2,40,30,0.35), transparent 70%)',
                      }}
                    />
                    <div className="absolute -bottom-6 left-6 flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-white text-primary shadow-card">
                      <Icon size={22} />
                    </div>
                  </div>

                  <div className="flex flex-1 flex-col px-6 pb-7 pt-10">
                    <h3 className="font-heading text-[15.5px] font-bold leading-snug text-text-primary" style={{ letterSpacing: '-0.02em' }}>
                      {t.group}
                    </h3>
                    <p className="mt-1.5 text-[13px] font-semibold uppercase tracking-[0.1em] text-primary">
                      {t.count}
                    </p>
                    <p className="mt-4 flex-1 text-[14px] leading-relaxed text-text-secondary">
                      {t.description}
                    </p>
                  </div>
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
