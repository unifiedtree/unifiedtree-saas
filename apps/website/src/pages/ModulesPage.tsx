import { motion } from 'framer-motion'
import { Navbar } from '../components/layout/Navbar'
import { Footer } from '../components/layout/Footer'
import { ModulesGrid } from '../components/modules/ModulesGrid'
import { LandscapeScene } from '../components/visuals/LandscapeScene'

/**
 * /modules — the catalog.
 *
 * Same shape as the rest of the site: a full-bleed emerald valley carries the
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
      <section className="relative overflow-hidden pb-32 pt-36">
        <LandscapeScene tone="dusk" wordmark="Modules" />

        {/* Hand-off into the light band below, so the ridge doesn't cut hard. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[5] h-28 bg-gradient-to-b from-transparent to-[#ECFDF5]" />

        <div className="relative z-10 mx-auto max-w-6xl px-4 text-center sm:px-6 lg:px-8">
          <motion.span
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="mb-7 inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-4 py-1.5 text-[12.5px] font-semibold uppercase tracking-[0.14em] text-white/90 backdrop-blur-sm"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-[#A7F3D0]" />
            All modules
          </motion.span>

          <motion.h1
            initial={{ opacity: 0, y: 26 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.75, ease: EASE }}
            className="font-heading font-extrabold text-white"
            style={{ fontSize: 'clamp(2.5rem, 5.6vw, 4.75rem)', lineHeight: 1.03, letterSpacing: '-0.038em' }}
          >
            All the tools your
            <br className="hidden sm:block" />{' '}
            business needs.
            <br />
            <span className="text-lime">In one tree.</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 22 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.75, delay: 0.1, ease: EASE }}
            className="mx-auto mt-7 max-w-2xl text-[17px] leading-relaxed text-white/85 sm:text-[19px]"
          >
            Browse all 12 modules. Activate only what you need. Mix and match to build your perfect ERP —
            every module works standalone or in perfect harmony with the rest.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.2, ease: EASE }}
            className="mt-10 flex flex-wrap justify-center gap-2.5"
          >
            {HERO_TAGS.map((tag) => (
              <span
                key={tag}
                className="rounded-full border border-white/20 bg-white/10 px-4 py-1.5 text-[13px] font-medium text-white backdrop-blur-sm"
              >
                {tag}
              </span>
            ))}
          </motion.div>
        </div>
      </section>

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
              style={{ fontSize: 'clamp(1.85rem, 3.4vw, 2.75rem)', lineHeight: 1.06, letterSpacing: '-0.035em' }}
            >
              Start with one. Add the rest when you're ready.
            </h2>
            <p className="mt-4 text-[17px] leading-relaxed text-text-secondary">
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
