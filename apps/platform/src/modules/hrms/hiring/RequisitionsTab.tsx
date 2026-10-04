// Hiring › Requisitions (P-HIRE; prototype PgTalent h-pipe tab 1): the roles being hired
// for, paged from the server (20 a page; the list used to stop at its first page).
//   - Open requisition (header button) and Edit open the requisition panel; Close stops a
//     role taking candidates. All need hrms.hiring.write, as the API does.
//   - The candidates count opens the role's pipeline (?tab=pipeline&role=).
// Location is free text (the API stores any place); the panel suggests the workspace's
// branches and the places already used, never a fixed list of cities.
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { usePermission } from '@unifiedtree/sdk'
import { apiJson } from '@/core/api/client'
import { Button, CellActions, Section, StatusPill, Table, type TableColumn } from '@/design/kit/display'
import { Pager } from '@/design/kit/data'
import { FieldGrid, Input, PanelButton, Select, SidePanel, Textarea, useToast } from '@/design/kit/overlays'
import { useCompanies, type Branch } from '../api/useOrg'
import {
  useRequisitions, useRequisition, useCreateRequisition, useUpdateRequisition, useCloseRequisition,
  EMPLOYMENT_TYPES, type JobRequisition,
} from '../api/useHiring'
import { REQUISITION_LABEL, REQUISITION_TONE, dayMon, fmtEnum, istTodayIso } from './hiringModel'

const PAGE = 20
const errText = (e: unknown, fallback: string) => (e instanceof Error && e.message) || fallback

/** Branch names and cities to suggest for Location (only with branch read: the list is permissioned). */
function useLocationSuggestions(requisitions: readonly JobRequisition[]) {
  const canBranches = usePermission('hrms.branch.read')
  const branches = useQuery({
    queryKey: ['hrms', 'branches', 'all'],
    queryFn: () => apiJson<Branch[]>('/v1/hrms/branches'),
    enabled: canBranches,
    staleTime: 5 * 60_000,
  })
  return useMemo(() => {
    const out = new Set<string>()
    for (const b of branches.data ?? []) { if (b.city) out.add(b.city); if (b.name) out.add(b.name) }
    for (const r of requisitions) if (r.location) out.add(r.location)
    return [...out].sort((a, b) => a.localeCompare(b))
  }, [branches.data, requisitions])
}

