import React, { useEffect, useRef } from 'react'
import { useAuthStore } from '@unifiedtree/sdk'
import { useNotificationStore } from './notificationStore'

interface NotificationProviderProps {
  children: React.ReactNode
}

/** Poll cadence — mobile bell also polls on foreground; web tab is longer-lived
 *  so we keep it at 60s. Cheap query (indexed on recipient + createdAt DESC). */
const POLL_MS = 60_000

/**
 * Wires the {@link useNotificationStore} to auth state. As soon as the SDK
 * auth store reports {@code status === 'authenticated'} (login or restore),
 * we fetch the current user's notifications and start a 60s poll; on sign-out
 * the poll is torn down.
 *
 * Note: the SDK's {@code useAuthStore} does not expose the access token
 * (it's kept in a private in-memory ref). We gate on {@code status} because
 * that's the observable signal — {@code apiJson} reads the token itself.
 */
export const NotificationProvider: React.FC<NotificationProviderProps> = ({ children }) => {
  const isAuthed = useAuthStore((s) => s.status === 'authenticated')
  const fetchNotifications = useNotificationStore((s) => s.fetch)
  const resetNotifications = useNotificationStore((s) => s.reset)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // Track the previous auth state so we only reset on true authed→unauthed
  // transitions (not on the initial "unauthed" mount before login, which
  // would clobber nothing but still fire an extra render for no reason).
  const wasAuthedRef = useRef(false)

  useEffect(() => {
    if (!isAuthed) {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
      // Sign-out (or session expiry): drop every cached row so the next user
      // signing in on the same tab never sees the previous user's inbox
      // between login and the first /v1/notifications response. Without this,
      // zustand keeps the old array in memory and the bell renders stale
      // cross-user data.
      if (wasAuthedRef.current) {
        resetNotifications()
        wasAuthedRef.current = false
      }
      return
    }
    wasAuthedRef.current = true
    // Immediate load on login/mount, then poll.
    fetchNotifications()
    timerRef.current = setInterval(fetchNotifications, POLL_MS)

    // Refresh when the tab regains focus — a user coming back after 20 min
    // shouldn't have to wait up to a minute for the poll tick.
    const onFocus = () => fetchNotifications()
    window.addEventListener('focus', onFocus)

    return () => {
      window.removeEventListener('focus', onFocus)
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
  }, [isAuthed, fetchNotifications, resetNotifications])

  return <>{children}</>
}
