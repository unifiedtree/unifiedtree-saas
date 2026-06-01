export type HealthStatus = 'UP' | 'DOWN' | 'DEGRADED'

export interface ServiceHealth {
  name: string
  status: HealthStatus
  responseTimeMs: number
  details?: Record<string, unknown>
  lastCheckedAt: string
}

export interface PlatformHealth {
  overall: HealthStatus
  services: ServiceHealth[]
  version: string
  uptime: number   // seconds the platform has been running
  checkedAt: string
}

export interface IHealthService {
  /**
   * Run a full health check across all services.
   */
  checkHealth(): Promise<PlatformHealth>

  /**
   * Check the health of a specific named service.
   */
  checkService(serviceName: string): Promise<ServiceHealth>
}

export const ServiceNames = {
  API_GATEWAY: 'api-gateway',
  POSTGRESQL: 'postgresql',
  REDIS: 'redis',
  KAFKA: 'kafka',
  FILE_STORAGE: 'file-storage',
  BACKGROUND_JOBS: 'background-jobs',
  AI_SERVICE: 'ai-service',
  SEARCH: 'search',
  EMAIL: 'email',
  SMS: 'sms',
} as const

export type ServiceName = (typeof ServiceNames)[keyof typeof ServiceNames]