export function RequisitionsTab({ creating, onCreateDone }: { creating: boolean; onCreateDone: () => void }) {
  const toast = useToast()
  const canWrite = usePermission('hrms.hiring.write')
  const [page, setPage] = useState(0)
  const { data, isLoading, error, refetch, isFetching } = useRequisitions(page)
  const requisitions = useMemo(() => data?.content ?? [], [data])
  const total = data?.totalElements ?? 0
  const close = useCloseRequisition()
  const [editingId, setEditingId] = useState<string | null>(null)
  const today = istTodayIso()
  const suggestions = useLocationSuggestions(requisitions)

  const onClose = async (r: JobRequisition) => {
    try {
      await close.mutateAsync(r.id)
      toast.success('Requisition closed', { detail: `“${r.title}” no longer takes candidates.` })
    } catch (e) { toast.error('Couldn’t close the requisition', { detail: errText(e, 'Please try again.') }) }
  }

  const columns: TableColumn<JobRequisition>[] = [
    { key: 'title', header: 'Job title', primary: true, render: (r) => r.title },
    { key: 'openings', header: 'Openings', width: 110, render: (r) => <span className="hi-num">{r.openings}</span> },
    { key: 'location', header: 'Location', render: (r) => r.location || '—' },
    { key: 'type', header: 'Type', render: (r) => (r.employmentType ? fmtEnum(r.employmentType) : '—') },
    {
      key: 'candidates', header: 'Candidates', width: 120, render: (r) => (
        <Link to={`/hrms/hiring?tab=pipeline&role=${r.id}`} className="hi-link hi-num"
          aria-label={`${r.candidateCount} ${r.candidateCount === 1 ? 'candidate' : 'candidates'} for ${r.title}: open the pipeline`}>{r.candidateCount}</Link>
      ),
    },
    { key: 'status', header: 'Status', render: (r) => <StatusPill tone={REQUISITION_TONE[r.status]}>{REQUISITION_LABEL[r.status]}</StatusPill> },
    ...(canWrite ? [{
      key: 'actions', header: <span className="uk-sr">Actions</span>, label: 'Actions', align: 'right' as const, render: (r: JobRequisition) => (
        // Edit stays on closed rows: the update never touches the status, so a typo in a
        // closed requisition can still be corrected.
        <CellActions>
          <Button size={30} variant="secondary" onClick={() => setEditingId(r.id)} aria-label={`Edit ${r.title}`}>Edit</Button>
          {r.status !== 'CLOSED' && <Button size={30} variant="secondary" disabled={close.isPending} onClick={() => onClose(r)} aria-label={`Close ${r.title}`}>Close</Button>}
        </CellActions>
      ),
    }] : []),
  ]

  return (
    <>
      <Section title="Requisitions" body="flush" loading={isLoading} skeleton="table" error={error} onRetry={() => refetch()} retrying={isFetching}
        empty={!isLoading && !error && total === 0 ? { title: 'No requisitions yet', hint: 'Open your first requisition to start hiring.', icon: 'briefcase' } : undefined}
        footer={total > PAGE ? <Pager page={page} pageSize={PAGE} total={total} onPageChange={setPage} noun="requisitions" /> : undefined}>
        <Table label="Requisitions" columns={columns} rows={requisitions} rowKey={(r) => r.id} mobile="cards" />
      </Section>
      {creating && <RequisitionPanel onClose={onCreateDone} suggestions={suggestions} today={today} />}
      {editingId && <RequisitionPanel id={editingId} onClose={() => setEditingId(null)} suggestions={suggestions} today={today} />}
    </>
  )
}

/**
 * Open a requisition, or edit one (`id`). An edit re-reads the requisition from the server
 * (GET /v1/hiring/requisitions/{id}) so it changes what the server holds now, not a
 * cached list row.
 */
