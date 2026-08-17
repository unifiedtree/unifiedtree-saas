import { motion, useReducedMotion } from 'framer-motion'
import { Users, MessageCircle } from 'lucide-react'
import { Link } from 'react-router-dom'

/**
 * Customer stories — placeholder for the pilot cohort.
 *
 * The six fabricated 5-star testimonials (named CEOs / CFOs / MDs with
 * specific ROI percentages) were removed on 2026-08-17 as part of the
 * CRIT #5 fix. Under India CPA §2(28) invented endorsements are a
 * misleading advertisement, and they cannot go back onto the page until
 * we have real quotes we can attribute to real pilot customers who have
 * given written consent.
 *
 * Until then, this section says exactly that.
 */
export function TestimonialsSection() {
  const reduce = useReducedMotion()

  return (
    <section className="surface-soft relative overflow-hidden py-24 lg:py-28">
      {/* Soft emerald bloom so the band has depth behind the card */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-80"
        style={{
          background:
            'radial-gradient(60% 100% at 50% 0%, rgba(167,243,208,0.42) 0%, rgba(236,253,245,0) 70%)',
        }}
      />
      <span aria-hidden className="grain" />

      <div className="relative z-10 mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: reduce ? 0 : 26 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="mx-auto max-w-3xl text-center"
        >
          <span className="mb-4 block text-[12.5px] font-semibold uppercase tracking-[0.14em] text-primary">
            Customer stories
          </span>
          <h2
            className="font-heading font-extrabold text-text-primary"
            style={{ fontSize: 'clamp(1.74rem, 3.52vw, 3.045rem)', lineHeight: 1.05, letterSpacing: '-0.035em' }}
          >
            Coming soon — stories from our pilot cohort
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-[15.5px] leading-relaxed text-text-secondary">
            We're in launch mode. Real quotes from real customers will land here
            once our pilot teams are ready to be named. In the meantime, if
            you'd like to see the platform, we'd rather show you than tell you.
          </p>

          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Link
              to="/talk-to-us?intent=demo"
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 text-[14.5px] font-semibold text-white shadow-md transition-colors hover:bg-primary-dark"
            >
              <MessageCircle size={16} /> Book a live walkthrough
            </Link>
            <Link
              to="/industries"
              className="inline-flex items-center gap-2 rounded-xl border border-border bg-surface px-6 py-3 text-[14.5px] font-semibold text-text-primary transition-colors hover:border-primary hover:text-primary"
            >
              <Users size={16} /> Who UnifiedTree is for
            </Link>
          </div>
        </motion.div>
      </div>
    </section>
  )
}
