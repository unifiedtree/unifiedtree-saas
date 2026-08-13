import { useId, useRef } from 'react'
import { motion, useMotionValue, useSpring, useTransform, useReducedMotion } from 'framer-motion'
import type { TreeFocus, TreePart } from './TreeAnatomy'

/**
 * The supplied tree illustration, split into independently lightable parts.
 *
 * A flat image cannot be recoloured piece by piece — it is one grid of pixels.
 * So `tree.jpg` was separated once, offline, into five transparent PNGs by
 * classifying every pixel (see scripts note below), and each layer is used here
 * as a CSS **mask** over a solid colour rather than drawn as an image. That is
 * the whole trick: a mask keeps the artwork's exact silhouette while letting the
 * fill be any colour we like, so grey -> emerald is a plain colour transition.
 *
 * The layers were cut on measured boundaries, not guesses:
 *   leaves   green-dominant pixels above y=400 (all green below that is JPEG
 *            colour fringing on dark wood — 2126 stray pixels of it)
 *   ground   rows 441-445, the horizon rule; kept as its own layer so it stays
 *            neutral while the roots light up, instead of the horizon glowing
 *   trunk    the column x 280-319 between the fork and the ground
 *   roots    everything below the ground line
 *   branches the remaining wood
 */

const SRC = '/assets/tree-parts'

/**
 * Resting greys — cool rather than dead neutral, and deliberately darker than a
 * watermark. The first pass sat around #C2CCC6 and the tree all but vanished
 * against the tinted section ground; the specular pass lightens every layer
 * further, so the resting values have to start lower than they look on paper.
 * Leaves stay lightest so the crown reads as mass rather than a solid block.
 */
const REST: Record<TreePart, string> = {
  roots: '#98A69E',
  trunk: '#8E9D94',
  branches: '#A2AFA7',
  leaves: '#B6C3BB',
}

/**
 * Lit colours — client-specified, one per anatomical part rather than a single
 * highlight tint. The tree wakes into a real tree: green canopy, brown trunk,
 * near-black woody limbs and roots.
 *
 * (The brand emerald was tried first and read as neon — a synthetic colour laid
 * over a drawing of a real tree. Sampling the artwork's own averages came next;
 * these values are the client's refinement of that idea.)
 */
const LIT: Record<TreePart, string> = {
  leaves: '#579D4C',
  trunk: '#8B4513', // the "spine"
  branches: '#6B5A4A',
  roots: '#202418',
}

/**
 * Bloom colour per part, as `r,g,b`.
 *
 * Each part glows its own colour, except the roots: at #202418 they are
 * near-black, and a black bloom reads as a muddy shadow rather than a part
 * coming alive, so they borrow the canopy's green at low opacity.
 */
const GLOW: Record<TreePart, string> = {
  leaves: '87,157,76',
  trunk: '139,69,19',
  branches: '107,90,74',
  roots: '87,157,76',
}

/** The horizon never lights — it is scenery, not part of the argument. */
const GROUND_COLOR = '#C8D0CB'

const ORDER: TreePart[] = ['roots', 'trunk', 'branches', 'leaves']

interface Props {
  focus: TreeFocus
  className?: string
}

export function TreePhoto({ focus, className }: Props) {
  const uid = useId().replace(/:/g, '')
  const reduce = useReducedMotion()
  const hostRef = useRef<HTMLDivElement>(null)

  const px = useMotionValue(0)
  const py = useMotionValue(0)
  const sx = useSpring(px, { stiffness: 110, damping: 20, mass: 0.4 })
  const sy = useSpring(py, { stiffness: 110, damping: 20, mass: 0.4 })
  const farX = useTransform(sx, (v) => v * 4)
  const farY = useTransform(sy, (v) => v * 3)
  const midX = useTransform(sx, (v) => v * 8)
  const midY = useTransform(sy, (v) => v * 5)
  const nearX = useTransform(sx, (v) => v * 13)
  const nearY = useTransform(sy, (v) => v * 8)

  const plane = (part: TreePart) => {
    if (part === 'leaves') return { x: nearX, y: nearY }
    if (part === 'branches') return { x: midX, y: midY }
    return { x: farX, y: farY }
  }

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

  const isLit = (part: TreePart) => focus === 'all' || focus === part

  const maskStyle = (name: string): React.CSSProperties => ({
    WebkitMaskImage: `url(${SRC}/${name}.png)`,
    maskImage: `url(${SRC}/${name}.png)`,
    WebkitMaskSize: 'contain',
    maskSize: 'contain',
    WebkitMaskRepeat: 'no-repeat',
    maskRepeat: 'no-repeat',
    WebkitMaskPosition: 'center',
    maskPosition: 'center',
  })

  return (
    <div
      ref={hostRef}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      className={`relative aspect-[592/730] w-full ${className ?? ''}`}
    >
      {/* Ground bloom, swelling when the whole tree is alight. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 transition-opacity duration-700"
        style={{
          opacity: focus === 'all' ? 1 : 0,
          background: `radial-gradient(54% 40% at 50% 52%, rgba(${GLOW.leaves},0.26), transparent 72%)`,
        }}
      />

      {/* The volume filter, shared by every layer. It reads SourceAlpha only,
          so the rounding it produces is identical whether the layer beneath is
          grey or emerald — the 3D survives the colour change for free. */}
      <svg width="0" height="0" aria-hidden className="absolute">
        <defs>
          <filter id={`${uid}-vol`} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="1.6" result="soft" />
            <feSpecularLighting
              in="soft"
              surfaceScale="2.4"
              specularConstant="0.42"
              specularExponent="20"
              lightingColor="#ffffff"
              result="spec"
            >
              <feDistantLight azimuth="135" elevation="60" />
            </feSpecularLighting>
            <feComposite in="spec" in2="SourceAlpha" operator="in" result="specClip" />
            <feComposite
              in="SourceGraphic"
              in2="specClip"
              operator="arithmetic"
              k1="0"
              k2="1"
              k3="0.9"
              k4="0"
            />
          </filter>
        </defs>
      </svg>

      {/* Horizon — always neutral, never part of the argument. */}
      <div aria-hidden className="absolute inset-0" style={{ ...maskStyle('ground'), backgroundColor: GROUND_COLOR }} />

      {/*
        Two nested elements per part, on purpose. CSS applies `filter` BEFORE
        `mask`, so putting both on one element would emboss the unmasked
        rectangle and mask the result — losing the bevel entirely. The parent
        carries the filter and the child carries the mask, so the filter sees
        the already-masked artwork.
      */}
      {ORDER.map((part) => (
        <motion.div
          key={part}
          aria-hidden
          className="absolute inset-0"
          style={{
            ...plane(part),
            filter: isLit(part)
              ? `url(#${uid}-vol) drop-shadow(0 0 11px rgba(${GLOW[part]},0.5))`
              : `url(#${uid}-vol)`,
            transition: 'filter 420ms cubic-bezier(0.16,1,0.3,1)',
          }}
        >
          <div
            id={part}
            className="absolute inset-0"
            style={{
              ...maskStyle(part),
              backgroundColor: isLit(part) ? LIT[part] : REST[part],
              transition: 'background-color 420ms cubic-bezier(0.16,1,0.3,1)',
            }}
          />
        </motion.div>
      ))}

      {/* One accessible description for the whole illustration. */}
      <span className="sr-only">
        A tree whose roots, trunk, branches and leaves each stand for a part of the platform.
      </span>
    </div>
  )
}
