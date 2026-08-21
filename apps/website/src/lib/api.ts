export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '');

export class ApiError extends Error {
  status: number;
  data: any;
  constructor(status: number, message: string, data?: any) {
    super(message);
    this.status = status;
    this.data = data;
    this.name = 'ApiError';
  }
}

/**
 * Token accessors are injected from authStore.ts on module load (see
 * `wireAuthAccessors`). We can't import the zustand store here without
 * creating an authStore ↔ api circular import (the store already imports
 * `api` for its network calls), so the store hands the accessors down at
 * boot instead. Until they're wired, requests go out unauthenticated —
 * which is the safe default for public marketing endpoints.
 *
 * As of 2026-08-17 tokens are held in-memory only (audit B7) — no more
 * `localStorage.getItem('account_token')` here.
 */
type Getter = () => string | null;
type Clearer = () => void;

let getAccountToken: Getter = () => null;
let getTenantToken: Getter = () => null;
let clearAccountToken: Clearer = () => {};
let clearTenantToken: Clearer = () => {};

export function wireAuthAccessors(hooks: {
  getAccountToken: Getter;
  getTenantToken: Getter;
  clearAccountToken: Clearer;
  clearTenantToken: Clearer;
}) {
  getAccountToken = hooks.getAccountToken;
  getTenantToken = hooks.getTenantToken;
  clearAccountToken = hooks.clearAccountToken;
  clearTenantToken = hooks.clearTenantToken;
}

async function fetchWithAuth(endpoint: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers || {});

  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  // Choose the token based on the endpoint
  // /v1/accounts/ -> use account token
  // everything else -> use tenant token
  const isAccountApi = endpoint.startsWith('/v1/accounts');
  const isAccountLogin = endpoint === '/v1/accounts/auth/login';
  const token = isAccountApi ? getAccountToken() : getTenantToken();

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const url = `${API_BASE_URL}${endpoint}`;

  try {
    const response = await fetch(url, { ...options, headers, credentials: 'include' });

    // Global 401 handler
    if (response.status === 401 && !isAccountLogin) {
      if (isAccountApi) {
        clearAccountToken();
        window.location.href = '/login';
      } else {
        clearTenantToken();
        window.location.href = '/workspaces';
      }
      throw new ApiError(401, 'Unauthorized');
    }

    if (!response.ok) {
      let errorMessage = response.status === 401 && isAccountLogin
        ? 'Invalid email or password'
        : 'An error occurred';
      let errorData = null;
      const errorText = await response.text();
      try {
        errorData = errorText ? JSON.parse(errorText) : null;
        errorMessage = errorData?.message || errorData?.error || errorMessage;
      } catch (e) {
        if (errorText) {
          errorMessage = errorText;
        }
      }
      throw new ApiError(response.status, errorMessage, errorData);
    }

    // Handle empty 204 responses
    if (response.status === 204) {
      return null;
    }

    return await response.json();
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(0, err instanceof Error ? err.message : 'Network error');
  }
}

export const api = {
  get: (endpoint: string, options?: RequestInit) => fetchWithAuth(endpoint, { ...options, method: 'GET' }),
  post: (endpoint: string, data?: any, options?: RequestInit) =>
    fetchWithAuth(endpoint, { ...options, method: 'POST', body: JSON.stringify(data) }),
  put: (endpoint: string, data?: any, options?: RequestInit) =>
    fetchWithAuth(endpoint, { ...options, method: 'PUT', body: JSON.stringify(data) }),
  patch: (endpoint: string, data?: any, options?: RequestInit) =>
    fetchWithAuth(endpoint, { ...options, method: 'PATCH', body: JSON.stringify(data) }),
  delete: (endpoint: string, options?: RequestInit) =>
    fetchWithAuth(endpoint, { ...options, method: 'DELETE' }),
};

/**
 * Session restoration helper — exchange the httpOnly `ut_acct_rt` refresh
 * cookie for a fresh account access token + account/workspaces payload.
 *
 * Never throws. A fresh visitor with no cookie legitimately gets a 401 here;
 * a network blip should also NOT crash the store's hydration path. Callers
 * treat `null` as "stay signed out silently" — see authStore.hydrate().
 *
 * We deliberately do NOT go through `fetchWithAuth` because:
 *   1. This must NOT trip the global 401 → `window.location = '/login'`
 *      redirect for a visitor who is legitimately signed-out.
 *   2. There is no bearer token yet to attach; the cookie IS the credential.
 */
export async function refreshAccount(): Promise<{
  accessToken: string;
  account: any;
  workspaces: any[];
} | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/v1/accounts/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      // Empty body — backend reads the cookie. Sending {} keeps some servers
      // (and CORS preflight matchers) happy that don't like a bodiless POST.
      body: '{}',
    });
    if (!response.ok) return null;
    if (response.status === 204) return null;
    return await response.json();
  } catch {
    // Network error, CORS block, offline — treat as "no session".
    return null;
  }
}
