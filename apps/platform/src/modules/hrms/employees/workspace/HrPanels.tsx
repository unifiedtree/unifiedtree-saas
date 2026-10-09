// The HR view's pop-ups, on the kit: Edit profile (Basic → Financial), Change shift, and the
// lifecycle dialogs (confirm / extend probation, start / cancel notice, mark exited).
// Each one calls the same endpoint it always did (the page passes the calls in) and says what
// the server did, or why it refused, in a toast.
import { Fragment, useState, type ReactNode } from 'react'
import { Callout } from '@/design/kit/display'
import { Dialog, FieldGrid, Input, PanelButton, Select, SidePanel, Textarea, useToast } from '@/design/kit/overlays'
import { emailConflictMessage, useEmailCheck, usePhoneWarning } from '../../api/useContactCheck'

export interface EditField {
  key: string; label: string; value: string
  type?: 'text' | 'email' | 'date' | 'number'
  placeholder?: string; options?: { value: string; label: string }[]
  off?: boolean; hint?: string; required?: boolean
  check?: (v: string) => string
  /**
   * Also asked of the server as you type: 'email' — already someone else's in the workspace
   * (an error, blocks Save); 'phone' — someone else has the number (a warning only).
   */
  remote?: 'email' | 'phone'
  /** Its own control instead of an input or select (the Reports to picker). */
  render?: (value: string, onChange: (value: string) => void, error?: string) => ReactNode
}

const errText = (e: unknown) => (e instanceof Error && e.message) || 'Please try again.'

function fieldErrors(fields: EditField[], form: Record<string, string>) {
  const errs: Record<string, string> = {}
  for (const f of fields) {
    if (f.off) continue
    const v = (form[f.key] ?? '').trim()
    if (f.required && !v) errs[f.key] = `${f.label} is required`
    else if (v && f.check) { const m = f.check(v); if (m) errs[f.key] = m }
  }
  return errs
}

/** Edit profile: Basic then Financial; "All fields…" opens the full employee form. */
export function EditProfilePanel({ open, onClose, basic, financial, onSave, onFullForm, employeeId }: {
  open: boolean; onClose: () => void; basic: EditField[]; financial: EditField[]
  onSave: (values: Record<string, string>) => Promise<string>; onFullForm: () => void
  /** The person being edited: left out of the email and phone checks. */
  employeeId?: string
}) {
  if (!open) return null
  return <OpenEdit onClose={onClose} basic={basic} financial={financial} onSave={onSave} onFullForm={onFullForm} employeeId={employeeId} />
}

function OpenEdit({ onClose, basic, financial, onSave, onFullForm, employeeId }: {
  onClose: () => void; basic: EditField[]; financial: EditField[]
  onSave: (values: Record<string, string>) => Promise<string>; onFullForm: () => void
  employeeId?: string
}) {
  const toast = useToast()
  const [form, setForm] = useState<Record<string, string>>(() => Object.fromEntries([...basic, ...financial].map((f) => [f.key, f.value])))
  const [step, setStep] = useState(0)
  const [shown, setShown] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)
  // The server's word on the email (as you type, and a 409 from Save), shown at once on the field.
  const emailField = basic.find((f) => f.remote === 'email'), phoneField = basic.find((f) => f.remote === 'phone')
  const emailCheck = useEmailCheck(emailField ? form[emailField.key] ?? '' : '', { excludeEmployeeId: employeeId, initial: emailField?.value, enabled: !!emailField })
  const phoneWarning = usePhoneWarning(phoneField ? form[phoneField.key] ?? '' : '', { excludeEmployeeId: employeeId, initial: phoneField?.value, enabled: !!phoneField })
  const [savedTaken, setSavedTaken] = useState<{ value: string; message: string } | null>(null)
  const remoteErr = emailField
    ? (savedTaken && savedTaken.value === (form[emailField.key] ?? '') ? savedTaken.message : emailCheck.message)
    : null
  const basicErrs = { ...fieldErrors(basic, form), ...(emailField && remoteErr ? { [emailField.key]: remoteErr } : {}) }
  const finErrs = fieldErrors(financial, form)
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }))
  const fields = (list: EditField[], errs: Record<string, string>, show: boolean) => (
    <FieldGrid columns={2}>
      {list.map((f) => f.render && !f.off ? (
        <Fragment key={f.key}>{f.render(form[f.key] ?? '', (v) => set(f.key, v), show ? errs[f.key] : undefined)}</Fragment>
      ) : f.options && !f.off ? (
        <Select key={f.key} label={f.label} value={form[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)}
          placeholder="Choose" options={f.options} error={show ? errs[f.key] : undefined} hint={f.hint} />
      ) : (
        <Input key={f.key} label={f.label} type={f.type || 'text'} value={form[f.key] ?? ''} disabled={f.off}
          placeholder={f.placeholder} onChange={(e) => set(f.key, e.target.value)}
          error={show || (f.remote === 'email' && remoteErr) ? errs[f.key] : undefined}
          hint={!(show && errs[f.key]) ? (f.remote === 'phone' && phoneWarning) || f.hint : undefined} />
      ))}
    </FieldGrid>
  )
  const save = async () => {
    if (Object.keys(basicErrs).length) { setShown(new Set([0, 1])); setStep(0); return }
    if (Object.keys(finErrs).length) { setShown(new Set([0, 1])); return }
    setBusy(true)
    try {
      // What is typed now, not the last debounced answer.
      const taken = emailField ? await emailCheck.settle() : null
      if (taken && emailField) { setSavedTaken({ value: form[emailField.key] ?? '', message: taken }); setStep(0); return }
      toast.success(await onSave(form)); onClose()
    } catch (e) {
      const taken = emailConflictMessage(e)
      if (taken && emailField) { setSavedTaken({ value: form[emailField.key] ?? '', message: taken }); setStep(0) }
      toast.error('Couldn’t save the changes', { detail: errText(e) })
    } finally { setBusy(false) }
  }
  const firstErr = (errs: Record<string, string>) => Object.values(errs)[0] || null
  return (
    <SidePanel open onClose={onClose} title="Edit profile" sub="Saves only what you change. Everything else stays as it is." closeLabel="Close panel"
      busy={busy} step={step} onStepChange={setStep} onBlocked={(i) => setShown((s) => new Set(s).add(i))}
      nextLabel="Next: Financial →" backLabel="← Basic" finishLabel="Save changes" onFinish={() => void save()}
      steps={[
        {
          key: 'basic', label: 'Basic', title: 'Basic details', sub: 'Name, contact, where they sit and when they joined.', icon: 'userCheck',
          blocker: firstErr(basicErrs),
          content: <>
            {fields(basic, basicErrs, shown.has(0))}
            <p className="upf-note" style={{ marginTop: 12 }}>
              Need another field?{' '}
              <button type="button" onClick={() => { onClose(); onFullForm() }} style={{ border: 0, padding: 0, background: 'none', font: 'inherit', fontWeight: 500, color: 'var(--u-brt,#0F6E56)', cursor: 'pointer' }}>All fields…</button>
            </p>
          </>,
        },
        {
          key: 'financial', label: 'Financial', title: 'Financial details', sub: 'Leave a field blank to keep what is on record.', icon: 'banknote',
          blocker: firstErr(finErrs),
          content: fields(financial, finErrs, shown.has(1)),
        },
      ]} />
  )
}

