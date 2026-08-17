import { useState, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, useInView, useReducedMotion, AnimatePresence } from 'framer-motion'
import {
  Users, MapPin, Banknote, BarChart2, Package, Target,
  ShoppingCart, TrendingUp, Kanban, Settings, Monitor, PieChart,
  ArrowRight, Lock, Sparkles,
  Factory, Store, Calculator, BarChart3, Contact, FolderKanban, Boxes, Fingerprint,
} from 'lucide-react'
import { useModulePlans, type ModulePlan } from '../../lib/plans'

/* ------------------------------------------------------------------ */
/*  Icon map (fallback, keyed by the plan.icon string from backend)   */
/* ------------------------------------------------------------------ */
const iconMap: Record<string, React.ElementType> = {
  Users, MapPin, Banknote, BarChart2, Package, Target,
  ShoppingCart, TrendingUp, Kanban, Settings, Monitor, PieChart,
}

/* Per-module icons — more representative than the generic fallbacks.   */
const keyIconMap: Record<string, React.ElementType> = {
  hrms:          Users,
  attendance:    Fingerprint,
  payroll:       Banknote,
  accounting:    Calculator,
  inventory:     Boxes,
  crm:           Contact,
  purchase:      ShoppingCart,
  sales:         TrendingUp,
  projects:      FolderKanban,
  manufacturing: Factory,
  pos:           Store,
  reports:       BarChart3,
}

/* ------------------------------------------------------------------ */
/*  Per-module "what you'd otherwise cobble together" annotations      */
/* ------------------------------------------------------------------ */
/**
 * Category labels, not named competitors.
 *
 * 2026-08-17 (CRIT #5 audit): the previous map named specific competitor
 * brands next to each tile, styled as strike-through comparisons. Naming
 * a competitor without a substantiated, apples-to-apples claim risks a
 * disparagement complaint under the Indian Advertising Code and the
 * competitor's own IP; the ASCI code (chapter III) also treats
 * unsubstantiated "our product replaces X" claims as misleading. Category
 * labels make the same "one platform vs. five tools" point without
 * naming anyone.
 */
const competitorMap: Record<string, string> = {
  hrms:          'yet another HR tool',
  attendance:    'a separate attendance app',
  payroll:       'a payroll spreadsheet',
  accounting:    'a standalone ledger',
  inventory:     'an inventory silo',
  crm:           'a CRM you keep exporting',
  purchase:      'a procurement app',
  sales:         'a sales-only pipeline',
  projects:      'a project tracker',
  manufacturing: 'a production spreadsheet',
  pos:           'a standalone POS',
  reports:       'a BI seat per department',
}

/* ------------------------------------------------------------------ */
/*  Scatter offsets — pre-computed random-looking offsets per index     */
/* ------------------------------------------------------------------ */
const scatterOffsets = [
  { x: -60,  y: -40, r: -12 },
  { x: 45,   y: -55, r: 8 },
  { x: -30,  y: 50,  r: -6 },
  { x: 70,   y: 30,  r: 14 },
  { x: -50,  y: -20, r: 10 },
  { x: 55,   y: -45, r: -15 },
  { x: -40,  y: 35,  r: 7 },
  { x: 35,   y: 60,  r: -9 },
  { x: -65,  y: 15,  r: 13 },
  { x: 50,   y: -35, r: -11 },
  { x: -25,  y: 55,  r: 5 },
  { x: 60,   y: -10, r: -8 },
]

/* ------------------------------------------------------------------ */
/*  Annotation positioning classes — staggered around tiles            */
/* ------------------------------------------------------------------ */
const annotationPositions = [
  'top-0 -right-2 -translate-y-full rotate-[-6deg]',     // top-right
  'top-0 left-1/2 -translate-y-full -translate-x-1/2 rotate-[3deg]', // top-center
  '-top-1 -left-3 -translate-y-full rotate-[-4deg]',     // top-left
  'top-1/2 -right-3 translate-x-full -translate-y-1/2 rotate-[5deg]', // right
  'bottom-0 right-0 translate-y-full rotate-[-3deg]',    // bottom-right
  'top-0 right-1/4 -translate-y-full rotate-[7deg]',     // top
  '-top-1 -right-4 -translate-y-full rotate-[-5deg]',    // top-right offset
  'top-1/2 -left-2 -translate-x-full -translate-y-1/2 rotate-[4deg]', // left
  'bottom-0 left-1/4 translate-y-full rotate-[-2deg]',   // bottom-left
  'top-0 left-0 -translate-y-full rotate-[6deg]',        // top-left
  'bottom-0 left-1/2 translate-y-full -translate-x-1/2 rotate-[-5deg]', // bottom-center
  '-top-1 right-1/3 -translate-y-full rotate-[4deg]',    // top
]

