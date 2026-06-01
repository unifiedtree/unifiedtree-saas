export type LeadStatus = 'NEW' | 'CONTACTED' | 'QUALIFIED' | 'PROPOSAL' | 'WON' | 'LOST'
export type LeadSource =
  | 'WEBSITE'
  | 'REFERRAL'
  | 'SOCIAL'
  | 'EMAIL'
  | 'COLD_CALL'
  | 'EVENT'
  | 'OTHER'
export type DealStage =
  | 'DISCOVERY'
  | 'PROPOSAL'
  | 'NEGOTIATION'
  | 'CONTRACT'
  | 'CLOSED_WON'
  | 'CLOSED_LOST'
export type CustomerStatus = 'ACTIVE' | 'INACTIVE' | 'CHURNED'

export interface Lead {
  id: string
  tenantId: string
  firstName: string
  lastName: string
  fullName: string
  email: string
  phone?: string
  company: string
  jobTitle?: string
  source: LeadSource
  status: LeadStatus
  estimatedValue: number
  probability: number
  assignedToId?: string
  assignedToName?: string
  notes?: string
  tags: string[]
  expectedCloseDate?: string
  convertedAt?: string
  customerId?: string
  createdAt: string
  updatedAt: string
}

export interface Customer {
  id: string
  tenantId: string
  name: string
  email: string
  phone?: string
  company: string
  address?: string
  city?: string
  country?: string
  totalRevenue: number
  status: CustomerStatus
  customerSince: string
  assignedToId?: string
  assignedToName?: string
  createdAt: string
}

export interface Deal {
  id: string
  tenantId: string
  title: string
  customerId: string
  customerName: string
  value: number
  currency: string
  stage: DealStage
  probability: number
  expectedCloseDate?: string
  closedAt?: string
  assignedToId?: string
  assignedToName?: string
  notes?: string
  createdAt: string
  updatedAt: string
}

export interface Activity {
  id: string
  tenantId: string
  type: 'CALL' | 'EMAIL' | 'MEETING' | 'TASK' | 'NOTE'
  title: string
  description?: string
  entityType: 'LEAD' | 'CUSTOMER' | 'DEAL'
  entityId: string
  entityName: string
  dueDate?: string
  completedAt?: string
  assignedToId: string
  assignedToName: string
  createdAt: string
}

export interface CreateLeadRequest {
  firstName: string
  lastName: string
  email: string
  phone?: string
  company: string
  jobTitle?: string
  source: LeadSource
  estimatedValue?: number
  assignedToId?: string
  notes?: string
  tags?: string[]
  expectedCloseDate?: string
}

export interface CreateDealRequest {
  title: string
  customerId: string
  value: number
  currency?: string
  stage: DealStage
  probability?: number
  expectedCloseDate?: string
  assignedToId?: string
  notes?: string
}

export interface CrmStats {
  totalLeads: number
  newLeadsThisMonth: number
  totalDeals: number
  pipelineValue: number
  wonDealsThisMonth: number
  conversionRate: number
}
