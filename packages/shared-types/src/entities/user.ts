export type UserStatus = 'ACTIVE' | 'INACTIVE' | 'INVITED' | 'SUSPENDED'

export interface User {
  id: string
  tenantId: string
  firstName: string
  lastName: string
  fullName: string
  email: string
  roleId: string
  roleName: string
  department?: string
  jobTitle?: string
  status: UserStatus
  lastLoginAt?: string
  loginCount: number
  avatarUrl?: string
  phone?: string
  permissions: string[]
  activeModules: string[]
  onboardingCompleted: boolean
  onboardingStep: number
  theme: 'dark' | 'light'
  createdAt: string
}

export interface LoginSession {
  id: string
  userId: string
  tenantId: string
  ipAddress: string
  userAgent: string
  deviceType: string
  isActive: boolean
  expiresAt: string
  lastActivityAt: string
  createdAt: string
}

export interface AuthTokens {
  accessToken: string
  refreshToken: string
  expiresAt: string
  tokenType: 'Bearer'
}

export interface LoginRequest {
  email: string
  password: string
  subdomain?: string
  rememberMe?: boolean
}

export interface RegisterRequest {
  firstName: string
  lastName: string
  email: string
  password: string
  companyName: string
  subdomain: string
  planType?: string
}

export interface ChangePasswordRequest {
  currentPassword: string
  newPassword: string
  confirmPassword: string
}

export interface InviteUserRequest {
  email: string
  firstName: string
  lastName: string
  roleId: string
  department?: string
  jobTitle?: string
}
