export type TenantStatus = 'TRIAL' | 'ACTIVE' | 'SUSPENDED' | 'CANCELLED'
export type PlanType = 'STARTER' | 'PROFESSIONAL' | 'ENTERPRISE'
export type CompanySize = 'STARTUP' | 'SMALL' | 'MEDIUM' | 'LARGE' | 'ENTERPRISE'

export interface Tenant {
  id: string
  name: string
  subdomain: string
  email: string
  phone?: string
  logoUrl?: string
  industry?: string
  size: CompanySize
  status: TenantStatus
  planType: PlanType
  trialEndsAt?: string
  adminUserId: string
  timezone: string
  currency: string
  country?: string
  onboardingCompleted: boolean
  onboardingStep: number
  createdAt: string
  updatedAt: string
}

export interface TenantSettings {
  timezone: string
  currency: string
  dateFormat: string
  language: string
  logoUrl?: string
  primaryColor?: string
  twoFactorRequired: boolean
  passwordExpiryDays: number
  maxSessionsPerUser: number
  allowedIpRanges: string[]
}

export interface TenantStats {
  totalUsers: number
  activeUsers: number
  totalModules: number
  activeModules: number
  storageUsedMb: number
  storageQuotaMb: number
}
