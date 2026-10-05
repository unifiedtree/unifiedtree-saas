// Roles & permissions › a role › "Personal pages" (V143.90).
//
// Whether the people holding this role see My work and the other "My …" pages
// (My leave, My claims, My reviews, My goals, My documents, …) on the website
// and in the phone app. Off by default for Owner and Admin roles, on for every
// other role. Every role has the switch, built-in ones too (whose permissions
// can't be changed); only the workspace owner can flip it, everyone else who
// may open this page sees it read-only. People pick a change up at their next
// sign-in or page reload. It changes what the menus show, not what the server
// allows.
import { toast } from 'sonner'
import { Toggle } from '@/design/kit/overlays'
import { Note } from '@/design/module/ModuleKit'
import { useRolePersonalPages, useSetRolePersonalPages, type RbacRole, type RolePersonalPages } from '../api/useRbac'

export const PERSONAL_PAGES_LABEL = 'Personal pages — My work, My leave, My claims, My goals and other “My” pages'

/** The line under the switch: the default, and whether the owner changed it. */
export function personalPagesHint(s: Pick<RolePersonalPages, 'enabled' | 'overridden' | 'defaultEnabled'>): string {
  const base = 'Off by default for Owner and Admin roles, on for every other role.'
  if (!s.overridden) return `${base} This role uses its default (${s.defaultEnabled ? 'on' : 'off'}).`
  return `${base} The owner turned it ${s.enabled ? 'on' : 'off'} for this role.`
}

export interface PersonalPagesSwitchViewProps {
  roleName: string
  setting: Pick<RolePersonalPages, 'enabled' | 'overridden' | 'defaultEnabled'>
  /** The signed-in person is the workspace owner. */
  canEdit: boolean
  /** The server can save it (its table is there). */
  ready: boolean
  busy?: boolean
  onChange: (enabled: boolean) => void
}

/** The switch and its notes (no data fetching, so it renders in tests). */
export function PersonalPagesSwitchView({ roleName, setting, canEdit, ready, busy, onChange }: PersonalPagesSwitchViewProps) {
  const editable = canEdit && ready
  return (
    <section aria-label={`Personal pages for ${roleName}`} className="space-y-2 rounded-lg border border-border-default p-3">
      <Toggle checked={setting.enabled} onChange={onChange} disabled={!editable || busy} size="md"
        label={PERSONAL_PAGES_LABEL} description={personalPagesHint(setting)} />
      <p className="text-xs text-text-secondary">
        This changes what people with this role see at their next sign-in or page reload. It doesn’t change what they’re allowed to do.
      </p>
      {!canEdit && <p className="text-xs text-text-tertiary">Only the workspace owner can change this.</p>}
      {canEdit && !ready && <Note tone="amber">This isn’t switched on yet, so it can’t be changed.</Note>}
    </section>
  )
}

/** The switch for one role, with its data. Shows a note instead when the setting can't be read. */
export function PersonalPagesSwitch({ role }: { role: RbacRole }) {
  const q = useRolePersonalPages()
  const set = useSetRolePersonalPages()
  if (q.isLoading) return null
  if (q.isError || !q.data) return <Note tone="amber">Couldn’t load the personal pages setting for this role.</Note>
  // Platform roles have no setting: nobody in a workspace holds them.
  const setting = q.data.roles.find((r) => r.roleId === role.id)
  if (!setting) return null
  const change = (enabled: boolean) => set.mutate({ roleId: role.id, enabled }, {
    onSuccess: () => toast.success(`Personal pages turned ${enabled ? 'on' : 'off'} for ${role.displayName}`,
      { description: 'People with this role see the change at their next sign-in or page reload.' }),
    onError: (e) => toast.error('Couldn’t change personal pages', { description: (e as { message?: string })?.message || 'Please try again.' }),
  })
  return (
    <PersonalPagesSwitchView roleName={role.displayName} setting={setting} canEdit={q.data.canEdit} ready={q.data.ready}
      busy={set.isPending} onChange={change} />
  )
}
