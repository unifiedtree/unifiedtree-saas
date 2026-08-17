import { create } from 'zustand';
import { api, wireAuthAccessors } from '../lib/api';

/**
 * Session state — in-memory only (2026-08-17 audit B7).
 *
 * Previously both `account_token` and `tenant_token` were persisted to
 * `localStorage`, which is the standard XSS-theft target: any third-party
 * script the marketing site loads (analytics, chatbot, tag manager) can
 * read the whole tab's localStorage and exfiltrate a live JWT. Even with
 * short expiry, that's a full-account takeover window.
 *
 * The remediation moves both tokens onto the module-scoped in-memory
 * store below. Trade-offs:
 *
 *   - A hard-refresh drops the session (the user re-logs-in). For a
 *     marketing site this is the right trade-off; a workspace app that
 *     needs persistence should adopt an httpOnly refresh cookie set by
 *     the backend and exchange it for a fresh access token on load. That
 *     cookie work is BACKEND scope and tracked separately — see the risk
 *     note returned with this fix bundle.
 *   - `api.ts` reads directly from this store (was reading localStorage
 *     itself), so both layers stay in sync.
 *
 * Nothing else touches token storage in this app.
 */

export type Role = 'OWNER' | 'ADMIN' | 'MANAGER' | 'EMPLOYEE';

export interface ModuleCard {
  key: string;
  displayName: string;
  category: string;
  active: boolean;
  locked: boolean;
  action: string;
}

export interface WorkspaceSummary {
  tenantId: string;
  tenantName: string;
  subdomain: string;
  workspaceUrl: string;
  status: string;
  role: Role;
  defaultWorkspace: boolean;
  defaultCompanyId?: string;
  defaultCompanyName?: string;
  activeModules: ModuleCard[];
  lockedPreviewModules: ModuleCard[];
  lockedModuleCount: number;
  canBuyModules: boolean;
}

export interface AccountSummary {
  accountId: string;
  email: string;
  displayName: string;
  phone: string;
  status: string;
}

interface AuthState {
  accountToken: string | null;
  tenantToken: string | null;
  account: AccountSummary | null;
  workspaces: WorkspaceSummary[];
  workspaceContext: WorkspaceSummary | null;
  isLoading: boolean;

  setAccountAuth: (token: string, account: AccountSummary, workspaces: WorkspaceSummary[]) => void;
  setTenantAuth: (token: string, context: WorkspaceSummary) => void;
  logoutAccount: () => void;
  logoutTenant: () => void;
  loadWorkspaces: () => Promise<void>;
  loadWorkspaceContext: () => Promise<void>;
}

// One-time migration on module load: if a token from the previous
// localStorage-based build is still lying around in the browser, remove
// it. Otherwise the fix leaves the very tokens it exists to protect
// sitting in localStorage for the length of the user's next visit.
if (typeof window !== 'undefined' && window.localStorage) {
  try {
    window.localStorage.removeItem('account_token');
    window.localStorage.removeItem('tenant_token');
  } catch { /* private-mode / storage-disabled — nothing to clean */ }
}

export const useAuthStore = create<AuthState>((set) => ({
  // Both tokens start null on every hard-load — see file header.
  accountToken: null,
  tenantToken: null,
  account: null,
  workspaces: [],
  workspaceContext: null,
  isLoading: false,

  setAccountAuth: (token, account, workspaces) => {
    set({ accountToken: token, account, workspaces });
  },

  setTenantAuth: (token, context) => {
    set({ tenantToken: token, workspaceContext: context });
  },

  logoutAccount: () => {
    set({
      accountToken: null,
      tenantToken: null,
      account: null,
      workspaces: [],
      workspaceContext: null,
    });
  },

  logoutTenant: () => {
    set({ tenantToken: null, workspaceContext: null });
  },

  loadWorkspaces: async () => {
    try {
      set({ isLoading: true });
      const data = await api.get('/v1/accounts/me/workspaces');
      set({ workspaces: data, isLoading: false });
    } catch (err) {
      set({ isLoading: false });
      throw err;
    }
  },

  loadWorkspaceContext: async () => {
    try {
      set({ isLoading: true });
      const data = await api.get('/v1/workspace/context');
      set({ workspaceContext: data, isLoading: false });
    } catch (err) {
      set({ isLoading: false });
      throw err;
    }
  },
}));

// Hand token accessors to api.ts. See the note in api.ts on why we
// dependency-inject rather than import the store directly (avoids the
// circular authStore ↔ api import).
wireAuthAccessors({
  getAccountToken: () => useAuthStore.getState().accountToken,
  getTenantToken: () => useAuthStore.getState().tenantToken,
  clearAccountToken: () => useAuthStore.setState({ accountToken: null }),
  clearTenantToken: () => useAuthStore.setState({ tenantToken: null }),
});
