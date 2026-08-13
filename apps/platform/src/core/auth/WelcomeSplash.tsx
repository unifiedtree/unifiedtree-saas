import React, { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'

/**
 * The moment after sign-in.
 *
 * Odoo greets you by name on the way in; ours does the same but in our own
 * language — a grove settling into place. A sapling draws itself, leaves drift
 * down past it, and the workspace name arrives underneath. It plays ONCE per
 * signed-in session (sessionStorage), so it feels like an arrival rather than
 * a loading screen you have to sit through every navigation.
 *
 * Two modes:
 *   mode="booting" — hydrating, no identity yet: just the grove, breathing.
 *   mode="welcome" — we know who they are: greet them, then get out of the way.
 */

const SESSION_KEY = 'ut.welcomed'

/** Has the welcome already played for this signed-in session? */
export function hasWelcomed(): boolean {
  try {
    return sessionStorage.getItem(SESSION_KEY) === '1'
  } catch {
    return true // storage blocked → never block the app on an animation
  }
}

export function markWelcomed() {
  try {
    sessionStorage.setItem(SESSION_KEY, '1')
  } catch {
    /* ignore — private mode */
  }
}

/** Deterministic drift so the leaves differ but never re-randomise on re-render. */
const LEAVES = [
  { x: -280, delay: 0.05, dur: 3.4, rot: -220, scale: 0.9,  tint: '#A7F3D0' },
  { x: -190, delay: 0.45, dur: 4.1, rot: 190,  scale: 0.65, tint: '#6EE7B7' },
  { x: -110, delay: 0.9,  dur: 3.1, rot: -140, scale: 1.05, tint: '#34D399' },
  { x:  -40, delay: 1.35, dur: 3.8, rot: 260,  scale: 0.75, tint: '#A7F3D0' },
  { x:   60, delay: 0.25, dur: 3.6, rot: -200, scale: 0.95, tint: '#6EE7B7' },
  { x:  140, delay: 0.75, dur: 4.3, rot: 170,  scale: 0.7,  tint: '#34D399' },
  { x:  225, delay: 1.15, dur: 3.3, rot: -260, scale: 1.0,  tint: '#A7F3D0' },
  { x:  310, delay: 0.6,  dur: 3.9, rot: 210,  scale: 0.8,  tint: '#6EE7B7' },
]

/** A single stylised leaf — one path, so it stays crisp at any size. */
function Leaf({ tint, size = 26 }: { tint: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M21 3c0 8.5-5.2 13.5-12 13.5-1.2 0-2.3-.15-3.3-.45C6.9 9.6 12.4 5.4 21 3Z"
        fill={tint}
        fillOpacity="0.9"
      />
      <path d="M4 21c1.6-4.8 4.2-8.2 8-10.4" stroke={tint} strokeOpacity="0.7" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

interface Props {
  mode: 'booting' | 'welcome'
  /** Shown in welcome mode. */
  name?: string
  workspace?: string
  /** Fired when the welcome has finished playing. */
  onDone?: () => void
}

export const WelcomeSplash: React.FC<Props> = ({ mode, name, workspace, onDone }) => {
  const reduce = useReducedMotion()
  const [visible, setVisible] = useState(true)

  // Welcome mode is time-boxed — it must never become a wall between the user
  // and their workspace. Reduced motion gets a much shorter beat.
  useEffect(() => {
    if (mode !== 'welcome') return
    const ms = reduce ? 900 : 2500
    const t = setTimeout(() => {
      setVisible(false)
      // let the exit transition finish before unmounting
      setTimeout(() => onDone?.(), reduce ? 0 : 500)
    }, ms)
    return () => clearTimeout(t)
  }, [mode, reduce, onDone])

  const greeting = useMemo(() => {
    const h = new Date().getHours()
    return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
  }, [])

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="welcome"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, scale: reduce ? 1 : 1.04 }}
          transition={{ duration: reduce ? 0.15 : 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="fixed inset-0 z-[9999] flex items-center justify-center overflow-hidden"
          style={{
            backgroundColor: '#04503A',
            backgroundImage: [
              'radial-gradient(58% 50% at 50% 36%, rgba(16,185,129,0.34), transparent 68%)',
              'radial-gradient(46% 40% at 84% 8%, rgba(5,150,105,0.30), transparent 72%)',
              'linear-gradient(168deg, #065F46 0%, #04503A 55%, #02291E 100%)',
            ].join(', '),
          }}
        >
          {/* ── Drifting leaves ───────────────────────────────────── */}
          {!reduce && (
            <div aria-hidden className="pointer-events-none absolute inset-0">
              {LEAVES.map((l, i) => (
                <motion.div
                  key={i}
                  className="absolute left-1/2 top-0"
                  initial={{ x: l.x, y: -80, rotate: 0, opacity: 0 }}
                  animate={{
                    x: [l.x, l.x + 26, l.x - 14, l.x + 8],
                    y: ['-10vh', '110vh'],
                    rotate: l.rot,
                    opacity: [0, 0.85, 0.85, 0],
                  }}
                  transition={{
                    duration: l.dur,
                    delay: l.delay,
                    repeat: Infinity,
                    ease: 'linear',
                    times: [0, 0.2, 0.75, 1],
                  }}
                  style={{ scale: l.scale }}
                >
                  <Leaf tint={l.tint} />
                </motion.div>
              ))}
            </div>
          )}

          {/* ── The grove ─────────────────────────────────────────── */}
          <div className="relative z-10 flex flex-col items-center px-6 text-center">
            <motion.div
              initial={{ scale: reduce ? 1 : 0.7, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: reduce ? 0.2 : 0.75, ease: [0.16, 1, 0.3, 1] }}
              className="relative"
            >
              {/* soft halo behind the mark */}
              <span
                aria-hidden
                className="absolute left-1/2 top-1/2 h-32 w-32 -translate-x-1/2 -translate-y-1/2 rounded-full"
                style={{ background: 'radial-gradient(circle, rgba(167,243,208,0.28), transparent 70%)', filter: 'blur(18px)' }}
              />
              <img
                src="/UnifiedTreeLogo.png"
                alt=""
                aria-hidden
                className="relative h-14 w-auto object-contain brightness-0 invert"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
              />
            </motion.div>

            {mode === 'welcome' ? (
              <>
                <motion.p
                  initial={{ opacity: 0, y: reduce ? 0 : 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: reduce ? 0 : 0.45, ease: [0.16, 1, 0.3, 1] }}
                  className="mt-9 text-[13px] font-semibold uppercase tracking-[0.18em] text-[#A7F3D0]"
                >
                  {greeting}
                </motion.p>

                <motion.h1
                  initial={{ opacity: 0, y: reduce ? 0 : 18, filter: reduce ? 'none' : 'blur(6px)' }}
                  animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                  transition={{ duration: 0.7, delay: reduce ? 0 : 0.6, ease: [0.16, 1, 0.3, 1] }}
                  className="mt-3 font-heading font-bold text-white"
                  style={{ fontSize: 'clamp(2rem, 5vw, 3.25rem)', letterSpacing: '-0.03em', lineHeight: 1.05 }}
                >
                  Welcome back{name ? <>, <span className="text-[#A7F3D0]">{name}</span></> : ''}
                </motion.h1>

                {workspace && (
                  <motion.p
                    initial={{ opacity: 0, y: reduce ? 0 : 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: reduce ? 0 : 0.85, ease: [0.16, 1, 0.3, 1] }}
                    className="mt-4 text-[15px] text-white/70"
                  >
                    Opening {workspace}
                  </motion.p>
                )}
              </>
            ) : (
              /* Booting: no identity yet — just a quiet growing line. */
              <div className="mt-9 h-[3px] w-32 overflow-hidden rounded-full bg-white/15">
                <motion.div
                  className="h-full rounded-full bg-[#A7F3D0]"
                  initial={{ x: '-100%' }}
                  animate={reduce ? { x: '0%' } : { x: ['-100%', '100%'] }}
                  transition={{ duration: 1.25, repeat: Infinity, ease: 'easeInOut' }}
                />
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
