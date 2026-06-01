import { useRef } from 'react'
import { motion, useInView } from 'framer-motion'

const treeCards = [
  { emoji: '🌱', element: 'Roots',    meaning: 'Core Foundation',        erp: 'Database, Infrastructure, Core Modules',          color: '#0A5240' },
  { emoji: '🪵', element: 'Trunk',    meaning: 'Central System',         erp: 'The Main ERP Engine connecting everything',        color: '#0F6E56' },
  { emoji: '🌿', element: 'Branches', meaning: 'Departments',            erp: 'Finance, HR, Sales, Inventory, Supply Chain',      color: '#16A34A' },
  { emoji: '🍃', element: 'Leaves',   meaning: 'End Users / Outputs',    erp: 'Reports, Dashboards, Insights, Transactions',      color: '#22C55E' },
  { emoji: '🍎', element: 'Fruit',    meaning: 'Business Results',       erp: 'Profits, Growth, Productivity',                   color: '#F59E0B' },
  { emoji: '🔗', element: 'Unified',  meaning: 'One Connected Organism', erp: 'All modules working as ONE living system',         color: '#6366F1' },
]

export function TreeSection() {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, amount: 0.15 })

  return (
    <section className="py-24 bg-surface overflow-hidden">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center" ref={ref}>

          {/* LEFT — Video: natural aspect ratio, no forced box */}
          <motion.div
            initial={{ opacity: 0, x: -24 }}
            animate={inView ? { opacity: 1, x: 0 } : {}}
            transition={{ duration: 0.7, ease: 'easeOut' }}
            className="relative w-full rounded-2xl overflow-hidden shadow-card-hover"
            style={{ aspectRatio: '4 / 3' }}
          >
            <video
              src="/tree.mp4"
              autoPlay
              loop
              muted
              playsInline
              className="absolute inset-0 w-full h-full object-cover"
            />
            {/* Soft bottom fade so it blends with white bg */}
            <div
              className="absolute inset-x-0 bottom-0 h-16 pointer-events-none"
              style={{ background: 'linear-gradient(to bottom, transparent, rgba(255,255,255,0.6))' }}
            />
          </motion.div>

          {/* RIGHT — Meaning table */}
          <div>
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.6 }}
              className="mb-8"
            >
              <span className="text-primary font-body font-semibold text-sm uppercase tracking-widest mb-3 block">
                The tree metaphor
              </span>
              <h2
                className="font-heading font-bold text-text-primary mb-4"
                style={{ fontSize: 'clamp(2rem, 3.5vw, 3rem)' }}
              >
                Why UnifiedTree?
              </h2>
              <p className="text-text-secondary font-body leading-relaxed">
                Just like a tree grows from one root but branches into many directions — UnifiedTree ERP
                connects every department through one single powerful platform.
              </p>
            </motion.div>

            <div className="space-y-3">
              {treeCards.map((card, i) => (
                <motion.div
                  key={card.element}
                  initial={{ opacity: 0, x: 30 }}
                  animate={inView ? { opacity: 1, x: 0 } : {}}
                  transition={{ duration: 0.45, delay: 0.25 + i * 0.09, ease: 'easeOut' }}
                  whileHover={{ x: 4, boxShadow: '0 4px 20px rgba(15,110,86,0.10)' }}
                  className="bg-surface border-l-4 rounded-lg p-4 flex items-start gap-4 cursor-default shadow-sm"
                  style={{ borderLeftColor: card.color }}
                >
                  <div
                    className="w-10 h-10 rounded-lg flex items-center justify-center text-lg flex-shrink-0"
                    style={{ backgroundColor: `${card.color}14` }}
                  >
                    {card.emoji}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                      <span className="font-heading font-bold text-text-primary text-sm">{card.element}</span>
                      <span className="text-xs text-text-secondary">·</span>
                      <span className="text-sm font-body font-semibold" style={{ color: card.color }}>
                        {card.meaning}
                      </span>
                    </div>
                    <p className="text-xs text-text-secondary font-body leading-relaxed">{card.erp}</p>
                  </div>
                </motion.div>
              ))}
            </div>

            {/* Quote */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ delay: 1, duration: 0.5 }}
              className="mt-8 p-5 bg-primary-light rounded-xl border border-primary/20 text-center"
            >
              <p className="text-primary font-heading font-semibold text-base italic">
                "💡 One root. Every branch connected. Your business, unified."
              </p>
            </motion.div>
          </div>
        </div>
      </div>
    </section>
  )
}
