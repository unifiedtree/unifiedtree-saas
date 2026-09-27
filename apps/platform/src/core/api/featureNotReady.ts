// "This isn’t switched on yet" (redesign DECISIONS 18).
//
// New features keep their data in new tables and columns, and production
// applies each migration by hand, later. Until it is applied the backend
// answers 503 { errorCode: 'FEATURE_NOT_READY', message: 'This isn’t switched
// on yet.' } (com.hrms.core.exception.FeatureNotReady). The page then shows
// that block's "not available yet" or empty state, hides the block's actions,
// and does not ask again: isRetryable (providers/QueryProvider) never retries
// it, and the shared hooks in modules/hrms/api/shared turn it into a typed
// "not available" state instead of an error.

export const FEATURE_NOT_READY = 'FEATURE_NOT_READY'

/** The backend's own words, for a block that shows a line instead of hiding. */
export const FEATURE_NOT_READY_MESSAGE = 'This isn’t switched on yet.'

type ErrorShape = {
  status?: unknown
  code?: unknown
  payload?: { errorCode?: unknown } | null
  response?: { status?: unknown; data?: { errorCode?: unknown } | null } | null
} | null | undefined

/**
 * The HTTP status of a failed call: `HttpError` from apiJson carries a flat
 * `.status`, the SDK's `ApiError` too, and a raw axios error `.response.status`.
 * Undefined for failures that never got an answer (offline, blocked, timed out).
 */
export function httpStatusOf(error: unknown): number | undefined {
  const e = error as ErrorShape
  const status = e?.status ?? e?.response?.status
  return typeof status === 'number' ? status : undefined
}

/**
 * The backend's `errorCode` ({timestamp, status, errorCode, message}) of a
 * failed call: `HttpError.payload.errorCode`, a raw axios error's
 * `response.data.errorCode`, or the SDK `ApiError.code`.
 */
export function errorCodeOf(error: unknown): string | undefined {
  const e = error as ErrorShape
  const code = e?.payload?.errorCode ?? e?.response?.data?.errorCode ?? e?.code
  return typeof code === 'string' ? code : undefined
}

/** True when the backend answered that this feature isn't switched on yet (503 FEATURE_NOT_READY). */
export function isFeatureNotReady(error: unknown): boolean {
  return httpStatusOf(error) === 503 && errorCodeOf(error) === FEATURE_NOT_READY
}
