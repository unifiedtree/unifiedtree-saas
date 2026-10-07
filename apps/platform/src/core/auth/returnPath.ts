/**
 * Where to go after signing in: the page that sent the person to the sign-in page (RouteGuard puts
 * it in the location state as `returnUrl`), or Home. A notification opened while signed out — the
 * app opens some on the website, in its own browser — so lands on the page it is about instead of
 * the app launcher.
 *
 * Only a path of this site is used: one leading "/" (never "//host" or "/\host"), no scheme, no
 * white space, and never the sign-in pages themselves.
 */
const SIGN_IN_PAGES = /^\/(login|forgot-password|reset-password|accept-invite|pending-approval)(\/|\?|#|$)/

export function returnPathFrom(state: unknown, fallback = '/'): string {
  const raw = state && typeof state === 'object' ? (state as { returnUrl?: unknown }).returnUrl : undefined
  if (typeof raw !== 'string' || raw.length > 512) return fallback
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return fallback
  if (/[\s\\]/.test(raw) || raw.includes('://') || [...raw].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) return fallback
  if (SIGN_IN_PAGES.test(raw)) return fallback
  return raw
}
