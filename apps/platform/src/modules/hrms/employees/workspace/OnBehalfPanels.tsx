// The profile's "on behalf" actions (DECISIONS 17), on the kit SidePanel:
//   Apply leave on behalf  POST /v1/leave/apply/for/{employeeId}   hrms.leave.apply.others (BW-43, C0 hook)
//   New claim on behalf    POST /v1/expense/claims/for/{employeeId} hrms.expense.claim.others (BW-61)
//                          receipts: POST /v1/expense/receipts/for/{employeeId}
// Both go through the employee's normal approval chain and the employee is told; the server
// applies every rule it applies to the person's own request (balance, caps, receipts).
import { useState } from 'react'
import { Callout } from '@/design/kit/display'
import { FieldGrid, Input, PanelButton, Select, SidePanel, Textarea, useToast } from '@/design/kit/overlays'
import { fmtWd, istToday } from '@/design/dc/dates'
import { useLeaveTypes, type LeaveDuration } from '../../api/useLeave'
import { useApplyLeaveOnBehalf } from '../../api/shared/useApplyLeaveOnBehalf'
import { EXPENSE_CATEGORIES, receiptProblem, type ExpenseCategory } from '../../api/useExpense'
import { uploadReceiptFor, useClaimOnBehalf } from '../api/useProfileData'

export function ApplyLeaveForPanel({ open, onClose, employeeId, name, companyId }: { open: boolean; onClose: () => void; employeeId: string; name: string; companyId: string }) {
  if (!open) return null
  return <OpenLeave onClose={onClose} employeeId={employeeId} name={name} companyId={companyId} />
}

function OpenLeave({ onClose, employeeId, name, companyId }: { onClose: () => void; employeeId: string; name: string; companyId: string }) {
  const toast = useToast()
  const today = istToday()
  const types = useLeaveTypes(companyId)
  const apply = useApplyLeaveOnBehalf()
  const active = (types.data ?? []).filter((t) => t.isActive !== false)
  const [typeId, setTypeId] = useState('')
  const [from, setFrom] = useState(today)
  const [to, setTo] = useState(today)
  const [duration, setDuration] = useState<LeaveDuration>('FULL_DAY')
  const [reason, setReason] = useState('')
  const [tried, setTried] = useState(false)
  const leaveTypeId = typeId || active[0]?.id || ''
  const oneDay = from === to
  const problems = {
    type: !leaveTypeId ? 'Choose the leave type.' : null,
    dates: !from || !to ? 'Choose the days.' : to < from ? 'The last day is before the first day.' : null,
  }
  const blocked = problems.type || problems.dates
  const save = () => {
    setTried(true)
    if (blocked || apply.isPending) return
    apply.mutateAsync({ employeeId, leaveTypeId, startDate: from, endDate: to, duration: oneDay ? duration : 'FULL_DAY', ...(reason.trim() ? { reason: reason.trim() } : {}) })
      .then((r) => {
        if (!r.available) { toast.info('Applying for someone else isn’t switched on yet.'); return }
        toast.success(`Leave applied for ${name} · ${oneDay ? fmtWd(from) : `${fmtWd(from)} – ${fmtWd(to)}`}. It goes for approval as usual.`)
        onClose()
      })
      .catch((e) => toast.error('Couldn’t apply the leave', { detail: (e as Error)?.message }))
  }
  return (
    <SidePanel open onClose={onClose} title="Apply leave on behalf" sub={`For ${name}. It goes for approval as their own request would, and they’re told.`} busy={apply.isPending} closeLabel="Close panel"
      footer={<>
        <PanelButton size="lg" onClick={onClose}>Cancel</PanelButton>
        <PanelButton size="lg" variant="primary" busy={apply.isPending} blockedReason={blocked} tipAlign="end" onBlockedClick={() => setTried(true)} onClick={save}>Apply leave</PanelButton>
      </>}>
      {types.isError && <Callout tone="danger">Couldn’t load the leave types.</Callout>}
      <FieldGrid columns={2}>
        <Select label="Leave type" full value={leaveTypeId} onChange={(e) => setTypeId(e.target.value)} error={tried ? problems.type : undefined}
          options={active.length ? active.map((t) => ({ value: t.id, label: t.name })) : [{ value: '', label: types.isLoading ? 'Loading…' : 'No leave types' }]} />
        <Input label="From" type="date" value={from} onChange={(e) => { setFrom(e.target.value); if (to < e.target.value) setTo(e.target.value) }} />
        <Input label="To" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} error={tried ? problems.dates : undefined} />
        {oneDay && (
          <Select label="How much of the day" full value={duration} onChange={(e) => setDuration(e.target.value as LeaveDuration)}
            options={[{ value: 'FULL_DAY', label: 'Full day' }, { value: 'HALF_DAY_MORNING', label: 'First half' }, { value: 'HALF_DAY_AFTERNOON', label: 'Second half' }]} />
        )}
        <Textarea label="Reason (optional)" full rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Called in sick" />
      </FieldGrid>
    </SidePanel>
  )
}

/** "OFFICE_SUPPLIES" → "Office Supplies", as the Expenses page shows categories. */
const fmtCat = (c: string) => c.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase())

