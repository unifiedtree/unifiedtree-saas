// HR configuration › Punch-in alerts (owner request 4 Oct; V143_72). Who is told, in the app and
// on their phone, when someone in this company punches in: their reporting manager (on by
// default), people picked here, everyone holding the roles picked here, and whether every
// punch-in counts or only late and outside-office ones. Saved with the page's Save bar.
import { useId } from 'react'
import { Dropdown, type DropdownOption } from '@/design/kit/overlays'
import { SegmentedControl } from '@/design/kit/display'
import { SettingsSection, SettingsToggleRow, SettingsNote, SettingsValue } from '@/design/settings/SettingsKit'
import { punchAlertSummary, type PunchAlertOn, type PunchAlertOptions } from '../api/shared/usePunchAlertSetting'
import './PunchAlertsSection.css'

/** The section's part of the page form. */
export interface PunchAlertsForm {
  manager: boolean
  people: { id: string; name: string; working: boolean }[]
  roles: { id: string; name: string; builtIn: boolean }[]
  on: PunchAlertOn
}

export const MAX_ALERT_PEOPLE = 50
export const MAX_ALERT_ROLES = 20

const WHEN: { value: PunchAlertOn; label: string }[] = [
  { value: 'ALL', label: 'Every punch-in' },
  { value: 'LATE_OR_OUTSIDE', label: 'Only late or outside the office' },
]

export interface PunchAlertsSectionProps {
  /** null while it loads; undefined when the server doesn't offer punch-in alerts yet. */
  value: PunchAlertsForm | null | undefined
  onChange: (next: PunchAlertsForm) => void
  readOnly: boolean
  options?: PunchAlertOptions
  optionsLoading?: boolean
  optionsError?: boolean
  /** The setting itself didn't load (not "not switched on"). */
  error?: boolean
  updatedByName?: string | null
  updatedAt?: string | null
}

