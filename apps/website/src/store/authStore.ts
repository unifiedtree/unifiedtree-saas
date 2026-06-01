import { create } from 'zustand';
import { api } from '../lib/api';

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

export const useAuthStore = create<AuthState>((set, get) => ({
  accountToken: localStorage.getItem('account_token'),
  tenantToken: localStorage.getItem('tenant_token'),
  account: null,
  workspaces: [],
  workspaceContext: null,
  isLoading: false,

  setAccountAuth: (token, account, workspaces) => {
    localStorage.setItem('account_token', token);
    set({ accountToken: token, account, workspaces });
  },

  setTenantAuth: (token, context) => {
    localStorage.setItem('tenant_token', token);
    set({ tenantToken: token, workspaceContext: context });
  },

  logoutAccount: () => {
    localStorage.removeItem('account_token');
    localStorage.removeItem('tenant_token');
    set({ accountToken: null, tenantToken: null, account: null, workspaces: [], workspaceContext: null });
  },

  logoutTenant: () => {
    localStorage.removeItem('tenant_token');
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
  }
}));
