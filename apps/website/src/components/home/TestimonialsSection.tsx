import { motion, useReducedMotion } from 'framer-motion'
import { Star } from 'lucide-react'

/**
 * Customer stories — premium quote cards drifting in a continuous marquee.
 *
 * Sits on `surface-soft` to keep the page alternating light/dark. Every quote
 * rides a single full-bleed row that drifts on a seamless -50% loop; the row
 * pauses while hovered and fades out at the viewport edges via a CSS mask.
 * Under reduced motion the marquee is dropped entirely in favour of the static
 * wrapped grid.
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

/** Per-column vertical offset for the reduced-motion (static grid) fallback. */
const COLUMN_OFFSET = ['', 'lg:mt-10', 'lg:mt-5']

/** Soft fade at both marquee edges so cards enter/exit the frame gently. */
const EDGE_FADE =
  'linear-gradient(90deg, transparent 0%, #000 6%, #000 94%, transparent 100%)'

function StarRating() {
  return (
    <div className="flex gap-1" aria-label="Rated 5 out of 5">
      {[1, 2, 3, 4, 5].map((s) => (
        <Star key={s} size={15} className="fill-primary text-primary" aria-hidden />
      ))}
    </div>
  )
}

type Testimonial = (typeof testimonials)[number]

function TestimonialCard({
  t,
  ariaHidden,
  className = '',
}: {
  t: Testimonial
  ariaHidden?: boolean
  className?: string
}) {
  return (
    <figure
      aria-hidden={ariaHidden || undefined}
      className={`group relative overflow-hidden rounded-3xl border border-border bg-surface p-7 shadow-card transition-all duration-300 hover:-translate-y-1.5 hover:shadow-card-hover ${className}`}
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

        <blockquote className="mt-5 text-[14.5px] leading-relaxed text-text-primary">
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
    </figure>
  )
}

/**
 * The single continuously drifting row. The track holds two identical halves —
 * each the full quote set — and the `marquee` keyframe translates it -50%, so
 * the loop point is invisible. Hovering the track pauses the drift so quotes
 * can be read.
 */
function MarqueeRow({ items, duration }: { items: Testimonial[]; duration: number }) {
  return (
    <div
      className="overflow-hidden pb-8 pt-4"
      style={{ WebkitMaskImage: EDGE_FADE, maskImage: EDGE_FADE }}
    >
      <div
        className="flex w-max animate-marquee hover:[animation-play-state:paused]"
        style={{ animationDuration: `${duration}s` }}
      >
        {[0, 1].map((copy) => (
          <div key={copy} className="flex gap-6 pr-6">
            {items.map((t) => (
              <TestimonialCard
                key={`${copy}-${t.name}`}
                t={t}
                // Only the first half is exposed to assistive tech; the second
                // exists purely to make the loop seamless.
                ariaHidden={copy === 1}
                className="w-[300px] flex-shrink-0 sm:w-[360px] lg:w-[400px]"
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

export function TestimonialsSection() {
  const reduce = useReducedMotion()

  return (
    <section className="surface-soft relative overflow-hidden py-24 lg:py-28">
      {/* Soft emerald bloom so the band has depth behind the cards */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-80"
        style={{
          background:
            'radial-gradient(60% 100% at 50% 0%, rgba(167,243,208,0.42) 0%, rgba(236,253,245,0) 70%)',
        }}
      />
      <span aria-hidden className="grain" />

      <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: reduce ? 0 : 26 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="mx-auto mb-12 max-w-3xl text-center"
        >
          <span className="mb-4 block text-[12.5px] font-semibold uppercase tracking-[0.14em] text-primary">
            Customer stories
          </span>
          <h2
            className="font-heading font-extrabold text-text-primary"
            style={{ fontSize: 'clamp(1.74rem, 3.52vw, 3.045rem)', lineHeight: 1.05, letterSpacing: '-0.035em' }}
          >
            What our customers say
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-[15.5px] leading-relaxed text-text-secondary">
            Real businesses, real results. From manufacturing to retail to services.
          </p>
        </motion.div>
      </div>

      {reduce ? (
        /* Reduced motion: no drift at all — the original static wrapped grid. */
        <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid items-start gap-6 md:grid-cols-2 lg:grid-cols-3">
            {testimonials.map((t, i) => (
              <TestimonialCard key={t.name} t={t} className={COLUMN_OFFSET[i % 3]} />
            ))}
          </div>
        </div>
      ) : (
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true, amount: 0.2 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="relative z-10"
        >
          {/* 48s over one half (six cards) — the exact drift speed of the
              original top row, which is the one the row keeps. */}
          <MarqueeRow items={testimonials} duration={48} />
        </motion.div>
      )}
    </section>
  )
}
