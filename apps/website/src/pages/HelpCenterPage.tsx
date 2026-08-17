import { useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ChevronDown, Mail, MessageCircle, BookOpen, LifeBuoy, ShieldCheck } from 'lucide-react'
import { Navbar } from '../components/layout/Navbar'
import { Footer } from '../components/layout/Footer'

const categories = [
  {
    icon: BookOpen,
    title: 'Getting started',
    items: [
      {
        q: 'How do I create my first workspace?',
        a: 'Head to the Pricing page, pick your modules and team size, and hit "Create Workspace with This Plan". A 7-day free trial is available on the paid autopay plan — autopay is set up at signup via Razorpay, and the first charge runs at the end of the trial unless you cancel before then.',
      },
      {
        q: 'How many people can I invite to a workspace?',
        a: 'Your seat count is set when you sign up. You can add or remove seats any time from Workspace Settings → Subscription. New seats are prorated.',
      },
      {
        q: 'Which modules are available today?',
        a: 'HR, Attendance & Payroll is live. The rest — CRM/Sales/POS, SCM, Marketing, Procurement, Inventory & Warehouse, Project Management, Accounting, Manufacturing, and Reports — are launching soon. Check the modules panel on /pricing for the current list.',
      },
    ],
  },
  {
    icon: LifeBuoy,
    title: 'Attendance & the mobile app',
    items: [
      {
        q: 'Where do employees download the app?',
        a: 'From the Google Play Store — search "UnifiedTree". iOS is on the roadmap.',
      },
      {
        q: 'Does the mobile app work offline?',
        a: 'Yes. Check-in / check-out, leave requests, and shift changes work fully offline and sync when the phone reconnects.',
      },
      {
        q: 'Face recognition isn\'t working — what should I do?',
        a: 'Go to Attendance Settings → Face Enrollment → Update Face and re-enroll under good lighting. If you\'re locked out, the lockout auto-clears after 30 minutes; you don\'t lose your saved face templates.',
      },
    ],
  },
  {
    icon: MessageCircle,
    title: 'Billing & subscriptions',
    items: [
      {
        q: 'What payment methods do you accept?',
        a: 'All major Indian cards (Visa, Mastercard, RuPay), UPI, and net banking via Razorpay. Enterprise annual plans can also be paid by bank transfer — email us.',
      },
      {
        q: 'Can I switch between monthly and annual billing?',
        a: 'Yes. Annual billing saves 10%. Switch any time from Workspace Settings → Subscription. The change kicks in on your next renewal.',
      },
      {
        q: 'How do I cancel?',
        a: 'Workspace Settings → Subscription → Cancel. You keep access until the end of the paid cycle. See our Terms for the refund policy.',
      },
    ],
  },
  {
    icon: ShieldCheck,
    title: 'Security & data',
    items: [
      {
        q: 'Where is my data hosted?',
        a: 'UnifiedTree runs on Google Cloud in the asia-south1 region (Mumbai). Data is encrypted at rest (AES-256) and in transit (TLS 1.3).',
      },
      {
        q: 'How often is my data backed up?',
        a: 'Automated daily backups (24-hour recovery point). You can also export your workspace data at any time from Workspace Settings.',
      },
      {
        q: 'What is your uptime commitment?',
        a: 'We target 99.5% monthly uptime. The offline modes on the mobile app (attendance, face capture) keep your team working when connectivity drops.',
      },
    ],
  },
]

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-b border-border last:border-b-0">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-start justify-between gap-4 py-4 text-left"
      >
        <span className="font-body font-semibold text-text-primary">{q}</span>
        <ChevronDown
          size={18}
          className={`mt-1 flex-shrink-0 text-text-tertiary transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && <p className="pb-4 pr-8 text-sm text-text-secondary font-body leading-relaxed">{a}</p>}
    </div>
  )
}

export function HelpCenterPage() {
  return (
    <div className="min-h-screen bg-bg">
      <Navbar />

      <section className="pt-32 pb-16 surface-deep relative overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute inset-0 pattern-dots" />
        <span aria-hidden className="grain grain-dark" />
        <div className="relative z-10 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
            <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-body font-semibold uppercase tracking-[0.1em] text-white/70 bg-white/[0.08] border border-white/10 mb-6">
              Help Center
            </span>
            <h1 className="font-heading font-extrabold text-white mb-6"
                style={{ fontSize: 'clamp(2.088rem, 3.96vw, 3.045rem)', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
              We&apos;re here to help.
            </h1>
            <p className="text-lg text-white/80 font-body leading-relaxed max-w-2xl mx-auto">
              Answers to common questions, guides for your team, and a direct line to us when the docs
              don&apos;t cut it.
            </p>
          </motion.div>
        </div>
      </section>

      <section className="py-16 surface-soft relative overflow-hidden">
        <span aria-hidden className="grain" />
        <div className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 space-y-10">
          {categories.map((cat) => {
            const Icon = cat.icon
            return (
              <div key={cat.title} className="premium-card p-8">
                <div className="mb-4 flex items-center gap-3">
                  <div className="icon-box w-10 h-10">
                    <Icon size={18} className="text-primary" />
                  </div>
                  <h2 className="font-heading font-bold text-text-primary text-xl">{cat.title}</h2>
                </div>
                <div>
                  {cat.items.map((item) => <FaqItem key={item.q} {...item} />)}
                </div>
              </div>
            )
          })}
        </div>
      </section>

      <section className="py-16 surface-tint relative overflow-hidden">
        <span aria-hidden className="grain" />
        <div className="relative z-10 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="premium-card p-10 text-center">
            <h2 className="font-heading font-bold text-text-primary text-2xl mb-3">Still need help?</h2>
            <p className="text-text-secondary font-body mb-8 max-w-xl mx-auto">
              Email us and we&apos;ll respond within one business day. Or book a demo call and we&apos;ll
              walk you through it live.
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <a href="mailto:support@unifiedtree.com" className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-body font-semibold text-white hover:bg-primary-dark">
                <Mail size={16} /> support@unifiedtree.com
              </a>
              <Link to="/talk-to-us?intent=demo" className="inline-flex items-center gap-2 rounded-xl border border-border bg-surface px-6 py-3 text-sm font-body font-semibold text-text-primary hover:border-primary hover:text-primary">
                <MessageCircle size={16} /> Book a demo
              </Link>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  )
}
