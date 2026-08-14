import { useId } from 'react'
import type { ReactNode } from 'react'
import { motion, useReducedMotion } from 'framer-motion'

/**
 * GrovePanel — an authored emerald grove, composed as a PORTRAIT side panel
 * for the auth pages (roughly 45vw x full card height).
 *
 * Same dark-band language as the rest of the site (CTABanner's layered
 * tree-line, film grain, soft mint light) but a designed scene, not a strip:
 * four depths of silhouettes with aerial perspective — palest haze at the
 * back, near-black in front — a clearing in the front rank, and one hero
 * tree with real branch structure standing in it, slightly off-centre,
 * backlit by a high light source. Mist bands sit between the depths.
 *
 * Everything is vector and deterministic (positions are hardcoded, no
 * randomness at render). The only motion is a few drifting leaves on a time
 * loop — nothing is tied to scroll — and they are skipped entirely under
 * prefers-reduced-motion.
 *
 * `children` renders over the lower third, where the vignette and the dark
 * front rank guarantee contrast for light text.
 */

interface GrovePanelProps {
  className?: string
  children?: ReactNode
}

type TreeSpec = {
  /** Ground x in the 720-wide scene */
  x: number
  /** Scale — a v0 tree is ~82 units tall at s=1 */
  s: number
  /** Silhouette variant: 0 broad, 1 tall, 2 leaning */
  v?: 0 | 1 | 2
  /** Baseline jitter so the ranks never read as ruled hedgerows */
  dy?: number
}

/* Depth ranks, back → front. Sizes and baselines are deliberately uneven —
   even spacing read as topiary rows, not a grove. The front rank leaves a
   clearing between x≈200 and x≈600 where the hero tree stands. */
const TREES_FAR: TreeSpec[] = [
  { x: 18, s: 0.34, v: 1, dy: 2 }, { x: 58, s: 0.3, dy: -4 }, { x: 96, s: 0.4, v: 2, dy: 4 },
  { x: 148, s: 0.32, v: 1, dy: -6 }, { x: 196, s: 0.42 }, { x: 248, s: 0.33, v: 1, dy: 6 },
  { x: 300, s: 0.38, v: 2, dy: -3 }, { x: 352, s: 0.3, dy: 3 }, { x: 404, s: 0.4, v: 1, dy: -5 },
  { x: 458, s: 0.34, dy: 5 }, { x: 512, s: 0.42, v: 2, dy: -2 }, { x: 562, s: 0.32, v: 1, dy: 4 },
  { x: 614, s: 0.38, dy: -4 }, { x: 668, s: 0.33, v: 1, dy: 2 }, { x: 706, s: 0.4, dy: -2 },
]
const TREES_BACK: TreeSpec[] = [
  { x: 6, s: 0.66, dy: -2 }, { x: 64, s: 0.52, v: 1, dy: 6 }, { x: 128, s: 0.72, v: 2, dy: -6 },
  { x: 206, s: 0.55, dy: 8 }, { x: 268, s: 0.64, v: 1, dy: -4 }, { x: 338, s: 0.5, v: 2, dy: 4 },
  { x: 410, s: 0.7, dy: -8 }, { x: 478, s: 0.54, v: 1, dy: 6 }, { x: 544, s: 0.68, v: 2, dy: -3 },
  { x: 610, s: 0.52, dy: 5 }, { x: 676, s: 0.66, v: 1, dy: -5 }, { x: 716, s: 0.55, dy: 2 },
]
const TREES_MID: TreeSpec[] = [
  { x: 28, s: 1.05, v: 2, dy: -6 }, { x: 96, s: 0.85, v: 1, dy: 8 }, { x: 150, s: 1.2, dy: -2 },
  { x: 262, s: 0.9, v: 1, dy: 10 }, { x: 322, s: 1.1, v: 2, dy: -8 }, { x: 452, s: 0.82, v: 1, dy: 6 },
  { x: 558, s: 1.25, dy: -10 }, { x: 628, s: 0.9, v: 2, dy: 6 }, { x: 700, s: 1.1, v: 1, dy: -4 },
]
const TREES_FRONT: TreeSpec[] = [
  { x: -6, s: 2.2 }, { x: 100, s: 1.6, v: 2 }, { x: 648, s: 1.5, v: 1 },
  { x: 735, s: 2.3 },
]