/** Change shift: today, or a future date (the current shift applies until then). */
export function ShiftPanel({ open, onClose, current, upcoming, options, today, onSave }: {
  open: boolean; onClose: () => void; current: string; upcoming: string; options: { value: string; label: string }[]; today: string
  onSave: (shiftId: string, from: string) => Promise<string>
}) {
  const toast = useToast()
  const [shift, setShift] = useState('')
  const [from, setFrom] = useState(today)
  const [busy, setBusy] = useState(false)
  if (!open) return null
  const shiftId = shift || options[0]?.value || ''
  const eff = from || today, future = eff > today
  const save = async () => {
    if (!shiftId) return
    setBusy(true)
    try { toast.success(await onSave(shiftId, eff)); setShift(''); setFrom(today); onClose() } catch (e) { toast.error('Couldn’t change the shift', { detail: errText(e) }) } finally { setBusy(false) }
  }
  return (
    <SidePanel open onClose={onClose} title="Change shift" sub={`Now: ${current}${upcoming ? ` · ${upcoming}` : ''}`} closeLabel="Close panel" busy={busy}
      footer={<>
        <PanelButton size="lg" onClick={onClose}>Cancel</PanelButton>
        <PanelButton size="lg" variant="primary" busy={busy} blockedReason={!shiftId ? 'There are no shifts to choose from' : null} onClick={() => void save()}>{future ? 'Schedule shift change' : 'Save shift'}</PanelButton>
      </>}>
      {options.length === 0 && <Callout tone="warning">This company has no shifts yet. Add one under Shifts &amp; overtime first.</Callout>}
      <FieldGrid columns={1}>
        <Select label="New shift" value={shiftId} onChange={(e) => setShift(e.target.value)} options={options.length ? options : [{ value: '', label: 'No shifts' }]} />
        <Input label="Applies from" type="date" value={eff} min={today} onChange={(e) => setFrom(e.target.value)}
          hint={future ? `The change is scheduled; the current shift applies until then.` : 'Applies from today.'} />
      </FieldGrid>
    </SidePanel>
  )
}

export type LifecycleKind = 'confirm' | 'extend' | 'notice' | 'exit' | 'cancel'

export interface LifecycleCalls {
  defaults: { noticeStart: string; lwd: string; reason: string; extendTo: string; exitType: string }
  exitTypes: { value: string; label: string }[]
  onConfirm: (date: string) => Promise<string>
  onExtend: (date: string) => Promise<string>
  onNotice: (start: string, lwd: string, reason: string, exitType: string) => Promise<string>
  onExit: (lwd: string, reason: string, exitType: string) => Promise<string>
  onCancel: () => Promise<string>
}

