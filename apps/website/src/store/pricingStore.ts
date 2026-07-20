import { create } from 'zustand';

/**
 * Selection state for the pricing / signup flow. Pure UI state only — the plan
 * catalog and all prices come from the backend (useModulePlans), and the
 * authoritative amount is computed server-side at checkout. This store just
 * remembers which plans the visitor picked and how many users (seats) they
 * entered, so the state survives navigating pricing -> signup.
 */
interface PricingState {
  selectedPlanKeys: string[];
  seats: number;                       // number of users (per-seat billing)
  billingCycle: 'monthly' | 'annual';
  togglePlan: (key: string) => void;
  setSelectedPlans: (keys: string[]) => void;
  setSeats: (n: number) => void;
  setBillingCycle: (c: 'monthly' | 'annual') => void;
}

export const usePricingStore = create<PricingState>((set) => ({
  selectedPlanKeys: [],
  seats: 10,
  billingCycle: 'monthly',

  togglePlan: (key: string) =>
    set((state) => ({
      selectedPlanKeys: state.selectedPlanKeys.includes(key)
        ? state.selectedPlanKeys.filter((k) => k !== key)
        : [...state.selectedPlanKeys, key],
    })),

  setSelectedPlans: (keys: string[]) => set({ selectedPlanKeys: keys }),

  setSeats: (n: number) => set({ seats: Math.max(1, Math.floor(n) || 1) }),

  setBillingCycle: (billingCycle) => set({ billingCycle }),
}));
