export interface DomainEvent<T = unknown> {
  id: string          // UUID
  type: string        // e.g. "hrms.employee.created"
  tenantId: string
  userId: string
  aggregateId: string  // ID of the affected entity
  aggregateType: string // "Employee", "Leave", "Invoice", etc.
  payload: T
  occurredAt: string   // ISO timestamp
  version: number
}

export interface IEventBus {
  publish<T>(event: DomainEvent<T>): Promise<void>
  publishBatch<T>(events: DomainEvent<T>[]): Promise<void>
  subscribe<T>(
    eventType: string,
    handler: (event: DomainEvent<T>) => Promise<void>
  ): void
  unsubscribe(eventType: string): void
}

/**
 * Event type constants for all platform modules.
 * Format: {module}.{entity}.{action}
 */
export const EventTypes = {
  // HRMS events
  EMPLOYEE_CREATED: 'hrms.employee.created',
  EMPLOYEE_UPDATED: 'hrms.employee.updated',
  EMPLOYEE_TERMINATED: 'hrms.employee.terminated',
  EMPLOYEE_ONBOARDED: 'hrms.employee.onboarded',
  LEAVE_REQUESTED: 'hrms.leave.requested',
  LEAVE_APPROVED: 'hrms.leave.approved',
  LEAVE_REJECTED: 'hrms.leave.rejected',
  LEAVE_CANCELLED: 'hrms.leave.cancelled',
  PAYROLL_PROCESSED: 'hrms.payroll.processed',
  PAYROLL_FAILED: 'hrms.payroll.failed',
  ATTENDANCE_MARKED: 'hrms.attendance.marked',

  // CRM events
  LEAD_CREATED: 'crm.lead.created',
  LEAD_UPDATED: 'crm.lead.updated',
  LEAD_CONVERTED: 'crm.lead.converted',
  LEAD_LOST: 'crm.lead.lost',
  DEAL_CREATED: 'crm.deal.created',
  DEAL_STAGE_CHANGED: 'crm.deal.stage_changed',
  DEAL_WON: 'crm.deal.won',
  DEAL_LOST: 'crm.deal.lost',
  CONTACT_CREATED: 'crm.contact.created',
  TASK_COMPLETED: 'crm.task.completed',

  // Accounts events
  INVOICE_CREATED: 'accounts.invoice.created',
  INVOICE_SENT: 'accounts.invoice.sent',
  INVOICE_PAID: 'accounts.invoice.paid',
  INVOICE_OVERDUE: 'accounts.invoice.overdue',
  INVOICE_VOIDED: 'accounts.invoice.voided',
  EXPENSE_SUBMITTED: 'accounts.expense.submitted',
  EXPENSE_APPROVED: 'accounts.expense.approved',
  PAYMENT_RECEIVED: 'accounts.payment.received',

  // Platform events
  TENANT_CREATED: 'platform.tenant.created',
  TENANT_SUSPENDED: 'platform.tenant.suspended',
  TENANT_DELETED: 'platform.tenant.deleted',
  MODULE_ACTIVATED: 'platform.module.activated',
  MODULE_DEACTIVATED: 'platform.module.deactivated',
  SUBSCRIPTION_CHANGED: 'platform.subscription.changed',
  SUBSCRIPTION_CANCELLED: 'platform.subscription.cancelled',
  USER_INVITED: 'platform.user.invited',
  USER_JOINED: 'platform.user.joined',
  PLAN_UPGRADED: 'platform.plan.upgraded',
  PLAN_DOWNGRADED: 'platform.plan.downgraded',
} as const

export type EventType = (typeof EventTypes)[keyof typeof EventTypes]
