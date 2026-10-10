// Shift planner › Rotation patterns (design §1.6): name, the pattern as chips (A A B B C C WO), cycle length, company or
// department, last changed by; a drawer with the pattern builder (the same one as the planner's step 3). Company-wide
// planners keep company patterns; a department head keeps their departments' own and sees the company's.
import { useMemo, useState } from 'react'
import { Button, CellActions, CellStack, Table, errorText, type TableColumn } from '@/design/kit/display'
import { Dialog, Input, PanelButton, Select, SidePanel, useToast } from '@/design/kit/overlays'
import { fmtShort } from '@/design/dc/dates'
import { errorCodeOf } from '@/core/api/featureNotReady'
import type { PatternDay, RotationTemplate } from '../../api/rosterTypes'
import { useDeleteTemplate, useSaveTemplate } from '../../api/useRosters'
import type { Department } from '../../api/useOrg'
import { PatternBuilder } from './PatternBuilder'
import { patternCodes, patternDay, patternToken, type ShiftLite } from './plannerModel'

interface Draft { id: string | null; name: string; departmentId: string | null; days: PatternDay[]; repeats: boolean }

export function PatternChips({ days, shifts, max = 14 }: { days: readonly PatternDay[]; shifts: ReadonlyMap<string, ShiftLite>; max?: number }) {
  const codes = patternCodes(days, shifts)
  return (
    <span className="spl-chips" aria-label={codes.join(' ')}>
      {days.slice(0, max).map((d, i) => {
        const t = patternToken(d)
        return <span key={i} className="spl-code spl-code--sm" data-tone={t === 'WO' ? 'wo' : shifts.get(t ?? '')?.tone ?? '1'}>{codes[i]}</span>
      })}
      {days.length > max && <span className="apl-muted">+{days.length - max}</span>}
    </span>
  )
}

