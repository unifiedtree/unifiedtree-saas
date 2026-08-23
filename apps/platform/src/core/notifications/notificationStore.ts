import { create } from 'zustand'
import type { Notification } from '@/types'
import { apiJson } from '@/core/api/client'
import { useAuthStore as useSdkAuthStore } from '@unifiedtree/sdk'

/**
 * Web notification store — mirrors the mobile app's notification screen
 * against the same {@code /v1/notifications} endpoints served by
 * {@code com.unifiedtree.notifications.controller.NotificationsController}.
 *
 * Previously this file held a hard-coded MOCK_NOTIFICATIONS array so the bell
 * always showed 4 "unread" fake alerts and clicking them did nothing useful.
 * Now it fetches the signed-in user's real, tenant-scoped notifications and
 * mirrors read/dismiss actions to the server so read-state stays in sync with
 * the mobile bell.
 */

/** Server enum — must stay in lock-step with
 *  {@code com.unifiedtree.notifications.enums.AppNotificationType}. */
export type AppNotificationType =
  | 'LEAVE_SUBMITTED'
  | 'LEAVE_APPROVED'
  | 'LEAVE_REJECTED'
  | 'LEAVE_CANCELLED'
  | 'FACE_ENROLLMENT_COMPLETE'
  | 'FACE_ENROLLMENT_FAILED'
  | 'WFH_SUBMITTED'
  | 'WFH_APPROVED'
  | 'WFH_REJECTED'
  | 'WFH_CANCELLED'
  | 'CORRECTION_SUBMITTED'
  | 'CORRECTION_APPROVED'
  | 'CORRECTION_REJECTED'
  | 'SHIFT_CHANGE_SUBMITTED'
  | 'SHIFT_CHANGE_APPROVED'
  | 'SHIFT_CHANGE_REJECTED'
  | 'WELCOME'
  | 'TRIAL_ENDING_SOON'
  | 'TRIAL_EXPIRED'
  | 'SUBSCRIPTION_HALTED'
  // Grandfathered over-cap warning (Anil punchlist 2026-08-22). Fired at
  // most once per (tenant, month) for workspaces that were already past
  // their paid seat count when SeatQuotaEnforcer's hard 402 shipped. Deep-
  // links to /plan where the matching amber banner explains the action.
  //
  // TODO(billing-ceiling): drop when the Razorpay ceiling flow retires the
  // grandfather.
  | 'BILLING_OVER_CAP'
  | 'GENERAL'

/** Raw server DTO (see {@code NotificationDtos.NotificationDto}). */
interface ServerNotificationDto {
  id: string
  type: AppNotificationType
  title: string
  body: string
  data?: Record<string, unknown> | null
  readAt?: string | null
  createdAt: string
}

interface PageResponse<T> {
  content: T[]
  totalElements?: number
  totalPages?: number
  page?: number
  size?: number
  first?: boolean
  last?: boolean
}

/**
 * Sensible web fallback route by category. The mobile app carries an explicit
 * {@code data.route} in every notification, but that route uses Expo Router
 * segments (e.g. {@code /leaves/[id]}) that don't exist on the web SPA. This
 * table maps by category prefix; the sender's route is preferred if it looks
 * web-shaped (starts with "/" and isn't a mobile-only segment).
 *
 * <p><b>Route existence guarantee:</b> every route returned by this function
 * MUST be a real path registered in {@code apps/platform/src/App.tsx}. Earlier
 * versions of this map returned {@code /me/leaves}, {@code /me/correction},
 * {@code /me/profile}, {@code /settings/billing} — none of which are
 * registered, so clicking a notification silently fell through the
 * {@code <Route path="*">} catch-all and dumped the user on the dashboard.
 * The set below has been cross-checked against App.tsx as of 2026-08-15.
 *
 * <p><b>Who receives which type:</b>
 * <ul>
 *   <li>{@code *_SUBMITTED} → the manager whose queue needs to act on it →
 *       the operations-center page (works for both the manager's approvals
 *       tab AND the requester's history tab, since these pages are
 *       role-aware and show the right tab per viewer).</li>
 *   <li>{@code *_APPROVED} / {@code *_REJECTED} / {@code *_CANCELLED} → the
 *       employee who submitted → the same operations page (their history
 *       tab) or, when there's a dedicated employee-self-service page for
 *       that category (WFH, shift-change), that page.</li>
 * </ul>
 */
