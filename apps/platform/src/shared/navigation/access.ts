/**
 * Who may open what — one set of rules for the menu, the app launcher, the ⌘K
 * search and its "/" path navigation.
 *
 * Every rule is written in PERMISSION codes (the same codes each route's
 * RouteGuard and each endpoint's @PreAuthorize check) plus the workspace's
 * active modules. Role names are not used to decide access; the two
 * exceptions are presentational and mirror something the backend or a page
 * itself decides by role today, and each is named where it is used:
 *   - `planAdmin`: holds workspace.billing.manage ("Can buy and manage plans
 *     and billing", Q-26), the code the server checks for the plan, module
 *     buying and billing; only they are offered the "request module" flow.
 *   - `adminRole`: the Leave page hides the personal tabs (My leave, Apply,
 *     Balances) and the Attendance page hides My Attendance from admin
 *     roles, so search must not offer them either. My work and the other
 *     pages' own "My …" views (My claims, My reviews, My documents, …)
 *     follow the same rule.
 *   - `personalPages`: that rule, now set per role by the workspace owner
 *     (Roles & permissions, V143.90). The server sends the answer with the
 *     session; until a server sends one it is exactly `!adminRole`. Every
 *     personal page, view and quick action reads it (personalPagesOn here,
 *     usePersonalPages in components).
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
  /** Sees the personal pages (see the note above). Missing = `!adminRole`. */
  personalPages?: boolean
  /** May add modules and manage the plan and billing: holds workspace.billing.manage (see the note above). */
  planAdmin: boolean
}

/**
 * Whether the personal pages (My work and every "My …" view) are shown: the
 * server's answer when the session carries one, else the role rule from before
 * the owner could set it per role (not for OWNER / SUPER_ADMIN / COMPANY_ADMIN
 * / ADMIN).
 */
export function personalPagesShown(fromServer: boolean | null | undefined, adminRole: boolean): boolean {
  return typeof fromServer === 'boolean' ? fromServer : !adminRole
}

/** The access rule every personal page, view and quick action uses. */
export const personalPagesOn = (ctx: AccessContext): boolean => ctx.personalPages ?? !ctx.adminRole

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
