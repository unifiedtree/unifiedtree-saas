import { useQuery } from '@tanstack/react-query'
import {
  Users, MapPin, Banknote, BarChart2, Package, Target,
  ShoppingCart, TrendingUp, Kanban, Settings, Monitor, PieChart,
  Truck, Warehouse, Megaphone, type LucideIcon,
} from 'lucide-react'
import { apiJson } from './client'

/**
 * A row from platform.module_plans — the SELLABLE-plan catalog served by
 * GET /v1/public/module-plans. Shape mirrors the backend ModulePlanDto record
 * (and the interface with the same name in apps/website/src/lib/plans.ts —
 * kept in sync manually since the platform + website apps are separate).
 */
export interface ModulePlan {
  key: string
  displayName: string
  tagline: string | null
  description: string | null
  category: string | null
  icon: string | null
  color: string | null
  priceInr: number          // monthly price per seat when priceModel === 'PER_SEAT'
  priceModel: 'PER_SEAT' | 'FLAT'
  status: 'AVAILABLE' | 'LAUNCHING_SOON' | 'RETIRED'
  sortOrder: number
  features: string[]
  includedModules: string[] // catalog keys unlocked when this plan activates
  annualDiscountPct: number
  /** Whether the plan is "included" in every workspace — a legacy field.
   *  All rows are false on prod today; kept for JSON-shape parity with the DTO. */
  included?: boolean
}

/** Fetch merged sellable plans. Cached for 5 minutes — the catalog rarely
 *  changes and every workspace hit would otherwise repeat a public GET. */
export function useModulePlans() {
  return useQuery({
    queryKey: ['module-plans'],
    queryFn: () => apiJson<ModulePlan[]>('/v1/public/module-plans'),
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  })
}

/** Lucide icon lookup — the DB stores an icon *name string* on module_plans.icon
 *  (e.g. "Users", "Truck"). Unknown names fall back to Users so a new DB row
 *  never breaks the UI. Same set the website uses in PricingCalculator +
 *  Navbar so the icon is identical everywhere. */
export const iconMap: Record<string, LucideIcon> = {
  Users, MapPin, Banknote, BarChart2, Package, Target,
  ShoppingCart, TrendingUp, Kanban, Settings, Monitor, PieChart,
  Truck, Warehouse, Megaphone,
}

/** Compute the effective per-user-per-month price for a billing cycle. Annual
 *  applies the DB-driven per-plan discount (module_plans.annual_discount_pct)
 *  and rounds to the whole rupee — matches the server's
 *  ModulePlanService.effectiveMonthlyUnit. */
export function effectiveUnit(plan: ModulePlan, cycle: 'monthly' | 'annual'): number {
  if (cycle === 'annual') {
    return Math.round(plan.priceInr * (1 - (plan.annualDiscountPct ?? 0) / 100))
  }
  return plan.priceInr
}
