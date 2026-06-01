import { create } from 'zustand'
import { modules } from '../data/modules'
import { getMultiplier } from '../data/pricing'

interface PricingState {
  selectedModules: string[]
  employeeCount: number
  billingCycle: 'monthly' | 'annual'
  toggleModule: (id: string) => void
  setEmployeeCount: (count: number) => void
  setBillingCycle: (cycle: 'monthly' | 'annual') => void
  getBaseMonthly: () => number
  getTotalPrice: () => number
  isContactSales: () => boolean
}

export const usePricingStore = create<PricingState>((set, get) => ({
  selectedModules: [],
  employeeCount: 10,
  billingCycle: 'monthly',

  toggleModule: (id: string) =>
    set((state) => ({
      selectedModules: state.selectedModules.includes(id)
        ? state.selectedModules.filter((m) => m !== id)
        : [...state.selectedModules, id],
    })),

  setEmployeeCount: (count: number) => set({ employeeCount: count }),

  setBillingCycle: (cycle: 'monthly' | 'annual') => set({ billingCycle: cycle }),

  getBaseMonthly: () => {
    const { selectedModules } = get()
    return selectedModules.reduce((sum, id) => {
      const mod = modules.find((m) => m.id === id)
      return sum + (mod?.basePrice ?? 0)
    }, 0)
  },

  getTotalPrice: () => {
    const { employeeCount, billingCycle } = get()
    const multiplier = getMultiplier(employeeCount)
    if (multiplier === 'contact') return -1
    const base = get().getBaseMonthly()
    const monthly = Math.round(base * multiplier)
    return billingCycle === 'annual' ? Math.round(monthly * 12 * 0.8) : monthly
  },

  isContactSales: () => {
    const multiplier = getMultiplier(get().employeeCount)
    return multiplier === 'contact'
  },
}))
