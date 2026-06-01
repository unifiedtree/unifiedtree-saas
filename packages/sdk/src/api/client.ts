import axios, { type AxiosInstance, type AxiosRequestConfig, type AxiosResponse, isAxiosError } from 'axios';
import { resolveTenantSlug } from '../auth/tenant';
import { getAccessToken, setAccessToken, isAccessTokenExpired } from '../auth/tokenStorage';

// ─── Api Error ──────────────────────────────────────────────────────────────
export class ApiError extends Error {
  status: number;
  code: string;
  detail: string;
  field?: string;
  traceId?: string;

  constructor(opts: { status: number; code: string; detail: string; field?: string; traceId?: string }) {
    super(opts.detail);
    this.name = 'ApiError';
    this.status = opts.status;
    this.code = opts.code;
    this.detail = opts.detail;
    this.field = opts.field;
    this.traceId = opts.traceId;
  }
}

// ─── Api Events ─────────────────────────────────────────────────────────────
type ForbiddenHandler = (code?: string) => void;

export const apiEvents = {
  _handlers: [] as ForbiddenHandler[],
  onForbidden(handler: ForbiddenHandler) {
    this._handlers.push(handler);
    return () => { this._handlers = this._handlers.filter(h => h !== handler); };
  },
  emit(code?: string) {
    this._handlers.forEach(h => h(code));
  },
};

// ─── Single-flight 401 refresh ───────────────────────────────────────────────
let refreshPromise: Promise<string | null> | null = null;

async function doRefresh(instance: AxiosInstance): Promise<string | null> {
  try {
    const res = await instance.post<{ accessToken: string }>(
      '/v1/auth/refresh',
      {},
      { withCredentials: true, _skipAuth: true } as AxiosRequestConfig & { _skipAuth?: boolean },
    );
    const newToken = res.data.accessToken;
    setAccessToken(newToken);
    return newToken;
  } catch {
    setAccessToken(null);
    return null;
  }
}

// ─── Client factory ──────────────────────────────────────────────────────────
export function createApiClient(): AxiosInstance {
  const baseURL =
    typeof import.meta !== 'undefined' &&
    (import.meta as unknown as { env?: Record<string, string> }).env
      ? (import.meta as unknown as { env: Record<string, string> }).env.VITE_API_BASE_URL ?? '/api'
      : '/api';

  const instance = axios.create({ baseURL, withCredentials: true });

  // ── Request interceptor ────────────────────────────────────────────────────
  instance.interceptors.request.use(config => {
    const skip = (config as AxiosRequestConfig & { _skipAuth?: boolean })._skipAuth;

    // Always add tenant slug — fail fast if not resolvable (except auth endpoints)
    const slug = resolveTenantSlug();
    const isAuthPath = config.url?.startsWith('/v1/auth');
    if (!slug && !isAuthPath) {
      return Promise.reject(
        new ApiError({ status: 0, code: 'NO_TENANT_CONTEXT', detail: 'Tenant slug could not be resolved from hostname.' }),
      );
    }
    if (slug) config.headers['X-Tenant-Subdomain'] = slug;

    // Add Bearer token
    if (!skip) {
      const token = getAccessToken();
      if (token) config.headers['Authorization'] = `Bearer ${token}`;
    }

    return config;
  });

  // ── Response interceptor ───────────────────────────────────────────────────
  instance.interceptors.response.use(
    (res: AxiosResponse) => res,
    async (error: unknown) => {
      if (!isAxiosError(error) || !error.response) {
        return Promise.reject(normalizeError(error));
      }

      const { response, config } = error;
      const skip = (config as AxiosRequestConfig & { _skipAuth?: boolean } | undefined)?._skipAuth;

      // 403 — fire forbidden event and surface the error
      if (response.status === 403) {
        const code = response.data?.errorCode as string | undefined;
        apiEvents.emit(code);
        return Promise.reject(normalizeError(error));
      }

      // 401 — attempt single-flight token refresh, then retry
      if (response.status === 401 && !skip) {
        if (!refreshPromise) refreshPromise = doRefresh(instance).finally(() => { refreshPromise = null; });
        const newToken = await refreshPromise;
        if (newToken && config) {
          config.headers = config.headers ?? {};
          config.headers['Authorization'] = `Bearer ${newToken}`;
          (config as AxiosRequestConfig & { _skipAuth?: boolean })._skipAuth = true;
          return instance.request(config);
        }
        return Promise.reject(normalizeError(error));
      }

      return Promise.reject(normalizeError(error));
    },
  );

  return instance;
}

function normalizeError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  if (isAxiosError(err) && err.response) {
    const { status, data } = err.response;
    return new ApiError({
      status,
      code: (data?.errorCode as string | undefined) ?? 'UNKNOWN',
      detail: (data?.message as string | undefined) ?? err.message,
      field: data?.field as string | undefined,
      traceId: data?.traceId as string | undefined,
    });
  }
  return new ApiError({ status: 0, code: 'NETWORK_ERROR', detail: String(err) });
}

// ─── Singleton ───────────────────────────────────────────────────────────────
export const apiClient = createApiClient();
