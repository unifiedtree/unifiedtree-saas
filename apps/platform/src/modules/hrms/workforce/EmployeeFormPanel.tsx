// Add employee / Edit details on the redesign kit (prototype PgEmpForm, as a side panel). Every
// field, rule and save is the Master design's EmpForm, unchanged:
//   - Personal: first and last name, work email (checked), mobile.
//   - Employment: company (fixed when editing), branch, department, designation (of that
//     department), employment type, date of joining, shift (attendance.workforce.admin), and the
//     staffing agency of a contract worker.
//   - "Create" beside branch, department, designation, type, shift and agency (MasterCreateField,
//     3fb6a5f0): the add form opens in a panel over this one, nothing typed here is lost, and
//     the new item is selected here once it is saved in this form's company.
//   - Access (people who can give roles or single permissions): MasterAccessStep.
// The save goes through the Master context's update('employees', …) (masterSync), as before.
// The "Employee code will be" preview and the "… added as <code>" message use the NEXT CODE OF
// THE CHOSEN COMPANY (codes are per company since V143_68); it used to be the first company's.
import { useMemo, useState, type ReactNode } from 'react'
import { useNextEmployeeCode } from '../api/useSettings'
import { Avatar, Callout, Chip } from '@/design/kit/display'
import { DateInput, Dropdown, FieldGrid, Input, PanelButton, SidePanel, type DropdownOption } from '@/design/kit/overlays'
import { SegmentedControl } from '@/design/kit/display'
import { TODAY_ISO } from '@/design/master/masterRuntime'
import type { Rec } from '../master/masterData'
import type { CreateKind } from '../master/masterCreate'
import { deptOptions, fmtDate, fmtL, shiftHours } from './directoryModel'
import { useMaps, useMasterApp } from './masterApp'

/** Below the "Create" panel (InlineCreate CREATE_PANEL_Z = 250), which opens over this form. */
export const EMPLOYEE_FORM_Z = 200

/** Changing one field empties the ones that depend on it. */
const CLEARS: Record<string, string[]> = { co: ['branch', 'dept', 'desig', 'agency'], dept: ['desig'] }
const EMAIL = /^\S+@\S+\.\S+$/

interface FieldProps {
  name: string
  label: string
  required?: boolean
  hint?: ReactNode
  error?: string | null
  full?: boolean
  /** The "Create" button at the end of the label row. */
  create?: ReactNode
  children: ReactNode
}

/** A kit field whose label row can hold "Create" (a button can't sit inside a <label>). */
function Field({ name, label, required, hint, error, full, create, children }: FieldProps) {
  return (
    <div className="uko-field wf-field" data-full={full ? '' : undefined} data-create-field={name} data-field={name}>
      <div className="wf-field__head">
        <span className="uko-label">{label}{required && <span className="uko-req" aria-hidden="true"> *</span>}</span>
        {create}
      </div>
      {children}
      {error ? <div className="uko-error" role="alert">{error}</div> : hint ? <div className="uko-hint">{hint}</div> : null}
    </div>
  )
}

export interface EmployeeFormPanelProps {
  /** The record to edit; none to add someone. */
  emp?: Rec | null
  onClose: () => void
}

