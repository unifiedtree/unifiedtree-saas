import { motion } from 'framer-motion'
import { Shield, Lock, Server, KeyRound, RefreshCcw, FileCheck, Mail } from 'lucide-react'
import { Navbar } from '../components/layout/Navbar'
import { Footer } from '../components/layout/Footer'

const pillars = [
  {
    icon: Lock,
    title: 'Encryption everywhere',
    body:
      'All traffic between your browser, mobile app, and our servers is encrypted in transit with TLS 1.2+. Data at rest on Google Cloud SQL is encrypted with AES-256 keys managed by Google KMS.',
  },
  {
    icon: KeyRound,
    title: 'Authentication built to modern standards',
    body:
      'Passwords are hashed with bcrypt (cost 10). Sessions use JWT bearer tokens tied to your account. Failed-login lockout and OTP flows protect against brute force. Mobile check-in adds face-recognition on top for shared devices.',
  },
  {
    icon: Server,
    title: 'Isolated per tenant',
    body:
      'Every workspace runs under a tenant boundary enforced from JWT claim to SQL row. Requests never cross tenant lines — verified at the API layer and again at the database with row-level policies.',
  },
  {
    icon: RefreshCcw,
    title: 'Automated backups',
    body:
      'The production database is backed up automatically every 24 hours with 7-day retention on Google Cloud SQL. On-demand snapshots are taken before every schema change or destructive operation, kept for 30 days.',
  },
  {
    icon: FileCheck,
    title: 'Least-privilege access',
    body:
      'Application code connects to Postgres as a low-privilege role (ut_app). Admin credentials are stored in Google Secret Manager and rotated. Only two engineers hold break-glass DB access, and every session is logged.',
  },
  {
    icon: Shield,
    title: 'Payments handled off our servers',
    body:
      'Razorpay processes every card and UPI charge inside their PCI-DSS environment. We only store the order and payment identifiers we need for reconciliation — never a card number, CVV, or bank credential.',
  },
]

export function SecurityPage() {
  return (
    <div className="min-h-screen bg-bg">
      <Navbar />

      <section className="pt-32 pb-16 hero-gradient relative overflow-hidden">
        <div className="absolute inset-0 pattern-dots" />
        <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
            <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-body font-semibold uppercase tracking-[0.1em] text-white/70 bg-white/[0.08] border border-white/10 mb-6">
              <Shield size={12} /> Security
            </span>
            <h1 className="font-heading font-extrabold text-white mb-6"
                style={{ fontSize: 'clamp(2.4rem, 4.5vw, 3.5rem)', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
              Your data, protected end to end.
            </h1>
            <p className="text-lg text-white/80 font-body leading-relaxed max-w-2xl mx-auto">
              How we secure the UnifiedTree platform — the honest picture, without the acronym soup.
            </p>
          </motion.div>
        </div>
      </section>

      <section className="py-20 bg-surface">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid md:grid-cols-2 gap-6">
            {pillars.map((p, i) => {
              const Icon = p.icon
              return (
                <motion.div
                  key={p.title}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.06 }}
                  className="premium-card p-7 flex gap-5"
                >
                  <div className="icon-box w-11 h-11 flex-shrink-0 mt-1">
                    <Icon size={20} className="text-primary" />
                  </div>
                  <div>
                    <h3 className="font-heading font-bold text-text-primary text-lg mb-2">{p.title}</h3>
                    <p className="text-text-secondary text-sm font-body leading-relaxed">{p.body}</p>
                  </div>
                </motion.div>
              )
            })}
          </div>
        </div>
      </section>

      <section className="py-20 bg-bg">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="premium-card p-10">
            <h2 className="font-heading font-bold text-text-primary text-2xl mb-3">Responsible disclosure</h2>
            <p className="text-text-secondary font-body leading-relaxed mb-5">
              Found a vulnerability? Please email <a href="mailto:security@unifiedtree.com" className="text-primary hover:underline">security@unifiedtree.com</a> with the details and a proof of concept.
              We&apos;ll acknowledge within 48 hours and keep you posted through the fix. We don&apos;t take legal
              action against researchers acting in good faith, and we credit reporters (with their permission)
              once the issue is resolved.
            </p>
            <a href="mailto:security@unifiedtree.com" className="inline-flex items-center gap-2 text-sm font-body font-semibold text-primary hover:text-primary-dark">
              <Mail size={15} /> security@unifiedtree.com
            </a>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  )
}
