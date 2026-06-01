export type InvoiceStatus = 'DRAFT' | 'SENT' | 'PAID' | 'OVERDUE' | 'CANCELLED'
export type PaymentMethod = 'BANK_TRANSFER' | 'CREDIT_CARD' | 'CASH' | 'CHEQUE' | 'OTHER'
export type ExpenseCategory =
  | 'SALARY'
  | 'RENT'
  | 'UTILITIES'
  | 'MARKETING'
  | 'TRAVEL'
  | 'SUPPLIES'
  | 'SOFTWARE'
  | 'OTHER'
export type ExpenseStatus = 'PENDING' | 'APPROVED' | 'REJECTED'

export interface Invoice {
  id: string
  tenantId: string
  invoiceNumber: string
  clientName: string
  clientEmail: string
  clientAddress?: string
  status: InvoiceStatus
  subtotal: number
  taxRate: number
  taxAmount: number
  totalAmount: number
  currency: string
  issueDate: string
  dueDate: string
  paidDate?: string
  notes?: string
  lineItems: InvoiceLineItem[]
  createdAt: string
  updatedAt: string
}

export interface InvoiceLineItem {
  id: string
  description: string
  quantity: number
  unitPrice: number
  totalPrice: number
}

export interface Payment {
  id: string
  tenantId: string
  invoiceId?: string
  invoiceNumber?: string
  amount: number
  paymentMethod: PaymentMethod
  referenceNumber?: string
  paidDate: string
  notes?: string
  createdAt: string
}

export interface Expense {
  id: string
  tenantId: string
  category: ExpenseCategory
  description: string
  amount: number
  date: string
  status: ExpenseStatus
  createdBy: string
  createdByName: string
  approvedBy?: string
  approvedByName?: string
  receipt?: string
  createdAt: string
}

export interface AccountsStats {
  totalRevenue: number
  revenueThisMonth: number
  totalOutstanding: number
  overdueAmount: number
  totalExpenses: number
  netProfit: number
}

export interface CreateInvoiceRequest {
  clientName: string
  clientEmail: string
  clientAddress?: string
  taxRate?: number
  currency?: string
  issueDate: string
  dueDate: string
  notes?: string
  lineItems: Omit<InvoiceLineItem, 'id'>[]
}

export interface CreateExpenseRequest {
  category: ExpenseCategory
  description: string
  amount: number
  date: string
  receipt?: string
}