/** One stylised deciduous tree: tapered trunk under clustered canopy blobs.
    Fill comes from the parent <g> so each depth is a single silhouette. */
function TreeForm({ v }: { v: 0 | 1 | 2 }) {
  if (v === 1) {
    return (
      <>
        <path d="M-2.6 0 L-1.6 -34 Q0 -37 1.6 -34 L2.6 0 Q0 1.6 -2.6 0 Z" />
        <circle cx="0" cy="-82" r="15" />
        <circle cx="-4" cy="-64" r="19" />
        <circle cx="5" cy="-50" r="16" />
        <circle cx="-11" cy="-46" r="13" />
        <circle cx="9" cy="-68" r="12" />
      </>
    )
  }
  if (v === 2) {
    return (
      <>
        <path d="M-3 0 L-1 -28 Q1 -31 3 -27 L5 0 Q1 2 -3 0 Z" />
        <circle cx="7" cy="-54" r="23" />
        <circle cx="-12" cy="-46" r="16" />
        <circle cx="22" cy="-42" r="13" />
        <circle cx="-2" cy="-66" r="14" />
        <circle cx="-22" cy="-40" r="9" />
      </>
    )
  }
  return (
    <>
      <path d="M-3.2 0 L-2 -30 Q0 -33 2 -30 L3.2 0 Q0 1.8 -3.2 0 Z" />
      <circle cx="0" cy="-56" r="25" />
      <circle cx="-20" cy="-45" r="17" />
      <circle cx="20" cy="-44" r="17" />
      <circle cx="-10" cy="-68" r="14" />
      <circle cx="11" cy="-66" r="13" />
      <circle cx="-27" cy="-54" r="10" />
      <circle cx="27" cy="-55" r="10" />
    </>
  )
}

/** One depth rank standing on its own ground. The ground edge undulates a
    little so the ranks never read as ruled stripes. */
function TreeRank({
  trees, baseline, fill, opacity,
}: {
  trees: TreeSpec[]
  baseline: number
  fill: string
  opacity: number
}) {
  const b = baseline
  return (
    <g fill={fill} opacity={opacity}>
      {trees.map((t, i) => (
        <g key={i} transform={`translate(${t.x} ${b + (t.dy ?? 0)}) scale(${t.s})`}>
          <TreeForm v={t.v ?? 0} />
        </g>
      ))}
      <path
        d={`M-40 ${b - 3} C 120 ${b - 12}, 250 ${b + 3}, 400 ${b - 8} S 640 ${b - 12}, 760 ${b - 2} L760 1090 L-40 1090 Z`}
      />
    </g>
  )
}

/** The hero tree — real branch structure, not a lollipop. Strokes carry the
    limbs, filled clumps carry the canopy, and a couple of sky gaps are left
    between the clumps so it reads as a tree at any DPI. */
