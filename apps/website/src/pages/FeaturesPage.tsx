import { motion } from 'framer-motion'
import {
  Wifi, ShieldCheck, Smartphone, Globe, Zap, BarChart2,
  Lock, RefreshCw, Bell, FileText, Users, Settings, Check,
} from 'lucide-react'
import { Navbar } from '../components/layout/Navbar'
import { Footer } from '../components/layout/Footer'
import { CTABanner } from '../components/home/CTABanner'

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
    title: 'India-Compliant by Default',
    description:
      'GST invoicing, e-way bills, GSTR-1/3B filing, TDS, PF, ESI — all built in. Stay compliant without hiring a compliance specialist.',
    points: ['GST e-invoicing & e-way bills', 'GSTR-1, GSTR-3B ready', 'PF, ESI, TDS automation', 'Form 16 & payslip generation'],
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
  { icon: Lock, label: 'AES-256 Encryption at rest' },
  { icon: RefreshCw, label: 'Auto backups every 6 hours' },
  { icon: Bell, label: 'Real-time push notifications' },
  { icon: FileText, label: 'Audit trail on every action' },
  { icon: Users, label: 'Role-based access control' },
  { icon: Settings, label: 'REST API + Webhooks' },
  { icon: Globe, label: 'Multi-currency support' },
  { icon: ShieldCheck, label: '99.9% uptime SLA' },
]

export function FeaturesPage() {
  return (
    <div className="min-h-screen bg-bg">
      <Navbar />

      {/* Hero */}
      <section className="pt-32 pb-24 hero-gradient relative overflow-hidden">
        <div className="absolute inset-0 pattern-dots" />
        <div className="absolute glow-orb w-[500px] h-[500px] bg-accent top-[-200px] left-[30%]" />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center relative">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-body font-semibold uppercase tracking-[0.1em] text-white/70 bg-white/[0.08] border border-white/10 mb-6">
              Platform Features
            </span>
            <h1
              className="font-heading font-extrabold text-white mb-6"
              style={{ fontSize: 'clamp(2.5rem, 5vw, 4rem)', letterSpacing: '-0.02em', lineHeight: 1.08 }}
            >
              Built for the way
              <br />
              <span className="text-accent">Indian businesses actually work.</span>
            </h1>
            <p className="text-lg text-white/75 font-body max-w-2xl mx-auto">
              From offline attendance in remote factories to GST e-filing from an accountant's desk —
              UnifiedTree is engineered for real-world conditions, not demo environments.
            </p>
          </motion.div>
        </div>
      </section>

      {/* Core pillars */}
      <section className="py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-7">
            {pillars.map((pillar, i) => {
              const Icon = pillar.icon
              return (
                <motion.div
                  key={pillar.title}
                  initial={{ opacity: 0, y: 30 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, amount: 0.2 }}
                  transition={{ duration: 0.5, delay: i * 0.08 }}
                  className="premium-card p-8"
                >
                  <div className="icon-box w-12 h-12 mb-6">
                    <Icon size={22} className="text-primary" />
                  </div>
                  <h3 className="font-heading font-bold text-text-primary text-xl mb-3">{pillar.title}</h3>
                  <p className="text-text-secondary font-body text-sm leading-relaxed mb-6">{pillar.description}</p>
                  <ul className="space-y-2.5">
                    {pillar.points.map((pt) => (
                      <li key={pt} className="flex items-center gap-2.5 text-sm text-text-secondary font-body">
                        <div className="w-5 h-5 rounded-lg bg-primary-light flex items-center justify-center flex-shrink-0">
                          <Check size={11} className="text-primary" />
                        </div>
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

      {/* Technical features grid */}
      <section className="py-24 bg-green-gradient pattern-dots relative overflow-hidden">
        <div className="absolute glow-orb w-[400px] h-[400px] bg-accent top-[-100px] right-[10%]" />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-16"
          >
            <h2 className="font-heading font-bold text-white text-3xl mb-3" style={{ letterSpacing: '-0.02em' }}>
              Enterprise-grade. Startup-friendly.
            </h2>
            <p className="text-white/60 font-body">Security and reliability built into every layer.</p>
          </motion.div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {technicalFeatures.map((feat, i) => {
              const Icon = feat.icon
              return (
                <motion.div
                  key={feat.label}
                  initial={{ opacity: 0, scale: 0.95 }}
                  whileInView={{ opacity: 1, scale: 1 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.06 }}
                  whileHover={{ y: -3, scale: 1.02 }}
                  className="flex flex-col items-center gap-3 p-6 bg-white rounded-2xl text-center transition-all duration-300 shadow-md hover:shadow-lg"
                >
                  <div className="icon-box w-11 h-11">
                    <Icon size={18} className="text-primary" />
                  </div>
                  <span className="text-sm font-body font-medium leading-tight text-text-primary">{feat.label}</span>
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