// Known web-route prefixes. Anything the backend puts in {@code data.route}
// that doesn't start with one of these is presumed to be an Expo-router
// mobile-only route (e.g. {@code /requests-tab}, {@code /leaves/[id]},
// {@code /wfh-apply}, {@code /my-corrections}) — cannot resolve on the web SPA
// and would fall through to the {@code *} catch-all which sends the user to
// {@code /} → {@code /modules}, which is what we're guarding against here.
// Order matters only if two prefixes could overlap — none do.
const WEB_ROUTE_PREFIXES = [
  '/hrms/', '/me/', '/me', '/settings/', '/settings', '/plan',
  '/team', '/dashboard', '/analytics', '/audit-logs', '/users',
  '/roles', '/modules', '/files',
] as const

function isWebShapedRoute(path: string): boolean {
  if (path === '/') return true
  if (path.includes('[') || path.includes(']')) return false // Expo bracket segments
  return WEB_ROUTE_PREFIXES.some((p) => path === p || path.startsWith(p + '?') || path.startsWith(p + '/') || (p.endsWith('/') && path.startsWith(p)))
}

/**
 * The *_CANCELLED events fan out to BOTH the requester (their own request was
 * withdrawn or rolled back) and the approver (their pending queue-item just
 * disappeared). Sending both parties to /hrms/leave?tab=approvals lands the
 * requester on a page they cannot see (or shows an empty ops-center for a
 * plain employee). Backend may hint the recipient's role via
 * {@code data.audience} (preferred) or {@code data.recipient_role}; if
 * neither is present we infer from the current signed-in user's role.
 *
 * Kept a permissive set of role synonyms because the backend has not
 * standardised the hint value yet — "employee"/"owner"/"requester" all
 * indicate the same intent, as do "approver"/"manager"/"admin".
 */
type RecipientRole = 'requester' | 'approver'
function inferRecipientRoleFromHint(data?: Record<string, unknown> | null): RecipientRole | null {
  const hintRaw =
    (typeof data?.audience === 'string' ? (data.audience as string) : undefined) ??
    (typeof data?.recipient_role === 'string' ? (data.recipient_role as string) : undefined) ??
    (typeof data?.recipientRole === 'string' ? (data.recipientRole as string) : undefined)
  if (!hintRaw) return null
  const hint = hintRaw.toLowerCase()
  if (hint === 'requester' || hint === 'employee' || hint === 'owner' || hint === 'self') return 'requester'
  if (hint === 'approver' || hint === 'manager' || hint === 'admin' || hint === 'hr' || hint === 'hr_manager') return 'approver'
  return null
}

/** Fall-back: infer whether the current signed-in user is on the approver
 *  side of the flow by looking at their roles in the SDK auth store. Plain
 *  EMPLOYEE with no elevated role = requester side. */
function currentUserIsApprover(): boolean {
  try {
    const state = useSdkAuthStore.getState()
    const roles = state.user?.roles ?? []
    const APPROVER_ROLES = ['SUPER_ADMIN', 'COMPANY_ADMIN', 'HR_MANAGER', 'DEPT_MANAGER', 'FINANCE_LEAD']
    return roles.some((r) => APPROVER_ROLES.includes(r))
  } catch {
    // getState may throw if the SDK bundle failed to hydrate — degrade to
    // requester so we err on the side of the employee's own view rather
    // than sending them to an empty approvals queue.
    return false
  }
}

