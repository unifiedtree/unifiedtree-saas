import { motion } from 'framer-motion'
import { Navbar } from '../components/layout/Navbar'
import { Footer } from '../components/layout/Footer'
import { ModulesGrid } from '../components/modules/ModulesGrid'

export function ModulesPage() {
  return (
    <div className="min-h-screen bg-bg">
      <Navbar />

      {/* Hero */}
      <section className="pt-32 pb-20 hero-gradient relative overflow-hidden">
        <div className="absolute inset-0 pattern-dots" />
        <div className="absolute glow-orb w-[500px] h-[500px] bg-accent top-[-200px] left-[30%]" />
        
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center relative">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-body font-semibold uppercase tracking-[0.1em] text-white/70 bg-white/[0.08] border border-white/10 mb-6">
              All Modules
            </span>
            <h1
              className="font-heading font-extrabold text-white mb-6"
              style={{ fontSize: 'clamp(2.5rem, 5vw, 4rem)', letterSpacing: '-0.02em', lineHeight: 1.08 }}
            >
              All the tools your business needs.
              <br />
              <span className="text-accent">In one tree.</span>
            </h1>
            <p className="text-lg text-white/75 font-body max-w-2xl mx-auto mb-8">
              Browse all 12 modules. Activate only what you need. Mix and match to build your perfect ERP.
              Every module is designed to work standalone or in perfect harmony with the rest.
            </p>
            <div className="flex flex-wrap gap-3 justify-center text-sm font-body">
              {['12 Modules', 'India-compliant', 'Offline-capable', 'GST Ready', 'API Access'].map((tag) => (
                <span key={tag} className="px-4 py-1.5 bg-white/10 text-white rounded-full font-medium border border-white/20">
                  {tag}
                </span>
              ))}
            </div>
          </motion.div>
        </div>
      </section>

      {/* Grid */}
      <section className="py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <ModulesGrid />
        </div>
      </section>

      <Footer />
    </div>
  )
}
