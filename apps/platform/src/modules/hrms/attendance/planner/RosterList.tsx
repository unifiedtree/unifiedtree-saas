// Shift planner › Rosters (design §1.6 "Planner tab"): name · period · scope (department, building) · people · status
// (Draft / Published / Published · changes not published) · published by and on · Open, Export, Delete (drafts never
// published only).
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, CellActions, CellStack, StatusPill, Table, errorText, type TableColumn } from '@/design/kit/display'
import { Dialog, PanelButton, useToast } from '@/design/kit/overlays'
import { fmtShort } from '@/design/dc/dates'
import type { RosterSummary } from '../../api/rosterTypes'
import { downloadRosterExport, useDeleteRoster } from '../../api/useRosters'
import { periodLabel } from './plannerModel'

export function rosterStatus(r: Pick<RosterSummary, 'status' | 'hasUnpublishedChanges'>) {
  if (r.status === 'DRAFT') return { tone: 'neutral' as const, label: 'Draft' }
  return r.hasUnpublishedChanges ? { tone: 'warning' as const, label: 'Published · changes not published' } : { tone: 'success' as const, label: 'Published' }
}
export const scopeLabel = (r: Pick<RosterSummary, 'departmentName' | 'branchName'>) => [r.departmentName, r.branchName].filter(Boolean).join(' · ') || 'Whole company'

export function RosterList({ rosters, loading, canPlan }: { rosters: RosterSummary[]; loading: boolean; canPlan: boolean }) {
  const navigate = useNavigate()
  const toast = useToast()
  const remove = useDeleteRoster()
  const [confirm, setConfirm] = useState<RosterSummary | null>(null)
  const open = (r: RosterSummary) => navigate(`/hrms/shifts/planner/${r.id}`)
  const exportIt = async (r: RosterSummary) => {
    try { await downloadRosterExport(r, r.status === 'PUBLISHED' && !r.hasUnpublishedChanges) } catch (e) { toast.error('Couldn’t export the roster', { detail: errorText(e, 'Try again in a moment.') }) }
  }
  const doDelete = async () => {
    if (!confirm) return
    try { await remove.mutateAsync(confirm.id); toast.success(`${confirm.name} deleted`); setConfirm(null) } catch (e) { toast.error('Couldn’t delete the roster', { detail: errorText(e, 'Try again in a moment.') }) }
  }

  const columns: TableColumn<RosterSummary>[] = [
    { key: 'name', header: 'Roster', primary: true, render: (r) => <CellStack primary={r.name} secondary={r.source === 'IMPORT' ? 'Imported from Excel' : undefined} /> },
    { key: 'period', header: 'Period', render: (r) => <span className="apl-num">{periodLabel(r.startDate, r.endDate)}</span> },
    { key: 'scope', header: 'Scope', render: (r) => scopeLabel(r) },
    { key: 'people', header: 'People', numeric: true, render: (r) => <span className="apl-num">{r.memberCount}</span> },
    { key: 'status', header: 'Status', render: (r) => { const s = rosterStatus(r); return <StatusPill tone={s.tone}>{s.label}</StatusPill> } },
    {
      key: 'published', header: 'Published', render: (r) => (r.publishedAt
        ? <CellStack primary={r.publishedByName ?? '—'} secondary={`${fmtShort(r.publishedAt.slice(0, 10))} · version ${r.version}`} />
        : <span className="apl-muted">Not yet</span>),
    },
    {
      key: 'actions', header: <span className="uk-sr">Actions</span>, label: 'Actions', align: 'right', render: (r) => (
        <CellActions>
          <Button variant="secondary" size={30} onClick={() => open(r)} aria-label={`Open ${r.name}`}>Open</Button>
          <Button variant="ghost" size={30} icon="download" onClick={() => exportIt(r)} aria-label={`Export ${r.name}`}>Export</Button>
          {canPlan && r.canEdit && r.status === 'DRAFT' && r.version === 0 && (
            <Button variant="ghost" size={30} onClick={() => setConfirm(r)} aria-label={`Delete ${r.name}`}>Delete</Button>
          )}
        </CellActions>
      ),
    },
  ]

  return (
    <>
      <Table label="Rosters" columns={columns} rows={rosters} rowKey={(r) => r.id} loading={loading} mobile="cards" onRowClick={open}
        empty={(
          <div className="spl-empty">
            <strong>No rosters yet</strong>
            <span className="apl-muted">Plan one from a rotation pattern, or import your Excel roster.</span>
          </div>
        )} />
      <Dialog open={!!confirm} onClose={() => setConfirm(null)} busy={remove.isPending} tone="danger" icon="trash"
        title={`Delete ${confirm?.name ?? 'this draft'}?`} sub="It was never published, so no one has seen it. This can’t be undone."
        footer={(
          <>
            <PanelButton variant="secondary" onClick={() => setConfirm(null)} disabled={remove.isPending}>Cancel</PanelButton>
            <PanelButton variant="danger" busy={remove.isPending} onClick={doDelete}>Delete draft</PanelButton>
          </>
        )} />
    </>
  )
}
