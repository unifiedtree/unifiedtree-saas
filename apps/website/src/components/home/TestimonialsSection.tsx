import { motion } from 'framer-motion'
import { Star } from 'lucide-react'

const testimonials = [
  {
    quote:
      "UnifiedTree’s offline attendance module is a game-changer for our field staff. They mark attendance via face capture even in remote locations, and it syncs perfectly when back in network range.",
    name: 'Ramesh Joshi',
    company: 'Joshi Construction Pvt. Ltd.',
    role: 'CEO',
    initials: 'RJ',
    color: '#0F6E56',
  },
  {
    quote:
      "The GST invoicing in the Accounting module saves my team 12+ hours every month. Auto-generated GSTR-1 reports and e-way bills — no manual work at all. Absolutely brilliant.",
    name: 'Anjali Krishnamurthy',
    company: 'Krishnamurthy Textiles',
    role: 'CFO',
    initials: 'AK',
    color: '#8B5CF6',
  },
  {
    quote:
      "We switched from three different software tools to UnifiedTree. Now our HR, payroll, and inventory all talk to each other. PF and ESI calculations are automatic. Zero errors.",
    name: 'Vikram Patel',
    company: 'VPL Industries',
    role: 'Operations Head',
    initials: 'VP',
    color: '#F59E0B',
  },
  {
    quote:
      "The CRM pipeline and WhatsApp integration together is incredible. Our sales team now follows up on leads in minutes, not days. Conversion rate is up 34% in 2 months.",
    name: 'Sneha Malhotra',
    company: 'TechServ Solutions',
    role: 'Sales Director',
    initials: 'SM',
    color: '#EC4899',
  },
  {
    quote:
      "We run a chain of 8 retail stores. The POS module works flawlessly offline — our billing never stops even when internet is down. Stock levels update centrally when back online.",
    name: 'Kiran Desai',
    company: 'Desai Retail Group',
    role: 'Managing Director',
    initials: 'KD',
    color: '#14B8A6',
  },
  {
    quote:
      "Multi-warehouse inventory with batch tracking was the feature that convinced us to move to UnifiedTree. Expiry date management for our pharmaceutical products is rock solid.",
    name: 'Pradeep Agarwal',
    company: 'MediCure Distributors',
    role: 'Warehouse Manager',
    initials: 'PA',
    color: '#EF4444',
  },
]

function StarRating() {
  return (
    <div className="flex gap-1 mb-4">
      {[1, 2, 3, 4, 5].map((s) => (
        <Star key={s} size={14} className="text-warning fill-warning" />
      ))}
    </div>
  )
}

export function TestimonialsSection() {
  return (
    <section className="py-24 bg-surface-2">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <span className="text-primary font-body font-semibold text-sm uppercase tracking-widest mb-3 block">
            Customer stories
          </span>
          <h2 className="font-heading font-bold text-text-primary" style={{ fontSize: 'clamp(2rem, 3.5vw, 3rem)' }}>
            What our customers say
          </h2>
          <p className="text-text-secondary font-body mt-3 text-lg max-w-xl mx-auto">
            Real businesses, real results. From manufacturing to retail to services.
          </p>
        </motion.div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {testimonials.map((t, i) => (
            <motion.div
              key={t.name}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.2 }}
              transition={{ duration: 0.5, delay: i * 0.08, ease: 'easeOut' }}
              whileHover={{ y: -4 }}
              className="bg-surface rounded-2xl p-6 border border-border shadow-card hover:shadow-card-hover transition-all duration-300"
            >
              <StarRating />
              <p className="text-text-secondary font-body leading-relaxed mb-6 text-sm italic">
                "{t.quote}"
              </p>
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center text-white font-heading font-bold text-sm flex-shrink-0"
                  style={{ backgroundColor: t.color }}
                >
                  {t.initials}
                </div>
                <div>
                  <p className="font-body font-semibold text-text-primary text-sm">{t.name}</p>
                  <p className="text-text-secondary text-xs">
                    {t.role} · {t.company}
                  </p>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}