export function PunchAlertsSection({ value, onChange, readOnly, options, optionsLoading, optionsError, error, updatedByName, updatedAt }: PunchAlertsSectionProps) {
  const peopleId = useId(), rolesId = useId()
  if (value === undefined || error) {
    return (
      <SettingsSection id="alerts" icon="bell" title="Punch-in alerts" summary={error ? 'Couldn’t load' : 'Not switched on yet'} readOnly>
        <SettingsNote>{error
          ? 'Punch-in alerts didn’t load, so they can’t be shown or changed right now. Reload the page to try again.'
          : 'Punch-in alerts aren’t switched on for your workspace yet. Once they are, the people you choose here are told when someone punches in, with the time and the exact place.'}</SettingsNote>
      </SettingsSection>
    )
  }
  if (value === null) {
    return <SettingsSection id="alerts" icon="bell" title="Punch-in alerts" summary="Loading…" readOnly />
  }

  const a = value
  const set = (patch: Partial<PunchAlertsForm>) => onChange({ ...a, ...patch })
  const pickedPeople = new Set(a.people.map((p) => p.id))
  const pickedRoles = new Set(a.roles.map((r) => r.id))
  const peopleOptions: DropdownOption[] = (options?.people ?? []).filter((p) => !pickedPeople.has(p.employeeId)).map((p) => ({
    value: p.employeeId, label: p.name || p.employeeCode || 'Unnamed', sub: [p.employeeCode, p.jobTitle].filter(Boolean).join(' · ') || undefined,
    keywords: [p.employeeCode, p.jobTitle].filter(Boolean).join(' '),
  }))
  const roleOptions: DropdownOption[] = (options?.roles ?? []).filter((r) => !pickedRoles.has(r.roleId)).map((r) => ({
    value: r.roleId, label: r.name, sub: r.builtIn ? 'Built-in role' : 'Made by your business',
  }))
  const listState = optionsLoading ? 'Loading…' : optionsError ? 'Couldn’t load the list' : undefined
  const fullPeople = a.people.length >= MAX_ALERT_PEOPLE, fullRoles = a.roles.length >= MAX_ALERT_ROLES

  return (
    <SettingsSection id="alerts" icon="bell" title="Punch-in alerts" summary={punchAlertSummary({ notifyManager: a.manager, people: a.people, roles: a.roles, alertOn: a.on })} readOnly={readOnly}>
      <SettingsToggleRow label="Their reporting manager" detail="The manager on each person’s record (their department head when they have none) is told when they punch in."
        on={a.manager} onToggle={() => set({ manager: !a.manager })} readOnly={readOnly} />

      <div className="uks-field">
        <span className="uks-label" id={peopleId}>Also tell these people</span>
        <ul className="pas-picked" aria-labelledby={peopleId}>
          {a.people.length === 0 && <li className="pas-none">Nobody else</li>}
          {a.people.map((p) => (
            <li key={p.id} className="pas-chip" data-off={p.working ? undefined : ''}>
              <span className="pas-chip__name">{p.name}{p.working ? '' : ' · has left'}</span>
              {!readOnly && <button type="button" className="pas-chip__x" aria-label={`Remove ${p.name}`} onClick={() => set({ people: a.people.filter((x) => x.id !== p.id) })}>×</button>}
            </li>
          ))}
        </ul>
        {!readOnly && (
          <div className="pas-add">
            <Dropdown label="Add a person" placeholder={listState ?? (fullPeople ? `Up to ${MAX_ALERT_PEOPLE} people` : 'Add a person…')}
              options={peopleOptions} value={null} disabled={!!optionsLoading || !!optionsError || fullPeople}
              searchPlaceholder="Search by name, code or job" emptyText="Nobody else in this company can be picked."
              onChange={(id, o) => set({ people: [...a.people, { id, name: o.label, working: true }] })} />
          </div>
        )}
        {!readOnly && options?.truncated && <p className="uks-hint">The list shows the first 1,000 people in this company.</p>}
      </div>

      <div className="uks-field">
        <span className="uks-label" id={rolesId}>And everyone in this company with these roles</span>
        <ul className="pas-picked" aria-labelledby={rolesId}>
          {a.roles.length === 0 && <li className="pas-none">No roles</li>}
          {a.roles.map((r) => (
            <li key={r.id} className="pas-chip">
              <span className="pas-chip__name">{r.name}</span>
              {!readOnly && <button type="button" className="pas-chip__x" aria-label={`Remove ${r.name}`} onClick={() => set({ roles: a.roles.filter((x) => x.id !== r.id) })}>×</button>}
            </li>
          ))}
        </ul>
        {!readOnly && (
          <div className="pas-add">
            <Dropdown label="Add a role" placeholder={listState ?? (fullRoles ? `Up to ${MAX_ALERT_ROLES} roles` : 'Add a role…')}
              options={roleOptions} value={null} disabled={!!optionsLoading || !!optionsError || fullRoles}
              searchPlaceholder="Search roles" emptyText="No other roles can be picked."
              onChange={(id, o) => set({ roles: [...a.roles, { id, name: o.label, builtIn: !!options?.roles.find((r) => r.roleId === id)?.builtIn }] })} />
          </div>
        )}
        <p className="uks-hint">For example a Supervisor role your business made. Only role holders who work in this company are told.</p>
      </div>

      {readOnly
        ? <SettingsValue label="Which punch-ins" value={WHEN.find((w) => w.value === a.on)?.label ?? 'Every punch-in'} />
        : (
          <div className="uks-field">
            <span className="uks-label">Which punch-ins</span>
            <SegmentedControl<PunchAlertOn> label="Which punch-ins" semantics="radio" size="lg" options={WHEN} value={a.on} onChange={(on) => set({ on })} />
          </div>
        )}

      <SettingsNote>Each alert says when they punched in, how (face scan in the app, on the web, or punched in for them by a manager), exactly where (the office zone, or how far outside the nearest one, with the coordinates) and has a map link. It goes in the app and to the phone. Nobody gets an alert about their own punch-in, and nobody gets the same alert twice. HR’s manual entries aren’t punches, so they send none. People can switch these alerts off for themselves in their notification settings.</SettingsNote>
      {updatedAt && <SettingsNote>Last changed {new Date(updatedAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}{updatedByName ? ` by ${updatedByName}` : ''}.</SettingsNote>}
    </SettingsSection>
  )
}
