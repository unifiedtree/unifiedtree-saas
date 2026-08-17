import { useAuthStore } from '@unifiedtree/sdk'

/**
 * Shape of a tab descriptor that can be filtered by permission.
 * `requires` is a permission code string (e.g. 'hrms.leave.approve.l1')
 * — matches SDK's usePermission code param. When omitted, the tab is
 * always visible.
 */
export interface VisibleTabDef {
  key: string
  label: string
  /** Permission code required to see this tab. Omit = always visible. */
  requires?: string
}

/**
 * Filters a stable tab list down to those the current user is allowed
 * to see, based on the SDK auth store's permission map.
 *
 * We deliberately read the store directly instead of calling
 * `usePermission()` in a loop — calling a hook inside `.filter()` breaks
 * the Rules of Hooks the moment a caller's `all` list changes shape
 * between renders (e.g. a menu that hides a tab while a mutation is
 * pending). A single store read keeps the hook count constant and still
 * re-renders on permission changes because zustand subscribes us to the
 * `permissions` slice we touch.
 *
 * Wildcard grants (`*`) satisfy every requires check — mirrors
 * `resolveGrantScope` in the SDK's usePermission implementation so an
 * OWNER / SUPER_ADMIN sees every tab exactly as `<Can>` would render.
 */
export function useVisibleTabs<T extends VisibleTabDef>(all: T[]): T[] {
  const permissions = useAuthStore((s) => s.permissions)
  const hasWildcard = permissions.has('*')
  return all.filter((t) => {
    if (!t.requires) return true
    if (hasWildcard) return true
    return permissions.has(t.requires)
  })
}
