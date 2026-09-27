// Help & support: the workspace's own admins to contact (More → Settings → Help & support).
//
// Contract C0 · BW-01 · owner F3b
//   GET /v1/workspace/admin-contacts   → AdminContact[]
//   Permission: isAuthenticated(); tenant-scoped JDBC. Active people whose
//   access includes workspace.users.manage or rbac.role.write ("admins" by
//   permission, never by role name, DECISIONS 11): name, work email, a plain
//   role label; owners first; at most 10. Never a vendor name or link
//   (white-label rule).
//   Not available: 404 until F3b ships it (the panel shows its empty state).
// Used by: F3a (the Help & support panel), F3b (builds the endpoint).
import { SHARED_KEYS, type AdminContact } from './contracts'
import { asAvailable, defaultApi, useAvailableQuery, type ApiFetch, type SharedQueryOptions } from './available'

export const ADMIN_CONTACTS_PATH = '/v1/workspace/admin-contacts'

export function adminContactsQuery(api: ApiFetch = defaultApi): SharedQueryOptions<AdminContact[]> {
  return {
    queryKey: SHARED_KEYS.adminContacts,
    queryFn: () => asAvailable(() => api<AdminContact[]>(ADMIN_CONTACTS_PATH)),
  }
}

/** Load it when the panel opens (`enabled: open`); the list rarely changes. */
export function useAdminContacts(opts?: { enabled?: boolean }) {
  return useAvailableQuery<AdminContact[]>({ ...adminContactsQuery(), enabled: opts?.enabled ?? true, staleTime: 5 * 60_000 })
}
