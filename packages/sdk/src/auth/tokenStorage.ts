import { jwtDecode } from 'jwt-decode';

// Access token lives in module-level memory only — never in localStorage or sessionStorage.
// In dev, VITE_DEV_TOKEN_STORAGE=session enables sessionStorage fallback for hot-reload DX.
const USE_SESSION =
  typeof import.meta !== 'undefined' &&
  (import.meta as unknown as { env?: Record<string, string> }).env != null &&
  ((import.meta as unknown as { env: Record<string, string> }).env.VITE_DEV_TOKEN_STORAGE === 'session');

const SESSION_KEY = '__ut_access_token__';

let _accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  _accessToken = token;
  if (USE_SESSION) {
    if (token) sessionStorage.setItem(SESSION_KEY, token);
    else sessionStorage.removeItem(SESSION_KEY);
  }
}

export function getAccessToken(): string | null {
  if (_accessToken) return _accessToken;
  if (USE_SESSION) {
    const stored = sessionStorage.getItem(SESSION_KEY);
    if (stored) {
      _accessToken = stored;
      return stored;
    }
  }
  return null;
}

/** Returns true when the stored token is missing or within 30 seconds of expiry. */
export function isAccessTokenExpired(): boolean {
  const token = getAccessToken();
  if (!token) return true;
  try {
    const { exp } = jwtDecode<{ exp?: number }>(token);
    if (exp === undefined) return false;
    return Date.now() >= (exp - 30) * 1000;
  } catch {
    return true;
  }
}

export function clearAccessToken(): void {
  _accessToken = null;
  if (USE_SESSION) sessionStorage.removeItem(SESSION_KEY);
}
