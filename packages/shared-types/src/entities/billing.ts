export type SubscriptionStatus = 'TRIAL' | 'ACTIVE' | 'SUSPENDED' | 'CANCELLED'
export type BillingCycle = 'MONTHLY' | 'YEARLY'
export type BillingInvoiceStatus = 'DRAFT' | 'SENT' | 'PAID' | 'OVERDUE' | 'CANCELLED'

export interface Subscription {
  id: string
  tenantId: string
  planType: string
  billingCycle: BillingCycle
  status: SubscriptionStatus
  startDate: string
  endDate: string
  trialEndDate?: string
  monthlyAmount: number
  activeModuleKeys: string[]
  subdomain: string
  adminEmail: string
  createdAt: string
}

export interface BillingInvoice {
  id: string
  tenantId: string
  invoiceNumber: string
  amount: number
  taxAmount: number
  totalAmount: number
  currency: string
  status: BillingInvoiceStatus
  issuedDate: string
  dueDate: string
  paidDate?: string
  lineItems: BillingLineItem[]
  createdAt: string
}

export interface BillingLineItem {
  description: string
  quantity: number
  unitPrice: number
  totalPrice: number
}

export interface PlanDetails {
  key: string
  name: string
  monthlyPrice: number
  yearlyPrice: number
  maxUsers: number
  maxModules: number
  storageGb: number
  features: string[]
  popular?: boolean
}

export interface ChangePlanRequest {
  planType: string
  billingCycle: BillingCycle
  moduleKeys: string[]
}

export interface BillingStats {
  currentMrr: number
  totalPaid: number
  outstandingAmount: number
  nextBillingDate: string
  nextBillingAmount: number
}
