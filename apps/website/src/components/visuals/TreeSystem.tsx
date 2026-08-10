import { useEffect, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { Users, Fingerprint, Banknote, Calculator, Boxes, Contact } from 'lucide-react'

/**
 * "One root. Every branch connected."
 *
 * The product argument drawn as the thing we're named after: a single core at
 * the base, roots feeding it, branches carrying live data up to each module.
 * Data visibly flows along the branches — that IS the pitch ("one connected
 * core"), so the hero visual argues instead of decorating.
 *
 * Deliberately not scenery. The geometry is ours and reads as a system diagram,
 * which is what an ERP actually is.
 */

const VB = { w: 1000, h: 700 }
const CORE = { x: 500, y: 606 }

export interface TreeNode {
  key: string
  label: string
  icon: React.ElementType
  x: number
  y: number
}

export const TREE_NODES: TreeNode[] = [
  { key: 'hr',         label: 'HR',         icon: Users,       x: 96,  y: 424 },
  { key: 'attendance', label: 'Attendance', icon: Fingerprint, x: 262, y: 250 },
  { key: 'payroll',    label: 'Payroll',    icon: Banknote,    x: 432, y: 138 },
  { key: 'accounting', label: 'Accounting', icon: Calculator,  x: 610, y: 138 },
  { key: 'inventory',  label: 'Inventory',  icon: Boxes,       x: 780, y: 250 },
  { key: 'crm',        label: 'CRM',        icon: Contact,     x: 934, y: 424 },
]

/**
 * A real tree forks; it does not radiate. Growth goes core -> trunk -> two
 * limbs -> three branches each. Drawing every node straight from the core made
 * it read as a starburst, which is the wrong metaphor entirely.
 */
const FORK = { x: CORE.x, y: 452 }
const LIMB = { left: { x: 322, y: 344 }, right: { x: 678, y: 344 } }

/** Trunk: core up to the fork. */
const TRUNK = `M ${CORE.x} ${CORE.y} C ${CORE.x} ${CORE.y - 70}, ${FORK.x} ${FORK.y + 70}, ${FORK.x} ${FORK.y}`

/** The two limbs off the trunk. */
const LIMBS = [
  `M ${FORK.x} ${FORK.y} C ${FORK.x - 60} ${FORK.y - 40}, ${LIMB.left.x + 70} ${LIMB.left.y + 34}, ${LIMB.left.x} ${LIMB.left.y}`,
  `M ${FORK.x} ${FORK.y} C ${FORK.x + 60} ${FORK.y - 40}, ${LIMB.right.x - 70} ${LIMB.right.y + 34}, ${LIMB.right.x} ${LIMB.right.y}`,
]

/** Each node hangs off its limb, not off the core. */
function branchPath(n: TreeNode, i: number) {
  const hub = i < 3 ? LIMB.left : LIMB.right
  const dx = n.x - hub.x
  const dy = n.y - hub.y
  return `M ${hub.x} ${hub.y} C ${hub.x + dx * 0.35} ${hub.y + dy * 0.08}, ${n.x - dx * 0.3} ${n.y + Math.abs(dy) * 0.45 + 24}, ${n.x} ${n.y}`
}

/** Full core-to-node route, used by the flowing highlight. */
function fullPath(n: TreeNode, i: number) {
  const hub = i < 3 ? LIMB.left : LIMB.right
  const limb = i < 3 ? LIMBS[0] : LIMBS[1]
  return `${TRUNK} ${limb.replace(/^M [^C]+/, `M ${FORK.x} ${FORK.y} `)} ${branchPath(n, i).replace(/^M [^C]+/, `M ${hub.x} ${hub.y} `)}`
}

const ROOTS = [
  `M ${CORE.x} ${CORE.y} C 470 660, 380 664, 268 700`,
  `M ${CORE.x} ${CORE.y} C 486 668, 452 682, 404 712`,
  `M ${CORE.x} ${CORE.y} C 514 668, 548 682, 596 712`,
  `M ${CORE.x} ${CORE.y} C 530 660, 620 664, 732 700`,
]

interface Props {
  active: number
  onSelect?: (i: number) => void
  className?: string
}

export function TreeSystem({ active, onSelect, className = '' }: Props) {
  const reduce = useReducedMotion()
  const [drawn, setDrawn] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setDrawn(true), 120)
    return () => clearTimeout(t)
  }, [])

  return (
    <div className={`relative w-full ${className}`} style={{ aspectRatio: `${VB.w} / ${VB.h}` }}>
      <svg viewBox={`0 0 ${VB.w} ${VB.h}`} className="h-full w-full overflow-visible" aria-hidden>
        <defs>
          {/* userSpaceOnUse is REQUIRED here, not a preference. The trunk is a
              perfectly vertical path, so its object bounding box has zero
              width — and an objectBoundingBox gradient on a zero-width bbox is
              not rendered at all, which silently erased the trunk. Absolute
              coordinates also keep the colour ramp consistent across trunk,
              limbs and branches instead of restarting per-path. */}
          <linearGradient
            id="tsBranch"
            gradientUnits="userSpaceOnUse"
            x1="500" y1={CORE.y} x2="500" y2="120"
          >
            <stop offset="0%" stopColor="#047857" />
            <stop offset="55%" stopColor="#10B981" />
            <stop offset="100%" stopColor="#6EE7B7" />
          </linearGradient>
          <radialGradient id="tsCore" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#A7F3D0" />
            <stop offset="55%" stopColor="#10B981" />
            <stop offset="100%" stopColor="#047857" />
          </radialGradient>
          <filter id="tsGlow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="16" />
          </filter>
        </defs>

        {/* Roots — the shared data everything is fed from */}
        {ROOTS.map((d, i) => (
          <motion.path
            key={`root-${i}`}
            d={d}
            fill="none"
            stroke="#047857"
            strokeOpacity={0.28}
            strokeWidth={3}
            strokeLinecap="round"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: drawn ? 1 : 0 }}
            transition={{ duration: reduce ? 0 : 0.9, delay: reduce ? 0 : 0.1 + i * 0.06, ease: 'easeOut' }}
          />
        ))}

        {/* Trunk — thickest, closest to the core */}
        <motion.path
          d={TRUNK}
          fill="none" stroke="url(#tsBranch)" strokeWidth={11} strokeLinecap="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: drawn ? 1 : 0 }}
          transition={{ duration: reduce ? 0 : 0.7, delay: reduce ? 0 : 0.15, ease: 'easeOut' }}
        />

        {/* Limbs — the two main forks, tapering from the trunk */}
        {LIMBS.map((d, i) => (
          <motion.path
            key={`limb-${i}`}
            d={d}
            fill="none" stroke="url(#tsBranch)" strokeWidth={7} strokeLinecap="round"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: drawn ? 1 : 0 }}
            transition={{ duration: reduce ? 0 : 0.7, delay: reduce ? 0 : 0.5 + i * 0.08, ease: 'easeOut' }}
          />
        ))}

        {/* Branches out to each module */}
        {TREE_NODES.map((n, i) => {
          const on = i === active
          return (
            <g key={n.key}>
              <motion.path
                d={branchPath(n, i)}
                fill="none"
                stroke="url(#tsBranch)"
                strokeWidth={on ? 5 : 3.5}
                strokeOpacity={on ? 1 : 0.5}
                strokeLinecap="round"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: drawn ? 1 : 0 }}
                transition={{ duration: reduce ? 0 : 0.8, delay: reduce ? 0 : 0.85 + i * 0.07, ease: 'easeOut' }}
                style={{ transition: 'stroke-width 300ms, stroke-opacity 300ms' }}
              />
              {/* Sap climbing the whole route, core → limb → branch */}
              {!reduce && on && (
                <motion.path
                  d={fullPath(n, i)}
                  fill="none"
                  stroke="#A7F3D0"
                  strokeWidth={5.5}
                  strokeLinecap="round"
                  strokeDasharray="30 900"
                  initial={{ strokeDashoffset: 930 }}
                  animate={{ strokeDashoffset: [930, 0] }}
                  transition={{ duration: 1.8, repeat: Infinity, ease: 'linear' }}
                />
              )}
            </g>
          )
        })}

        {/* Fork joint — hides the seam where trunk meets limbs */}
        <circle cx={FORK.x} cy={FORK.y} r={7} fill="#059669" />
        <circle cx={LIMB.left.x} cy={LIMB.left.y} r={5} fill="#10B981" />
        <circle cx={LIMB.right.x} cy={LIMB.right.y} r={5} fill="#10B981" />

        {/* Core */}
        <circle cx={CORE.x} cy={CORE.y} r={64} fill="#10B981" opacity={0.28} filter="url(#tsGlow)" />
        <motion.circle
          cx={CORE.x} cy={CORE.y} r={30} fill="url(#tsCore)"
          animate={reduce ? undefined : { r: [30, 33, 30] }}
          transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut' }}
        />
        <circle cx={CORE.x} cy={CORE.y} r={30} fill="none" stroke="#ECFDF5" strokeOpacity={0.6} strokeWidth={1.5} />
      </svg>

      {/* Module chips — HTML so icons and type stay crisp */}
      {TREE_NODES.map((n, i) => {
        const Icon = n.icon
        const on = i === active
        return (
          <button
            key={n.key}
            type="button"
            onClick={() => onSelect?.(i)}
            aria-pressed={on}
            className="absolute -translate-x-1/2 -translate-y-1/2 focus-visible:outline-none"
            style={{ left: `${(n.x / VB.w) * 100}%`, top: `${(n.y / VB.h) * 100}%` }}
          >
            <span
              className={`flex items-center gap-1 rounded-lg border px-1.5 py-1 text-[10px] font-semibold shadow-sm backdrop-blur-sm transition-all duration-300 sm:gap-2 sm:rounded-xl sm:px-3 sm:py-2 sm:text-[13px] ${
                on
                  ? 'scale-105 border-primary/40 bg-white text-primary shadow-md'
                  : 'border-border bg-white/85 text-text-secondary hover:border-primary/30 hover:text-primary'
              }`}
            >
              <Icon size={12} className={`shrink-0 sm:h-[15px] sm:w-[15px] ${on ? 'text-primary' : 'text-text-tertiary'}`} />
              {n.label}
            </span>
          </button>
        )
      })}

      {/* Core caption */}
      <div
        className="absolute -translate-x-1/2 translate-y-3 text-center"
        style={{ left: `${(CORE.x / VB.w) * 100}%`, top: `${(CORE.y / VB.h) * 100}%` }}
      >
        <p className="mt-8 whitespace-nowrap text-[11px] font-bold uppercase tracking-[0.18em] text-primary">
          One core
        </p>
      </div>
    </div>
  )
}
