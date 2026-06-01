export type NotificationType =
  | 'LEAVE_REQUEST'
  | 'PAYROLL'
  | 'INVOICE'
  | 'SUBSCRIPTION'
  | 'SYSTEM'
  | 'MENTION'
  | 'APPROVAL'
  | 'REMINDER'
  | 'ALERT'
  | 'ANNOUNCEMENT'

export type NotificationPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'

export interface Notification {
  id: string
  tenantId: string
  recipientId: string
  type: NotificationType
  priority: NotificationPriority
  title: string
  message: string
  entityType?: string
  entityId?: string
  actionUrl?: string
  isRead: boolean
  readAt?: string
  createdAt: string
}

export interface NotificationStats {
  total: number
  unread: number
  highPriority: number
}

export interface NotificationPreferences {
  userId: string
  emailEnabled: boolean
  browserEnabled: boolean
  types: Partial<Record<NotificationType, { email: boolean; browser: boolean }>>
}