function webRouteFor(type: AppNotificationType, data?: Record<string, unknown> | null): string | undefined {
  const raw = typeof data?.route === 'string' ? (data.route as string) : undefined
  // Prefer the backend-supplied route ONLY if it points at a real web route.
  // Otherwise it's a mobile-only path (Expo Router shape like /requests-tab
  // or /leaves/[id]) and we fall through to the category-based web mapping.
  if (raw && isWebShapedRoute(raw)) return raw

  // Leave — the ops-center page handles both approvals (manager view) and
  // my-leaves (employee view). We deep-link straight into the right tab
  // via ?tab= (see Leave.tsx which reads useSearchParams on mount).
  if (type === 'LEAVE_SUBMITTED') return '/hrms/leave?tab=approvals'
  // LEAVE_CANCELLED fans out to BOTH parties. Route per-recipient so the
  // requester lands on their own list instead of an approvals queue they
  // cannot see. Server hint (data.audience / data.recipient_role) wins;
  // otherwise infer from the current user's role.
  if (type === 'LEAVE_CANCELLED') {
    const role = inferRecipientRoleFromHint(data) ?? (currentUserIsApprover() ? 'approver' : 'requester')
    return role === 'approver' ? '/hrms/leave?tab=approvals' : '/hrms/leave?tab=my'
  }
  if (type.startsWith('LEAVE_')) return '/hrms/leave?tab=my'

  // WFH — approvals are surfaced on the leave ops-center Approvals tab
  // for admins; employees have their own /me/wfh apply/history page.
  if (type === 'WFH_APPROVED' || type === 'WFH_REJECTED') return '/me/wfh'
  if (type === 'WFH_SUBMITTED') return '/hrms/leave?tab=approvals'
  // WFH_CANCELLED fans out to both parties too: employee → /me/wfh (their
  // history), approver → /hrms/leave?tab=approvals (their queue).
  if (type === 'WFH_CANCELLED') {
    const role = inferRecipientRoleFromHint(data) ?? (currentUserIsApprover() ? 'approver' : 'requester')
    return role === 'approver' ? '/hrms/leave?tab=approvals' : '/me/wfh'
  }

  // Attendance corrections — /hrms/attendance has 'corrections' + 'my'
  // tabs. Both flavours of notification land on the corrections tab, which
  // is role-aware and shows the right list (approvals-queue for managers,
  // history for employees).
  if (type.startsWith('CORRECTION_')) return '/hrms/attendance?tab=corrections'

  // Shift change — employees submit + view on /me/shift-change; admins
  // work the queue from /hrms/shifts (the shifts admin page).
  if (type === 'SHIFT_CHANGE_APPROVED' || type === 'SHIFT_CHANGE_REJECTED') return '/me/shift-change'
  if (type === 'SHIFT_CHANGE_SUBMITTED') return '/hrms/shifts'

  // Face enrollment happens on the mobile app; on web the ESS dashboard is
  // the closest surface to visualise the employee's profile state.
  if (type === 'FACE_ENROLLMENT_COMPLETE' || type === 'FACE_ENROLLMENT_FAILED') return '/me'

  // Billing / subscription — the workspace admin lands on the /plan page
  // (the in-workspace plan configurator + autopay setup).
  if (type === 'TRIAL_ENDING_SOON' || type === 'TRIAL_EXPIRED' || type === 'SUBSCRIPTION_HALTED') return '/plan'
  // Grandfathered over-cap warning routes to /plan where the amber banner
  // (Plan.tsx) explains the "set up autopay for the extras" action.
  if (type === 'BILLING_OVER_CAP') return '/plan'

  if (type === 'WELCOME') return '/'
  // Unknown / not-yet-mapped types: land the user on their own workspace
  // dashboard instead of returning undefined (which used to render an
  // un-clickable notification card and lose the deep-link intent).
  return '/dashboard'
}

/** Severity used by NotificationPanel for icon + tone. */
function severityFor(type: AppNotificationType): Notification['type'] {
  if (type.endsWith('_APPROVED') || type === 'FACE_ENROLLMENT_COMPLETE' || type === 'WELCOME') return 'success'
  if (type.endsWith('_REJECTED') || type === 'FACE_ENROLLMENT_FAILED' || type === 'TRIAL_EXPIRED' || type === 'SUBSCRIPTION_HALTED')
    return 'error'
  if (type.endsWith('_SUBMITTED') || type === 'TRIAL_ENDING_SOON' || type === 'BILLING_OVER_CAP') return 'warning'
  return 'info'
}

function toDisplay(dto: ServerNotificationDto): Notification {
  return {
    id: dto.id,
    title: dto.title,
    message: dto.body,
    type: severityFor(dto.type),
    isRead: dto.readAt != null,
    createdAt: dto.createdAt,
    link: webRouteFor(dto.type, dto.data),
  }
}

