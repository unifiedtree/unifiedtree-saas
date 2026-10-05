// The top bar's bell and its popover (HrmsPlatform.dc.html L40, L74). The count is the server's
// unread count; the list is everything still unread plus the rest of the last 7 days, each with its
// module, how long ago, one line of its text and a gold dot while unread. A row marks itself read
// and opens where it belongs (core/notifications/notificationRoutes.ts).
// Two tabs, as the app's Alerts: Notifications, and Messages (Team messages sent to you, which
// used to show only on Home). Messages is left out when the server doesn't have Team messages.
import { useEffect, useRef, useState } from 'react'
import { Popover } from '@/design/kit/overlays'
import { EmptyState, ErrorState, SegmentedControl, SkeletonList } from '@/design/kit/display'
import { dashIcon } from '@/design/dc/icons'
import { useNotificationStore } from '@/core/notifications/notificationStore'
import { LAST_DAYS, bellRows, timeAgo } from '@/core/notifications/notificationRoutes'
import { useTeamMessages } from '@/modules/hrms/api/shared/useTeamMessages'
import { ShellIcon } from '../shellIcons'
import { TEAM_MESSAGE_DAYS, TeamMessagesList } from './TeamMessagesList'
import './notifications.css'

/** How many rows the popover lists (as before the redesign); more only when more are unread. */
const MAX_ROWS = 8

export type BellView = 'notifications' | 'messages'

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
  const [view, setView] = useState<BellView>('notifications')
  // Read when the popover opens, like the list. Not there yet (404 / 503): no Messages tab.
  const messages = useTeamMessages(TEAM_MESSAGE_DAYS, { enabled: open })
  const withMessages = !messages.notAvailable
  const showing: BellView = withMessages ? view : 'notifications'

  // The background poll only refreshes the unread count (NotificationProvider); the list is
  // fetched when the popover opens.
  useEffect(() => {
    if (open) void fetchList()
  }, [open, fetchList])

  const now = new Date()
  const rows = bellRows(notifications, now, MAX_ROWS)

  let body
  if (showing === 'messages') {
    body = <TeamMessagesList messages={messages.data} loading={messages.isLoading} error={messages.error} now={now}
      onRetry={() => void messages.refetch()} retrying={messages.isFetching} />
  } else if (loading && !loaded) body = <div className="ut-bellpop__state"><SkeletonList rows={3} pill={false} label="Loading notifications" /></div>
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
            {/* A punch-in alert's exact place, in a new tab (beside the row: a link can't sit inside its button). */}
            {n.mapUrl && (
              <a className="ut-bellpop__map" href={n.mapUrl} target="_blank" rel="noopener noreferrer"
                aria-label={`View on Google Maps: ${n.title} (opens in a new tab)`}
                onClick={() => { if (!n.isRead) void markAsRead(n.id) }}>
                {dashIcon('mapPin', 13)}View on Google Maps
              </a>
            )}
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
          {/* "Alerts" over the two tabs, as the app names it; just "Notifications" without Messages. */}
          <span className="ut-bellpop__heading">{withMessages ? 'Alerts' : 'Notifications'}</span>
          {showing === 'notifications' && <span className="ut-bellpop__new">{unreadCount > 0 ? `${unreadCount} new` : 'All caught up'}</span>}
        </div>
        {withMessages && (
          <div className="ut-bellpop__tabs">
            <SegmentedControl<BellView> label="Alerts" size="lg" value={showing} onChange={setView} options={[
              { value: 'notifications', label: 'Notifications', count: unreadCount > 0 ? (unreadCount > 99 ? '99+' : unreadCount) : null, controls: 'ut-bellpop-body' },
              { value: 'messages', label: 'Messages', controls: 'ut-bellpop-body' },
            ]} />
          </div>
        )}
        <div className="ut-bellpop__scroll" id="ut-bellpop-body" role={withMessages ? 'tabpanel' : undefined}>{body}</div>
        <div className="ut-bellpop__foot">
          {showing === 'messages' ? (
            <span className="ut-bellpop__span">Messages from the last {TEAM_MESSAGE_DAYS} days</span>
          ) : (
            <>
              {unreadCount > 0 && <button type="button" className="ut-bellpop__all" onClick={() => void markAllAsRead()}>Mark all as read</button>}
              <span className="ut-bellpop__span">Last {LAST_DAYS} days and all unread</span>
            </>
          )}
        </div>
      </Popover>
    </>
  )
}
