import { useRef } from 'react'
import { motion, useInView } from 'framer-motion'

const treeCards = [
  { emoji: '🌱', element: 'Roots',    meaning: 'Core Foundation',        erp: 'Database, Infrastructure, Core Modules',          color: '#0F1B08' },
  { emoji: '🪵', element: 'Trunk',    meaning: 'Central System',         erp: 'The Main ERP Engine connecting everything',        color: '#18280E' },
  { emoji: '🌿', element: 'Branches', meaning: 'Departments',            erp: 'Finance, HR, Sales, Inventory, Supply Chain',      color: '#3A7D22' },
  { emoji: '🍃', element: 'Leaves',   meaning: 'End Users / Outputs',    erp: 'Reports, Dashboards, Insights, Transactions',      color: '#5B8C2A' },
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
          {/* RIGHT — Meaning table */}
          <div className="flex flex-col justify-center lg:pl-6">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.6 }}
              className="mb-10"
            >
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/20 mb-6">
                <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                <span className="text-primary font-body font-semibold text-xs uppercase tracking-widest">
                  The Tree Metaphor
                </span>
              </div>
              <h2
                className="font-heading font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-text-primary to-primary mb-5"
                style={{ fontSize: 'clamp(2.25rem, 3.5vw, 3rem)', lineHeight: '1.2' }}
              >
                Why UnifiedTree?
              </h2>
              <p className="text-text-secondary font-body text-lg leading-relaxed max-w-xl">
                Just like a tree grows from one root but branches into many directions — UnifiedTree ERP
                connects every department through one single powerful platform.
              </p>
            </motion.div>

            <div className="space-y-4">
              {treeCards.map((card, i) => (
                <motion.div
                  key={card.element}
                  initial={{ opacity: 0, x: 30 }}
                  animate={inView ? { opacity: 1, x: 0 } : {}}
                  transition={{ duration: 0.5, delay: 0.2 + i * 0.1, ease: 'easeOut' }}
                  whileHover={{ scale: 1.02, x: 5 }}
                  className="group relative bg-white rounded-2xl p-4 border border-black/5 shadow-sm transition-all duration-300 hover:shadow-md"
                >
                  {/* Subtle background gradient on hover */}
                  <div 
                    className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
                    style={{ background: `linear-gradient(90deg, transparent, ${card.color}05)` }}
                  />
                  
                  <div className="relative z-10 flex items-start gap-4">
                    <div
                      className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl flex-shrink-0 shadow-sm transform group-hover:rotate-6 transition-transform duration-300"
                      style={{ backgroundColor: `${card.color}15`, color: card.color }}
                    >
                      {card.emoji}
                    </div>
                    <div className="flex-1 min-w-0 pt-0.5">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="font-heading font-bold text-text-primary text-base group-hover:text-primary transition-colors">
                          {card.element}
                        </span>
                        <span className="text-xs text-text-secondary/60 block sm:inline">·</span>
                        <span className="text-sm font-body font-semibold tracking-wide" style={{ color: card.color }}>
                          {card.meaning}
                        </span>
                      </div>
                      <p className="text-sm text-text-secondary font-body leading-relaxed">{card.erp}</p>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>

            {/* Quote */}
            <motion.div
              initial={{ opacity: 0, y: 15 }}
              animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ delay: 1, duration: 0.6 }}
              className="mt-10 p-6 bg-gradient-to-r from-primary/10 to-transparent rounded-2xl border-l-4 border-primary relative overflow-hidden"
            >
              <div className="absolute top-2 right-4 opacity-10 pointer-events-none">
                <span className="text-7xl font-serif text-primary">"</span>
              </div>
              <p className="text-text-primary font-heading text-lg italic leading-relaxed relative z-10">
                One root. Every branch connected. <span className="font-semibold text-primary">Your business, unified.</span>
              </p>
            </motion.div>
          </div>
        </div>
      </div>
    </section>
  )
}