interface NotificationState {
  notifications: Notification[]
  loading: boolean
  loaded: boolean
  error: string | null
  /**
   * Authoritative unread count from the server. The visible list is capped
   * at 50 for the bell popover, so deriving unread from `notifications` gets
   * capped along with it — a workspace with 120 unread items shows "50 new".
   * `serverUnreadCount` is populated by {@link fetchUnreadCount} and refreshed
   * whenever we mutate read-state, so the bell badge stays truthful even
   * when the list is paginated.
   */
  serverUnreadCount: number | null
  fetch: () => Promise<void>
  fetchUnreadCount: () => Promise<void>
  markAsRead: (id: string) => Promise<void>
  markAllAsRead: () => Promise<void>
  removeNotification: (id: string) => Promise<void>
  unreadCount: () => number
  /**
   * Wipe all cached rows and reset load flags. Called on sign-out so a
   * subsequent sign-in as a different user does not briefly render the
   * previous user's notifications while the fresh /v1/notifications
   * request is in flight.
   */
  reset: () => void
}

export const useNotificationStore = create<NotificationState>()((set, get) => ({
  notifications: [],
  loading: false,
  loaded: false,
  error: null,
  serverUnreadCount: null,

  fetch: async () => {
    set({ loading: true, error: null })
    try {
      // size=50 keeps the bell useful without paying full-history cost on every open.
      const page = await apiJson<PageResponse<ServerNotificationDto>>('/v1/notifications?page=0&size=50')
      set({
        notifications: (page.content ?? []).map(toDisplay),
        loading: false,
        loaded: true,
        error: null,
      })
      // Refresh the truthful unread count alongside the list — fire-and-forget
      // so a slow count endpoint never blocks the bell rendering.
      void get().fetchUnreadCount()
    } catch (e) {
      // Silent-fail the bell — a notifications endpoint hiccup must never
      // block the rest of the SPA, and the panel already renders an empty
      // state. Keep the message for debug/test surfaces.
      set({ loading: false, loaded: true, error: (e as Error).message })
    }
  },

  fetchUnreadCount: async () => {
    try {
      // Server endpoint returns the untruncated count so the bell dot is
      // right even in workspaces with hundreds of unread items.
      const res = await apiJson<{ count: number }>('/v1/notifications/unread-count')
      const n = Number(res?.count ?? 0)
      set({ serverUnreadCount: Number.isFinite(n) && n >= 0 ? n : 0 })
    } catch {
      // Endpoint not yet wired on some deployments — leave serverUnreadCount
      // as null so the unreadCount() getter falls back to the derived value.
    }
  },

  markAsRead: async (id) => {
    // Optimistic update — the bell is user-facing latency-sensitive.
    const before = get().notifications
    set({
      notifications: before.map((n) => (n.id === id ? { ...n, isRead: true } : n)),
    })
    // Optimistically decrement the server count too (clamped at 0) so the
    // badge doesn't lag one refresh behind the visible list.
    const prevCount = get().serverUnreadCount
    if (prevCount != null && prevCount > 0 && before.find((n) => n.id === id && !n.isRead)) {
      set({ serverUnreadCount: prevCount - 1 })
    }
    try {
      await apiJson<void>(`/v1/notifications/${id}/read`, { method: 'PUT' })
    } catch {
      // Revert on failure so unread badge stays honest.
      set({ notifications: before, serverUnreadCount: prevCount })
    }
  },

  markAllAsRead: async () => {
    const before = get().notifications
    const prevCount = get().serverUnreadCount
    set({ notifications: before.map((n) => ({ ...n, isRead: true })), serverUnreadCount: 0 })
    try {
      await apiJson<void>('/v1/notifications/mark-all-read', { method: 'POST' })
    } catch {
      set({ notifications: before, serverUnreadCount: prevCount })
    }
  },

  removeNotification: async (id) => {
    const before = get().notifications
    const prevCount = get().serverUnreadCount
    set({ notifications: before.filter((n) => n.id !== id) })
    if (prevCount != null && prevCount > 0 && before.find((n) => n.id === id && !n.isRead)) {
      set({ serverUnreadCount: prevCount - 1 })
    }
    try {
      await apiJson<void>(`/v1/notifications/${id}`, { method: 'DELETE' })
    } catch {
      set({ notifications: before, serverUnreadCount: prevCount })
    }
  },

  // Prefer the server total when we have it — the derived count is capped
  // at the visible page size (50) which understates on active workspaces.
  unreadCount: () => {
    const server = get().serverUnreadCount
    if (server != null) return server
    return get().notifications.filter((n) => !n.isRead).length
  },

  reset: () => set({ notifications: [], loading: false, loaded: false, error: null, serverUnreadCount: null }),
}))
