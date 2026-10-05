import { useAuthStore } from '@unifiedtree/sdk'
import { personalPagesShown } from '@/shared/navigation/access'
import { useRoles } from './useRoles'

/**
 * Whether the signed-in person sees the personal pages: My work and every
 * "My …" view inside a module (My leave, My attendance, My claims, My reviews,
 * My goals, My documents, My letters, My training, My advances, My incentives),
 * the "for yourself" actions and the profile's links into them.
 *
 * The workspace owner sets it per role in Roles & permissions; the server sends
 * the answer with the session (personalPages), so a change shows at the
 * person's next sign-in or page reload. When the server sends none (a backend
 * from before it existed) it is the old role rule: not for OWNER / SUPER_ADMIN
 * / COMPANY_ADMIN / ADMIN. The menu, search and quick actions use the same rule
 * through the access context (personalPagesOn).
 *
 * Presentational only: every endpoint keeps checking its own permission.
 */
export function usePersonalPages(): boolean {
  const fromServer = useAuthStore((s) => s.personalPages)
  const { isAdmin } = useRoles()
  return personalPagesShown(fromServer, isAdmin)
}
