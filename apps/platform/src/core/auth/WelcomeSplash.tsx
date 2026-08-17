import React, { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'

/**
 * The moment after signing in.
 *
 * ONE animation, and only when it is earned. It plays when someone signs in, or
 * arrives in the workspace from the marketing site — never on an ordinary page
 * reload, and never twice at once.
 *
 * The previous version did both of those things: it mounted a "booting" splash
 * while auth hydrated and then a second "welcome" splash on top, so the two
 * cross-faded through each other — a logo and a greeting at different vertical
 * offsets, visibly overlapping. And because it keyed off "has this session been
 * greeted", every fresh tab replayed it on reload. Both are fixed here by
 * separating the two jobs completely:
 *
 *   BootScreen      static, motionless. Shown only while auth resolves.
 *   WelcomeSplash   the single animation. Shown only on a real arrival.
 *
 * Arrival is signalled explicitly with `markWelcomeIntent()` at the point of
 * login, and consumed exactly once — which is what makes a reload silent.
 */

const INTENT_KEY = 'ut.welcome.intent'

/**
 * Mirrors the stored flag in memory. Signing in happens inside an already
 * running app, so the decision to greet has to be readable *synchronously
 * during render* — an effect runs after the browser has already painted, which
 * is what let the dashboard flash into view before the splash appeared.
 */
let pending = false

/** Call at the moment of a successful sign-in, or on cross-domain SSO entry. */
export function markWelcomeIntent() {
  pending = true
  try {
    sessionStorage.setItem(INTENT_KEY, '1')
  } catch {
    /* private mode — the welcome is decoration, never block on it */
  }
}

/** Pure read. Safe to call during render; never mutates anything. */
export function peekWelcomeIntent(): boolean {
  if (pending) return true
  try {
    return sessionStorage.getItem(INTENT_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * The decision at first paint, for a full page load.
 *
 * `?token=` means the visitor just came through from the marketing site, which
 * is an arrival and earns the greeting. Reading it here — in a state
 * initialiser rather than an effect — is what lets the splash be on screen from
 * the very first frame, instead of a boot screen appearing first and the
 * welcome replacing it a moment later.
 */
export function initialWelcomeIntent(): boolean {
  try {
    if (new URLSearchParams(window.location.search).has('token')) return true
  } catch {
    /* ignore */
  }
  return peekWelcomeIntent()
}

/** Spend the flag, so a later reload finds nothing and stays silent. */
export function consumeWelcomeIntent() {
  pending = false
  try {
    sessionStorage.removeItem(INTENT_KEY)
  } catch {
    /* ignore */
  }
}

export const clearWelcomeIntent = consumeWelcomeIntent

/* ------------------------------------------------------------------ */
/*  Shared ground                                                      */
/* ------------------------------------------------------------------ */
/** The gradient both screens sit on, so moving between them never flashes. */
const FIELD: React.CSSProperties = {
  backgroundColor: '#8FD49B',
  backgroundImage: [
    'radial-gradient(62% 52% at 50% 42%, rgba(255,255,255,0.42), transparent 68%)',
    'linear-gradient(135deg, #F0FCAB 0%, #A8E4A0 46%, #60BF8F 100%)',
  ].join(', '),
}

const INK = '#04503A'
const INK_SOFT = 'rgba(4,80,58,0.72)'
const EASE = [0.16, 1, 0.3, 1] as const

/* ------------------------------------------------------------------ */
/*  There is deliberately no boot screen.                              */
/*                                                                     */
/*  An earlier version showed a branded panel while auth resolved, so  */
/*  every reload of every page flashed a full-screen green screen. A   */
/*  reload should just be a reload. Nothing is needed in its place:    */
/*  RouteGuard already returns null for `idle`/`loading`, so protected */
/*  pages never render against an unresolved session.                  */
/* ------------------------------------------------------------------ */
/*  Welcome — the one animation                                        */
/* ------------------------------------------------------------------ */

/** Deterministic drift, so leaves differ but never reshuffle on re-render. */
const LEAVES = [
  { x: -300, delay: 0.0, dur: 3.6, rot: -210, scale: 0.9, tint: '#3E9E6B' },
  { x: -205, delay: 0.5, dur: 4.2, rot: 195, scale: 0.62, tint: '#2F8F63' },
  { x: -115, delay: 0.9, dur: 3.3, rot: -150, scale: 1.0, tint: '#57B97F' },
  { x: -35, delay: 1.4, dur: 3.9, rot: 250, scale: 0.72, tint: '#3E9E6B' },
  { x: 70, delay: 0.25, dur: 3.7, rot: -190, scale: 0.92, tint: '#2F8F63' },
  { x: 155, delay: 0.8, dur: 4.4, rot: 175, scale: 0.68, tint: '#57B97F' },
  { x: 245, delay: 1.15, dur: 3.4, rot: -250, scale: 0.98, tint: '#3E9E6B' },
  { x: 325, delay: 0.6, dur: 4.0, rot: 205, scale: 0.8, tint: '#2F8F63' },
]

function Leaf({ tint, size = 26 }: { tint: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M21 3c0 8.5-5.2 13.5-12 13.5-1.2 0-2.3-.15-3.3-.45C6.9 9.6 12.4 5.4 21 3Z"
        fill={tint}
        fillOpacity="0.75"
      />
      <path
        d="M4 21c1.6-4.8 4.2-8.2 8-10.4"
        stroke={tint}
        strokeOpacity="0.6"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  )
}

interface Props {
  /**
   * Whether identity has resolved. The splash covers the screen from the first
   * frame regardless, but the greeting text waits for this — otherwise the name
   * pops in mid-animation once /me returns.
   */
  ready?: boolean
  name?: string
  workspace?: string
  onDone?: () => void
}

/**
 * Timing. The whole thing is on screen for well under three seconds — it is an
 * arrival, not a loading screen someone has to sit through. Beats are staged so
 * each line lands as the previous one settles, rather than everything arriving
 * together and then waiting.
 */
const HOLD_MS = 2150
const EXIT_MS = 460

export const WelcomeSplash: React.FC<Props> = ({ ready = true, name, workspace, onDone }) => {
  const reduce = useReducedMotion()
  const [visible, setVisible] = useState(true)

  /* The clock starts when there is something to read, not when the screen
     appears — otherwise a slow /me eats the whole greeting and the splash
     vanishes just as the name lands. */
  useEffect(() => {
    if (!ready) return
    const hold = reduce ? 850 : HOLD_MS
    const exit = reduce ? 0 : EXIT_MS
    const t = setTimeout(() => {
      setVisible(false)
      setTimeout(() => onDone?.(), exit)
    }, hold)
    return () => clearTimeout(t)
  }, [ready, reduce, onDone])

  const greeting = useMemo(() => {
    const h = new Date().getHours()
    return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
  }, [])

  /* The caller passes the already-resolved display identity via useDisplayName()
     — `name` here is the FULL name ("Chakri Chikkala"), not just the first word.
     Callers that pass a first-name-only value get it verbatim. We still soft-
     capitalise the first letter so "shurya" reads as "Shurya" when the record
     came in lower case; multi-word names ("McKenzie", "de Souza") are otherwise
     left alone. */
  const shown = useMemo(() => {
    if (!name) return undefined
    const t = name.trim()
    if (!t) return undefined
    return t.charAt(0).toUpperCase() + t.slice(1)
  }, [name])

  /** Each beat starts as the one before it settles. */
  const beat = (delay: number, y = 14) => ({
    initial: { opacity: 0, y: reduce ? 0 : y },
    animate: { opacity: 1, y: 0 },
    transition: { duration: reduce ? 0.2 : 0.55, delay: reduce ? 0 : delay, ease: EASE },
  })

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="welcome"
          /* Opaque from frame one. Fading the overlay IN meant the app behind it
             was visible through the fade — which is exactly the "dashboard
             appears, then the animation starts" flash. Only the exit fades. */
          initial={{ opacity: 1 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, scale: reduce ? 1 : 1.03 }}
          transition={{ duration: reduce ? 0.15 : EXIT_MS / 1000, ease: EASE }}
          className="fixed inset-0 z-[9999] flex items-center justify-center overflow-hidden"
          style={FIELD}
        >
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
                    opacity: [0, 0.8, 0.8, 0],
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

          <div className="relative z-10 flex flex-col items-center px-6 text-center">
            <motion.img
              src="/UnifiedTreeLogo.png"
              alt=""
              aria-hidden
              initial={{ opacity: 0, scale: reduce ? 1 : 0.86 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: reduce ? 0.2 : 0.7, ease: EASE }}
              className="h-14 w-auto object-contain"
              onError={(e) => {
                ;(e.target as HTMLImageElement).style.display = 'none'
              }}
            />

            {/* Fixed height so the logo does not jump when the text arrives on a
                cold load, where identity resolves a beat after the screen. */}
            <div className="flex min-h-[150px] flex-col items-center justify-start">
              {ready && (
                <>
                  <motion.p
                    {...beat(0.16, 10)}
                    className="mt-8 text-[12.5px] font-semibold uppercase tracking-[0.2em]"
                    style={{ color: INK_SOFT }}
                  >
                    {greeting}
                  </motion.p>

                  <motion.h1
                    {...beat(0.28, 16)}
                    className="mt-2.5 font-heading font-bold"
                    style={{
                      color: INK,
                      fontSize: 'clamp(1.9rem, 4.6vw, 3rem)',
                      letterSpacing: '-0.03em',
                      lineHeight: 1.06,
                    }}
                  >
                    Welcome back{shown ? <>, {shown}</> : ''}
                  </motion.h1>

                  {workspace && (
                    <motion.p
                      {...beat(0.46, 10)}
                      className="mt-3.5 text-[15px]"
                      style={{ color: INK_SOFT }}
                    >
                      Opening {workspace}
                    </motion.p>
                  )}
                </>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
