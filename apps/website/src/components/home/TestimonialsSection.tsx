import { motion, useReducedMotion } from 'framer-motion'
import { Star } from 'lucide-react'

/**
 * Customer stories — premium quote cards on a soft emerald tint band.
 *
 * Sits between the emerald StatsSection and the white IntegrationsSection, so
 * it takes the light tint surface to keep the page alternating. Cards are laid
 * out as a masonry-ish three-column rhythm on lg: each column carries a fixed
 * vertical offset so the grid reads hand-set rather than tabular.
 */

const testimonials = [
  {
    quote:
      "UnifiedTree’s offline attendance module is a game-changer for our field staff. They mark attendance via face capture even in remote locations, and it syncs perfectly when back in network range.",
    name: 'Ramesh Joshi',
    company: 'Joshi Construction Pvt. Ltd.',
    role: 'CEO',
    initials: 'RJ',
    color: '#047857',
  },
  {
    quote:
      "The tax-compliant invoicing in the Accounting module saves my team 12+ hours every month. Auto-generated returns and shipping documents — no manual work at all. Absolutely brilliant.",
    name: 'Anjali Krishnamurthy',
    company: 'Krishnamurthy Textiles',
    role: 'CFO',
    initials: 'AK',
    color: '#059669',
  },
  {
    quote:
      "We switched from three different software tools to UnifiedTree. Now our HR, payroll, and inventory all talk to each other. Statutory calculations are automatic. Zero errors.",
    name: 'Vikram Patel',
    company: 'VPL Industries',
    role: 'Operations Head',
    initials: 'VP',
    color: '#065F46',
  },
  {
    quote:
      "The CRM pipeline and WhatsApp integration together is incredible. Our sales team now follows up on leads in minutes, not days. Conversion rate is up 34% in 2 months.",
    name: 'Sneha Malhotra',
    company: 'TechServ Solutions',
    role: 'Sales Director',
    initials: 'SM',
    color: '#10B981',
  },
  {
    quote:
      "We run a chain of 8 retail stores. The POS module works flawlessly offline — our billing never stops even when internet is down. Stock levels update centrally when back online.",
    name: 'Kiran Desai',
    company: 'Desai Retail Group',
    role: 'Managing Director',
    initials: 'KD',
    color: '#04503A',
  },
  {
    quote:
      "Multi-warehouse inventory with batch tracking was the feature that convinced us to move to UnifiedTree. Expiry date management for our pharmaceutical products is rock solid.",
    name: 'Pradeep Agarwal',
    company: 'MediCure Distributors',
    role: 'Warehouse Manager',
    initials: 'PA',
    color: '#047857',
  },
]

/** Per-column vertical offset that gives the lg grid its masonry rhythm. */
const COLUMN_OFFSET = ['', 'lg:mt-10', 'lg:mt-5']

function StarRating() {
  return (
    <div className="flex gap-1" aria-label="Rated 5 out of 5">
      {[1, 2, 3, 4, 5].map((s) => (
        <Star key={s} size={15} className="fill-primary text-primary" aria-hidden />
      ))}
    </div>
  )
}

export function TestimonialsSection() {
  const reduce = useReducedMotion()

  return (
    <section className="relative overflow-hidden bg-tint py-24 lg:py-28">
      {/* Soft emerald bloom so the tint band has depth behind the cards */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-80"
        style={{
          background:
            'radial-gradient(60% 100% at 50% 0%, rgba(167,243,208,0.55) 0%, rgba(236,253,245,0) 70%)',
        }}
      />

      <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: reduce ? 0 : 26 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="mx-auto mb-16 max-w-3xl text-center"
        >
          <span className="mb-4 block text-[12.5px] font-semibold uppercase tracking-[0.14em] text-primary">
            Customer stories
          </span>
          <h2
            className="font-heading font-extrabold text-text-primary"
            style={{ fontSize: 'clamp(2rem, 4vw, 3.5rem)', lineHeight: 1.05, letterSpacing: '-0.035em' }}
          >
            What our customers say
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-[17px] leading-relaxed text-text-secondary">
            Real businesses, real results. From manufacturing to retail to services.
          </p>
        </motion.div>

        <div className="grid items-start gap-6 md:grid-cols-2 lg:grid-cols-3">
          {testimonials.map((t, i) => (
            <motion.figure
              key={t.name}
              initial={{ opacity: 0, y: reduce ? 0 : 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.2 }}
              transition={{ duration: 0.6, delay: (i % 3) * 0.08, ease: [0.16, 1, 0.3, 1] }}
              whileHover={reduce ? undefined : { y: -6 }}
              className={`group relative overflow-hidden rounded-3xl border border-border bg-surface p-7 shadow-card transition-shadow duration-300 hover:shadow-card-hover ${COLUMN_OFFSET[i % 3]}`}
            >
              {/* Oversized decorative quote glyph */}
              <span
                aria-hidden
                className="pointer-events-none absolute -top-6 right-4 select-none font-heading font-extrabold leading-none text-primary/10 transition-colors duration-300 group-hover:text-primary/20"
                style={{ fontSize: '132px', letterSpacing: '-0.045em' }}
              >
                &ldquo;
              </span>

              <div className="relative z-10">
                <StarRating />

                <blockquote className="mt-5 text-[15.5px] leading-relaxed text-text-primary">
                  {t.quote}
                </blockquote>

                <figcaption className="mt-7 flex items-center gap-3 border-t border-border pt-6">
                  <span
                    aria-hidden
                    className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full font-heading text-[13px] font-bold text-white"
                    style={{ backgroundColor: t.color }}
                  >
                    {t.initials}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[15px] font-semibold text-text-primary">
                      {t.name}
                    </span>
                    <span className="block truncate text-[13px] text-text-tertiary">
                      {t.role} · {t.company}
                    </span>
                  </span>
                </figcaption>
              </div>
            </motion.figure>
          ))}
        </div>
      </div>
    </section>
  )
}
