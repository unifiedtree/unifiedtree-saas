import { useId, useRef } from 'react'
import type { MotionValue } from 'framer-motion'
import { motion, useMotionValue, useSpring, useTransform, useReducedMotion } from 'framer-motion'
import {
  BRANCH_SEGS,
  ROOT_SEGS,
  LEAF_POS,
  LEAF_BLADE,
  LEAF_STALK,
  LEAF_VEINS,
  TRUNK_PATH,
  type LeafPos,
} from './treeGeometry'

/**
 * The tree, drawn as four addressable parts, with real dimensionality.
 *
 * This is the left half of TreeSection. It rests in grey; hovering a point on
 * the right lights the matching part emerald, and the final point lights every
 * part at once. The artwork is not decoration — each stroke of it is the
 * referent of a specific claim.
 *
 * Two ideas make this work:
 *
 * 1. COLOUR LIVES ON THE GROUP. Each part is exactly one <g> carrying a `color`,
 *    and every child paints with `currentColor`. So a whole part recolours with
 *    one value, and adding geometry never means touching the colour logic.
 *
 * 2. SHADING IS COLOUR-INDEPENDENT. Volume comes from an SVG lighting filter
 *    that reads only the ALPHA channel — never the fill. That is the whole
 *    trick: the trunk looks round whether it is grey or emerald, so the 3D
 *    survives the transition for free instead of needing a second green palette
 *    hand-maintained alongside the grey one.
 */

export type TreePart = 'roots' | 'trunk' | 'branches' | 'leaves'
/** `all` is the closing beat: the entire tree alight at once. */
export type TreeFocus = TreePart | 'all' | null

/** Resting greys — slightly cool, so the tree reads as a printed watermark and
    the emerald has somewhere to travel to. Back layers are lighter (aerial
    perspective: distant things lose contrast). */
const REST = {
  roots: '#C2CBC6',
  trunk: '#BCC6C0',
  branches: '#CBD3CF',
  leaves: '#D8E0DB',
} satisfies Record<TreePart, string>

const LIT = '#059669'
const LIT_LEAF = '#10B981'

function partColor(part: TreePart, focus: TreeFocus): string {
  const on = focus === 'all' || focus === part
  if (!on) return REST[part]
  return part === 'leaves' ? LIT_LEAF : LIT
}

interface Props {
  focus: TreeFocus
  className?: string
}

