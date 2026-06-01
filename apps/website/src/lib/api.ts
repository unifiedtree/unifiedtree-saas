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
  const token = isAccountApi 
    ? localStorage.getItem('account_token') 
    : localStorage.getItem('tenant_token');

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const url = `${API_BASE_URL}${endpoint}`;
  
  try {
    const response = await fetch(url, { ...options, headers });
    
    // Global 401 handler
    if (response.status === 401 && !isAccountLogin) {
      if (isAccountApi) {
        localStorage.removeItem('account_token');
        window.location.href = '/login';
      } else {
        localStorage.removeItem('tenant_token');
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
