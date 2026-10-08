import { useMemo } from 'react'
import { Building2, CreditCard, History, KeyRound, Palette, ShieldCheck, Users, type LucideIcon } from 'lucide-react'
import { useAuthStore as useSdkStore } from '@unifiedtree/sdk'
import { useVisibleEntries } from '@/shared/navigation/useAccess'

/**
 * Business settings (master context §11, owner 6 Oct 2026): the business's own settings sit on the
 * launcher, next to its apps, not inside a module. They open under /business/*, in the business
 * frame (BusinessShell): no HRMS rail, no company selector. The launcher's cards and the frame's tabs
 * are this one list.
 */
export interface BusinessSettingsItem { key: string; label: string; desc: string; icon: LucideIcon; path: string }

/** Who may open Business details: the same codes as the Workspace settings route. */
const BUSINESS_DETAILS_CODES = ['settings.read', 'settings.hrconfig.write', 'settings.holidays.write', 'hrms.probation.config.read']

/** Registry ids, so each item shows exactly when its page would open for this person. */
const BUSINESS_SETTINGS: { id: string; label: string; desc: string; icon: LucideIcon; path: string }[] = [
  { id: 's-branding', label: 'Branding', desc: 'Logo and sign-in picture', icon: Palette, path: '/business/branding' },
  { id: 'users', label: 'Users & access', desc: 'Who can sign in, and to what', icon: Users, path: '/business/users' },
  { id: 'roles', label: 'Roles & permissions', desc: 'What each role can do', icon: ShieldCheck, path: '/business/roles' },
  { id: 's-billing', label: 'Billing & plan', desc: 'Subscription, seats and invoices', icon: CreditCard, path: '/business/billing' },
  { id: 'audit', label: 'Audit logs', desc: 'Who changed what, and when', icon: History, path: '/business/audit-logs' },
]

/** The business settings this person can open, in order. */
export function useBusinessSettings(): BusinessSettingsItem[] {
  const { ctx, entries } = useVisibleEntries()
  const isOwner = useSdkStore((st) => (st.user?.roles ?? []).includes('OWNER'))
  return useMemo(() => {
    const byId = new Map(entries.map(e => [e.id, e]))
    const items: BusinessSettingsItem[] = []
    if (BUSINESS_DETAILS_CODES.some(c => ctx.has(c))) {
      items.push({ key: 'details', label: 'Business details', desc: 'Name, address and tax details', icon: Building2, path: '/business/details' })
    }
    for (const s of BUSINESS_SETTINGS) {
      const e = byId.get(s.id)
      if (e && e.state !== 'locked') items.push({ key: s.id, label: s.label, desc: s.desc, icon: s.icon, path: s.path })
    }
    // Only the owner can hand the business over (the person offered reaches it from their notification).
    if (isOwner) items.push({ key: 'ownership', label: 'Ownership', desc: 'Hand the business to someone else', icon: KeyRound, path: '/business/ownership' })
    return items
  }, [entries, ctx, isOwner])
}
