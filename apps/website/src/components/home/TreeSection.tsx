import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, useReducedMotion } from 'framer-motion'
import { ArrowRight } from 'lucide-react'
import type { TreeFocus } from '../visuals/TreeAnatomy'
import { TreePhoto } from '../visuals/TreePhoto'

/**
 * "One root. Every branch connected." — the tree on the left, the argument on
 * the right, wired together.
 *
 * The point of the section: every claim we make has a referent in the drawing.
 * Hover "one data core" and the roots light; hover "six modules" and the
 * branches do. The last point lights the whole tree at once, which is the
 * actual pitch — it only works because it is one organism.
 *
 * Resting state cycles through the parts on its own so a reader who never
 * moves their mouse still sees what the section does; the cycle yields the
 * moment they hover, and reduced motion never cycles at all.
 */

interface Point {
  part: TreeFocus
  label: string
  body: string
}

/** Each point names a part of the tree, and the tree answers. */
const POINTS: Point[] = [
  {
    part: 'roots',
    label: 'One data core',
    body: 'Every module reads and writes the same records. Nothing is copied between systems, so nothing can drift out of agreement.',
  },
  {
    part: 'trunk',
    label: 'One platform spine',
    body: 'Identity, roles, approvals, audit trail and offline sync are built once and shared — not rebuilt module by module.',
  },
  {
    part: 'branches',
    label: 'Six modules',
    body: 'HR, attendance, payroll, accounting, inventory and CRM. Switch on only the ones you need, whenever you need them.',
  },
  {
    part: 'leaves',
    label: 'Reporting that stays true',
    body: 'Dashboards and filings grow from those same records, so the number on your screen is the number you file.',
  },
  {
    part: 'all',
    label: 'One living system',
    body: 'Turn everything on and it still behaves as a single product — because it grew that way, rather than being bundled together.',
  },
]

/** The resting cycle walks the parts in growth order, ending on the whole tree. */
const CYCLE_MS = 2400

export function TreeSection() {
  const navigate = useNavigate()
  const reduce = useReducedMotion()

  /** What the reader is pointing at. Null means "nobody is pointing". */
  const [hovered, setHovered] = useState<TreeFocus>(null)
  const [autoIdx, setAutoIdx] = useState(0)
  /** Once they have touched it, the section stops performing and obeys. */
  const [engaged, setEngaged] = useState(false)

  useEffect(() => {
    if (reduce || engaged) return
    const id = setInterval(() => setAutoIdx((i) => (i + 1) % POINTS.length), CYCLE_MS)
    return () => clearInterval(id)
  }, [reduce, engaged])

  /* Hover wins; otherwise the resting cycle drives it, unless the reader has
     already engaged (then we hold whatever they last looked at) or motion is
     reduced (then nothing moves on its own). */
  const auto = reduce || engaged ? null : POINTS[autoIdx].part
  const focus: TreeFocus = hovered ?? auto

  const point = (p: Point) => {
    const on = focus === p.part
    return (
      <li key={String(p.part)}>
        <button
          type="button"
          onMouseEnter={() => { setEngaged(true); setHovered(p.part) }}
          onMouseLeave={() => setHovered(null)}
          onFocus={() => { setEngaged(true); setHovered(p.part) }}
          onBlur={() => setHovered(null)}
          onClick={() => { setEngaged(true); setHovered(p.part) }}
          aria-pressed={on}
          className={`group w-full rounded-2xl border px-4 py-3.5 text-left transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
            on
              ? 'border-primary/25 bg-primary/[0.06] shadow-[0_10px_28px_-18px_rgba(5,150,105,0.55)]'
              : 'border-transparent bg-transparent hover:border-border hover:bg-surface/70'
          }`}
        >
          <span className="flex items-center gap-2.5">
            {/* The marker is the tell: it fills as its part of the tree lights. */}
            <span
              aria-hidden
              className={`h-2 w-2 shrink-0 rounded-full transition-all duration-300 ${
                on ? 'scale-125 bg-primary' : 'bg-border'
              }`}
            />
            <span
              className={`font-heading text-[16px] font-bold tracking-[-0.02em] transition-colors duration-300 sm:text-[16.5px] ${
                on ? 'text-primary' : 'text-text-primary'
              }`}
            >
              {p.label}
            </span>
          </span>
          <span
            className={`mt-1.5 block pl-[18px] text-[13.5px] leading-[1.55] transition-colors duration-300 sm:text-[14px] ${
              on ? 'text-text-secondary' : 'text-text-tertiary'
            }`}
          >
            {p.body}
          </span>
        </button>
      </li>
    )
  }

  return (
    <section className="surface-soft relative overflow-hidden py-24 lg:py-28">
      {/* Bloom sits under the tree now that the tree has moved left. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(64% 55% at 26% 45%, rgba(16,185,129,0.10), transparent 70%)' }}
      />
      <span aria-hidden className="grain" />

      <div className="relative z-10 mx-auto grid max-w-7xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-[0.86fr_1fr] lg:gap-16 lg:px-8">
        {/* ── The tree (left) ───────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, scale: reduce ? 1 : 0.96 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true, amount: 0.25 }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          className="order-2 lg:order-1"
        >
          <TreePhoto focus={focus} className="mx-auto max-w-[460px]" />
        </motion.div>

        {/* ── The argument (right) ──────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: reduce ? 0 : 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.25 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="order-1 lg:order-2"
        >
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface-2 px-3.5 py-1.5 text-[12px] font-semibold uppercase tracking-[0.14em] text-primary">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            One root · every branch connected
          </span>

          <h2
            className="mt-6 font-heading font-bold text-text-primary"
            style={{ fontSize: 'clamp(1.85rem, 3.4vw, 2.95rem)', lineHeight: 1.05, letterSpacing: '-0.035em' }}
          >
            Run the whole business
            <br />
            on <span className="text-primary">one system</span>.
          </h2>

          <p className="mt-5 max-w-xl text-[15.5px] leading-relaxed text-text-secondary sm:text-[16px]">
            HR, attendance, payroll, accounting, inventory and CRM growing from a single
            core. Point at any part of the claim to see the part of the system it stands on.
          </p>

          {/* The wiring. Leaving the list entirely hands control back. */}
          <ul
            className="mt-7 space-y-0.5"
            onMouseLeave={() => setHovered(null)}
          >
            {POINTS.map(point)}
          </ul>

          <div className="mt-8 flex flex-wrap items-center gap-3.5">
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
      </div>
    </section>
  )
}
