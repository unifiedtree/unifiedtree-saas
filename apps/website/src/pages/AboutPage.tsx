import { motion } from 'framer-motion'
import { Heart, Target, Lightbulb, Users } from 'lucide-react'
import { Navbar } from '../components/layout/Navbar'
import { Footer } from '../components/layout/Footer'
import { CTABanner } from '../components/home/CTABanner'

const values = [
  {
    icon: Heart,
    title: 'Built for Bharat',
    description:
      'We built UnifiedTree for the 63 million SMEs in India — businesses that work in the heat, deal with power cuts, and operate in patchy internet zones. Every feature is designed with this reality in mind.',
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

const milestones = [
  { year: '2021', event: 'Founded in Pune by a team of ex-SAP and Zoho engineers' },
  { year: '2022', event: 'Launched HR & Attendance module. First 100 customers.' },
  { year: '2023', event: 'Added Accounting, Inventory, CRM. Series A funding ₹28Cr.' },
  { year: '2024', event: 'Crossed 1,000 businesses. Launched Manufacturing & POS modules.' },
  { year: '2025', event: 'Expanded to 40+ countries. 2,400+ businesses. 12 modules complete.' },
  { year: '2026', event: 'Launched AI-powered insights engine and WhatsApp-native workflows.' },
]

const team = [
  { name: 'Arjun Mehta', role: 'CEO & Co-founder', initials: 'AM', color: '#0F6E56', bio: 'Ex-SAP. 14 years in enterprise ERP. Believes ERP should be as easy as WhatsApp.' },
  { name: 'Priya Krishnan', role: 'CTO & Co-founder', initials: 'PK', color: '#0A3D2F', bio: 'Ex-Zoho. Built the offline-sync engine from scratch. AWS certified architect.' },
  { name: 'Rohan Desai', role: 'CPO', initials: 'RD', color: '#1DB985', bio: 'Ex-Razorpay. Obsessed with reducing clicks. Has interviewed 500+ SME owners.' },
  { name: 'Sneha Agarwal', role: 'Head of Finance Products', initials: 'SA', color: '#0F6E56', bio: 'Chartered Accountant. Designed the GST engine and payroll module. 10 years fintech.' },
  { name: 'Vikram Nair', role: 'Head of Sales', initials: 'VN', color: '#0A3D2F', bio: 'Built the India GTM from 0 to 2,400+ customers. Knows every industrial estate in India.' },
  { name: 'Kavya Rao', role: 'Head of Customer Success', initials: 'KR', color: '#1DB985', bio: 'Ensures every customer goes live in under 48 hours. NPS score: 72.' },
]

export function AboutPage() {
  return (
    <div className="min-h-screen bg-bg">
      <Navbar />

      {/* Hero — DARK gradient for clear text visibility */}
      <section className="pt-32 pb-24 hero-gradient relative overflow-hidden">
        {/* Decorative elements */}
        <div className="absolute inset-0 pattern-dots" />
        <div className="absolute glow-orb w-[500px] h-[500px] bg-accent top-[-200px] right-[-100px]" />
        <div className="absolute glow-orb w-[300px] h-[300px] bg-primary bottom-[-100px] left-[10%]" />

        <div className="absolute inset-0 opacity-[0.06]">
          <div className="absolute top-10 right-10 w-96 h-96 rounded-full border-2 border-white" />
          <div className="absolute bottom-0 left-20 w-64 h-64 rounded-full border-2 border-white" />
          <div className="absolute top-1/2 left-1/2 w-48 h-48 rounded-full border border-white -translate-x-1/2 -translate-y-1/2" />
        </div>

        <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-body font-semibold uppercase tracking-[0.1em] text-white/70 bg-white/[0.08] border border-white/10 mb-6">
              Our Story
            </span>
            <h1
              className="font-heading font-extrabold text-white mb-8"
              style={{ fontSize: 'clamp(2.8rem, 5.5vw, 4.5rem)', letterSpacing: '-0.02em', lineHeight: 1.08 }}
            >
              We built the ERP we
              <br />
              wished we had.
            </h1>
            <p className="text-xl text-white/80 font-body leading-relaxed max-w-2xl mx-auto">
              UnifiedTree was born out of frustration. We watched Indian businesses suffer through
              clunky, expensive ERP systems that assumed perfect infrastructure and unlimited IT budgets.
              We decided to build something different.
            </p>
          </motion.div>
        </div>
      </section>

      {/* Mission */}
      <section className="py-24 bg-surface">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
          >
            <div className="w-20 h-1 bg-gradient-to-r from-primary to-accent rounded-full mx-auto mb-10" />
            <h2 className="font-heading font-bold text-text-primary text-3xl mb-6" style={{ letterSpacing: '-0.02em' }}>Our Mission</h2>
            <p className="text-xl text-text-secondary font-body leading-relaxed">
              To give every Indian SME — whether they're in Mumbai or Muzaffarpur, with 10 employees
              or 10,000 — access to world-class business management software that actually fits the
              way they work.
            </p>
          </motion.div>
        </div>
      </section>

      {/* Values */}
      <section className="py-24 bg-bg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-16"
          >
            <span className="section-badge mb-4 inline-block">Our values</span>
            <h2 className="font-heading font-bold text-text-primary text-3xl" style={{ letterSpacing: '-0.02em' }}>
              What we <span className="gradient-text">believe</span>
            </h2>
          </motion.div>
          <div className="grid md:grid-cols-2 gap-7">
            {values.map((val, i) => {
              const Icon = val.icon
              return (
                <motion.div
                  key={val.title}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.1 }}
                  className="premium-card p-8 flex gap-5"
                >
                  <div className="icon-box w-12 h-12 flex-shrink-0 mt-1">
                    <Icon size={22} className="text-primary" />
                  </div>
                  <div>
                    <h3 className="font-heading font-bold text-text-primary text-xl mb-2">{val.title}</h3>
                    <p className="text-text-secondary font-body leading-relaxed">{val.description}</p>
                  </div>
                </motion.div>
              )
            })}
          </div>
        </div>
      </section>

      {/* Timeline */}
      <section className="py-24 bg-surface">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-16"
          >
            <span className="section-badge mb-4 inline-block">Timeline</span>
            <h2 className="font-heading font-bold text-text-primary text-3xl" style={{ letterSpacing: '-0.02em' }}>
              Our <span className="gradient-text">Journey</span>
            </h2>
          </motion.div>
          <div className="relative">
            <div className="absolute left-8 top-0 bottom-0 w-0.5 bg-gradient-to-b from-primary/20 via-primary/40 to-accent/20" />
            <div className="space-y-8">
              {milestones.map((m, i) => (
                <motion.div
                  key={m.year}
                  initial={{ opacity: 0, x: -20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.08 }}
                  className="flex gap-8 pl-20 relative"
                >
                  <div className="absolute left-0 w-16 h-16 rounded-2xl bg-gradient-to-br from-primary to-accent flex items-center justify-center flex-shrink-0 shadow-lg shadow-primary/20">
                    <span className="text-white font-heading font-bold text-xs">{m.year}</span>
                  </div>
                  <div className="premium-card p-5 flex-1 -mt-1">
                    <p className="text-text-secondary font-body leading-relaxed">{m.event}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Team */}
      <section className="py-24 bg-bg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-16"
          >
            <span className="section-badge mb-4 inline-block">Our team</span>
            <h2 className="font-heading font-bold text-text-primary text-3xl mb-4" style={{ letterSpacing: '-0.02em' }}>
              The team behind <span className="gradient-text">UnifiedTree</span>
            </h2>
            <p className="text-text-secondary font-body text-lg">
              Ex-SAP, Zoho, Razorpay. We've seen ERP from every angle.
            </p>
          </motion.div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {team.map((member, i) => (
              <motion.div
                key={member.name}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.08 }}
                whileHover={{ y: -4 }}
                className="premium-card p-7"
              >
                <div
                  className="w-14 h-14 rounded-2xl flex items-center justify-center text-white font-heading font-bold text-lg mb-5 shadow-md"
                  style={{ background: `linear-gradient(135deg, ${member.color}, ${member.color}cc)` }}
                >
                  {member.initials}
                </div>
                <h3 className="font-heading font-bold text-text-primary text-lg">{member.name}</h3>
                <p className="text-primary text-sm font-body font-semibold mb-3">{member.role}</p>
                <p className="text-text-secondary text-sm font-body leading-relaxed">{member.bio}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <CTABanner />
      <Footer />
    </div>
  )
}