/* ------------------------------------------------------------------ */
/*  Tint helper — softens a hex color into a light background          */
/* ------------------------------------------------------------------ */
function hexToTint(hex: string, opacity = 0.12): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${opacity})`
}

/* ------------------------------------------------------------------ */
/*  Hand-drawn arrow pointing at the toggle                            */
/* ------------------------------------------------------------------ */
/** Sketchy arrow that draws itself in, so the eye lands on the toggle.
 *  Sits directly above the toggle and sweeps down onto it — the head points
 *  straight down at the switch.
 *  Hidden below lg — on stacked layouts it would point at nothing. */
function HandArrow() {
  const reduceMotion = useReducedMotion()

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute bottom-full right-5 mb-2 hidden h-[74px] w-[118px] lg:block"
    >
      <svg viewBox="0 0 118 74" fill="none" className="h-full w-full overflow-visible">
        <motion.path
          d="M6 18 C 32 4, 70 6, 90 26 C 100 36, 105 48, 106 62"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          className="text-primary/45"
          initial={reduceMotion ? { pathLength: 1, opacity: 1 } : { pathLength: 0, opacity: 0 }}
          whileInView={{ pathLength: 1, opacity: 1 }}
          viewport={{ once: true, amount: 0.6 }}
          transition={reduceMotion ? { duration: 0 } : { duration: 0.9, ease: 'easeInOut', delay: 0.35 }}
        />
        <motion.path
          d="M97 53 L106 64 L115 52"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          className="text-primary/45"
          initial={reduceMotion ? { pathLength: 1, opacity: 1 } : { pathLength: 0, opacity: 0 }}
          whileInView={{ pathLength: 1, opacity: 1 }}
          viewport={{ once: true, amount: 0.6 }}
          transition={reduceMotion ? { duration: 0 } : { duration: 0.35, ease: 'easeOut', delay: 1.15 }}
        />
      </svg>
      <span className="absolute -left-3 top-2 -translate-y-full whitespace-nowrap font-handwriting text-lg text-primary/70">
        try it
      </span>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Module Tile Component                                              */
/* ------------------------------------------------------------------ */
function ModuleTile({
  plan,
  index,
  scattered,
  hasToggled,
}: {
  plan: ModulePlan
  index: number
  scattered: boolean
  hasToggled: boolean
}) {
  const Icon = keyIconMap[plan.key] ?? iconMap[plan.icon ?? 'Users'] ?? Users
  const available = plan.status === 'AVAILABLE'
  const color = plan.color || '#059669'
  const competitor = competitorMap[plan.key]
  const offset = scatterOffsets[index % scatterOffsets.length]
  const annotationPos = annotationPositions[index % annotationPositions.length]

  return (
    <motion.div
      className="relative flex flex-col items-center group"
      style={{
        '--scatter-x': `${offset.x}px`,
        '--scatter-y': `${offset.y}px`,
        '--scatter-r': `${offset.r}deg`,
      } as React.CSSProperties}
    >
      {/* Competitor annotation — handwritten, crossed out */}
      {competitor && (
        <div
          className={`absolute z-10 pointer-events-none whitespace-nowrap font-handwriting font-semibold text-lg competitor-strike transition-opacity duration-500 ${annotationPos} ${
            scattered ? 'opacity-70' : 'opacity-0'
          }`}
          style={{ color: '#8B4513' }}
        >
          {competitor}
        </div>
      )}

      {/* The tile itself */}
      <div
        className={`module-tile-glow relative flex flex-col items-center gap-3 cursor-pointer ${
          hasToggled
            ? scattered
              ? 'module-tile-scattered'
              : 'module-tile-unified'
            : ''
        }`}
        style={{
          animationDelay: `${index * 0.04}s`,
        }}
      >
        {/* "Launching soon" badge (was "Soon", per audit 2026-08-17) */}
        {!available && (
          <span className="absolute -top-1 -right-1 z-20 text-[9px] font-bold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded-full flex items-center gap-0.5 shadow-sm whitespace-nowrap">
            <Lock size={8} /> Launching soon
          </span>
        )}

        {/* Icon container */}
        <div
          className="w-[72px] h-[72px] sm:w-20 sm:h-20 rounded-2xl flex items-center justify-center shadow-card group-hover:shadow-card-hover transition-all duration-300 relative overflow-hidden"
          style={{ backgroundColor: hexToTint(color, 0.1), border: `1.5px solid ${hexToTint(color, 0.18)}` }}
        >
          {/* Subtle gradient overlay */}
          <div
            className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
            style={{
              background: `radial-gradient(circle at 30% 30%, ${hexToTint(color, 0.15)}, transparent 70%)`,
            }}
          />
          <Icon size={28} style={{ color }} className="relative z-10 transition-transform duration-300 group-hover:scale-110" />
        </div>

        {/* Module name */}
        <span className="text-xs sm:text-sm font-heading font-semibold text-text-primary text-center leading-tight max-w-[100px]">
          {plan.displayName}
        </span>

        {/* Hover tagline tooltip */}
        {plan.tagline && (
          <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-all duration-300 pointer-events-none z-30 whitespace-nowrap">
            <span className="text-[10px] font-body text-text-secondary bg-white/90 backdrop-blur-sm px-2 py-1 rounded-lg shadow-md border border-border-light">
              {plan.tagline}
            </span>
          </div>
        )}
      </div>
    </motion.div>
  )
}

/* ------------------------------------------------------------------ */
/*  Connecting Lines SVG — decorative arcs between tiles               */
/* ------------------------------------------------------------------ */
function ConnectingLines({ visible }: { visible: boolean }) {
  return (
    <svg
      className={`absolute inset-0 w-full h-full pointer-events-none z-0 transition-opacity duration-700 ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
      viewBox="0 0 1000 600"
      preserveAspectRatio="none"
    >
      {/* Curved connecting paths between module positions */}
      {[
        'M 100,120 C 180,80 220,80 300,120',
        'M 300,120 C 380,160 420,160 500,120',
        'M 500,120 C 580,80 620,80 700,120',
        'M 700,120 C 780,160 820,160 900,120',
        'M 150,300 C 230,260 270,260 350,300',
        'M 350,300 C 430,340 470,340 550,300',
        'M 550,300 C 630,260 670,260 750,300',
        'M 200,480 C 280,440 320,440 400,480',
        'M 400,480 C 480,520 520,520 600,480',
        'M 600,480 C 680,440 720,440 800,480',
      ].map((d, i) => (
        <path
          key={i}
          d={d}
          stroke="rgba(24,40,14,0.06)"
          strokeWidth="1.5"
          fill="none"
          strokeDasharray="6 6"
        />
      ))}
    </svg>
  )
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */
export function ModulesOverview() {
  const navigate = useNavigate()
  const { data: allPlans = [] } = useModulePlans()
  // Hide RETIRED — same filter as PricingCalculator / ModulesGrid.
  const plans = allPlans.filter((p) => p.status !== 'RETIRED')
  const [scattered, setScattered] = useState(false)
  const [hasToggled, setHasToggled] = useState(false)
  const sectionRef = useRef<HTMLDivElement>(null)
  const inView = useInView(sectionRef, { once: true, amount: 0.15 })

  const handleToggle = () => {
    setHasToggled(true)
    setScattered(prev => !prev)
  }

  return (
    <section className="surface-soft relative overflow-hidden py-24" ref={sectionRef}>
      {/* Soft emerald wash that blooms behind the grid while it is unified */}
      <div aria-hidden className={`absolute inset-0 bg-connected-dots transition-opacity duration-700 ${scattered ? 'opacity-0' : 'opacity-100'}`} />
      <span aria-hidden className="grain" />

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="mb-10 lg:mb-14"
        >
          {/* Heading */}
          <div className="text-center lg:text-left">
            <span className="text-primary font-body font-semibold text-sm uppercase tracking-widest mb-3 block">
              Platform modules
            </span>
            <h2 className="font-heading font-bold text-text-primary mb-4" style={{ fontSize: 'clamp(1.74rem, 3.08vw, 2.61rem)' }}>
              Everything your business needs.
              <br />
              Nothing it doesn't.
            </h2>
          </div>

          {/* Sub-heading + toggle share one row on lg+: sentence left, toggle
              right-aligned and vertically centred against it, with the
              hand-drawn arrow drawing itself in directly above the switch.
              The whole row sits above the grid panel — no overlap, no pull-down.
              Below lg it stacks: sentence, then the toggle centred. */}
          <div className="flex flex-col items-center gap-8 lg:mt-6 lg:flex-row lg:items-center lg:justify-between lg:gap-12">
            <p className="text-text-secondary font-body text-lg max-w-xl text-center lg:text-left">
              Activate only the modules you need. Pay only for what you use.
            </p>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.6, delay: 0.1 }}
              className="relative z-20 shrink-0"
            >
              <HandArrow />
              <button
                onClick={handleToggle}
                aria-pressed={scattered}
                className="group flex items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3 shadow-card transition-all duration-300 hover:border-primary/40 hover:shadow-card-hover"
              >
                <Sparkles
                  size={16}
                  className={`transition-colors duration-300 ${scattered ? 'text-primary' : 'text-amber-500'}`}
                />
                <span className={`toggle-switch ${scattered ? 'active' : ''}`} aria-hidden />
                <span className="text-sm font-body text-text-secondary select-none whitespace-nowrap">
                  {scattered ? (
                    <span className="font-semibold text-primary">One platform. Unified.</span>
                  ) : (
                    <span className="font-handwriting text-lg text-amber-700">Imagine without UnifiedTree</span>
                  )}
                </span>
              </button>
            </motion.div>
          </div>
        </motion.div>

        {/* Module Icon Grid */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.7, delay: 0.15 }}
          className="relative"
        >
          {/* Soft panel behind the tiles — a surface-tint-like wash with very
              soft per-corner glows echoing the tile colours, plus grain.
              Pure colour fields: no linework, no dots. */}
          <div
            aria-hidden
            className="absolute inset-0 overflow-hidden rounded-[32px]"
            style={{ boxShadow: '0 24px 60px -40px rgba(4, 80, 58, 0.28)' }}
          >
            <div
              className="absolute inset-0"
              style={{
                backgroundColor: '#F2FAF6',
                backgroundImage: [
                  'radial-gradient(64% 50% at 84% 0%, rgba(16, 185, 129, 0.10), transparent 70%)',
                  'radial-gradient(70% 55% at 10% 100%, rgba(110, 231, 183, 0.16), transparent 72%)',
                  'linear-gradient(180deg, rgba(255, 255, 255, 0.55) 0%, rgba(255, 255, 255, 0) 34%)',
                ].join(', '),
              }}
            />
            {/* Corner glows — indigo, cyan, amber, pink, kept whisper-soft */}
            <div
              className="absolute inset-0"
              style={{
                backgroundImage: [
                  'radial-gradient(40% 36% at 0% 0%, rgba(99, 102, 241, 0.07), transparent 70%)',
                  'radial-gradient(38% 34% at 100% 0%, rgba(6, 182, 212, 0.07), transparent 70%)',
                  'radial-gradient(40% 36% at 100% 100%, rgba(245, 158, 11, 0.06), transparent 70%)',
                  'radial-gradient(38% 34% at 0% 100%, rgba(236, 72, 153, 0.05), transparent 70%)',
                ].join(', '),
              }}
            />
            <span aria-hidden className="grain" />
          </div>

          {/* Connecting lines between tiles */}
          <ConnectingLines visible={!scattered} />

          {/* Grid */}
          <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-y-14 gap-x-6 sm:gap-x-8 lg:gap-x-10 justify-items-center px-4 sm:px-8 lg:px-10 py-10 sm:py-12 relative z-10">
            {plans.map((plan, i) => (
              <motion.div
                key={plan.key}
                initial={{ opacity: 0, y: 24, scale: 0.9 }}
                animate={inView ? { opacity: 1, y: 0, scale: 1 } : {}}
                transition={{
                  duration: 0.45,
                  delay: 0.25 + i * 0.06,
                  ease: 'easeOut',
                }}
                onClick={() => navigate('/modules')}
              >
                <ModuleTile
                  plan={plan}
                  index={i}
                  scattered={scattered}
                  hasToggled={hasToggled}
                />
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* Bottom bar: Toggle + View All */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ delay: 0.5 }}
          className="flex flex-col sm:flex-row items-center justify-end mt-16 pt-8 border-t border-border"
        >
          {/* View all Apps — the toggle sits above the grid panel */}
          <button
            onClick={() => navigate('/modules')}
            className="inline-flex items-center gap-2 text-primary font-body font-semibold text-sm hover:gap-3 transition-all duration-300 group"
          >
            View all Apps
            <ArrowRight size={16} className="transition-transform duration-300 group-hover:translate-x-1" />
          </button>
        </motion.div>
      </div>
    </section>
  )
}
