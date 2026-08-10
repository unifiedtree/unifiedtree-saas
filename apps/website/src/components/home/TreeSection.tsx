import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, useReducedMotion } from 'framer-motion'
import { ArrowRight, Check } from 'lucide-react'
import { TreeSystem, TREE_NODES } from '../visuals/TreeSystem'

/**
 * "One root. Every branch connected." — the claim on the left, the system
 * drawn on the right.
 *
 * The diagram is ours: one core, roots feeding it, a trunk that forks into two
 * limbs, then a branch per module with live data climbing the active one. It
 * argues the single-source-of-truth point rather than decorating it, and the
 * branches are clickable so a reader can walk the modules.
 */

const PROOF = ['Works offline', 'Tax compliance built in', 'Activate module by module']

export function TreeSection() {
  const navigate = useNavigate()
  const reduce = useReducedMotion()
  const [active, setActive] = useState(0)

  useEffect(() => {
    if (reduce) return
    const id = setInterval(() => setActive((i) => (i + 1) % TREE_NODES.length), 2600)
    return () => clearInterval(id)
  }, [reduce])

  return (
    <section className="surface-soft relative overflow-hidden py-24 lg:py-28">
      {/* Extra bloom on the right so the diagram sits in its own pool of light. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(70% 55% at 78% 40%, rgba(16,185,129,0.10), transparent 70%)' }}
      />
      <span aria-hidden className="grain" />

      <div className="relative z-10 mx-auto grid max-w-7xl items-center gap-14 px-4 sm:px-6 lg:grid-cols-[1.02fr_1fr] lg:gap-10 lg:px-8">
        {/* ── Claim (left) ──────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: reduce ? 0 : 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.25 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        >
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface-2 px-3.5 py-1.5 text-[12px] font-semibold uppercase tracking-[0.14em] text-primary">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            One root · every branch connected
          </span>

          <h2
            className="mt-6 font-heading font-bold text-text-primary"
            style={{ fontSize: 'clamp(1.958rem, 3.872vw, 3.263rem)', lineHeight: 1.03, letterSpacing: '-0.035em' }}
          >
            Run the whole business
            <br />
            on <span className="text-primary">one system</span>.
          </h2>

          <p className="mt-6 max-w-xl text-[15.5px] leading-relaxed text-text-secondary sm:text-[16.5px]">
            HR, attendance, payroll, accounting, inventory and CRM growing from a single
            core — so the number on your dashboard is the number in your report. Switch on
            only the modules you need.
          </p>

          <ul className="mt-7 flex flex-wrap gap-x-6 gap-y-2.5">
            {PROOF.map((p) => (
              <li key={p} className="flex items-center gap-2 text-[14px] font-medium text-text-secondary">
                <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-primary-light">
                  <Check size={11} strokeWidth={3} className="text-primary" />
                </span>
                {p}
              </li>
            ))}
          </ul>

          <div className="mt-9 flex flex-wrap items-center gap-3.5">
            <button
              onClick={() => navigate('/signup')}
              className="group inline-flex items-center gap-2 rounded-xl bg-primary px-7 py-3.5 text-[15px] font-bold text-white shadow-sm transition-all hover:gap-3 hover:bg-primary-dark"
            >
              Start free trial
              <ArrowRight size={17} className="transition-transform group-hover:translate-x-0.5" />
            </button>
            <button
              onClick={() => navigate('/modules')}
              className="rounded-xl border border-border bg-surface px-7 py-3.5 text-[15px] font-bold text-text-primary transition-all hover:border-primary/40 hover:text-primary"
            >
              Explore modules
            </button>
          </div>
        </motion.div>

        {/* ── The system (right) ────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, scale: reduce ? 1 : 0.96 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true, amount: 0.25 }}
          transition={{ duration: 0.8, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
        >
          <TreeSystem active={active} onSelect={setActive} />
        </motion.div>
      </div>
    </section>
  )
}
