import { create } from 'zustand'

export interface ErpModule {
  key: string
  name: string
  description: string
  icon: string
  category: string
  version: string
  isActive: boolean
  isBeta: boolean
  requiredPlan: 'starter' | 'professional' | 'enterprise'
  pricing: {
    monthly: number
    annual: number
  }
  features: string[]
}

export interface NavItem {
  label: string
  path: string
  icon: string
  moduleKey?: string
  children?: NavItem[]
}

export interface NavigationConfig {
  primaryNav: NavItem[]
  secondaryNav: NavItem[]
  moduleNav: Record<string, NavItem[]>
}

interface ModuleState {
  modules: ErpModule[]
  activeModuleKeys: string[]
  navigationConfig: NavigationConfig | null

  // Actions
  setModules: (modules: ErpModule[]) => void
  setActiveModules: (keys: string[]) => void
  setNavigationConfig: (config: NavigationConfig) => void
  isModuleActive: (key: string) => boolean
  getModule: (key: string) => ErpModule | undefined
}

export const useModuleStore = create<ModuleState>((set, get) => ({
  modules: [],
  activeModuleKeys: [],
  navigationConfig: null,

  setModules: (modules) => set({ modules }),

  setActiveModules: (keys) => set({ activeModuleKeys: keys }),

  setNavigationConfig: (config) => set({ navigationConfig: config }),

  isModuleActive: (key) => get().activeModuleKeys.includes(key),

  getModule: (key) => get().modules.find((m) => m.key === key),
}))
