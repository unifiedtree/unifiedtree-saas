export type AuditAction =
  | 'LOGIN'
  | 'LOGOUT'
  | 'CREATE'
  | 'UPDATE'
  | 'DELETE'
  | 'VIEW'
  | 'APPROVE'
  | 'REJECT'
  | 'ACTIVATE'
  | 'DEACTIVATE'
  | 'INVITE'
  | 'EXPORT'
  | 'PAYMENT'
  | 'SUBSCRIPTION_CHANGE'
  | 'ROLE_CHANGE'
  | 'SETTINGS_CHANGE'
  | 'MODULE_ACTIVATION'

export type AuditSeverity = 'INFO' | 'WARNING' | 'CRITICAL'

export interface AuditLog {
  id: string
  tenantId: string
  userId: string
  userEmail: string
  userName: string
  action: AuditAction
  entityType?: string
  entityId?: string
  entityName?: string
  description: string
  oldValues?: string
  newValues?: string
  ipAddress?: string
  userAgent?: string
  severity: AuditSeverity
  status: 'SUCCESS' | 'FAILURE'
  createdAt: string
}

export interface AuditSummary {
  totalToday: number
  criticalToday: number
  loginEvents: number
  dataChanges: number
}

export interface AuditFilters {
  userId?: string
  action?: AuditAction
  entityType?: string
  severity?: AuditSeverity
  status?: 'SUCCESS' | 'FAILURE'
  from?: string
  to?: string
}