interface Line { category: ExpenseCategory; amount: string; date: string; description: string; file: File | null }
const blank = (date: string): Line => ({ category: 'TRAVEL', amount: '', date, description: '', file: null })

export function NewClaimForPanel({ open, onClose, employeeId, name }: { open: boolean; onClose: () => void; employeeId: string; name: string }) {
  if (!open) return null
  return <OpenClaim onClose={onClose} employeeId={employeeId} name={name} />
}

function OpenClaim({ onClose, employeeId, name }: { onClose: () => void; employeeId: string; name: string }) {
  const toast = useToast()
  const today = istToday()
  const submit = useClaimOnBehalf()
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<Line[]>([blank(today)])
  const [tried, setTried] = useState(false)
  const [uploading, setUploading] = useState(false)
  const busy = submit.isPending || uploading
  const lineProblem = (l: Line) => !(Number(l.amount) > 0) ? 'Enter an amount above 0.' : !l.date ? 'Choose the date.' : l.date > today ? 'The date can’t be in the future.' : l.file && receiptProblem(l.file) ? receiptProblem(l.file) : null
  const problem = !title.trim() ? 'Give the claim a title.' : lines.map(lineProblem).find(Boolean) || null
  const setLine = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)))
  const total = lines.reduce((n, l) => n + (Number(l.amount) || 0), 0)
  const save = async () => {
    setTried(true)
    if (problem || busy) return
    try {
      setUploading(true)
      const items = []
      for (const l of lines) {
        const stored = l.file ? await uploadReceiptFor(employeeId, l.file) : null
        items.push({ category: l.category, amount: Number(l.amount), expenseDate: l.date, ...(l.description.trim() ? { description: l.description.trim() } : {}), ...(stored ? { receiptUrl: stored.receiptUrl } : {}) })
      }
      setUploading(false)
      await submit.mutateAsync({ employeeId, title: title.trim(), ...(notes.trim() ? { notes: notes.trim() } : {}), items })
      toast.success(`Claim raised for ${name}. It goes to their approver as usual.`)
      onClose()
    } catch (e) {
      setUploading(false)
      toast.error('Couldn’t raise the claim', { detail: (e as Error)?.message })
    }
  }
  return (
    <SidePanel open onClose={onClose} title="New claim on behalf" sub={`For ${name}. It goes to their usual approver, and they’re told.`} busy={busy} closeLabel="Close panel" width={560}
      footer={<>
        <PanelButton size="lg" onClick={onClose}>Cancel</PanelButton>
        <PanelButton size="lg" variant="primary" busy={busy} blockedReason={problem} tipAlign="end" onBlockedClick={() => setTried(true)} onClick={() => void save()}>Raise claim · ₹{Math.round(total).toLocaleString('en-IN')}</PanelButton>
      </>}>
      <FieldGrid columns={1}>
        <Input label="Title" required value={title} maxLength={120} placeholder="e.g. Client visit travel" onChange={(e) => setTitle(e.target.value)} error={tried && !title.trim() ? 'Give the claim a title.' : undefined} />
      </FieldGrid>
      {lines.map((l, i) => (
        <div key={i} style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--u-ln2,#EDF1EF)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, fontSize: 13, fontWeight: 500, color: 'var(--u-ink2,#4A5A54)' }}>
            <span>Line {i + 1}</span>
            {lines.length > 1 && <PanelButton onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>Remove line</PanelButton>}
          </div>
          <FieldGrid columns={2}>
            <Select label="Category" value={l.category} onChange={(e) => setLine(i, { category: e.target.value as ExpenseCategory })}
              options={EXPENSE_CATEGORIES.map((c) => ({ value: c, label: fmtCat(c) }))} />
            <Input label="Amount (₹)" type="number" min={0} step="0.01" value={l.amount} onChange={(e) => setLine(i, { amount: e.target.value })}
              error={tried && !(Number(l.amount) > 0) ? 'Enter an amount above 0.' : undefined} />
            <Input label="Date" type="date" value={l.date} max={today} onChange={(e) => setLine(i, { date: e.target.value })}
              error={tried && (!l.date || l.date > today) ? 'Choose a date up to today.' : undefined} />
            <Input label="Description (optional)" value={l.description} maxLength={200} onChange={(e) => setLine(i, { description: e.target.value })} />
            <Input label="Receipt (optional)" type="file" full accept=".pdf,.png,.jpg,.jpeg" onChange={(e) => setLine(i, { file: e.target.files?.[0] ?? null })}
              error={l.file && receiptProblem(l.file) ? receiptProblem(l.file) : undefined} hint="PDF, PNG or JPEG, up to 10 MB. The category’s rules decide whether one is needed." />
          </FieldGrid>
        </div>
      ))}
      <div style={{ marginTop: 12 }}><PanelButton icon="plus" onClick={() => setLines((ls) => [...ls, blank(today)])}>Add a line</PanelButton></div>
      <FieldGrid columns={1}>
        <div style={{ marginTop: 16 }}>
          <Textarea label="Notes (optional)" rows={2} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </FieldGrid>
    </SidePanel>
  )
}
