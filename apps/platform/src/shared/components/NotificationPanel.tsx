import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { X, CheckCircle, AlertTriangle, XCircle, Info, Bell, Check } from 'lucide-react'
import { clsx } from 'clsx'
import { useNotificationStore } from '@/core/notifications/notificationStore'
import type { Notification } from '@/types'
import { formatDistanceToNow } from 'date-fns'

interface NotificationPanelProps {
  isOpen: boolean
  onClose: () => void
}

type TabKey = 'all' | 'unread' | 'priority'

const typeConfig = {
  success: { icon: CheckCircle, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
  warning: { icon: AlertTriangle, color: 'text-amber-400', bg: 'bg-amber-500/10' },
  error: { icon: XCircle, color: 'text-red-400', bg: 'bg-red-500/10' },
  info: { icon: Info, color: 'text-blue-400', bg: 'bg-blue-500/10' },
}

function groupByDate(notifications: Notification[]) {
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const yesterdayStart = todayStart - 86400000
  const weekStart = todayStart - 6 * 86400000

  const groups: Record<string, Notification[]> = {
    Today: [],
    Yesterday: [],
    'This Week': [],
    Older: [],
  }

  for (const n of notifications) {
    const t = new Date(n.createdAt).getTime()
    if (t >= todayStart) groups['Today'].push(n)
    else if (t >= yesterdayStart) groups['Yesterday'].push(n)
    else if (t >= weekStart) groups['This Week'].push(n)
    else groups['Older'].push(n)
  }

  return groups
}

export const NotificationPanel: React.FC<NotificationPanelProps> = ({ isOpen, onClose }) => {
  const navigate = useNavigate()
  const { notifications, markAsRead, markAllAsRead, removeNotification, unreadCount } = useNotificationStore()
  const [tab, setTab] = useState<TabKey>('all')

  const filtered = notifications.filter((n) => {
    if (tab === 'unread') return !n.isRead
    if (tab === 'priority') return n.type === 'error' || n.type === 'warning'
    return true
  })

  const groups = groupByDate(filtered)

  const handleClick = (n: Notification) => {
    markAsRead(n.id)
    if (n.link) { navigate(n.link); onClose() }
  }

  if (!isOpen) return null

  return (
    <>
      <div className="fixed inset-0 z-[150] bg-black/30" onClick={onClose} />
      <div className="fixed right-0 top-0 bottom-0 z-[160] w-96 bg-white border-l border-border-default flex flex-col shadow-2xl animate-slide-up">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-default">
          <div className="flex items-center gap-2">
            <Bell size={18} className="text-[#FF9D00]" />
            <h2 className="text-text-primary font-semibold text-sm">Notifications</h2>
            {unreadCount() > 0 && (
              <span className="px-2 py-0.5 bg-red-500/20 text-red-400 text-xs font-bold rounded-full">
                {unreadCount()}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {unreadCount() > 0 && (
              <button
                onClick={markAllAsRead}
                className="flex items-center gap-1 text-xs text-[#C16E00] hover:text-[#7A4400] transition-colors"
              >
                <Check size={12} />
                Mark all read
              </button>
            )}
            <button onClick={onClose} className="p-1.5 text-text-secondary hover:text-text-primary rounded-lg hover:bg-[#FFF8EC] transition-colors">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-4 py-2 border-b border-border-default">
          {(['all', 'unread', 'priority'] as TabKey[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={clsx(
                'px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors',
                tab === t ? 'bg-[#FFF4E1] text-[#C16E00] border border-[#FFD68A]' : 'text-text-secondary hover:text-text-primary hover:bg-[#FFF8EC]'
              )}
            >
              {t === 'priority' ? 'High Priority' : t}
            </button>
          ))}
        </div>

        {/* Notifications */}
        <div className="flex-1 overflow-y-auto">
          {Object.entries(groups).map(([group, items]) => {
            if (items.length === 0) return null
            return (
              <div key={group}>
                <p className="px-5 py-2 text-[10px] font-semibold text-text-tertiary uppercase tracking-wider sticky top-0 bg-white/95 backdrop-blur-sm">
                  {group}
                </p>
                {items.map((n) => {
                  const cfg = typeConfig[n.type]
                  const Icon = cfg.icon
                  return (
                    <div
                      key={n.id}
                      className={clsx(
                        'relative flex gap-3 px-5 py-3.5 border-b border-border-default/40 cursor-pointer transition-colors',
                        !n.isRead ? 'bg-[#FFF8EC] hover:bg-[#FFF4E1]' : 'hover:bg-bg-base'
                      )}
                      onClick={() => handleClick(n)}
                    >
                      {!n.isRead && (
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 w-1.5 h-1.5 bg-[#FF9D00] rounded-full" />
                      )}
                      <div className={clsx('w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5', cfg.bg)}>
                        <Icon size={15} className={cfg.color} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={clsx('text-sm font-medium truncate', n.isRead ? 'text-text-secondary' : 'text-text-primary')}>
                          {n.title}
                        </p>
                        <p className="text-xs text-text-secondary mt-0.5 leading-relaxed">{n.message}</p>
                        <p className="text-[10px] text-text-tertiary mt-1">
                          {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
                        </p>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); removeNotification(n.id) }}
                        className="flex-shrink-0 p-1 text-text-tertiary hover:text-text-secondary rounded transition-colors opacity-0 group-hover:opacity-100"
                        title="Dismiss"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  )
                })}
              </div>
            )
          })}
          {filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center px-6">
              <Bell size={32} className="text-[#FFD68A] mb-3" />
              <p className="text-text-secondary text-sm font-medium">No notifications</p>
              <p className="text-text-tertiary text-xs mt-1">
                {tab === 'unread' ? "You're all caught up!" : 'Nothing here yet.'}
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border-default">
          <button
            onClick={() => { navigate('/audit-logs'); onClose() }}
            className="w-full text-center text-xs text-[#C16E00] hover:text-[#7A4400] transition-colors py-1"
          >
            View all activity in Audit Logs
          </button>
        </div>
      </div>
    </>
  )
}
