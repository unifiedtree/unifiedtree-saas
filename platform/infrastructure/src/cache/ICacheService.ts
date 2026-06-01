export interface ICacheService {
  get<T>(key: string): Promise<T | null>
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>
  delete(key: string): Promise<void>
  exists(key: string): Promise<boolean>
  clear(pattern?: string): Promise<void>
  increment(key: string, by?: number): Promise<number>
  decrement(key: string, by?: number): Promise<number>
  setWithExpiry<T>(key: string, value: T, expiryDate: Date): Promise<void>
}

/**
 * Consistent cache key builders for all platform services.
 * Using namespaced keys prevents collisions across services.
 */
export const CacheKeys = {
  tenant: (id: string) => `tenant:${id}`,
  tenantModules: (id: string) => `tenant:${id}:modules`,
  tenantSettings: (id: string) => `tenant:${id}:settings`,
  user: (id: string) => `user:${id}`,
  userPermissions: (id: string) => `user:${id}:permissions`,
  userSession: (id: string) => `user:${id}:session`,
  moduleRegistry: () => 'modules:registry',
  moduleByKey: (key: string) => `modules:key:${key}`,
  featureFlag: (tenantId: string, key: string) => `ff:${tenantId}:${key}`,
  featureFlags: (tenantId: string) => `ff:${tenantId}:all`,
  rateLimit: (userId: string, action: string) => `rate:${userId}:${action}`,
  session: (token: string) => `session:${token}`,
  dashboard: (tenantId: string) => `dashboard:${tenantId}`,
  report: (tenantId: string, reportId: string) => `report:${tenantId}:${reportId}`,
  search: (tenantId: string, query: string) => `search:${tenantId}:${Buffer.from(query).toString('base64')}`,
} as const

export type CacheKeyBuilder = typeof CacheKeys
