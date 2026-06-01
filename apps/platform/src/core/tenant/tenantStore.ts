import { create } from 'zustand'
import type { Tenant } from '@/types'

interface TenantState {
  tenant: Tenant | null
  setTenant: (tenant: Tenant) => void
  clearTenant: () => void
}

export const useTenantStore = create<TenantState>()((set) => ({
  tenant: null,
  setTenant: (tenant) => set({ tenant }),
  clearTenant: () => set({ tenant: null }),
}))