function HeroTree() {
  const c = '#083826'
  return (
    <g transform="translate(452 1006) scale(1.32)" fill={c} stroke="none">
      {/* trunk, tapering, with a slight root flare */}
      <path d="M-9 3 C -7 -48, -5 -104, -4 -148 L 4 -148 C 6 -104, 7 -56, 10 3 Q 0 7 -9 3 Z" />
      <ellipse cx="0" cy="2" rx="26" ry="6" />
      {/* limbs */}
      <g fill="none" stroke={c} strokeLinecap="round">
        <path d="M0 -143 C -2 -180, -6 -212, -16 -244" strokeWidth="10" />
        <path d="M0 -138 C 18 -170, 36 -196, 58 -222" strokeWidth="7" />
        <path d="M-2 -116 C -26 -140, -44 -158, -64 -182" strokeWidth="7" />
        <path d="M58 -222 C 68 -238, 74 -250, 78 -262" strokeWidth="4" />
        <path d="M-64 -182 C -76 -194, -84 -206, -88 -218" strokeWidth="3.5" />
      </g>
      {/* canopy clumps — left mass, crown, right mass */}
      <circle cx="-78" cy="-224" r="34" />
      <circle cx="-52" cy="-250" r="29" />
      <circle cx="-96" cy="-198" r="21" />
      <circle cx="-16" cy="-290" r="45" />
      <circle cx="-44" cy="-270" r="27" />
      <circle cx="16" cy="-264" r="35" />
      <circle cx="62" cy="-256" r="38" />
      <circle cx="92" cy="-226" r="27" />
      <circle cx="40" cy="-236" r="25" />
      {/* small perimeter tufts so the outline reads leafy, not balloon-smooth */}
      <circle cx="-34" cy="-318" r="16" />
      <circle cx="8" cy="-310" r="14" />
      <circle cx="-70" cy="-282" r="15" />
      <circle cx="-108" cy="-232" r="13" />
      <circle cx="-98" cy="-176" r="12" />
      <circle cx="34" cy="-292" r="15" />
      <circle cx="86" cy="-262" r="14" />
      <circle cx="108" cy="-224" r="12" />
      <circle cx="98" cy="-198" r="11" />
      <circle cx="-24" cy="-244" r="22" />
    </g>
  )
}

/* Drifting leaves — start just OUTSIDE the hero crown so they read as shed
   leaves over the misty field, never as artifacts on the dark canopy. */
const LEAVES: Array<{ x: number; y: number; dur: number; delay: number }> = [
  { x: 606, y: 790, dur: 12, delay: 0 },
  { x: 336, y: 820, dur: 14, delay: 4.5 },
  { x: 524, y: 878, dur: 13, delay: 8.5 },
]

const LEAF_PATH = 'M0 0 C 4 -5, 9 -5, 12 1 C 8 5, 2 5, 0 0 Z'

