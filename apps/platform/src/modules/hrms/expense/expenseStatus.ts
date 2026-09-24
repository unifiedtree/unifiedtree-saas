import type { ExpenseStatus } from '../api/useExpense'

/**
 * Readable labels for the ExpenseStatus enum. The pills used to print the raw
 * enum ("APPROVED_FOR_PAY", "SUBMITTED"); SUBMITTED reads as "Pending approval"
 * because that is what the claimant is actually waiting on.
 */
export const EXPENSE_STATUS_LABEL: Record<ExpenseStatus, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Pending approval',
  APPROVED: 'Approved',
  APPROVED_FOR_PAY: 'Approved for pay',
  REJECTED: 'Rejected',
  REIMBURSED: 'Reimbursed',
}

/** Sentence-case any other enum (batch status, category): "APPROVED_FOR_PAY" → "Approved for pay". */
export const enumLabel = (value: string) => {
  const text = value.toLowerCase().replaceAll('_', ' ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export const expenseStatusLabel = (value: string) =>
  EXPENSE_STATUS_LABEL[value as ExpenseStatus] ?? enumLabel(value)
