import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { PunchAlertsSection, type PunchAlertsForm, type PunchAlertsSectionProps } from './PunchAlertsSection'

const FORM: PunchAlertsForm = {
  manager: true,
  people: [{ id: 'e1', name: 'Priya Rao', working: true }, { id: 'e2', name: 'Arjun Nair', working: false }],
  roles: [{ id: 'r1', name: 'Supervisor', builtIn: false }],
  on: 'ALL',
}
const OPTIONS = {
  companyId: 'c1', truncated: false,
  roles: [{ roleId: 'r1', name: 'Supervisor', builtIn: false }, { roleId: 'r2', name: 'HR Manager', builtIn: true }],
  people: [{ employeeId: 'e1', name: 'Priya Rao', employeeCode: 'EMP-0001', jobTitle: 'HR lead', working: true },
    { employeeId: 'e3', name: 'Ravi Kumar', employeeCode: 'EMP-0003', jobTitle: 'Supervisor', working: true }],
}

const html = (props: Partial<PunchAlertsSectionProps>) =>
  renderToString(createElement(PunchAlertsSection, { value: FORM, onChange: () => {}, readOnly: false, options: OPTIONS, ...props }))
const text = (s: string) => s.replace(/<!-- -->/g, '').replace(/&#x27;/g, '’')

describe('HR configuration › Punch-in alerts', () => {
  it('says who is told, in one line', () => {
    expect(text(html({}))).toContain('Reporting manager · 2 people · 1 role · every punch-in')
    expect(text(html({ value: { ...FORM, manager: false, people: [], roles: [], on: 'LATE_OR_OUTSIDE' } })))
      .toContain('Nobody · late or outside-office punch-ins only')
  })

  it('lets an editor switch the manager, remove and add people and roles, and choose which punch-ins', () => {
    const out = text(html({}))
    expect(out).toContain('Their reporting manager')
    expect(out).toMatch(/role="switch" aria-checked="true" aria-label="Their reporting manager"/)
    expect(out).toContain('aria-label="Remove Priya Rao"')
    expect(out).toContain('aria-label="Remove Supervisor"')
    expect(out).toContain('Add a person…')
    expect(out).toContain('Add a role…')
    expect(out).toContain('role="radiogroup"')
    expect(out).toContain('Every punch-in')
    expect(out).toContain('Only late or outside the office')
  })

  it('marks someone who has left (the alert skips them)', () => {
    expect(text(html({}))).toContain('Arjun Nair · has left')
  })

  it('shows a viewer the choices without anything to change', () => {
    const out = text(html({ readOnly: true }))
    expect(out).toContain('Priya Rao')
    expect(out).not.toContain('Remove Priya Rao')
    expect(out).not.toContain('Add a person')
    expect(out).not.toContain('role="radiogroup"')
    expect(out).toContain('Which punch-ins')
  })

  it('says plainly when it isn’t switched on yet, is loading, or didn’t load', () => {
    expect(text(html({ value: undefined }))).toContain('aren’t switched on for your workspace yet')
    expect(text(html({ value: null }))).toContain('Loading…')
    expect(text(html({ error: true }))).toContain('didn’t load')
  })

  it('stops adding at the limits and while the lists load', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ id: `p${i}`, name: `Person ${i}`, working: true }))
    expect(text(html({ value: { ...FORM, people: many } }))).toContain('Up to 50 people')
    expect(text(html({ optionsLoading: true, options: undefined }))).toContain('Loading…')
  })
})
