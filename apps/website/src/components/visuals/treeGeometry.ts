/**
 * The tree's skeleton, grown once at module load.
 *
 * Hand-placing forty branches and fifty leaves produces a tree that looks
 * hand-placed — regular, symmetrical, and dead. So the geometry is *grown*:
 * each branch forks into two or three children at varying angles, each shorter
 * and thinner than its parent, and a leaf opens at every tip.
 *
 * The randomness is seeded and evaluated once at module scope, so the tree is
 * byte-identical on every render and every reload — it must never reshuffle
 * under the reader, and server and client must agree. This is generated
 * geometry, not animation.
 */

/** mulberry32 — small, fast, and deterministic for a given seed. */
function mulberry32(seed: number) {
  let a = seed
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface Seg {
  d: string
  w: number
}

export interface LeafPos {
  x: number
  y: number
  /** Degrees. The leaf is drawn pointing up, so this rotates it onto its twig. */
  rot: number
  s: number
}

const r1 = (n: number) => Math.round(n * 10) / 10

/**
 * A segment as a quadratic curve. Straight lines read as a diagram; the
 * perpendicular offset on the control point is what makes a branch look grown
 * rather than drawn.
 */
function curve(x1: number, y1: number, x2: number, y2: number, bend: number): string {
  const dx = x2 - x1
  const dy = y2 - y1
  const len = Math.hypot(dx, dy) || 1
  const px = -dy / len
  const py = dx / len
  const cx = (x1 + x2) / 2 + px * bend
  const cy = (y1 + y2) / 2 + py * bend
  return `M ${r1(x1)} ${r1(y1)} Q ${r1(cx)} ${r1(cy)} ${r1(x2)} ${r1(y2)}`
}

const rand = mulberry32(0x5eed1eaf)

const branches: Seg[] = []
const roots: Seg[] = []
const leaves: LeafPos[] = []

/**
 * Grow one branch and its children.
 *
 * @param ang    radians; -PI/2 points up the screen (y grows downward in SVG)
 * @param depth  remaining generations; a leaf opens when it reaches zero
 * @param out    which set of segments this limb belongs to
 * @param sprout whether tips carry leaves — roots must not
 */
/**
 * Open one leaf on a twig.
 *
 * The rotation jitter matters more than it looks. Aligning every leaf exactly
 * with its twig makes them all point radially outward, and the crown fuses
 * into a solid arc shell — which is precisely what happened on the first
 * attempt. Real leaves hang at their own angles, and that variance is what
 * keeps individual silhouettes readable inside a dense canopy.
 */
/**
 * Minimum gap between leaf anchors, in viewBox units.
 *
 * Without this the canopy silts up: wherever twigs happen to converge, six
 * leaves land on top of each other and the crown turns into one solid mass with
 * no readable silhouettes — the exact failure the reference avoids. Rejecting a
 * leaf that lands too close to an existing one thins the crowded regions while
 * leaving sparse ones untouched, which is what produces an even canopy with
 * daylight through it.
 */
/* Tips are held to a smaller gap than inner leaves. A twig that ends in nothing
   reads as broken, so terminal leaves get priority; the inner ones are the
   optional fill and take the stricter spacing. */
const GAP_TIP = 23
const GAP_INNER = 34

function sprout(x: number, y: number, ang: number, scale: number, gap: number) {
  for (const l of leaves) {
    if (Math.hypot(l.x - x, l.y - y) < gap) return
  }
  leaves.push({
    x: r1(x),
    y: r1(y),
    rot: r1((ang * 180) / Math.PI + 90 + (rand() - 0.5) * 88),
    s: r1(scale),
  })
}

function grow(
  x: number,
  y: number,
  ang: number,
  len: number,
  w: number,
  depth: number,
  out: Seg[],
  leafy: boolean,
) {
  const x2 = x + Math.cos(ang) * len
  const y2 = y + Math.sin(ang) * len
  out.push({ d: curve(x, y, x2, y2, (rand() - 0.5) * len * 0.34), w: r1(w) })

  if (depth <= 0) {
    if (leafy) sprout(x2, y2, ang, 0.5 + rand() * 0.34, GAP_TIP)
    return
  }

  /* Leaves along the inner branches, not only at the extremities. Without
     these the canopy is hollow: a rim of leaves around bare structure. */
  if (leafy && depth <= 2 && rand() < 0.62) {
    const t = 0.45 + rand() * 0.4
    sprout(x + (x2 - x) * t, y + (y2 - y) * t, ang, 0.42 + rand() * 0.26, GAP_INNER)
  }

  /* Two children usually, three sometimes — an unvarying fork factor is the
     single biggest tell that a tree was generated. */
  const n = rand() < 0.3 ? 3 : 2
  for (let i = 0; i < n; i++) {
    const spread = (i - (n - 1) / 2) * (0.4 + rand() * 0.2)
    grow(
      x2,
      y2,
      ang + spread + (rand() - 0.5) * 0.2,
      /* Wide length variance so sibling tips do not all land on the same
         radius — equidistant tips are the other half of the shell problem. */
      len * (0.6 + rand() * 0.24),
      w * 0.64,
      depth - 1,
      out,
      leafy,
    )
  }
}

/* ── The trunk ─────────────────────────────────────────────────────────
   Grown as a tapered outline rather than a stroke, because a stroke has the
   same width top and bottom and instantly reads as a stick. Slight lean and a
   flare at the base where it meets the ground. */
export const BASE = { x: 258, y: 584 }
export const FORK = { x: 264, y: 436 }

export const TRUNK_PATH = [
  `M ${BASE.x - 19} ${BASE.y}`,
  `C ${BASE.x - 15} ${BASE.y - 62}, ${FORK.x - 9} ${FORK.y + 74}, ${FORK.x - 6} ${FORK.y}`,
  `L ${FORK.x + 6} ${FORK.y}`,
  `C ${FORK.x + 10} ${FORK.y + 74}, ${BASE.x + 16} ${BASE.y - 62}, ${BASE.x + 20} ${BASE.y}`,
  'Z',
].join(' ')

/* ── The crown ─────────────────────────────────────────────────────────
   Three limbs off the fork: one leaning left, one up, one leaning right. Angles
   are deliberately not symmetrical — a mirrored tree looks manufactured. */
const LIMBS: Array<{ ang: number; len: number; w: number; rise: number }> = [
  { ang: -Math.PI / 2 - 0.74, len: 94, w: 10, rise: 0 },
  { ang: -Math.PI / 2 - 0.26, len: 112, w: 11.5, rise: 22 },
  { ang: -Math.PI / 2 + 0.18, len: 108, w: 11.5, rise: 12 },
  { ang: -Math.PI / 2 + 0.7, len: 96, w: 10, rise: 32 },
]

/* Limbs leave the trunk at staggered heights (`rise`). Four limbs radiating
   from one identical point reads as a starburst, not a tree — real branches
   emerge at intervals up the trunk. */
for (const l of LIMBS) {
  grow(FORK.x, FORK.y + l.rise, l.ang, l.len, l.w, 3, branches, true)
}

/* ── The roots ─────────────────────────────────────────────────────────
   The same growth rule pointed downward, shallower and thinner, so they read
   as roots rather than as a second crown. */
const ROOT_ANGLES = [Math.PI / 2 + 0.86, Math.PI / 2 + 0.3, Math.PI / 2 - 0.32, Math.PI / 2 - 0.88]
for (const ang of ROOT_ANGLES) {
  grow(BASE.x, BASE.y - 4, ang, 44, 7.5, 1, roots, false)
}

export const BRANCH_SEGS = branches
export const ROOT_SEGS = roots
export const LEAF_POS = leaves

/* ── The leaf ──────────────────────────────────────────────────────────
   Cordate: a notched heart-shaped base, widest in the lower third, drawn to a
   point at the tip. Base sits at the origin so a leaf can be dropped straight
   onto a twig tip, pointing up before rotation. */
export const LEAF_STALK = 'M 0 0 L 0 -7'

export const LEAF_BLADE = [
  'M 0 -6',
  'C -4 -2, -9 0, -15 -3',
  'C -26 -9, -31 -28, -25 -42',
  'C -20 -55, -10 -63, 0 -70',
  'C 10 -63, 20 -55, 25 -42',
  'C 31 -28, 26 -9, 15 -3',
  'C 9 0, 4 -2, 0 -6',
  'Z',
].join(' ')

/** Midrib plus three pairs of laterals sweeping toward the tip. */
export const LEAF_VEINS = [
  'M 0 -9 L 0 -63',
  'M 0 -20 Q -9 -26 -16 -35',
  'M 0 -20 Q 9 -26 16 -35',
  'M 0 -32 Q -8 -38 -14 -48',
  'M 0 -32 Q 8 -38 14 -48',
  'M 0 -44 Q -6 -49 -10 -57',
  'M 0 -44 Q 6 -49 10 -57',
].join(' ')