function RequisitionPanel({ id, onClose, suggestions, today }: { id?: string; onClose: () => void; suggestions: string[]; today: string }) {
  const toast = useToast()
  const editing = !!id
  const { data: companies = [] } = useCompanies()
  const loaded = useRequisition(id)
  const create = useCreateRequisition()
  const update = useUpdateRequisition()
  const busy = create.isPending || update.isPending
  const [companyId, setCompanyId] = useState('')
  const [form, setForm] = useState({ title: '', openings: '1', location: '', employmentType: editing ? '' : 'FULL_TIME', description: '' })
  const [titleError, setTitleError] = useState('')
  // Prefill once per requisition: keying on the loaded object would wipe what was typed on a background refetch.
  const [prefilled, setPrefilled] = useState<string | null>(null)
  const current = loaded.data
  useEffect(() => {
    if (!current || current.id === prefilled) return
    setForm({ title: current.title ?? '', openings: String(current.openings ?? 1), location: current.location ?? '', employmentType: current.employmentType ?? '', description: current.description ?? '' })
    setPrefilled(current.id)
  }, [current, prefilled])
  useEffect(() => { if (!editing && !companyId && companies.length) setCompanyId(companies[0].id) }, [editing, companies, companyId])

  // employmentType is free text on the server, so a requisition can carry a value that
  // isn't in the list. Keep it as an option, or saving would quietly rewrite it.
  const typeOptions = useMemo(() => {
    const known = EMPLOYMENT_TYPES as readonly string[]
    const all = form.employmentType && !known.includes(form.employmentType) ? [form.employmentType, ...known] : [...known]
    return all.map((t) => ({ value: t, label: fmtEnum(t) }))
  }, [form.employmentType])

  const submit = async (e?: FormEvent) => {
    e?.preventDefault()
    const title = form.title.trim()
    if (!title) { setTitleError('Give the requisition a title'); return }
    const openings = Math.max(1, parseInt(form.openings, 10) || 1)
    try {
      if (editing) {
        if (!current) return
        await update.mutateAsync({
          id: current.id,
          // PUT is a FULL REPLACE: fields left out are written back as empty, so the ones this
          // panel doesn't edit (company, department, hiring manager) are echoed from the record.
          companyId: current.companyId, departmentId: current.departmentId, hiringManagerId: current.hiringManagerId,
          title, openings, location: form.location.trim() || undefined, employmentType: form.employmentType || undefined,
          description: form.description.trim() || undefined,
        })
        toast.success('Requisition updated')
      } else {
        await create.mutateAsync({
          companyId: companyId || undefined, title, openings, location: form.location.trim() || undefined,
          employmentType: form.employmentType || undefined, description: form.description.trim() || undefined,
        })
        toast.success('Requisition opened', { detail: `“${title}” is taking candidates.` })
      }
      onClose()
    } catch (err) { toast.error(editing ? 'Couldn’t update the requisition' : 'Couldn’t open the requisition', { detail: errText(err, 'Please try again.') }) }
  }

  const sub = editing && current
    ? [REQUISITION_LABEL[current.status], `${current.candidateCount} ${current.candidateCount === 1 ? 'candidate' : 'candidates'}`,
      current.hiringManagerName ? `Hiring manager: ${current.hiringManagerName}` : null, current.createdAt ? `Opened ${dayMon(current.createdAt, today)}` : null].filter(Boolean).join(' · ')
    : 'Say what the role is and how many people you need.'
  return (
    <SidePanel open onClose={onClose} width={560} busy={busy} closeLabel="Close panel"
      title={editing ? 'Edit requisition' : 'Open requisition'} sub={sub}
      footer={<><PanelButton size="lg" onClick={onClose} disabled={busy}>Cancel</PanelButton>
        <PanelButton size="lg" variant="primary" busy={busy} disabled={editing && !current} onClick={() => submit()}>{editing ? 'Save changes' : 'Open requisition'}</PanelButton></>}>
      {editing && loaded.isLoading ? <p className="hi-small" role="status">Loading the requisition…</p>
        : editing && !current ? <p className="hi-copy" role="alert">{errText(loaded.error, 'This requisition could not be loaded. Close and try again.')}</p>
          : (
            <form id="requisition-form" onSubmit={submit} noValidate>
              <FieldGrid columns={2}>
                {!editing && companies.length > 1 && (
                  <Select id="req-company" label="Company" full value={companyId} onChange={(e) => setCompanyId(e.target.value)}
                    options={companies.map((c) => ({ value: c.id, label: c.name }))} />
                )}
                <Input id="req-title" label="Job title" full value={form.title} maxLength={200} placeholder="e.g. Senior Backend Engineer" error={titleError || undefined}
                  onChange={(e) => { setForm((f) => ({ ...f, title: e.target.value })); setTitleError('') }} />
                <Input id="req-openings" label="Openings" type="number" min={1} value={form.openings} onChange={(e) => setForm((f) => ({ ...f, openings: e.target.value }))} />
                <Select id="req-type" label="Type" value={form.employmentType} onChange={(e) => setForm((f) => ({ ...f, employmentType: e.target.value }))}
                  placeholder={editing ? 'Not set' : undefined} options={typeOptions} />
                <Input id="req-location" label="Location" full value={form.location} maxLength={150} placeholder="e.g. Bengaluru" list="req-location-options"
                  onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} />
                <Textarea id="req-description" label="Description" full rows={5} value={form.description} maxLength={5000}
                  placeholder="Responsibilities, must-have skills, interview loop…" onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
              </FieldGrid>
              <datalist id="req-location-options">{suggestions.map((s) => <option key={s} value={s} />)}</datalist>
            </form>
          )}
    </SidePanel>
  )
}
