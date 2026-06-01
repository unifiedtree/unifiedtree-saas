export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogEntry {
  level: LogLevel
  message: string
  service?: string
  tenantId?: string
  userId?: string
  requestId?: string
  data?: Record<string, unknown>
  error?: {
    message: string
    stack?: string
    code?: string
  }
  timestamp: string
}

export interface ILogger {
  debug(message: string, data?: Record<string, unknown>): void
  info(message: string, data?: Record<string, unknown>): void
  warn(message: string, data?: Record<string, unknown>): void
  error(
    message: string,
    error?: Error | unknown,
    data?: Record<string, unknown>
  ): void

  /**
   * Create a child logger with pre-bound context.
   * All log entries from the child will include the provided context.
   */
  child(context: {
    service?: string
    tenantId?: string
    userId?: string
    requestId?: string
  }): ILogger
}

/**
 * A no-op logger implementation for use in tests or when logging
 * is not needed.
 */
export const noopLogger: ILogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => noopLogger,
}

/**
 * Console-based logger suitable for development.
 */
export function createConsoleLogger(context: {
  service?: string
  tenantId?: string
  userId?: string
  requestId?: string
} = {}): ILogger {
  const prefix = Object.entries(context)
    .filter(([, v]) => v)
    .map(([k, v]) => `[${k}:${v}]`)
    .join(' ')

  const formatMessage = (level: LogLevel, message: string) =>
    `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${prefix ? prefix + ' ' : ''}${message}`

  return {
    debug(message, data) {
      if (process.env.NODE_ENV === 'development') {
        console.debug(formatMessage('debug', message), data ?? '')
      }
    },
    info(message, data) {
      console.info(formatMessage('info', message), data ?? '')
    },
    warn(message, data) {
      console.warn(formatMessage('warn', message), data ?? '')
    },
    error(message, error, data) {
      console.error(formatMessage('error', message), error ?? '', data ?? '')
    },
    child(childContext) {
      return createConsoleLogger({ ...context, ...childContext })
    },
  }
}
