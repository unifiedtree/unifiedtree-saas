/**
 * Who may open what — one set of rules for the menu, the app launcher, the ⌘K
 * search and its "/" path navigation.
 *
 * Every rule is written in PERMISSION codes (the same codes each route's
 * RouteGuard and each endpoint's @PreAuthorize check) plus the workspace's
 * active modules. Role names are not used to decide access; the two
 * exceptions are presentational and mirror something the backend or a page
 * itself decides by role today, and each is named where it is used:
 *   - `planAdmin`: adding modules and billing are role-gated on the server
 *     (WorkspacePlanController / BrandingController), so only those roles are
 *     offered the "request module" flow.
 *   - `adminRole`: the Leave page hides the personal tabs (My leave, Apply,
 *     Balances) and the Attendance page hides My Attendance from admin
 *     roles, so search must not offer them either.
 *
 * Pure functions only (no React), so the rules can be unit-tested.
 */

export interface AccessContext {
  /** Holds the permission code (the '*' wildcard counts). */
  has: (code: string) => boolean
  /** The workspace's active module keys (tenant.activeModules). */
  modules: readonly string[]
  /** The signed-in person has an employee record (JWT employee_id). */
  self: boolean
  /** OWNER / SUPER_ADMIN / COMPANY_ADMIN / ADMIN (see the note above). */
  adminRole: boolean
  /** May add modules and manage the plan (see the note above). */
  planAdmin: boolean
}

/** One clause of an access rule. Every field that is set must pass. */
export interface Access {
  /** At least one of these codes. Empty or missing = no permission needed. */
  anyOf?: string[]
  /** Every one of these codes. */
  allOf?: string[]
  /** None of these codes (e.g. the manager-only "My team" view). */
  noneOf?: string[]
  /** The workspace module the route sits behind (its ModuleGate key). */
  module?: string
  /** Needs the person's own employee record (self-service pages). */
  self?: boolean
  /** A presentational condition the page itself applies (see the file note). */
  when?: (ctx: AccessContext) => boolean
}

/** open = may use it; locked = allowed, but the workspace doesn't have the module (plan admins only); hidden = not for this person. */
export type AccessState = 'open' | 'locked' | 'hidden'

export function accessState(rules: readonly Access[] | undefined, ctx: AccessContext): AccessState {
  let locked = false
  for (const r of rules ?? []) {
    if (r.anyOf && r.anyOf.length > 0 && !r.anyOf.some(ctx.has)) return 'hidden'
    if (r.allOf && !r.allOf.every(ctx.has)) return 'hidden'
    if (r.noneOf && r.noneOf.some(ctx.has)) return 'hidden'
    if (r.self && !ctx.self) return 'hidden'
    if (r.when && !r.when(ctx)) return 'hidden'
    if (r.module && !ctx.modules.includes(r.module)) locked = true
  }
  if (locked) return ctx.planAdmin ? 'locked' : 'hidden'
  return 'open'
}

export const canOpen = (rules: readonly Access[] | undefined, ctx: AccessContext) => accessState(rules, ctx) === 'open'