export function TreeAnatomy({ focus, className }: Props) {
  /* SVG ids are document-global; namespace them so a second instance on the
     same page cannot steal this one's filter and gradient references. */
  const uid = useId().replace(/:/g, '')
  const reduce = useReducedMotion()
  const hostRef = useRef<HTMLDivElement>(null)

  /* Pointer parallax. Near layers travel further than far ones, which is what
     sells depth — a flat illustration moving as one plane just looks like it
     is sliding. */
  const px = useMotionValue(0)
  const py = useMotionValue(0)
  const sx = useSpring(px, { stiffness: 110, damping: 20, mass: 0.4 })
  const sy = useSpring(py, { stiffness: 110, damping: 20, mass: 0.4 })
  const farX = useTransform(sx, (v) => v * 4)
  const farY = useTransform(sy, (v) => v * 3)
  const midX = useTransform(sx, (v) => v * 9)
  const midY = useTransform(sy, (v) => v * 6)
  const nearX = useTransform(sx, (v) => v * 15)
  const nearY = useTransform(sy, (v) => v * 10)
  /* The contact shadow slides with the trunk but barely rises — a shadow on the
     ground does not lift when the viewer's eye moves. Hoisted out of the JSX
     because hooks may not be called mid-render-tree. */
  const shadowY = useTransform(midY, (v) => v * 0.25)

  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (reduce) return
    const r = hostRef.current?.getBoundingClientRect()
    if (!r) return
    px.set((e.clientX - r.left) / r.width - 0.5)
    py.set((e.clientY - r.top) / r.height - 0.5)
  }
  const onLeave = () => {
    px.set(0)
    py.set(0)
  }

  const groupStyle = (part: TreePart): React.CSSProperties => ({
    color: partColor(part, focus),
    transition: 'color 420ms cubic-bezier(0.16,1,0.3,1)',
  })

  const lit = (part: TreePart) => focus === 'all' || focus === part

  return (
    <div
      ref={hostRef}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      className={`relative ${className ?? ''}`}
    >
      {/* Ground bloom — swells when the whole tree is alight. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 transition-opacity duration-700"
        style={{
          opacity: focus === 'all' ? 1 : 0,
          background: 'radial-gradient(56% 44% at 50% 64%, rgba(16,185,129,0.22), transparent 72%)',
        }}
      />

      <svg
        /* Cropped to the artwork's real bounds rather than the nominal 520x640
           drawing space — the untrimmed box left a wide band of dead air around
           the tree, which read as the illustration being too small for its
           column. Height runs past 640 to take in the roots. */
        viewBox="38 104 448 572"
        className="relative w-full overflow-visible"
        role="img"
        aria-label="A tree whose roots, trunk, branches and leaves each stand for a part of the platform"
      >
        <defs>
          {/*
            The volume filter. feDiffuseLighting reads SourceAlpha only, so the
            bevel it produces is identical whether the shape underneath is grey
            or emerald — which is exactly why the 3D survives the colour change
            without a second palette. The blur sets how soft the rounding is;
            surfaceScale sets how far the surface appears to rise.
          */}
          <filter id={`${uid}-vol`} x="-25%" y="-25%" width="150%" height="150%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="2.4" result="soft" />
            <feDiffuseLighting
              in="soft"
              surfaceScale="3.2"
              diffuseConstant="1"
              lightingColor="#ffffff"
              result="light"
            >
              {/* Light from the upper left, consistent across every part. */}
              <feDistantLight azimuth="135" elevation="58" />
            </feDiffuseLighting>
            {/* Multiply the lighting back over the artwork so it shades the real
                colour instead of replacing it. */}
            <feComposite in="light" in2="SourceAlpha" operator="in" result="shade" />
            <feBlend in="SourceGraphic" in2="shade" mode="multiply" result="shaded" />
            {/* A touch of specular along the lit edge reads as a rounded surface
                catching light, rather than a flat shape with a gradient on it. */}
            <feSpecularLighting
              in="soft"
              surfaceScale="2.6"
              specularConstant="0.5"
              specularExponent="22"
              lightingColor="#ffffff"
              result="spec"
            >
              <feDistantLight azimuth="135" elevation="62" />
            </feSpecularLighting>
            <feComposite in="spec" in2="SourceAlpha" operator="in" result="specClip" />
            <feComposite
              in="shaded"
              in2="specClip"
              operator="arithmetic"
              k1="0"
              k2="1"
              k3="0.85"
              k4="0"
            />
          </filter>

          {/* Cast shadow on the ground — anchors the tree instead of letting it float. */}
          <radialGradient id={`${uid}-ground`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#0B231A" stopOpacity="0.20" />
            <stop offset="60%" stopColor="#0B231A" stopOpacity="0.07" />
            <stop offset="100%" stopColor="#0B231A" stopOpacity="0" />
          </radialGradient>

          {/* Depth of field for the layer sitting behind the tree. */}
          <filter id={`${uid}-far`} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="4.5" />
          </filter>
        </defs>

        {/* ── Far layer: a ghosted copy of the crown, blurred and drifting least.
               Pure depth cue — never lights up, never interactive. ────────── */}
        <motion.g
          aria-hidden
          style={{ x: farX, y: farY }}
          filter={`url(#${uid}-far)`}
          opacity="0.5"
        >
          <BackCanopy />
        </motion.g>

        {/* Contact shadow travels with the trunk so the tree stays planted. */}
        <motion.ellipse
          aria-hidden
          cx="260"
          cy="572"
          rx="156"
          ry="15"
          fill={`url(#${uid}-ground)`}
          style={{ x: midX, y: shadowY }}
        />

        {/* ── The four addressable parts ──────────────────────────────────── */}
        <motion.g style={{ x: midX, y: midY }}>
          <TreeGeometry
            volFilter={`url(#${uid}-vol)`}
            groupStyle={groupStyle}
            lit={lit}
            nearX={nearX}
            nearY={nearY}
          />
        </motion.g>
      </svg>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Geometry                                                           */
/* ------------------------------------------------------------------ */
/**
 * Split out so the artwork can be swapped without touching any of the colour,
 * lighting or parallax machinery above.
 */
function TreeGeometry({
  volFilter,
  groupStyle,
  lit,
  nearX,
  nearY,
}: {
  volFilter: string
  groupStyle: (part: TreePart) => React.CSSProperties
  lit: (part: TreePart) => boolean
  nearX: MotionValue<number>
  nearY: MotionValue<number>
}) {
  /* A lit part gets a bloom. Applied per group and chained AFTER the volume
     filter so the glow spreads from the already-shaded shape. */
  const glow = (part: TreePart) =>
    lit(part)
      ? `${volFilter} drop-shadow(0 0 12px rgba(5,150,105,0.45))`
      : volFilter

  return (
    <>
      <g id="roots" style={{ ...groupStyle('roots'), filter: glow('roots') }}>
        <RootGeometry />
      </g>

      <g id="trunk" style={{ ...groupStyle('trunk'), filter: glow('trunk') }}>
        <TrunkGeometry />
      </g>

      <g id="branches" style={{ ...groupStyle('branches'), filter: glow('branches') }}>
        <BranchGeometry />
      </g>

      {/* Leaves ride the near parallax plane — they are the closest thing to
          the viewer, so they must travel furthest.

          Two nested groups on purpose. A motion.g whose `style` carries motion
          values takes ownership of that style object, and plain CSS properties
          set alongside them are NOT reliably re-applied on re-render — which
          silently froze the leaves at their resting grey while every other part
          lit correctly. So motion owns the transform and nothing else, and a
          plain <g> underneath owns colour. The id must sit on the coloured
          group, since that is what the focus state is read from. */}
      <motion.g style={{ x: nearX, y: nearY }}>
        <g id="leaves" style={{ ...groupStyle('leaves'), filter: glow('leaves') }}>
          <LeafGeometry />
        </g>
      </motion.g>
    </>
  )
}

/* ------------------------------------------------------------------ */
/*  Artwork                                                            */
/* ------------------------------------------------------------------ */

function RootGeometry() {
  return (
    <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      {ROOT_SEGS.map((s, i) => (
        <path key={i} d={s.d} strokeWidth={s.w} />
      ))}
    </g>
  )
}

function TrunkGeometry() {
  return (
    <g fill="currentColor">
      <path d={TRUNK_PATH} />
    </g>
  )
}

function BranchGeometry() {
  return (
    <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      {BRANCH_SEGS.map((s, i) => (
        <path key={i} d={s.d} strokeWidth={s.w} />
      ))}
    </g>
  )
}

function LeafGeometry() {
  return (
    <g>
      {LEAF_POS.map((l, i) => (
        <Leaf key={i} {...l} />
      ))}
    </g>
  )
}

/**
 * The out-of-focus crown behind the tree — the same leaves, sparser and offset,
 * so the blurred layer is made of the right shapes rather than generic blobs.
 * Never lights up; it exists only to give the crown depth.
 */
function BackCanopy() {
  return (
    <g fill="#CDD7D1">
      {LEAF_POS.filter((_, i) => i % 3 === 0).map((l, i) => (
        <g
          key={i}
          transform={`translate(${l.x - 12} ${l.y - 16}) rotate(${l.rot}) scale(${l.s * 1.15})`}
        >
          <path d={LEAF_BLADE} />
        </g>
      ))}
    </g>
  )
}

/** One cordate leaf: stalk, blade, and veins picked out in light. */
function Leaf({ x, y, rot, s }: LeafPos) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot}) scale(${s})`}>
      <path d={LEAF_STALK} stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" fill="none" />
      <path d={LEAF_BLADE} fill="currentColor" />
      {/* Veins are drawn in white rather than a fixed grey so they read the
          same way once the leaf turns emerald — a hard-coded vein colour would
          disappear against the lit state. */}
      <path
        d={LEAF_VEINS}
        fill="none"
        stroke="#FFFFFF"
        strokeOpacity={0.5}
        strokeWidth={1.5}
        strokeLinecap="round"
      />
    </g>
  )
}
