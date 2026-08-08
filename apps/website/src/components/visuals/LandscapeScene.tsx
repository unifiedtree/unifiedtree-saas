import { motion, useScroll, useTransform, useReducedMotion } from 'framer-motion'
import { useId, useRef } from 'react'

/**
 * The signature backdrop: a painted-feeling valley built entirely from SVG so
 * it scales to any viewport, weighs ~4kb, themes off our emerald palette, and
 * can parallax layer-by-layer. No raster assets, nothing to load.
 *
 * Layers back-to-front — each drifts at a different rate on scroll, which is
 * what sells the depth ("curtain raising" as the page moves).
 *
 * NOTE ON IDS: every gradient/filter/clip id is namespaced with useId(). SVG
 * ids are document-global, so two scenes with different tones on one page
 * would otherwise both resolve url(#ls-sky) to whichever mounted first — a
 * dusk band would silently render in dawn colours. Do not hardcode these.
 */

interface Props {
  className?: string
  /** Dawn (deep crown → warm horizon, for heroes) or dusk (deep, for dark bands). */
  tone?: 'dawn' | 'dusk'
  /** Renders the big translucent wordmark rising from behind the ridge. */
  wordmark?: string
}

export function LandscapeScene({ className = '', tone = 'dawn', wordmark }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const reduce = useReducedMotion()
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] })

  // Unique per instance — see note above.
  const raw = useId()
  const uid = raw.replace(/[^a-zA-Z0-9]/g, '')
  const id = (name: string) => `ls-${name}-${uid}`

  // Back layers drift least, front layers most — classic parallax ordering.
  const ySky = useTransform(scrollYProgress, [0, 1], ['0%', reduce ? '0%' : '6%'])
  const yFar = useTransform(scrollYProgress, [0, 1], ['0%', reduce ? '0%' : '12%'])
  const yMid = useTransform(scrollYProgress, [0, 1], ['0%', reduce ? '0%' : '22%'])
  const yNear = useTransform(scrollYProgress, [0, 1], ['0%', reduce ? '0%' : '34%'])
  // The wordmark rises INTO view from behind the ridge as you scroll.
  const yWord = useTransform(scrollYProgress, [0, 0.6], ['26%', reduce ? '26%' : '-4%'])
  const oWord = useTransform(scrollYProgress, [0.05, 0.35], [0, 1])

  const dusk = tone === 'dusk'

  return (
    <div ref={ref} className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}>
      <svg
        viewBox="0 0 1440 900"
        preserveAspectRatio="xMidYMax slice"
        className="h-full w-full"
        aria-hidden
      >
        <defs>
          <linearGradient id={id('sky')} x1="0" y1="0" x2="0" y2="1">
            {dusk ? (
              <>
                <stop offset="0%" stopColor="#011E17" />
                <stop offset="42%" stopColor="#04503A" />
                <stop offset="74%" stopColor="#065F46" />
                <stop offset="100%" stopColor="#0F766E" />
              </>
            ) : (
              // Deep at the crown so white display type reads, warming to a
              // low dawn light at the horizon.
              <>
                <stop offset="0%" stopColor="#04503A" />
                <stop offset="30%" stopColor="#047857" />
                <stop offset="56%" stopColor="#10B981" />
                <stop offset="78%" stopColor="#A7F3D0" />
                <stop offset="100%" stopColor="#FEF3C7" />
              </>
            )}
          </linearGradient>

          {/* Low sun bloom sitting on the horizon */}
          <radialGradient id={id('sun')} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={dusk ? '#A7F3D0' : '#FDE68A'} stopOpacity={dusk ? 0.4 : 0.9} />
            <stop offset="60%" stopColor={dusk ? '#34D399' : '#FCD34D'} stopOpacity="0.18" />
            <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
          </radialGradient>

          {/* Hill bands — light at the back, deep at the front */}
          <linearGradient id={id('far')} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={dusk ? '#065F46' : '#A7F3D0'} />
            <stop offset="100%" stopColor={dusk ? '#047857' : '#6EE7B7'} />
          </linearGradient>
          <linearGradient id={id('mid')} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={dusk ? '#04503A' : '#34D399'} />
            <stop offset="100%" stopColor={dusk ? '#043D2D' : '#10B981'} />
          </linearGradient>
          <linearGradient id={id('near')} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={dusk ? '#032B20' : '#10B981'} />
            <stop offset="100%" stopColor={dusk ? '#022119' : '#059669'} />
          </linearGradient>
          <linearGradient id={id('front')} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={dusk ? '#021B14' : '#059669'} />
            <stop offset="100%" stopColor={dusk ? '#01120D' : '#04503A'} />
          </linearGradient>

          {/* Soft haze that separates each ridge from the one behind it */}
          <linearGradient id={id('haze')} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={dusk ? '#5EEAD4' : '#FFFFFF'} stopOpacity="0.42" />
            <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
          </linearGradient>

          <filter id={id('blur')} x="-20%" y="-200%" width="140%" height="500%">
            <feGaussianBlur stdDeviation="14" />
          </filter>

          <clipPath id={id('clip')}>
            <rect x="0" y="0" width="1440" height="900" />
          </clipPath>
        </defs>

        <g clipPath={`url(#${id('clip')})`}>
          {/* ── Sky ─────────────────────────────────────────────── */}
          <motion.g style={{ y: ySky }}>
            <rect x="-100" y="-80" width="1640" height="1060" fill={`url(#${id('sky')})`} />
            <ellipse cx="720" cy="560" rx="620" ry="300" fill={`url(#${id('sun')})`} />
            {/* Haze bands — kept low and very soft so display type stays clean. */}
            <g opacity={dusk ? 0.14 : 0.26} filter={`url(#${id('blur')})`}>
              <ellipse cx="250" cy="452" rx="330" ry="17" fill="#FFFFFF" opacity="0.5" />
              <ellipse cx="470" cy="490" rx="240" ry="12" fill="#FFFFFF" opacity="0.35" />
              <ellipse cx="1130" cy="436" rx="360" ry="19" fill="#FFFFFF" opacity="0.45" />
              <ellipse cx="930" cy="486" rx="250" ry="12" fill="#FFFFFF" opacity="0.3" />
            </g>
          </motion.g>

          {/* ── Wordmark rising from behind the ridge ───────────── */}
          {wordmark && (
            <motion.g style={{ y: yWord, opacity: oWord }}>
              <text
                x="720"
                y="640"
                textAnchor="middle"
                fill="#FFFFFF"
                fillOpacity={dusk ? 0.14 : 0.5}
                style={{
                  fontFamily: 'Inter, sans-serif',
                  fontSize: 250,
                  fontWeight: 800,
                  letterSpacing: '-0.045em',
                }}
              >
                {wordmark}
              </text>
            </motion.g>
          )}

          {/* ── Far ridge ───────────────────────────────────────── */}
          <motion.g style={{ y: yFar }}>
            <path
              d="M-40 600 C 160 520, 300 560, 470 536 C 640 512, 760 452, 940 486 C 1120 520, 1290 500, 1480 548 L1480 980 L-40 980 Z"
              fill={`url(#${id('far')})`}
            />
            <path
              d="M-40 600 C 160 520, 300 560, 470 536 C 640 512, 760 452, 940 486 C 1120 520, 1290 500, 1480 548 L1480 616 L-40 668 Z"
              fill={`url(#${id('haze')})`}
              opacity="0.5"
            />
          </motion.g>

          {/* ── Mid ridge ───────────────────────────────────────── */}
          <motion.g style={{ y: yMid }}>
            <path
              d="M-40 686 C 200 612, 380 668, 560 640 C 760 608, 900 552, 1100 600 C 1250 636, 1360 620, 1480 648 L1480 980 L-40 980 Z"
              fill={`url(#${id('mid')})`}
            />
            <g fill={dusk ? '#01120D' : '#047857'} opacity="0.32">
              {[210, 268, 322, 372, 1042, 1096, 1148, 1206, 1262].map((x, i) => (
                <path key={x} d={`M${x} ${648 + (i % 3) * 6} l9 26 h-18 z`} />
              ))}
            </g>
          </motion.g>

          {/* ── Near ridge ──────────────────────────────────────── */}
          <motion.g style={{ y: yNear }}>
            <path
              d="M-40 782 C 240 700, 420 764, 640 738 C 880 710, 1040 656, 1240 706 C 1350 734, 1420 726, 1480 742 L1480 980 L-40 980 Z"
              fill={`url(#${id('near')})`}
            />
          </motion.g>

          {/* ── Foreground meadow ───────────────────────────────── */}
          <motion.g style={{ y: yNear }}>
            <path
              d="M-40 880 C 300 826, 560 878, 820 856 C 1080 834, 1280 848, 1480 838 L1480 980 L-40 980 Z"
              fill={`url(#${id('front')})`}
              opacity="0.96"
            />
          </motion.g>
        </g>
      </svg>
    </div>
  )
}
