// The top bar's bell and its popover (HrmsPlatform.dc.html L40, L74). The count is the server's
// unread count; the list is the person's real notifications from the last 7 days, each with its
// module, how long ago, one line of its text and a gold dot while unread. A row marks itself read
// and opens where it belongs (core/notifications/notificationRoutes.ts).
import { useEffect, useRef } from 'react'
import { Popover } from '@/design/kit/overlays'
import { EmptyState, ErrorState, SkeletonList } from '@/design/kit/display'
import { dashIcon } from '@/design/dc/icons'
import { useNotificationStore } from '@/core/notifications/notificationStore'
import { LAST_DAYS, timeAgo, withinDays } from '@/core/notifications/notificationRoutes'
import { ShellIcon } from '../shellIcons'
import './notifications.css'

/** How many rows the popover lists (as before the redesign). */
const MAX_ROWS = 8

export interface NotificationBellProps {
  open: boolean
  onToggle: () => void
  onClose: () => void
  /** Opens an in-app path. */
  onNavigate: (to: string) => void
}

export function NotificationBell({ open, onToggle, onClose, onNavigate }: NotificationBellProps) {
  const anchor = useRef<HTMLButtonElement>(null)
  const notifications = useNotificationStore((s) => s.notifications)
  const loading = useNotificationStore((s) => s.loading)
  const loaded = useNotificationStore((s) => s.loaded)
  const error = useNotificationStore((s) => s.error)
  const markAsRead = useNotificationStore((s) => s.markAsRead)
  const markAllAsRead = useNotificationStore((s) => s.markAllAsRead)
  const unreadCount = useNotificationStore((s) => s.unreadCount())
  const fetchList = useNotificationStore((s) => s.fetch)

  // The background poll only refreshes the unread count (NotificationProvider); the list is
  // fetched when the popover opens.
  useEffect(() => {
    if (open) void fetchList()
  }, [open, fetchList])

  const now = new Date()
  const rows = withinDays(notifications, now).slice(0, MAX_ROWS)

  let body
  if (loading && !loaded) body = <div className="ut-bellpop__state"><SkeletonList rows={3} pill={false} label="Loading notifications" /></div>
  else if (error && !notifications.length) body = <div className="ut-bellpop__state"><ErrorState title="Couldn’t load notifications" error={error} onRetry={() => void fetchList()} retrying={loading} /></div>
  else if (!rows.length) {
    body = (
      <div className="ut-bellpop__state">
        <EmptyState icon="bell" title="You’re all caught up" hint={notifications.length ? `Nothing new in the last ${LAST_DAYS} days.` : 'New updates show up here.'} />
      </div>
    )
  } else {
    body = (
      <ul className="ut-bellpop__list" data-testid="notification-list">
        {rows.map((n) => (
          <li key={n.id}>
            <button
              type="button"
              className="ut-bellpop__row"
              data-unread={n.isRead ? undefined : ''}
              data-kind={n.kind}
              onClick={() => { if (!n.isRead) void markAsRead(n.id); if (n.link) onNavigate(n.link) }}
            >
              <span className="ut-bellpop__icon" aria-hidden="true">{dashIcon(n.icon, 16)}</span>
              <span className="ut-bellpop__text">
                <span className="ut-bellpop__title">{n.title}</span>
                {n.message && n.message !== n.title && <span className="ut-bellpop__body">{n.message}</span>}
                <span className="ut-bellpop__meta">{n.group} · {timeAgo(n.createdAt, now)}</span>
              </span>
              {!n.isRead && <span className="ut-bellpop__dot" role="img" aria-label="Unread" />}
            </button>
          </li>
        ))}
      </ul>
    )
  }

  return (
    <>
      {/* The count is truthful — shown only when something is unread. */}
      <button ref={anchor} type="button" className="ut-topbar__icon" onClick={onToggle} aria-expanded={open} aria-haspopup="dialog"
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'} title="Notifications">
        <ShellIcon name="bell" size={18} />
        {unreadCount > 0 && <span className="ut-bell__n" aria-hidden="true">{unreadCount > 99 ? '99+' : unreadCount}</span>}
      </button>
      <Popover open={open} onClose={onClose} anchorRef={anchor} placement="bottom-end" width={370} maxHeight={560}
        role="dialog" aria-label="Notifications" className="ut-bellpop" initialFocus="none">
        <div className="ut-bellpop__head">
          <span className="ut-bellpop__heading">Notifications</span>
          <span className="ut-bellpop__new">{unreadCount > 0 ? `${unreadCount} new` : 'All caught up'}</span>
        </div>
        <div className="ut-bellpop__scroll">{body}</div>
        <div className="ut-bellpop__foot">
          {unreadCount > 0 && <button type="button" className="ut-bellpop__all" onClick={() => void markAllAsRead()}>Mark all as read</button>}
          <span className="ut-bellpop__span">Last {LAST_DAYS} days</span>
        </div>
      </Popover>
    </>
  )
}
