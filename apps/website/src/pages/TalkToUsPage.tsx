import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Navbar } from '../components/layout/Navbar'
import { Footer } from '../components/layout/Footer'
import { TalkToUsToggle, type TalkIntent } from '../components/forms/TalkToUsToggle'
import { DemoRequestForm } from '../components/forms/DemoRequestForm'
import { ContactSalesForm } from '../components/forms/ContactSalesForm'

/**
 * Merged Request-a-Demo + Contact-Sales page.
 *
 * A single URL — `/talk-to-us` — hosts BOTH forms. The active form is driven
 * by state; the pill toggle at the top swaps the form without a route change.
 * Deep-links land on the right form via `?intent=demo|sales`, and the URL
 * updates as the reader flips the toggle so a shared/bookmarked link is
 * stable.
 *
 * Why one page instead of two routes: the client explicitly asked to see
 * both options together with a switch, so a prospect who lands on the wrong
 * one can pivot without back-button gymnastics.
 */
export function TalkToUsPage() {
  const [params, setParams] = useSearchParams()
  const initial: TalkIntent = params.get('intent') === 'sales' ? 'sales' : 'demo'
  const [intent, setIntent] = useState<TalkIntent>(initial)

  // Keep the URL in sync so a refresh / share preserves the current form.
  useEffect(() => {
    const current = params.get('intent')
    if (current !== intent) {
      const next = new URLSearchParams(params)
      next.set('intent', intent)
      setParams(next, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intent])

  return (
    <div className="min-h-screen bg-[#EBF5DF]">
      <Navbar />
      <main className="pb-24 pt-28 sm:pt-32">
        <div className="mx-auto max-w-2xl px-4">
          <motion.header
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: 'easeOut' }}
            className="mb-8 text-center"
          >
            <h1 className="font-heading text-3xl font-bold text-text-primary sm:text-4xl">
              {intent === 'demo' ? 'See UnifiedTree in action' : 'Talk to our sales team'}
            </h1>
            <p className="mt-3 text-text-secondary">
              {intent === 'demo'
                ? 'Book a personalised walkthrough with our team.'
                : 'Tell us about your business and we will get back within one working day.'}
            </p>
          </motion.header>

          <TalkToUsToggle value={intent} onChange={setIntent} />

          <motion.div
            key={intent}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className="mt-8 rounded-2xl border border-border bg-white p-6 shadow-card sm:p-8"
          >
            {intent === 'demo' ? <DemoRequestForm /> : <ContactSalesForm />}
          </motion.div>
        </div>
      </main>
      <Footer />
    </div>
  )
}