const TITLES: Record<LifecycleKind, [string, string, 'primary' | 'danger']> = {
  confirm: ['Confirm probation', 'Confirm probation', 'primary'],
  extend: ['Extend probation', 'Extend probation', 'primary'],
  notice: ['Start notice period', 'Start notice', 'primary'],
  exit: ['Mark employee as exited', 'Mark exited', 'danger'],
  cancel: ['Cancel notice period', 'Cancel notice', 'primary'],
}

/** One lifecycle step. `kind` null = closed. */
export function LifecycleDialog({ kind, onClose, name, today, calls }: { kind: LifecycleKind | null; onClose: () => void; name: string; today: string; calls: LifecycleCalls }) {
  if (!kind) return null
  return <OpenLifecycle key={kind} kind={kind} onClose={onClose} name={name} today={today} calls={calls} />
}

function OpenLifecycle({ kind, onClose, name, today, calls }: { kind: LifecycleKind; onClose: () => void; name: string; today: string; calls: LifecycleCalls }) {
  const toast = useToast()
  const L = calls.defaults, firstType = calls.exitTypes[0]?.value || ''
  const [conf, setConf] = useState(today)
  const [ext, setExt] = useState(L.extendTo)
  const [nStart, setNStart] = useState(L.noticeStart)
  const [lwd, setLwd] = useState(L.lwd)
  const [reason, setReason] = useState(L.reason)
  const [xLwd, setXLwd] = useState(L.lwd || today)
  const [xReason, setXReason] = useState(L.reason)
  const [type, setType] = useState(L.exitType || firstType)
  const [tried, setTried] = useState(false)
  const [busy, setBusy] = useState(false)
  const first = name.split(' ')[0]
  const desc: Record<LifecycleKind, string> = {
    confirm: `${name} becomes a permanent employee from the confirmation date.`,
    extend: `Pick the new date ${first}’s probation runs until.`,
    notice: 'Record the resignation and the notice period.',
    exit: 'Their login is disabled after the last working day. Check the exit type: it decides how this exit is counted in the attrition report.',
    cancel: 'The employee becomes active again.',
  }
  const lwdBad = !!lwd && lwd < nStart
  const missing = kind === 'notice' ? (!lwd || lwdBad) : kind === 'extend' ? !ext : kind === 'exit' ? !xLwd : false
  const ok = async () => {
    if (missing) { setTried(true); return }
    const call = { confirm: () => calls.onConfirm(conf), extend: () => calls.onExtend(ext), notice: () => calls.onNotice(nStart, lwd, reason, type), exit: () => calls.onExit(xLwd, xReason, type), cancel: () => calls.onCancel() }[kind]
    setBusy(true)
    try { toast.success(await call()); onClose() } catch (e) { toast.error('That didn’t go through', { detail: errText(e) }) } finally { setBusy(false) }
  }
  const [title, cta, variant] = TITLES[kind]
  const typeSelect = <Select label="Exit type" required value={type} onChange={(e) => setType(e.target.value)} options={calls.exitTypes} hint="Shown in the attrition report as resigned, terminated or other." />
  return (
    <Dialog open onClose={onClose} title={title} sub={desc[kind]} busy={busy} width={520}
      icon={kind === 'exit' ? 'logOut' : kind === 'notice' || kind === 'cancel' ? 'calendarClock' : 'calendarCheck'} tone={variant === 'danger' ? 'danger' : 'brand'}
      footer={<>
        <PanelButton onClick={onClose}>Cancel</PanelButton>
        <PanelButton variant={variant} busy={busy} onClick={() => void ok()}>{cta}</PanelButton>
      </>}>
      <FieldGrid columns={1}>
        {kind === 'confirm' && <Input label="Confirmation date" type="date" value={conf} onChange={(e) => setConf(e.target.value)} />}
        {kind === 'extend' && <Input label="New probation end date" required type="date" value={ext} onChange={(e) => setExt(e.target.value)} error={tried && !ext ? 'New probation end date is required' : undefined} />}
        {kind === 'notice' && <>
          {typeSelect}
          <Input label="Notice start date" type="date" value={nStart} onChange={(e) => setNStart(e.target.value)} />
          <Input label="Last working day" required type="date" value={lwd} onChange={(e) => setLwd(e.target.value)}
            error={lwdBad ? 'Last working day must be on or after the notice start' : tried && !lwd ? 'Last working day is required' : undefined} />
          <Textarea label="Reason" value={reason} maxLength={100} rows={2} placeholder="Optional" onChange={(e) => setReason(e.target.value)} hint={`${reason.length} / 100`} />
        </>}
        {kind === 'exit' && <>
          {typeSelect}
          <Input label="Last working day" required type="date" value={xLwd} onChange={(e) => setXLwd(e.target.value)} error={tried && !xLwd ? 'Last working day is required' : undefined} />
          <Input label="Exit reason" value={xReason} maxLength={100} placeholder="Optional" onChange={(e) => setXReason(e.target.value)} />
        </>}
      </FieldGrid>
    </Dialog>
  )
}
