// A role's code, name and description: the fields of Roles & permissions →
// "New role" / "Duplicate" / "Edit", and of Add employee → Access → Create role
// (AccessPicker). One set of fields and one set of checks for both.
import type { RbacRole } from '../api/useRbac'

export interface RoleDraft {
  code: string
  /** Someone typed their own code; until then it follows the name. */
  codeEdited: boolean
  displayName: string
  description: string
}

/** "Senior manager" → "SENIOR_MANAGER" (the same rule the server uses when no code is given). */
export const codeFromName = (name: string) => {
  const c = name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return (c && /^[A-Z]/.test(c) ? c : c ? `ROLE_${c}` : '').slice(0, 50)
}

/** Where the role editor starts: blank for a new role, a copy's name for a duplicate, the role itself for an edit. */
export function roleDraftFor(mode: 'create' | 'edit' | 'clone', role?: RbacRole): RoleDraft {
  return {
    displayName: mode === 'edit' && role ? role.displayName : mode === 'clone' && role ? `${role.displayName} (copy)` : '',
    code: mode === 'clone' && role ? codeFromName(`${role.displayName} copy`) : '',
    codeEdited: false,
    description: (mode === 'edit' || mode === 'clone') && role ? role.description ?? '' : '',
  }
}

/** What's missing before the role can be saved, or null. */
export const roleDraftProblem = (d: RoleDraft, isCreate: boolean) =>
  isCreate ? (!d.code.trim() || !d.displayName.trim() ? 'Role code and name are required' : null)
    : !d.displayName.trim() ? 'Name is required' : null

/** The body of POST /v1/rbac/roles (and of a duplicate). */
export const newRoleBody = (d: RoleDraft) => ({ code: codeFromName(d.code), displayName: d.displayName.trim(), description: d.description.trim() || undefined })

export function RoleFields({ draft, onChange, showCode }: { draft: RoleDraft; onChange: (next: RoleDraft) => void; showCode: boolean }) {
  return (
    <>
      {showCode && (
        <div>
          <label className="mb-1.5 block text-[13px] font-semibold text-text-secondary">Role code <span className="text-danger">*</span></label>
          <input
            value={draft.code}
            onChange={(e) => onChange({ ...draft, code: e.target.value, codeEdited: true })}
            placeholder="e.g. REGIONAL_HR"
            className="ut-input"
          />
          <p className="mt-1 text-xs text-text-tertiary">Uppercase identifier, unique within your workspace. Spaces become underscores. It can’t be a built-in role’s code.</p>
        </div>
      )}
      <div>
        <label className="mb-1.5 block text-[13px] font-semibold text-text-secondary">Display name <span className="text-danger">*</span></label>
        <input
          value={draft.displayName}
          onChange={(e) => onChange({ ...draft, displayName: e.target.value, ...(showCode && !draft.codeEdited ? { code: codeFromName(e.target.value) } : {}) })}
          placeholder="e.g. Regional HR"
          className="ut-input"
        />
      </div>
      <div>
        <label className="mb-1.5 block text-[13px] font-semibold text-text-secondary">Description</label>
        <textarea
          value={draft.description}
          onChange={(e) => onChange({ ...draft, description: e.target.value })}
          rows={2}
          placeholder="What is this role for?"
          className="w-full rounded-xl border border-border/60 bg-white px-3 py-2 text-sm focus:border-primary focus:outline-none"
        />
      </div>
    </>
  )
}
