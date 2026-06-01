export interface QueueJob<T = unknown> {
  id: string
  queue: string
  data: T
  priority: number
  attempts: number
  maxAttempts: number
  scheduledAt?: string
  startedAt?: string
  completedAt?: string
  failedAt?: string
  error?: string
}

export interface EnqueueOptions {
  priority?: number   // Higher = more urgent; default 0
  delayMs?: number    // Delay before processing (ms)
  maxAttempts?: number // Retry count on failure; default 3
}

export interface IQueueService {
  /**
   * Add a job to the queue. Returns the job ID.
   */
  enqueue<T>(
    queue: string,
    data: T,
    options?: EnqueueOptions
  ): Promise<string>

  /**
   * Register a handler that processes jobs from the given queue.
   */
  process<T>(
    queue: string,
    handler: (job: QueueJob<T>) => Promise<void>
  ): void

  /**
   * Cancel a pending or scheduled job.
   */
  cancel(jobId: string): Promise<void>

  /**
   * Get the current status/metadata of a job.
   */
  getStatus(jobId: string): Promise<QueueJob | null>
}

/**
 * Named queues used across the platform.
 */
export const Queues = {
  EMAIL: 'email',
  NOTIFICATIONS: 'notifications',
  PAYROLL: 'payroll-processing',
  REPORTS: 'report-generation',
  AUDIT: 'audit-log',
  WEBHOOKS: 'webhooks',
  FILE_PROCESSING: 'file-processing',
  DATA_IMPORT: 'data-import',
  DATA_EXPORT: 'data-export',
  SEARCH_INDEXING: 'search-indexing',
  BILLING: 'billing',
} as const

export type QueueName = (typeof Queues)[keyof typeof Queues]
