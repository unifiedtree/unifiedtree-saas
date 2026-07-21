import { useState, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, useInView, AnimatePresence } from 'framer-motion'
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
/*  Per-module competitor annotations                                  */
/* ------------------------------------------------------------------ */
const competitorMap: Record<string, string> = {
  hrms:          'BambooHR',
  attendance:    'Keka',
  payroll:       'greytHR',
  accounting:    'QuickBooks',
  inventory:     'Zoho',
  crm:           'Salesforce',
  purchase:      'SAP',
  sales:         'Freshsales',
  projects:      'Asana',
  manufacturing: 'Katana',
  pos:           'Lightspeed',
  reports:       'Tableau',
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
  const color = plan.color || '#18280E'
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
        {/* "Soon" badge */}
        {!available && (
          <span className="absolute -top-1 -right-1 z-20 text-[9px] font-bold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded-full flex items-center gap-0.5 shadow-sm">
            <Lock size={8} /> Soon
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
  const { data: plans = [] } = useModulePlans()
  const [scattered, setScattered] = useState(false)
  const [hasToggled, setHasToggled] = useState(false)
  const sectionRef = useRef<HTMLDivElement>(null)
  const inView = useInView(sectionRef, { once: true, amount: 0.15 })

  const handleToggle = () => {
    setHasToggled(true)
    setScattered(prev => !prev)
  }

  return (
    <section className="py-24 bg-bg relative overflow-hidden" ref={sectionRef}>
      {/* Background dot pattern when unified */}
      <div className={`absolute inset-0 bg-connected-dots transition-opacity duration-700 ${scattered ? 'opacity-0' : 'opacity-100'}`} />

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <span className="text-primary font-body font-semibold text-sm uppercase tracking-widest mb-3 block">
            Platform modules
          </span>
          <h2 className="font-heading font-bold text-text-primary mb-4" style={{ fontSize: 'clamp(2rem, 3.5vw, 3rem)' }}>
            Everything your business needs.
            <br />
            Nothing it doesn't.
          </h2>
          <p className="text-text-secondary font-body text-lg max-w-xl mx-auto">
            Activate only the modules you need. Pay only for what you use.
          </p>
        </motion.div>

        {/* Module Icon Grid */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.7, delay: 0.15 }}
          className="relative"
        >
          {/* Connecting lines between tiles */}
          <ConnectingLines visible={!scattered} />

          {/* Grid */}
          <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-y-14 gap-x-6 sm:gap-x-8 lg:gap-x-10 justify-items-center py-8 relative z-10">
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
          className="flex flex-col sm:flex-row items-center justify-between mt-16 pt-8 border-t border-border"
        >
          {/* Toggle — "Imagine without UnifiedTree" */}
          <div className="flex items-center gap-3 mb-4 sm:mb-0">
            <Sparkles size={16} className={`transition-colors duration-300 ${scattered ? 'text-amber-500' : 'text-primary'}`} />
            <button
              onClick={handleToggle}
              className={`toggle-switch ${scattered ? 'active' : ''}`}
              aria-label="Toggle: imagine without UnifiedTree"
            />
            <span className="text-sm font-body text-text-secondary select-none">
              {scattered ? (
                <span className="font-handwriting text-lg text-amber-700">Imagine without UnifiedTree</span>
              ) : (
                <span className="font-semibold text-primary">One platform. Unified.</span>
              )}
            </span>
          </div>

          {/* View all Apps */}
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
