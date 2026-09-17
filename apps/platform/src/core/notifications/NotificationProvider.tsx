import React, { useEffect, useRef } from 'react'
import { useAuthStore } from '@unifiedtree/sdk'
import { useNotificationStore } from './notificationStore'

interface NotificationProviderProps {
  children: React.ReactNode
}

/**
 * Background poll cadence for the bell badge.
 *
 * 2026-09-17: raised from 60s to 5 min AND changed to fetch only the unread
 * COUNT, not the 50-row list. This provider is mounted above the router, so
 * previously every signed-in user was firing two /v1/notifications requests
 * per minute on every route — at 5,000 concurrent users that is ~167 req/s of
 * pure background load, most of it materialising 50 rows per user per minute
 * for a badge that only needs a number. The 50-row list is fetched lazily
 * when the panel actually opens (see NotificationBell.onOpen).
 *
 * We also pause the poll when the tab is hidden — a manager who leaves the
 * app open in a background tab used to keep hitting the API forever.
 */
const POLL_MS = 5 * 60_000

/**
 * Wires the {@link useNotificationStore} to auth state. Fetches the unread
 * COUNT on login and every {@link POLL_MS}, pauses while the tab is hidden,
 * and one immediate count refresh on visibilitychange back to visible or on
 * a focus event — a user coming back after an hour should not have to wait
 * up to five minutes for the badge to be right.
 *
 * The SDK's {@code useAuthStore} does not expose the access token
 * (it's kept in a private in-memory ref), so we gate on {@code status} —
 * that's the observable signal; {@code apiJson} reads the token itself.
 */
export const NotificationProvider: React.FC<NotificationProviderProps> = ({ children }) => {
  const isAuthed = useAuthStore((s) => s.status === 'authenticated')
  const fetchCount = useNotificationStore((s) => s.fetchUnreadCount)
  const resetNotifications = useNotificationStore((s) => s.reset)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // Track the previous auth state so we only reset on true authed→unauthed
  // transitions (not on the initial unauthed mount before login).
  const wasAuthedRef = useRef(false)

  useEffect(() => {
    if (!isAuthed) {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
      // Sign-out: drop every cached row so the next user signing in on the
      // same tab never sees the previous user's inbox between login and the
      // first response.
      if (wasAuthedRef.current) {
        resetNotifications()
        wasAuthedRef.current = false
      }
      return
    }
    wasAuthedRef.current = true

    // Never poll while the tab is hidden — the number is invisible anyway,
    // and a manager parking the app on a second monitor generates request
    // load forever otherwise. Starting/stopping the interval mirrors the
    // visibility state.
    let stopped = false
    const start = () => {
      if (timerRef.current || stopped) return
      timerRef.current = setInterval(fetchCount, POLL_MS)
    }
    const stop = () => {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    }
    const kick = () => { void fetchCount() }

    // Immediate load on login/mount, then poll while visible.
    kick()
    if (!document.hidden) start()

    const onVis = () => {
      if (document.hidden) { stop() }
      else { kick(); start() }
    }
    document.addEventListener('visibilitychange', onVis)
    // focus separately — some browsers do not fire visibilitychange when the
    // window regains focus without an explicit tab switch.
    window.addEventListener('focus', kick)

    return () => {
      stopped = true
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('focus', kick)
      stop()
    }
  }, [isAuthed, fetchCount, resetNotifications])

  return <>{children}</>
}
