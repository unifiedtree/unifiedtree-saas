import { accessState, type AccessContext } from './access'
import { menuRule } from './pageRegistry'

/**
 * Workspace settings: what belongs to the whole workspace rather than to one
 * module. Opened from the Apps page (/modules) and the profile menu; each page
 * shows the rest as its section tabs. HR settings are in HRMS settings
 * (hrmsSettings.ts); your own profile is under the profile menu.
 *
 * Who sees each page is the page registry's rule for its path (the same rule
 * its route checks), so a person is only offered pages they can open.
 */
export interface WorkspaceSettingsPage { key: string; label: string; path: string }

export const WORKSPACE_SETTINGS: WorkspaceSettingsPage[] = [
  { key: 's-profile', label: 'Workspace profile', path: '/settings/profile' },
  { key: 's-branding', label: 'Branding', path: '/settings/branding' },
  { key: 's-security', label: 'Security', path: '/settings/security' },
  { key: 's-notifications', label: 'Notifications', path: '/settings/notifications' },
  { key: 's-billing', label: 'Billing & Plan', path: '/settings/billing' },
  { key: 's-integrations', label: 'Integrations', path: '/settings/integrations' },
  { key: 's-users', label: 'Users & Access', path: '/users' },
  { key: 's-audit', label: 'Audit Logs', path: '/audit-logs' },
  { key: 's-danger', label: 'Danger Zone', path: '/settings/danger' },
]

/** The workspace settings pages this person may open, in menu order. */
export function workspaceSettingsFor(ctx: AccessContext): WorkspaceSettingsPage[] {
  return WORKSPACE_SETTINGS.filter((p) => accessState(menuRule(p.path), ctx) !== 'hidden')
}
