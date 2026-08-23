import { useNavigate } from 'react-router-dom'
import { motion, useReducedMotion } from 'framer-motion'
import { ArrowRight, Sprout, Layers, GitBranch, Leaf, Sparkles, Link2 } from 'lucide-react'
import { useCtaMode } from '../../hooks/useCtaMode'

/**
 * "Why UnifiedTree?" — the tree on the left, the metaphor on the right.
 *
 * The illustration is a single flat PNG (client-supplied, 2026-08-22) rather
 * than the five layered tree-part cut-outs this section used before. That
 * changes what the section can do: with one image there is no way to light an
 * individual branch, so the old hover-a-claim-and-the-tree-answers wiring is
 * gone. What replaces it is calmer and still honest — the tree breathes on its
 * own, and the six rows carry the mapping in words.
 *
 * The PNG ships on a white ground, so it is composited with `mix-blend-multiply`
 * to knock the white out against the tinted section instead of sitting in a
 * visible white rectangle.
 */

interface Part {
  icon: typeof Sprout
  name: string
  role: string
  detail: string
}

/** Reads bottom-up, the way the tree grows: roots first, fruit last. */
const PARTS: Part[] = [
  { icon: Sprout,    name: 'Roots',    role: 'Core Foundation',        detail: 'Database, Infrastructure, Core Modules' },
  { icon: Layers,    name: 'Trunk',    role: 'Central System',         detail: 'The Main ERP Engine connecting everything' },
  { icon: GitBranch, name: 'Branches', role: 'Departments',            detail: 'Finance, HR, Sales, Inventory, Supply Chain' },
  { icon: Leaf,      name: 'Leaves',   role: 'End Users / Outputs',    detail: 'Reports, Dashboards, Insights, Transactions' },
  { icon: Sparkles,  name: 'Fruit',    role: 'Business Results',       detail: 'Profits, Growth, Productivity' },
  { icon: Link2,     name: 'Unified',  role: 'One Connected Organism', detail: 'All modules working as ONE living system' },
]

export function TreeSection() {
  const navigate = useNavigate()
  /* Same rule as the header and hero — see useCtaMode. */
  const { href: ctaHref } = useCtaMode()
  const reduce = useReducedMotion()

  return (
    <section className="surface-soft relative overflow-hidden py-24 lg:py-28">
      {/* Bloom sits under the tree, on the left half. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(64% 55% at 26% 45%, rgba(16,185,129,0.10), transparent 70%)' }}
      />
      <span aria-hidden className="grain" />

      <div className="relative z-10 mx-auto grid max-w-7xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-[0.86fr_1fr] lg:gap-16 lg:px-8">
        {/* ── The tree (left) ───────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, scale: reduce ? 1 : 0.94 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true, amount: 0.25 }}
          transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
          className="order-2 lg:order-1"
        >
          <div className="relative mx-auto max-w-[460px]">
            {/* Soft ground shadow — anchors the tree so it does not float. */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-[18%] bottom-[6%] h-6 rounded-[50%] blur-xl"
              style={{ background: 'rgba(6,95,70,0.18)' }}
            />
            <motion.img
              src="/assets/tree-parts/treemain.png"
              alt="A tree with its root system shown below ground — one root, many branches"
              loading="lazy"
              decoding="async"
              className="relative w-full select-none mix-blend-multiply"
              /* Sway pivots at the base, where a real trunk meets the ground.
                 Rotating about the centre would read as hovering-and-rocking
                 rather than growing. */
              style={{ transformOrigin: '50% 92%' }}
              animate={reduce ? undefined : { rotate: [-0.9, 0.9, -0.9], y: [0, -7, 0] }}
              transition={reduce ? undefined : { duration: 10, repeat: Infinity, ease: 'easeInOut' }}
            />
          </div>
        </motion.div>

        {/* ── The metaphor (right) ──────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: reduce ? 0 : 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.25 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="order-1 lg:order-2"
        >
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface-2 px-3.5 py-1.5 text-[12px] font-semibold uppercase tracking-[0.14em] text-primary">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            The tree metaphor
          </span>

          <h2
            className="mt-6 font-heading font-bold text-text-primary"
            style={{ fontSize: 'clamp(1.85rem, 3.4vw, 2.95rem)', lineHeight: 1.05, letterSpacing: '-0.035em' }}
          >
            Why <span className="text-primary">UnifiedTree</span>?
          </h2>

          <p className="mt-5 max-w-xl text-[15.5px] leading-relaxed text-text-secondary sm:text-[16px]">
            Just like a tree grows from one root but branches into many directions —
            UnifiedTree ERP connects every department through one single powerful platform.
          </p>

          {/* Six rows, bottom-up. The left rule deepens as you climb the tree:
              one emerald family rather than six unrelated hues, so the ramp
              reads as growth instead of as six unrelated categories. */}
          <ul className="mt-7 space-y-2">
            {PARTS.map((part, i) => {
              const Icon = part.icon
              /* 0 -> 1 up the tree; drives both the rule and the chip tint. */
              const depth = i / (PARTS.length - 1)
              return (
                <motion.li
                  key={part.name}
                  initial={{ opacity: 0, x: reduce ? 0 : -12 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true, amount: 0.4 }}
                  transition={{ duration: 0.45, delay: reduce ? 0 : i * 0.07, ease: [0.16, 1, 0.3, 1] }}
                >
                  <div
                    className="group flex items-start gap-3 rounded-xl border border-transparent bg-surface/60 py-3 pl-3.5 pr-4 transition-all duration-300 hover:border-border hover:bg-surface hover:shadow-[0_10px_28px_-20px_rgba(5,150,105,0.5)]"
                    style={{ borderLeft: `3px solid rgba(5,150,105,${0.25 + depth * 0.55})` }}
                  >
                    <span
                      aria-hidden
                      className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-primary transition-transform duration-300 group-hover:scale-110"
                      style={{ background: `rgba(16,185,129,${0.08 + depth * 0.10})` }}
                    >
                      <Icon size={15} />
                    </span>
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-baseline gap-x-2">
                        <span className="font-heading text-[15.5px] font-bold tracking-[-0.02em] text-text-primary">
                          {part.name}
                        </span>
                        <span aria-hidden className="text-text-tertiary">·</span>
                        <span className="text-[14px] font-semibold text-primary">{part.role}</span>
                      </span>
                      <span className="mt-0.5 block text-[13px] leading-[1.5] text-text-tertiary">
                        {part.detail}
                      </span>
                    </span>
                  </div>
                </motion.li>
              )
            })}
          </ul>

          <p className="mt-6 rounded-xl border border-primary/15 bg-primary/[0.06] px-4 py-3 text-center text-[14px] font-medium italic text-text-secondary">
            &ldquo;One root. Every branch connected. Your business, unified.&rdquo;
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3.5">
            <button
              onClick={() => navigate(ctaHref)}
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
