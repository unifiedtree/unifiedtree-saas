import { create } from 'zustand';
import { api, refreshAccount, wireAuthAccessors, API_BASE_URL } from '../lib/api';

/**
 * Session state — access tokens in-memory only, refresh in an httpOnly cookie.
 *
 * XSS posture (2026-08-17 audit B7):
 *   Access tokens are held in this module-scoped store and NEVER written to
 *   localStorage/sessionStorage. Any third-party script the marketing site
 *   loads (analytics, chatbot, tag manager) can read the whole tab's Web
 *   Storage, so a JWT sitting there is a full-account takeover primitive.
 *
 * Session persistence across refresh (2026-08-21):
 *   The backend now issues an httpOnly, Secure, SameSite refresh cookie
 *   (`ut_acct_rt`) on /v1/accounts/auth/login. On module load we call
 *   /v1/accounts/auth/refresh once — the browser attaches the cookie, the
 *   backend returns a fresh access token + account + workspaces, and the
 *   in-memory store is repopulated. Hard-refresh therefore no longer signs
 *   the user out.
 *
 * Why this is still XSS-safe:
 *   The refresh token itself is httpOnly — JS on this origin cannot read it,
 *   only the browser can attach it to same-origin requests. An attacker with
 *   XSS can still ride the session in-tab (nothing defeats that short of
 *   isolating renderers), but they cannot exfiltrate the token to hit the
 *   API from elsewhere. The access token stays memory-only, so nothing
 *   survives closing the tab beyond what the httpOnly cookie carries.
 *
 * `api.ts` reads accessors from this store (was reading localStorage
 * itself), so both layers stay in sync.
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
  /**
   * True while the initial refresh-cookie exchange is in flight. Any
   * account-only route (WorkspacesPage, etc.) should render a loading
   * shim while this is true so a signed-in user reloading the page
   * doesn't flash the login screen for ~300ms before landing back.
   */
  isHydrating: boolean;

  setAccountAuth: (token: string, account: AccountSummary, workspaces: WorkspaceSummary[]) => void;
  setTenantAuth: (token: string, context: WorkspaceSummary) => void;
  logoutAccount: () => void;
  logoutTenant: () => void;
  loadWorkspaces: () => Promise<void>;
  loadWorkspaceContext: () => Promise<void>;
  /**
   * Attempt to restore a signed-in session from the httpOnly refresh
   * cookie. Called exactly once at module load (see the bottom of this
   * file). Silent on failure — a fresh visitor legitimately has no
   * cookie, and we must not annoy them with an error alert.
   */
  hydrate: () => Promise<void>;
  /**
   * Log the account out end-to-end: clear the server-side refresh
   * cookie AND drop all in-memory state. Used by the Navbar Sign Out
   * button and anywhere else the user asks to leave. Silent on network
   * failure — the local sign-out still happens (the cookie will expire
   * server-side on its own timer).
   */
  signOut: () => Promise<void>;
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

export const useAuthStore = create<AuthState>((set, get) => ({
  // Both tokens start null on every hard-load — see file header. `hydrate()`
  // below will (asynchronously) repopulate them from the refresh cookie.
  accountToken: null,
  tenantToken: null,
  account: null,
  workspaces: [],
  workspaceContext: null,
  isLoading: false,
  // Start TRUE so account-only routes rendered on the very first paint
  // (e.g. a user reloading on /workspaces) show the spinner instead of
  // the empty/signed-out layout while the refresh call is in flight.
  // If we skipped this and the hydrate() call is still queued, those
  // routes would flash "no workspaces / please sign in" for ~300ms.
  // Flipped to false in SSR/test environments below where there is no
  // `window` to run hydrate() against.
  isHydrating: typeof window !== 'undefined',

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

  hydrate: async () => {
    // Guard against double-invocation (StrictMode double-mount, HMR).
    if (!get().isHydrating) return;
    try {
      const resp = await refreshAccount();
      if (resp && resp.accessToken) {
        set({
          accountToken: resp.accessToken,
          account: resp.account ?? null,
          workspaces: Array.isArray(resp.workspaces) ? resp.workspaces : [],
        });
      }
      // On null: no valid cookie — stay signed-out silently. Do NOT alert
      // or redirect: a fresh visitor legitimately has no cookie.
    } finally {
      set({ isHydrating: false });
    }
  },

  signOut: async () => {
    // Fire-and-forget the server-side cookie clear. We proceed with the
    // local sign-out regardless — the cookie has a short server-side
    // expiry anyway, and users hitting Sign Out expect an immediate
    // response, not a spinner blocked on the network.
    try {
      await fetch(`${API_BASE_URL}/v1/accounts/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      });
    } catch {
      /* offline / CORS blocked — local sign-out below still runs */
    }
    set({
      accountToken: null,
      tenantToken: null,
      account: null,
      workspaces: [],
      workspaceContext: null,
    });
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

// Kick off session restoration at module load. This runs exactly once per
// tab: the browser attaches the httpOnly `ut_acct_rt` cookie to the POST,
// backend returns a fresh access token + account + workspaces if the
// cookie is still valid, and the store repopulates. Mobile apps use the
// same shape (proven pattern: SDK bootstrap on app start, not per-screen
// useEffect) — an AuthBootstrap component would work but adds a mount
// dependency for something that only needs to happen once per page load.
if (typeof window !== 'undefined') {
  // Defer to a microtask so the store is fully constructed before the
  // async call schedules its state updates.
  Promise.resolve().then(() => {
    useAuthStore.getState().hydrate().catch(() => {
      // Belt-and-suspenders: hydrate() itself already swallows failures.
    });
  });
}