export function PatternList({ companyId, templates, loading, shifts, departments, companyWide, canPlan }: {
  companyId: string
  templates: RotationTemplate[]
  loading: boolean
  shifts: ShiftLite[]
  /** Departments the planner may keep patterns for (their own when not company-wide). */
  departments: Department[]
  companyWide: boolean
  canPlan: boolean
}) {
  const toast = useToast()
  const save = useSaveTemplate(), remove = useDeleteTemplate()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [confirm, setConfirm] = useState<RotationTemplate | null>(null)
  const shiftMap = useMemo(() => new Map(shifts.map((s) => [s.id, s])), [shifts])
  const deptName = useMemo(() => new Map(departments.map((d) => [d.id, d.name])), [departments])

  const openNew = () => setDraft({
    id: null, name: '', departmentId: companyWide ? null : departments[0]?.id ?? null, repeats: true,
    days: shifts.length ? [...shifts.slice(0, 3).flatMap((s) => [patternDay(s.id), patternDay(s.id)]), patternDay('WO')] : [patternDay('WO')],
  })
  const edit = (t: RotationTemplate) => setDraft({ id: t.id, name: t.name, departmentId: t.departmentId, days: t.days.map((d) => ({ ...d })), repeats: t.repeats })
  const nameProblem = !draft ? null : !draft.name.trim() ? 'Give the pattern a name' : draft.name.trim().length > 80 ? 'Keep the name under 80 characters' : null
  const blocked = nameProblem ?? (!draft?.days.length ? 'Add at least one day' : !companyWide && !draft?.departmentId ? 'Pick your department' : null)

  const doSave = async () => {
    if (!draft || blocked) return
    try {
      await save.mutateAsync({ companyId, id: draft.id, body: { name: draft.name.trim(), departmentId: draft.departmentId, repeats: draft.repeats, days: draft.days } })
      toast.success(draft.id ? `${draft.name.trim()} saved` : `${draft.name.trim()} added`)
      setDraft(null)
    } catch (e) {
      toast.error('Couldn’t save the pattern', { detail: errorCodeOf(e) === 'TEMPLATE_NAME_TAKEN' ? 'A pattern with this name already exists.' : errorText(e, 'Try again in a moment.') })
    }
  }
  const doDelete = async () => {
    if (!confirm) return
    try { await remove.mutateAsync({ id: confirm.id, companyId }); toast.success(`${confirm.name} deleted`); setConfirm(null) } catch (e) { toast.error('Couldn’t delete the pattern', { detail: errorText(e, 'Try again in a moment.') }) }
  }

  const columns: TableColumn<RotationTemplate>[] = [
    { key: 'name', header: 'Pattern', primary: true, render: (t) => t.name },
    { key: 'days', header: 'Cycle', render: (t) => <PatternChips days={t.days} shifts={shiftMap} /> },
    { key: 'len', header: 'Length', render: (t) => <span className="apl-num">{`${t.days.length} ${t.days.length === 1 ? 'day' : 'days'}${t.repeats ? '' : ', once'}`}</span> },
    { key: 'for', header: 'For', render: (t) => (t.departmentId ? deptName.get(t.departmentId) ?? 'A department' : 'Whole company') },
    { key: 'by', header: 'Last changed', render: (t) => <CellStack primary={t.updatedByName ?? '—'} secondary={t.updatedAt ? fmtShort(t.updatedAt.slice(0, 10)) : undefined} /> },
    {
      key: 'actions', header: <span className="uk-sr">Actions</span>, label: 'Actions', align: 'right', render: (t) => (
        t.editable && canPlan ? (
          <CellActions>
            <Button variant="secondary" size={30} onClick={() => edit(t)} aria-label={`Edit ${t.name}`}>Edit</Button>
            <Button variant="ghost" size={30} onClick={() => setConfirm(t)} aria-label={`Delete ${t.name}`}>Delete</Button>
          </CellActions>
        ) : <span className="apl-muted">View only</span>
      ),
    },
  ]

  return (
    <>
      <Table label="Rotation patterns" columns={columns} rows={templates} rowKey={(t) => t.id} loading={loading} mobile="cards"
        empty={(
          <div className="spl-empty">
            <strong>No patterns yet</strong>
            <span className="apl-muted">A pattern is a cycle of shifts and days off, such as A A B B C C WO.</span>
            {canPlan && <Button icon="plus" onClick={openNew}>New pattern</Button>}
          </div>
        )} />
      {canPlan && templates.length > 0 && <div className="spl-under"><Button variant="secondary" icon="plus" onClick={openNew}>New pattern</Button></div>}

      <SidePanel open={!!draft} onClose={() => setDraft(null)} busy={save.isPending} width={560}
        title={draft?.id ? `Edit ${draft.name || 'pattern'}` : 'New rotation pattern'}
        sub="A cycle of shifts and days off. Each person starts at a different day of it."
        footer={(
          <>
            <PanelButton variant="secondary" size="lg" onClick={() => setDraft(null)} disabled={save.isPending}>Cancel</PanelButton>
            <PanelButton variant="primary" size="lg" busy={save.isPending} blockedReason={blocked} onClick={doSave}>{draft?.id ? 'Save pattern' : 'Add pattern'}</PanelButton>
          </>
        )}>
        {draft && (
          <div className="apl-form">
            <Input label="Name" required placeholder="e.g. Technical team rotation" value={draft.name} maxLength={80} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            {!companyWide && departments.length > 1 && (
              <Select label="For" value={draft.departmentId ?? ''} onChange={(e) => setDraft({ ...draft, departmentId: e.target.value || null })}
                options={departments.map((d) => ({ value: d.id, label: d.name }))} />
            )}
            {!shifts.length && <p className="spl-note" data-tone="amber">There are no shifts yet. Add shifts in Shift Schedules first.</p>}
            <PatternBuilder days={draft.days} repeats={draft.repeats} shifts={shifts} onChange={(days, repeats) => setDraft({ ...draft, days, repeats })} />
          </div>
        )}
      </SidePanel>

      <Dialog open={!!confirm} onClose={() => setConfirm(null)} busy={remove.isPending} tone="danger" icon="trash"
        title={`Delete ${confirm?.name ?? 'this pattern'}?`} sub="Rosters made with it keep their own copy of the pattern."
        footer={(
          <>
            <PanelButton variant="secondary" onClick={() => setConfirm(null)} disabled={remove.isPending}>Cancel</PanelButton>
            <PanelButton variant="danger" busy={remove.isPending} onClick={doDelete}>Delete pattern</PanelButton>
          </>
        )} />
    </>
  )
}
