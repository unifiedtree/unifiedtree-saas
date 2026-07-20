import { useQuery } from '@tanstack/react-query';
import { API_BASE_URL } from './api';

/** Mirrors the backend ModulePlanDto served by GET /v1/public/module-plans. */
export interface ModulePlan {
  key: string;
  displayName: string;
  tagline: string | null;
  description: string | null;
  category: string | null;
  icon: string | null;
  color: string | null;
  priceInr: number;          // monthly price PER SEAT (per user) when priceModel === 'PER_SEAT'
  priceModel: 'PER_SEAT' | 'FLAT';
  status: 'AVAILABLE' | 'LAUNCHING_SOON' | 'RETIRED';
  sortOrder: number;
  features: string[];
  includedModules: string[];
}

async function fetchModulePlans(): Promise<ModulePlan[]> {
  const res = await fetch(`${API_BASE_URL}/v1/public/module-plans`);
  if (!res.ok) throw new Error(`Failed to load plans (${res.status})`);
  return res.json();
}

/**
 * DB-driven plan catalog for the whole marketing site. No module/price is ever
 * hardcoded again — everything (name, caption, price, launching-soon lock) comes
 * from platform.module_plans via the backend.
 */
export function useModulePlans() {
  return useQuery({
    queryKey: ['module-plans'],
    queryFn: fetchModulePlans,
    staleTime: 5 * 60 * 1000,
  });
}

export function isPurchasable(plan: ModulePlan): boolean {
  return plan.status === 'AVAILABLE';
}

/**
 * Server bills the same way (see ModulePlanService.totalPriceInr): PER_SEAT
 * plans cost price * seats, FLAT plans cost price once. Only AVAILABLE selected
 * plans count. This mirror exists purely to show the amount before checkout —
 * the backend re-computes it authoritatively.
 */
export function computeMonthlyTotal(
  plans: ModulePlan[],
  selectedKeys: string[],
  seats: number,
): number {
  const s = Math.max(1, seats || 1);
  return plans
    .filter((p) => selectedKeys.includes(p.key) && isPurchasable(p))
    .reduce((sum, p) => sum + (p.priceModel === 'FLAT' ? p.priceInr : p.priceInr * s), 0);
}
