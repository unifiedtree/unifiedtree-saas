import { create } from 'zustand'
import type { Notification } from '@/types'

const MOCK_NOTIFICATIONS: Notification[] = [
  { id: 'n1', title: 'Deal Closed: Apex Solutions', message: 'Mike Davis closed a $48,500 deal.', type: 'success', isRead: false, createdAt: new Date(Date.now() - 5 * 60000).toISOString(), link: '/crm/deals' },
  { id: 'n2', title: 'Payroll Approval Required', message: 'January payroll for 152 employees pending approval.', type: 'warning', isRead: false, createdAt: new Date(Date.now() - 30 * 60000).toISOString(), link: '/hrms/payroll' },
  { id: 'n3', title: 'Critical Login Failure', message: '5 failed login attempts from IP 185.220.101.45.', type: 'error', isRead: false, createdAt: new Date(Date.now() - 90 * 60000).toISOString(), link: '/audit-logs' },
  { id: 'n4', title: 'New Employee Joined', message: 'Sarah Chen joined as Senior Engineer.', type: 'info', isRead: false, createdAt: new Date(Date.now() - 3 * 3600000).toISOString(), link: '/hrms/employees' },
  { id: 'n5', title: 'Invoice Overdue', message: 'Invoice INV-2024-089 is 7 days overdue.', type: 'warning', isRead: true, createdAt: new Date(Date.now() - 6 * 3600000).toISOString(), link: '/accounts/invoices' },
  { id: 'n6', title: 'Q4 Report Ready', message: 'Analytics report for Q4 2024 is ready.', type: 'info', isRead: true, createdAt: new Date(Date.now() - 22 * 3600000).toISOString(), link: '/analytics' },
  { id: 'n7', title: 'Leave Request Pending', message: 'James Wilson requested 3 days PTO from Jan 15-17.', type: 'warning', isRead: true, createdAt: new Date(Date.now() - 26 * 3600000).toISOString(), link: '/hrms/leave' },
  { id: 'n8', title: 'New Ticket #T-1042', message: 'High priority ticket opened by Priya Sharma.', type: 'error', isRead: true, createdAt: new Date(Date.now() - 2 * 86400000).toISOString(), link: '/helpdesk/tickets' },
  { id: 'n9', title: 'Lead Qualified: TechStart Inc', message: 'Lead from website converted to opportunity.', type: 'success', isRead: true, createdAt: new Date(Date.now() - 3 * 86400000).toISOString(), link: '/crm/leads' },
  { id: 'n10', title: 'Backup Completed', message: 'Nightly database backup completed successfully.', type: 'success', isRead: true, createdAt: new Date(Date.now() - 4 * 86400000).toISOString() },
  { id: 'n11', title: 'Storage 80% Full', message: 'Your file storage is at 80% capacity.', type: 'warning', isRead: true, createdAt: new Date(Date.now() - 5 * 86400000).toISOString(), link: '/files' },
  { id: 'n12', title: 'New User Registered', message: 'Ravi Patel joined workspace as Finance Manager.', type: 'info', isRead: true, createdAt: new Date(Date.now() - 6 * 86400000).toISOString(), link: '/users' },
]

interface NotificationState {
  notifications: Notification[]
  markAsRead: (id: string) => void
  markAllAsRead: () => void
  removeNotification: (id: string) => void
  unreadCount: () => number
}

export const useNotificationStore = create<NotificationState>()((set, get) => ({
  notifications: MOCK_NOTIFICATIONS,
  markAsRead: (id) => set((s) => ({ notifications: s.notifications.map((n) => n.id === id ? { ...n, isRead: true } : n) })),
  markAllAsRead: () => set((s) => ({ notifications: s.notifications.map((n) => ({ ...n, isRead: true })) })),
  removeNotification: (id) => set((s) => ({ notifications: s.notifications.filter((n) => n.id !== id) })),
  unreadCount: () => get().notifications.filter((n) => !n.isRead).length,
}))
