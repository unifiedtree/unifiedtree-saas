export type ModuleStatus = 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED' | 'COMING_SOON'
export type ModuleCategory = 'HR' | 'FINANCE' | 'SALES' | 'OPERATIONS' | 'SUPPORT' | 'ANALYTICS'

export interface ErpModule {
  id: string
  moduleKey: string
  displayName: string
  description: string
  version: string
  category: ModuleCategory
  iconName: string
  color: string
  isActive: boolean
  isBeta: boolean
  requiredPlan: string
  dependencies: string[]
  navItems: ModuleNavItem[]
  sortOrder: number
  monthlyPrice: number
  yearlyPrice: number
  features: string[]
  popular?: boolean
  new?: boolean
}

export interface ModuleNavItem {
  id: string
  moduleKey: string
  label: string
  path: string
  iconName: string
  parentLabel?: string
  requiredPermission?: string
  sortOrder: number
  isVisible: boolean
}

export interface TenantModule {
  id: string
  tenantId: string
  moduleKey: string
  status: ModuleStatus
  activatedAt: string
  deactivatedAt?: string
  activatedBy: string
  expiresAt?: string
  trialMode: boolean
}

export interface NavigationConfig {
  modules: {
    moduleKey: string
    label: string
    icon: string
    color: string
    items: { label: string; path: string; icon: string; permission?: string }[]
  }[]
}

export interface ModuleActivationRequest {
  moduleKey: string
  trialMode?: boolean
}

// All supported module keys
export const MODULE_KEYS = {
  HRMS: 'hrms',
  CRM: 'crm',
  ACCOUNTS: 'accounts',
  PROJECTS: 'projects',
  INVENTORY: 'inventory',
  HELPDESK: 'helpdesk',
  ANALYTICS: 'analytics',
  PROCUREMENT: 'procurement',
} as const

export type ModuleKey = (typeof MODULE_KEYS)[keyof typeof MODULE_KEYS]