export function EmployeeFormPanel({ emp, onClose }: EmployeeFormPanelProps) {
  const { db, update, toast, act } = useMasterApp()
  const M = useMaps(db)
  const isEdit = !!emp
  const [v, setV] = useState<Rec>(() => (isEdit
    ? { ...emp }
    : { co: act.defaultCo, branch: (db.branches.find((b) => b.co === act.defaultCo && b.kind === 'Head office') || {}).id || '', type: 'Full-time', joined: TODAY_ISO, shift: '' }))
  const [errs, setErrs] = useState<Record<string, string | null>>({})
  const set = (k: string, x: unknown) => {
    setV((o) => { const n: Rec = { ...o, [k]: x }; for (const c of CLEARS[k] || []) n[c] = ''; return n })
    setErrs((e) => ({ ...e, [k]: null }))
  }

  // The chosen company's next code (V143_68: codes are unique per company).
  const codeQ = useNextEmployeeCode(isEdit ? undefined : String(v.co || '') || undefined)
  const nextCode = codeQ.data?.preview || ''

  const mk = (kind: CreateKind) => (!isEdit && act.inlineCreate ? act.inlineCreate(kind, v, set) : undefined)
  const showAgency = v.type === 'Contract' && act.showAgency

  const opts = useMemo(() => ({
    companies: db.companies.map((c): DropdownOption => ({ value: c.id, label: c.name })),
    branches: db.branches.filter((b) => b.co === v.co).map((b): DropdownOption => ({ value: b.id, label: b.name, sub: b.city || undefined })),
    depts: deptOptions(db.depts).filter((o) => (db.depts.find((x) => x.id === o.value) || {}).co === v.co).map((o): DropdownOption => ({ value: o.value, label: o.label, sub: o.sub })),
    desigs: db.desigs.filter((x) => x.co === v.co && (x.dept === v.dept || !x.dept)).map((x): DropdownOption => ({ value: x.id, label: x.name, sub: x.grade || undefined })),
    shifts: db.shifts.filter((s) => s.status === 'Active').map((s): DropdownOption => ({ value: s.id, label: s.name, sub: s.kind === 'Flexible' ? 'Flexible' : shiftHours(s) })),
    agencies: [{ value: '', label: 'No agency' } as DropdownOption].concat(db.agencies.filter((a) => a.co === v.co && (a.status === 'Active' || a.id === v.agency)).map((a) => ({ value: a.id, label: a.name, sub: a.service || undefined }))),
    types: act.typeOptions(v.type).map((t) => ({ value: t, label: t })),
  }), [db, v.co, v.dept, v.type, v.agency, act])

  const required: [string, boolean][] = [['first', true], ['last', true], ['email', true], ['co', !isEdit], ['branch', true], ['dept', true], ['desig', true], ['joined', true]]
  const submit = () => {
    const e: Record<string, string> = {}
    for (const [k, on] of required) if (on && String(v[k] ?? '').trim() === '') e[k] = 'Required'
    if (!e.email && !EMAIL.test(String(v.email))) e.email = 'Enter a valid email address'
    setErrs(e)
    if (Object.keys(e).length) return
    const first = String(v.first).trim(), last = String(v.last).trim(), name = `${first} ${last}`
    const ds = M.desig[v.desig]
    const co = M.branch[v.branch].co
    const rec: Rec = {
      ...(isEdit ? emp : {}), ...v, name, first, last, grade: ds.grade, co,
      id: isEdit ? emp!.id : nextCode || 'Assigned when saved', status: isEdit ? emp!.status : 'Probation', agency: v.type === 'Contract' ? (v.agency || '') : '',
    }
    update('employees', (L) => (isEdit ? L.map((x) => (x.id === emp!.id ? rec : x)) : L.concat([rec])))
    toast(isEdit ? `Saved changes to ${name}` : `${name}${nextCode ? ` added as ${nextCode}` : ' added'}`)
    onClose()
  }

  // Preview: the code, the grade of the designation and the rules of the employment type.
  const cls = db.classes.find((c) => c.type === v.type)
  const ds = v.desig ? M.desig[v.desig] : null
  const g = ds && ds.grade ? M.grade[ds.grade] : null
  const who = `${String(v.first || '').trim()} ${String(v.last || '').trim()}`.trim()
  const preview = (
    <div className="wf-preview" data-code-preview="">
      <div className="wf-preview__head">
        <span>{isEdit ? 'Employee code' : 'Employee code will be'}</span>
        <span className="wf-preview__aside">{isEdit ? 'Codes never change' : 'Auto-generated'}</span>
      </div>
      <div className="wf-preview__who">
        <Avatar name={who || 'New employee'} size={40} tone="pale" />
        <div className="wf-preview__name">
          <b>{who || (isEdit ? emp!.name : 'New employee')}</b>
          <span>{[ds?.name, v.dept ? M.dept[v.dept].name : ''].filter((x) => x && x !== '—').join(' · ') || 'Pick a department and designation'}</span>
        </div>
      </div>
      <dl className="wf-preview__facts">
        <div><dt>Code</dt><dd className="wf-preview__code" data-next-code="">{isEdit ? emp!.code : nextCode || (codeQ.isLoading ? '…' : 'Assigned when saved')}</dd></div>
        <div><dt>Joins</dt><dd>{fmtDate(v.joined)}</dd></div>
      </dl>
    </div>
  )

  return (
    <SidePanel open onClose={onClose} width={620} zIndex={EMPLOYEE_FORM_Z} closeLabel="Close"
      title={isEdit ? `Edit ${emp!.name}` : 'Add employee'}
      sub={isEdit ? `${emp!.code} · changes apply from the next payroll run` : 'They get an employee code, login invite and the rules for their classification.'}
      footer={<>
        <PanelButton size="lg" onClick={onClose}>Cancel</PanelButton>
        <PanelButton size="lg" variant="primary" icon="check" onClick={submit}>{isEdit ? 'Save changes' : 'Add employee'}</PanelButton>
      </>}>
      <div className="wf-form">
        <section className="wf-fsec" aria-labelledby="wf-sec-personal">
          <div className="wf-fsec__head"><h3 id="wf-sec-personal">Who they are</h3><span>Name and contact</span></div>
          <FieldGrid>
            <Input label="First name" required placeholder="e.g. Ananya" value={v.first ?? ''} error={errs.first} onChange={(e) => set('first', e.target.value)} />
            <Input label="Last name" required placeholder="e.g. Sharma" value={v.last ?? ''} error={errs.last} onChange={(e) => set('last', e.target.value)} />
            <Input label="Work email" required type="email" placeholder="name@company.com" value={v.email ?? ''} error={errs.email} onChange={(e) => set('email', e.target.value)} />
            <Input label="Mobile" placeholder="+91 98xxx xxxxx" value={v.phone ?? ''} onChange={(e) => set('phone', e.target.value)} />
          </FieldGrid>
        </section>

        <section className="wf-fsec" aria-labelledby="wf-sec-role">
          <div className="wf-fsec__head"><h3 id="wf-sec-role">Their role</h3><span>Where they sit and when they start</span></div>
          <FieldGrid>
            <Field name="co" label="Company" required={!isEdit} full error={errs.co}
              hint={isEdit ? 'Moving someone to another company isn’t supported yet' : undefined}>
              <Dropdown label="Company" options={opts.companies} value={v.co || ''} disabled={isEdit} searchable={opts.companies.length > 6}
                invalid={!!errs.co} onChange={(x) => set('co', x)} />
            </Field>
            <Field name="branch" label="Branch" required error={errs.branch} create={mk('branches')}>
              <Dropdown label="Branch" options={opts.branches} value={v.branch || ''} invalid={!!errs.branch} searchable={opts.branches.length > 6}
                emptyText="This company has no branches yet." onChange={(x) => set('branch', x)} />
            </Field>
            <Field name="dept" label="Department" required error={errs.dept} create={mk('depts')}>
              <Dropdown label="Department" options={opts.depts} value={v.dept || ''} invalid={!!errs.dept} searchable
                emptyText="No departments match." onChange={(x) => set('dept', x)} />
            </Field>
            <Field name="desig" label="Designation" required error={errs.desig} create={mk('desigs')}>
              <Dropdown label="Designation" options={opts.desigs} value={v.desig || ''} invalid={!!errs.desig} searchable={opts.desigs.length > 6}
                placeholder={v.dept ? 'Select…' : 'Pick a department first'} emptyText="No designations for this department yet." onChange={(x) => set('desig', x)} />
            </Field>
            <DateInput label="Date of joining" required value={v.joined || ''} error={errs.joined} onChange={(e) => set('joined', e.target.value)} />
            <Field name="type" label="Employment type" full create={mk('classes')}>
              <SegmentedControl label="Employment type" semantics="radio" size="xl" className="wf-seg" options={opts.types} value={v.type || ''} onChange={(x) => set('type', x)} />
            </Field>
            <Field name="shift" label="Shift" create={mk('shifts')} hint={act.canAssignShift ? undefined : 'You don’t have access to assign shifts'}>
              <Dropdown label="Shift" options={opts.shifts} value={v.shift || ''} disabled={!act.canAssignShift} searchable={opts.shifts.length > 6}
                emptyText="No active shifts yet." onChange={(x) => set('shift', x)} />
            </Field>
            {showAgency && (
              <Field name="agency" label="Staffing agency" full create={mk('agencies')}
                hint={act.canAgency ? 'The agency that supplies this contract worker. Its worker count on Contractor Master is counted from these links.' : 'You don’t have access to change the agency'}>
                <Dropdown label="Staffing agency" options={opts.agencies} value={v.agency || ''} disabled={!act.canAgency} onChange={(x) => set('agency', x)} />
              </Field>
            )}
          </FieldGrid>
        </section>

        {!isEdit && act.accessStep && (
          <section className="wf-fsec" aria-labelledby="wf-sec-access">
            <div className="wf-fsec__head"><h3 id="wf-sec-access">Access</h3><span>What they can do once they sign in</span></div>
            {act.accessStep(v.access, (x) => set('access', x))}
          </section>
        )}

        {preview}
        {(g || cls) && (
          <div className="wf-preview__more">
            {g && <Chip>{g.id} · {g.name}{g.min != null ? ` · ${fmtL(g.min)}–${fmtL(g.max)}` : ''}</Chip>}
            {cls && (
              <Callout tone="info" icon="info">
                <b>{cls.name} rules apply</b> — probation {String(cls.probation).toLowerCase()}, notice {cls.notice ? `${cls.notice} days` : '—'}{cls.pf === true ? ', PF & ESI eligible' : ''}.
              </Callout>
            )}
          </div>
        )}
      </div>
    </SidePanel>
  )
}
