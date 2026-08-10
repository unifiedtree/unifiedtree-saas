import { motion } from 'framer-motion'
import { Navbar } from '../components/layout/Navbar'
import { Footer } from '../components/layout/Footer'
import { ModulesGrid } from '../components/modules/ModulesGrid'
import { PageHero } from '../components/marketing/PageHero'

/**
 * /modules — the catalog.
 *
 * Same shape as the rest of the site: a ruled deep-emerald band carries the
 * display type, then the page settles into a light surface where the actual
 * work (picking modules) happens. The catalog itself — plans, prices,
 * selection state — lives in <ModulesGrid />; this file is the stage it sits on.
 */

const HERO_TAGS = ['12 Modules', 'Multi-region compliance', 'Offline-capable', 'Tax Ready', 'API Access']

const EASE = [0.16, 1, 0.3, 1] as const

export function ModulesPage() {
  return (
    <div className="min-h-screen bg-bg">
      <Navbar />

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <PageHero
        eyebrow="All modules"
        title={
          <>
            All the tools your
            <br className="hidden sm:block" />{' '}
            business needs.
            <br />
            <span className="text-lime">In one tree.</span>
          </>
        }
        lede={
          <>
            Browse all 12 modules. Activate only what you need. Mix and match to build your perfect ERP —
            every module works standalone or in perfect harmony with the rest.
          </>
        }
      >
        <div className="flex flex-wrap justify-center gap-2.5">
          {HERO_TAGS.map((tag) => (
            <span
              key={tag}
              className="rounded-full border border-white/20 bg-white/10 px-4 py-1.5 text-[13px] font-medium text-white backdrop-blur-sm"
            >
              {tag}
            </span>
          ))}
        </div>
      </PageHero>

      {/* ── Catalog ──────────────────────────────────────────────────────── */}
      <section className="bg-gradient-to-b from-[#ECFDF5] via-white to-white py-20 lg:py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: 26 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.2 }}
            transition={{ duration: 0.6, ease: EASE }}
            className="mb-12 max-w-2xl"
          >
            <span className="text-[12.5px] font-semibold uppercase tracking-[0.14em] text-primary">
              Build your stack
            </span>
            <h2
              className="mt-3 font-heading font-extrabold text-text-primary"
              style={{ fontSize: 'clamp(1.61rem, 2.992vw, 2.393rem)', lineHeight: 1.06, letterSpacing: '-0.035em' }}
            >
              Start with one. Add the rest when you're ready.
            </h2>
            <p className="mt-4 text-[15.5px] leading-relaxed text-text-secondary">
              Filter by category, open a module to see exactly what's inside, and watch your monthly
              per-user cost build up on the right as you go.
            </p>
          </motion.div>

          <ModulesGrid />
        </div>
      </section>

      <Footer />
    </div>
  )
}