export function GrovePanel({ className = '', children }: GrovePanelProps) {
  const reduce = useReducedMotion()
  // Gradient ids must be unique per mounted instance (login + signup can both
  // be alive during a route transition).
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const id = (name: string) => `grove-${name}-${uid}`

  return (
    <div className={`relative isolate overflow-hidden bg-[#04503A] ${className}`}>
      <svg
        viewBox="0 0 720 1080"
        preserveAspectRatio="xMidYMax slice"
        className="absolute inset-0 h-full w-full"
        aria-hidden
      >
        <defs>
          <linearGradient id={id('sky')} x1="0" y1="0" x2="0" y2="1080" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#148560" />
            <stop offset="0.2" stopColor="#0E6E4E" />
            <stop offset="0.45" stopColor="#085740" />
            <stop offset="0.7" stopColor="#053B2A" />
            <stop offset="1" stopColor="#02231A" />
          </linearGradient>
          {/* high light source — a wide ambient lift plus a tighter core whose
              lower falloff kisses the hero crown */}
          <radialGradient id={id('glowWide')} gradientUnits="userSpaceOnUse" cx="450" cy="190" r="560">
            <stop offset="0" stopColor="#6EE7B7" stopOpacity="0.22" />
            <stop offset="1" stopColor="#6EE7B7" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={id('glow')} gradientUnits="userSpaceOnUse" cx="450" cy="180" r="380">
            <stop offset="0" stopColor="#A7F3D0" stopOpacity="0.5" />
            <stop offset="1" stopColor="#A7F3D0" stopOpacity="0" />
          </radialGradient>
          <linearGradient id={id('mist')} x1="0" y1="0" x2="0" y2="1" >
            <stop offset="0" stopColor="#D6F6E9" stopOpacity="0" />
            <stop offset="0.45" stopColor="#D6F6E9" stopOpacity="0.13" />
            <stop offset="1" stopColor="#D6F6E9" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={id('floor')} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#03291E" stopOpacity="0" />
            <stop offset="1" stopColor="#022017" stopOpacity="0.6" />
          </linearGradient>
          <linearGradient id={id('vig')} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#01100B" stopOpacity="0" />
            <stop offset="0.45" stopColor="#011811" stopOpacity="0.35" />
            <stop offset="1" stopColor="#01100B" stopOpacity="0.82" />
          </linearGradient>
        </defs>

        {/* sky + light */}
        <rect width="720" height="1080" fill={`url(#${id('sky')})`} />
        <rect width="720" height="1080" fill={`url(#${id('glowWide')})`} />
        <rect width="720" height="1080" fill={`url(#${id('glow')})`} />

        {/* faint light motes hanging in the glow */}
        <g fill="#A7F3D0" opacity="0.3">
          <circle cx="300" cy="182" r="2" />
          <circle cx="520" cy="238" r="1.6" />
          <circle cx="410" cy="92" r="1.4" />
          <circle cx="252" cy="300" r="1.5" />
          <circle cx="558" cy="142" r="2" />
        </g>

        {/* depth ranks with mist between them — palest furthest away */}
        <TreeRank trees={TREES_FAR} baseline={545} fill="#A7F3D0" opacity={0.13} />
        <rect y="500" width="720" height="120" fill={`url(#${id('mist')})`} opacity="0.85" />
        <TreeRank trees={TREES_BACK} baseline={655} fill="#6EE7B7" opacity={0.15} />
        <rect y="590" width="720" height="140" fill={`url(#${id('mist')})`} opacity="0.9" />
        <TreeRank trees={TREES_MID} baseline={790} fill="#059669" opacity={0.45} />
        <rect y="710" width="720" height="140" fill={`url(#${id('mist')})`} opacity="0.5" />

        {/* the clearing floor falls into shadow as it comes forward, with a
            faint moonlit pool where the hero stands */}
        <rect y="780" width="720" height="300" fill={`url(#${id('floor')})`} />
        <ellipse cx="440" cy="905" rx="190" ry="38" fill="#A7F3D0" opacity="0.05" />

        {/* drifting leaves — drawn BEFORE the hero and front rank so the
            foreground silhouettes occlude them naturally. Time-based only,
            skipped under reduced motion. */}
        {!reduce && LEAVES.map((l, i) => (
          <motion.path
            key={i}
            d={LEAF_PATH}
            fill="#8FE6C3"
            initial={{ x: l.x, y: l.y, rotate: 0, opacity: 0 }}
            animate={{
              x: [l.x, l.x + 26, l.x - 12, l.x + 18],
              y: [l.y, l.y + 90, l.y + 180, l.y + 264],
              rotate: [0, 140, 260, 380],
              opacity: [0, 0.6, 0.5, 0],
            }}
            transition={{
              duration: l.dur,
              delay: l.delay,
              repeat: Infinity,
              ease: 'linear',
              times: [0, 0.35, 0.7, 1],
            }}
          />
        ))}

        <HeroTree />
        <TreeRank trees={TREES_FRONT} baseline={1010} fill="#02231A" opacity={0.96} />

        {/* canopy overhang framing the top corners — keeps the sky from
            reading as empty and closes the composition like a glade seen
            from under the eaves of the grove */}
        <g fill="#02231A" opacity="0.9">
          {/* left eave */}
          <circle cx="-40" cy="90" r="110" />
          <circle cx="70" cy="60" r="84" />
          <circle cx="150" cy="80" r="58" />
          <circle cx="212" cy="52" r="40" />
          <circle cx="96" cy="142" r="44" />
          <circle cx="180" cy="122" r="30" />
          <circle cx="240" cy="94" r="22" />
          {/* right eave */}
          <circle cx="762" cy="80" r="120" />
          <circle cx="664" cy="54" r="80" />
          <circle cx="596" cy="64" r="52" />
          <circle cx="700" cy="132" r="48" />
          <circle cx="612" cy="118" r="30" />
          <circle cx="548" cy="46" r="30" />
        </g>

        {/* vignette seats the lower third for the children slot */}
        <rect y="600" width="720" height="480" fill={`url(#${id('vig')})`} />
      </svg>

      {/* film grain over the whole scene — same treatment as every dark band */}
      <span aria-hidden className="grain grain-dark" />

      {children && (
        <div className="absolute inset-x-0 bottom-0 z-10">
          {children}
        </div>
      )}
    </div>
  )
}
