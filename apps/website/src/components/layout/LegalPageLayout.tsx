import { motion } from 'framer-motion'
import { ReactNode } from 'react'
import { Navbar } from './Navbar'
import { Footer } from './Footer'

interface Props {
  title: string
  lastUpdated: string
  intro: string
  children: ReactNode
}

export function LegalPageLayout({ title, lastUpdated, intro, children }: Props) {
  return (
    <div className="min-h-screen bg-bg">
      <Navbar />

      <section className="pt-32 pb-16 hero-gradient relative overflow-hidden">
        <div className="absolute inset-0 pattern-dots" />
        <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
            <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-body font-semibold uppercase tracking-[0.1em] text-white/70 bg-white/[0.08] border border-white/10 mb-6">
              Legal · Last updated {lastUpdated}
            </span>
            <h1
              className="font-heading font-extrabold text-white mb-6"
              style={{ fontSize: 'clamp(2.4rem, 4.5vw, 3.5rem)', letterSpacing: '-0.02em', lineHeight: 1.1 }}
            >
              {title}
            </h1>
            <p className="text-lg text-white/80 font-body leading-relaxed max-w-2xl mx-auto">{intro}</p>
          </motion.div>
        </div>
      </section>

      <section className="py-16 bg-surface">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="prose prose-slate max-w-none text-text-secondary font-body leading-relaxed [&_h2]:font-heading [&_h2]:font-bold [&_h2]:text-text-primary [&_h2]:text-2xl [&_h2]:mt-10 [&_h2]:mb-3 [&_h3]:font-heading [&_h3]:font-semibold [&_h3]:text-text-primary [&_h3]:text-lg [&_h3]:mt-6 [&_h3]:mb-2 [&_p]:mb-4 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:mb-4 [&_ul>li]:mb-1 [&_a]:text-primary [&_a]:no-underline hover:[&_a]:underline">
            {children}
          </div>
        </div>
      </section>

      <Footer />
    </div>
  )
}
