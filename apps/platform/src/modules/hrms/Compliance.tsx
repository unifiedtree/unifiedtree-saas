import { InspectorSessions } from './compliance/InspectorSessions'
import { FilingCalendar } from './compliance/FilingCalendar'
import React, { useId, useMemo, useState } from 'react'
import { Plus, Check, FileCheck2, RotateCw } from 'lucide-react'
import { usePermission } from '@unifiedtree/sdk'
import { Modal } from '@unifiedtree/ui-kit'
import { useToast } from '@/shared/hooks/useToast'
import { HrButton, HrStatusPill, TableCard, HrDrawer, type PillTone } from '@/shared/components/hr'
import { DateField } from '@/shared/components/calendar'
import { ModulePage, Views, useView, StatRow, State, Note, dmy, todayIso } from '@/design/module/ModuleKit'
import { hrPaginationFooter } from '@/shared/components/HrPagination'
import { useCompanies } from './api/useOrg'
import { useEmployeeDirectory } from './api/useWorkforce'
import {
  useComplianceItems, useCreateComplianceItem, useMarkComplianceDone,
  useStatutoryFilings, useCreateFiling, useFileFiling,
  usePoshComplaints, useCreatePoshComplaint, useUpdatePoshStatus,
  inr, FILING_TYPES, POSH_STATUSES, POSH_SEVERITIES, COMPLIANCE_PAGE_SIZE,
  type ComplianceStatus, type FilingType, type FilingStatus, type PoshStatus, type StatutoryFiling,
} from './api/useCompliance'

const ITEM_TONE: Record<ComplianceStatus, PillTone> = { PENDING: 'warn', DONE: 'ok', OVERDUE: 'red' }
const FILING_TONE: Record<FilingStatus, PillTone> = { DUE: 'warn', FILED: 'ok', LATE: 'red' }
const POSH_TONE: Record<PoshStatus, PillTone> = {
  RECEIVED: 'info', UNDER_INQUIRY: 'warn', RESOLVED: 'ok', DISMISSED: 'gray',
}
// Human wording for the enum values. LATE is only ever set by
// ComplianceService.fileFiling when the return was recorded after its due date,
// so it reads "Filed late" rather than suggesting the return is still open.
const ITEM_LABEL: Record<ComplianceStatus, string> = { PENDING: 'Pending', DONE: 'Done', OVERDUE: 'Overdue' }
const FILING_LABEL: Record<FilingStatus, string> = { DUE: 'Due', FILED: 'Filed', LATE: 'Filed late' }
const POSH_LABEL: Record<PoshStatus, string> = {
  RECEIVED: 'Received', UNDER_INQUIRY: 'Under inquiry', RESOLVED: 'Resolved', DISMISSED: 'Dismissed',
}

// Today in the browser's calendar: toISOString() is UTC and gave yesterday before 5:30 am IST.
const today = todayIso
const fmtDate = (d?: string | null) => (d ? dmy(d) : '—')
const errMessage = (e: unknown, fallback: string) => (e as Error)?.message || fallback

type Tab = 'calendar' | 'filings' | 'posh' | 'inspector'

export const Compliance: React.FC = () => {
  const canRead = usePermission('hrms.compliance.read')
  const canWrite = usePermission('hrms.compliance.write')
  const canPosh = usePermission('hrms.compliance.posh')
  const canInspectorRead = usePermission('hrms.compliance.inspector.read')

  const { data: companies = [] } = useCompanies()
  const [companyId, setCompanyId] = useState('')
  const activeCompany = companyId || companies[0]?.id || ''

  // 2026-09-10: gate the Calendar and Filings tabs on hrms.compliance.read
  // (the permission their data endpoints enforce). The route admits anyOf
  // [compliance.read, compliance.write, compliance.posh], so a POSH-only
  // principal used to land on the default 'calendar' tab, whose GET
  // /v1/compliance/items 403s, and see a permanently empty calendar instead
  // of the POSH tab they do have access to.
  //
  // The list endpoints (items, filings, calendar-events) all need
  // hrms.compliance.read, so write alone doesn't open these views.
  const tabs = [
    ...(canRead ? [{ key: 'calendar', label: 'Compliance calendar', icon: 'calendarDays' }, { key: 'filings', label: 'Statutory filings', icon: 'fileText' }] : []),
    ...(canPosh ? [{ key: 'posh', label: 'POSH register', icon: 'shield' }] : []),
    ...(canRead || canInspectorRead ? [{ key: 'inspector', label: 'Inspector access', icon: 'lock' }] : []),
  ]
  const [activeTab, setTab] = useView(tabs.map((t) => t.key)) as [Tab, (k: string) => void]

  // The add forms used to sit permanently open above each table. They now
  // live in a drawer opened from the header's primary action, which follows
  // the active tab and the permission its POST endpoint enforces
  // (items/filings: hrms.compliance.write, posh: hrms.compliance.posh).
  const [adding, setAdding] = useState<Tab | null>(null)
  const closeAdd = () => setAdding(null)
  const headerAction =
    activeTab === 'calendar' && canWrite ? <HrButton onClick={() => setAdding('calendar')}><Plus size={15} /> Add obligation</HrButton>
    : activeTab === 'filings' && canWrite ? <HrButton onClick={() => setAdding('filings')}><Plus size={15} /> Schedule filing</HrButton>
    : activeTab === 'posh' && canPosh ? <HrButton onClick={() => setAdding('posh')}><Plus size={15} /> Register complaint</HrButton>
    : undefined

  return (
    <ModulePage crumb="Compliance" title="Statutory compliance" subtitle="Due dates, statutory filings, the POSH register and read-only access for inspectors." actions={headerAction}>
      <div style={{ display: 'grid', gap: 16, minWidth: 0 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          {tabs.length > 1 ? <Views items={tabs} active={activeTab} onChange={(k) => { setTab(k); setAdding(null) }} label="Compliance views" /> : <span />}
          {companies.length > 1 && (
            <select value={activeCompany} onChange={(e) => setCompanyId(e.target.value)} className="ut-select ut-select-sm w-56" aria-label="Company">
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
        </div>
        {tabs.length === 0 && <State kind="empty" icon="lock" title="No compliance access" description="Ask an admin if you look after statutory compliance." />}
        {activeTab === 'calendar' && <CalendarTab companyId={activeCompany} canWrite={canWrite} adding={adding === 'calendar'} onAddClose={closeAdd} />}
        {activeTab === 'filings' && <FilingsTab companyId={activeCompany} canWrite={canWrite} adding={adding === 'filings'} onAddClose={closeAdd} />}
        {activeTab === 'posh' && (canPosh ? <PoshTab companyId={activeCompany} adding={adding === 'posh'} onAddClose={closeAdd} /> : <PoshDenied />)}
        {activeTab === 'inspector' && (activeCompany ? <InspectorSessions key={activeCompany} companyId={activeCompany} /> : <State kind="loading" />)}
      </div>
    </ModulePage>
  )
}

// ── Shared form bits ─────────────────────────────────────────────────────────

/** Label + control pair; the control receives the generated id so every input is labelled. */
function FormField({ label, required, hint, error, children }: {
  label: string
  required?: boolean
  hint?: string
  error?: string
  children: (id: string) => React.ReactNode
}) {
  const id = useId()
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-[13px] font-semibold text-text-secondary">
        {label}{required && <span className="text-[#B91C1C]"> *</span>}
      </label>
      {children(id)}
      {error ? (
        <p role="alert" className="mt-1 text-xs font-medium text-[#B91C1C]">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-xs text-text-tertiary">{hint}</p>
      ) : null}
    </div>
  )
}

function FormError({ message }: { message: string | null }) {
  if (!message) return null
  return <p role="alert" className="rounded-xl border border-[#FCA5A5] bg-[#FEF2F2] px-3 py-2 text-xs font-medium text-[#B91C1C]">{message}</p>
}

/** In-table error row with a retry, used by all three registers. */
function TableErrorRow({ colSpan, what, onRetry }: { colSpan: number; what: string; onRetry: () => void }) {
  return (
    <tr>
      <td colSpan={colSpan} className="py-12 text-center">
        <div role="alert">
          <p className="text-sm font-semibold text-text-secondary">Could not load {what}</p>
          <p className="mt-1 text-xs text-text-tertiary">Check your connection and try again.</p>
        </div>
        <div className="mt-3 flex justify-center">
          <HrButton size="sm" variant="ghost" onClick={onRetry}><RotateCw size={14} /> Retry</HrButton>
        </div>
      </td>
    </tr>
  )
}

// ── Compliance calendar ──────────────────────────────────────────────────────

function CalendarTab({ companyId, canWrite, adding, onAddClose }: {
  companyId: string; canWrite: boolean; adding: boolean; onAddClose: () => void
}) {
  const { toast } = useToast()
  // Was hard-coded to page 0 with no control, so a tenant tracking more than
  // COMPLIANCE_PAGE_SIZE obligations could not see the rest of its calendar —
  // on a statutory screen, a due date you cannot see is a due date you miss.
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(COMPLIANCE_PAGE_SIZE)
  const { data, isLoading, isError, refetch } = useComplianceItems(companyId || undefined, page, pageSize)
  const markDone = useMarkComplianceDone()
  const items = useMemo(() => data?.content ?? [], [data])
  const total = data?.totalElements ?? 0
  const totalPages = data?.totalPages ?? 1

  // The company selector lives on the parent, so the only way to notice a
  // filter change down here is to watch the prop. Without this, switching to a
  // company with fewer obligations while on page 3 asks the server for a page
  // it does not have and the calendar renders empty.
  React.useEffect(() => { setPage(0) }, [companyId])

  const stats = useMemo(() => {
    const pending = items.filter((i) => i.status === 'PENDING').length
    const overdue = items.filter((i) => i.status === 'OVERDUE').length
    const done = items.filter((i) => i.status === 'DONE').length
    return { pending, overdue, done }
  }, [items])

  const onDone = async (id: string) => {
    try {
      await markDone.mutateAsync(id)
      toast('Marked done', 'success')
    } catch (e) {
      toast(errMessage(e, 'Could not mark the obligation done'), 'error')
    }
  }

  // Pending / Overdue / Completed are counted over the rows we hold, so they
  // describe the current page only — /v1/compliance exposes no status
  // aggregate to call instead. Say so rather than let "0 Overdue" on page 1
  // imply the company is clean when page 2 is full of late filings.
  const pageScoped = totalPages > 1 ? 'On this page' : undefined
  const cols = canWrite ? 6 : 5

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {isLoading ? <State kind="loading" height={96} /> : <StatRow tiles={[
        { icon: 'clock', color: 'orange', label: 'Pending', value: isError ? '—' : String(stats.pending), sub: pageScoped || 'Not yet due or done' },
        { icon: 'alertTriangle', color: 'red', label: 'Overdue', value: isError ? '—' : String(stats.overdue), sub: pageScoped || 'Past the due date' },
        { icon: 'checkCircle', color: 'green', label: 'Completed', value: isError ? '—' : String(stats.done), sub: pageScoped || 'Marked done' },
      ]} />}

      <TableCard
        footer={isError ? undefined : hrPaginationFooter({
          page, pageSize, totalElements: total, totalPages, onPageChange: setPage,
          onPageSizeChange: setPageSize,
        })}
      >
        <table className="hr-table">
          <thead>
            <tr>
              <th>Obligation</th>
              <th>Category</th>
              <th>Owner</th>
              <th>Due</th>
              <th>Status</th>
              {canWrite && <th className="text-right">Action</th>}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(4)].map((_, i) => <tr key={i}><td colSpan={cols} className="py-3"><div className="h-5 w-full animate-pulse rounded bg-bg-base" /></td></tr>)
            ) : isError ? (
              <TableErrorRow colSpan={cols} what="compliance items" onRetry={() => refetch()} />
            ) : items.length === 0 ? (
              <tr><td colSpan={cols} className="!p-0"><State kind="empty" icon="calendarDays" title="No obligations yet" description="Track statutory due dates here so nothing is missed." /></td></tr>
            ) : items.map((i) => (
              <tr key={i.id}>
                <td className="font-medium text-text-primary">{i.title}</td>
                <td className="text-text-secondary">{i.category || '—'}</td>
                <td className="text-text-secondary">{i.ownerName || '—'}</td>
                <td className="text-text-secondary">{fmtDate(i.dueDate)}</td>
                <td><HrStatusPill tone={ITEM_TONE[i.status]}>{ITEM_LABEL[i.status] ?? i.status}</HrStatusPill></td>
                {canWrite && (
                  <td>
                    <div className="flex items-center justify-end">
                      {i.status !== 'DONE' && (
                        <HrButton size="sm" variant="ghost" onClick={() => onDone(i.id)} disabled={markDone.isPending}><Check size={14} /> Mark done</HrButton>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </TableCard>

      <FilingCalendar companyId={companyId} />

      {canWrite && adding && <AddObligationDrawer companyId={companyId} onClose={onAddClose} />}
    </div>
  )
}

function AddObligationDrawer({ companyId, onClose }: { companyId: string; onClose: () => void }) {
  const { toast } = useToast()
  const create = useCreateComplianceItem()
  // 2026-09-10: gate the directory fetch on the permission it enforces
  // (hrms.employee.read). A custom role holding compliance.write alone
  // reached this page, and the Owner <select> silently showed only
  // "Unassigned" because the 403 fell through to `employees = []`. Now the
  // fetch is skipped and the dropdown says why.
  const canReadEmployees = usePermission('hrms.employee.read')
  const { data: dir, isError: dirError } = useEmployeeDirectory(
    { companyId, pageSize: 100 },
    { enabled: !!companyId && canReadEmployees },
  )
  const employees = dir?.content ?? []

  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('')
  const [dueDate, setDueDate] = useState(today())
  const [frequency, setFrequency] = useState('')
  const [ownerId, setOwnerId] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  // ComplianceItemRequest: @NotBlank title, @NotNull dueDate.
  const titleError = submitted && !title.trim() ? 'Give the obligation a title' : undefined
  const dueError = submitted && !dueDate ? 'Pick a due date' : undefined
  const busy = create.isPending
  const close = () => { if (!busy) onClose() }

  const onSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    setSubmitted(true)
    setServerError(null)
    if (!title.trim() || !dueDate) return
    try {
      await create.mutateAsync({
        companyId: companyId || undefined,
        title: title.trim(),
        category: category.trim() || undefined,
        dueDate,
        frequency: frequency.trim() || undefined,
        ownerId: ownerId || undefined,
      })
      toast('Compliance item added', 'success')
      onClose()
    } catch (err) {
      setServerError(errMessage(err, 'Could not add the compliance item'))
    }
  }

  return (
    <HrDrawer
      title="Add compliance obligation"
      onClose={close}
      footer={<>
        <HrButton variant="ghost" onClick={close} disabled={busy}>Cancel</HrButton>
        <HrButton type="submit" form="compliance-item-form" disabled={busy}>{busy ? 'Adding…' : 'Add obligation'}</HrButton>
      </>}
    >
      <form id="compliance-item-form" onSubmit={onSubmit} className="space-y-4" noValidate>
        <FormField label="Obligation" required error={titleError}>
          {(id) => <input id={id} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. PF monthly return" maxLength={200} className="ut-input" autoFocus />}
        </FormField>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Due date" required error={dueError}>
            {(id) => <DateField id={id} value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="ut-input" format="short" icon={false} clearable />}
          </FormField>
          <FormField label="Frequency">
            {(id) => <input id={id} value={frequency} onChange={(e) => setFrequency(e.target.value)} placeholder="e.g. Monthly" maxLength={30} className="ut-input" />}
          </FormField>
        </div>
        <FormField label="Category">
          {(id) => <input id={id} value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Statutory" maxLength={50} className="ut-input" />}
        </FormField>
        <FormField
          label="Owner"
          hint={!canReadEmployees ? 'Your role cannot browse the employee directory' : dirError ? 'Could not load the employee directory' : undefined}
        >
          {(id) => (
            <select
              id={id}
              value={ownerId}
              onChange={(e) => setOwnerId(e.target.value)}
              className="ut-select"
              disabled={!canReadEmployees}
            >
              <option value="">
                {canReadEmployees ? 'Unassigned' : 'Cannot browse employees'}
              </option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>{[e.firstName, e.lastName].filter(Boolean).join(' ')}{e.employeeCode ? ` (${e.employeeCode})` : ''}</option>
              ))}
            </select>
          )}
        </FormField>
        <FormError message={serverError} />
      </form>
    </HrDrawer>
  )
}

// ── Statutory filings ────────────────────────────────────────────────────────

function FilingsTab({ companyId, canWrite, adding, onAddClose }: {
  companyId: string; canWrite: boolean; adding: boolean; onAddClose: () => void
}) {
  // Was hard-coded to page 0 with no control. The filings ledger is append-only
  // and grows every month, so past COMPLIANCE_PAGE_SIZE rows the older PF / ESI
  // / TDS history simply disappeared from the product — including anything
  // still DUE.
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(COMPLIANCE_PAGE_SIZE)
  const { data, isLoading, isError, refetch } = useStatutoryFilings(companyId || undefined, page, pageSize)
  const filings = data?.content ?? []
  const total = data?.totalElements ?? 0
  const totalPages = data?.totalPages ?? 1
  const [filing, setFiling] = useState<StatutoryFiling | null>(null)

  // The company selector lives on the parent, so watching the prop is the only
  // way to notice a filter change down here. Without this, switching to a
  // company with a shorter ledger while on page 3 asks for a page the server
  // does not have and the table renders empty.
  React.useEffect(() => { setPage(0) }, [companyId])

  const cols = canWrite ? 8 : 7

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <TableCard
        footer={isError ? undefined : hrPaginationFooter({
          page, pageSize, totalElements: total, totalPages, onPageChange: setPage,
          onPageSizeChange: setPageSize,
        })}
      >
        <table className="hr-table">
          <thead>
            <tr>
              <th>Type</th>
              <th>Period</th>
              <th>Amount</th>
              <th>Due</th>
              <th>Filed</th>
              <th>Reference</th>
              <th>Status</th>
              {canWrite && <th className="text-right">Action</th>}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(4)].map((_, i) => <tr key={i}><td colSpan={cols} className="py-3"><div className="h-5 w-full animate-pulse rounded bg-bg-base" /></td></tr>)
            ) : isError ? (
              <TableErrorRow colSpan={cols} what="statutory filings" onRetry={() => refetch()} />
            ) : filings.length === 0 ? (
              <tr><td colSpan={cols} className="!p-0"><State kind="empty" icon="fileText" title="No filings recorded" description="Schedule PF, ESI and TDS filings to track their deadlines." /></td></tr>
            ) : filings.map((f) => (
              <tr key={f.id}>
                <td><HrStatusPill tone="info">{f.filingType}</HrStatusPill></td>
                <td className="text-text-secondary">{f.period || '—'}</td>
                <td className="font-semibold tabular-nums text-text-primary">{f.amount != null ? inr(f.amount) : '—'}</td>
                <td className="text-text-secondary">{fmtDate(f.dueDate)}</td>
                <td className="text-text-secondary">{fmtDate(f.filedDate)}</td>
                <td className="text-text-secondary">{f.referenceNo || '—'}</td>
                <td><HrStatusPill tone={FILING_TONE[f.status]}>{FILING_LABEL[f.status] ?? f.status}</HrStatusPill></td>
                {canWrite && (
                  <td>
                    <div className="flex items-center justify-end">
                      {f.status === 'DUE' && (
                        <HrButton size="sm" onClick={() => setFiling(f)}><FileCheck2 size={14} /> Mark filed</HrButton>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </TableCard>

      {canWrite && adding && <AddFilingDrawer companyId={companyId} onClose={onAddClose} />}
      {canWrite && <MarkFiledModal filing={filing} onClose={() => setFiling(null)} />}
    </div>
  )
}

function AddFilingDrawer({ companyId, onClose }: { companyId: string; onClose: () => void }) {
  const { toast } = useToast()
  const create = useCreateFiling()
  const [filingType, setFilingType] = useState<FilingType>('PF')
  const [period, setPeriod] = useState('')
  const [amount, setAmount] = useState('')
  const [dueDate, setDueDate] = useState(today())
  const [submitted, setSubmitted] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  // StatutoryFilingRequest: @NotNull filingType + dueDate, period @Size(max=20),
  // amount @PositiveOrZero.
  const parsedAmount = amount.trim() ? Number(amount) : null
  const amountInvalid = parsedAmount != null && (!Number.isFinite(parsedAmount) || parsedAmount < 0)
  const dueError = submitted && !dueDate ? 'Pick a due date' : undefined
  const amountError = submitted && amountInvalid ? 'Enter an amount of zero or more' : undefined
  const busy = create.isPending
  const close = () => { if (!busy) onClose() }

  const onSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    setSubmitted(true)
    setServerError(null)
    if (!dueDate || amountInvalid) return
    try {
      await create.mutateAsync({
        companyId: companyId || undefined,
        filingType,
        period: period.trim() || undefined,
        amount: parsedAmount,
        dueDate,
      })
      toast('Filing scheduled', 'success')
      onClose()
    } catch (err) {
      setServerError(errMessage(err, 'Could not schedule the filing'))
    }
  }

  return (
    <HrDrawer
      title="Schedule statutory filing"
      onClose={close}
      footer={<>
        <HrButton variant="ghost" onClick={close} disabled={busy}>Cancel</HrButton>
        <HrButton type="submit" form="statutory-filing-form" disabled={busy}>{busy ? 'Scheduling…' : 'Schedule filing'}</HrButton>
      </>}
    >
      <form id="statutory-filing-form" onSubmit={onSubmit} className="space-y-4" noValidate>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Filing type" required>
            {(id) => (
              <select id={id} value={filingType} onChange={(e) => setFilingType(e.target.value as FilingType)} className="ut-select">
                {FILING_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            )}
          </FormField>
          <FormField label="Due date" required error={dueError}>
            {(id) => <DateField id={id} value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="ut-input" format="short" icon={false} clearable />}
          </FormField>
        </div>
        <FormField label="Period" hint="Up to 20 characters, e.g. 2026-05">
          {(id) => <input id={id} value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="e.g. 2026-05" maxLength={20} className="ut-input" />}
        </FormField>
        <FormField label="Amount (₹)" error={amountError} hint="Optional">
          {(id) => <input id={id} type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Optional" className="ut-input" />}
        </FormField>
        <FormError message={serverError} />
      </form>
    </HrDrawer>
  )
}

function MarkFiledModal({ filing, onClose }: { filing: StatutoryFiling | null; onClose: () => void }) {
  const { toast } = useToast()
  const file = useFileFiling()
  const [referenceNo, setReferenceNo] = useState('')
  const [serverError, setServerError] = useState<string | null>(null)
  const refId = useId()
  const busy = file.isPending

  // Reset the form each time a different filing is opened.
  React.useEffect(() => { setReferenceNo(''); setServerError(null) }, [filing?.id])

  // Cancel / Esc / the close button must abort — marking a statutory return as
  // "filed" when the user backed out creates a false compliance record, which
  // is exactly what an inspector would catch (2026-09-08 audit). Only the
  // explicit "Record filing" button calls the endpoint.
  const close = () => { if (!busy) onClose() }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!filing) return
    setServerError(null)
    try {
      await file.mutateAsync({ id: filing.id, referenceNo: referenceNo.trim() || undefined })
      toast('Filing recorded', 'success')
      onClose()
    } catch (err) {
      setServerError(errMessage(err, 'Could not record the filing'))
    }
  }

  // ComplianceService.fileFiling stamps today's date and records the return as
  // LATE when today is after the due date — say so before the user commits.
  const pastDue = filing ? today() > filing.dueDate : false

  return (
    <Modal
      open={!!filing}
      onOpenChange={(o) => { if (!o) close() }}
      title="Mark filing as filed"
      description={filing ? `${filing.filingType}${filing.period ? ` · ${filing.period}` : ''} · due ${fmtDate(filing.dueDate)}${filing.amount != null ? ` · ${inr(filing.amount)}` : ''}` : undefined}
      size="md"
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label htmlFor={refId} className="mb-1 block text-[13px] font-semibold text-text-secondary">Challan / acknowledgement reference</label>
          <input id={refId} value={referenceNo} onChange={(e) => setReferenceNo(e.target.value)} maxLength={120} placeholder="Optional" className="ut-input" autoFocus />
          <p className="mt-1 text-xs text-text-tertiary">Recorded against the filing for inspectors and auditors.</p>
        </div>
        <p className="text-xs text-text-secondary">
          The filing is recorded as filed today.
          {pastDue && <> It is past its due date, so it will be recorded as <strong>Filed late</strong>.</>}
        </p>
        <FormError message={serverError} />
        <div className="flex justify-end gap-2">
          <HrButton type="button" variant="ghost" onClick={close} disabled={busy}>Cancel</HrButton>
          <HrButton type="submit" disabled={busy}><FileCheck2 size={14} /> {busy ? 'Recording…' : 'Record filing'}</HrButton>
        </div>
      </form>
    </Modal>
  )
}

// ── POSH register ────────────────────────────────────────────────────────────

function PoshDenied() {
  return <State kind="empty" icon="lock" title="Restricted register" description="The POSH complaints register holds sensitive information. It needs the POSH access permission." />
}

function PoshNotice() {
  return <Note tone="green">This register is confidential. Record only what is necessary and handle every entry in line with your POSH policy.</Note>
}

function PoshTab({ companyId, adding, onAddClose }: { companyId: string; adding: boolean; onAddClose: () => void }) {
  const { toast } = useToast()
  // Same defect as the other two registers: hard-coded page 0 with no control.
  // Not in the original bug list, but it is the third paginated table in this
  // file and an unreachable POSH case is a legal-register gap, so it is fixed
  // here alongside them.
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(COMPLIANCE_PAGE_SIZE)
  const { data, isLoading, isError, refetch } = usePoshComplaints(companyId || undefined, page, true, pageSize)
  const updateStatus = useUpdatePoshStatus()
  const complaints = data?.content ?? []
  const total = data?.totalElements ?? 0
  const totalPages = data?.totalPages ?? 1
  // Closing (RESOLVED / DISMISSED) is terminal, so it goes through a dialog.
  const [closing, setClosing] = useState<{ id: string; complaintNo: string; status: PoshStatus } | null>(null)

  React.useEffect(() => { setPage(0) }, [companyId])

  const onAdvance = async (id: string, complaintNo: string, status: PoshStatus) => {
    if (status === 'RESOLVED' || status === 'DISMISSED') {
      setClosing({ id, complaintNo, status })
      return
    }
    try {
      await updateStatus.mutateAsync({ id, status })
      toast('Status updated', 'success')
    } catch (e) {
      toast(errMessage(e, 'Could not update the status'), 'error')
    }
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <PoshNotice />

      <TableCard
        footer={isError ? undefined : hrPaginationFooter({
          page, pageSize, totalElements: total, totalPages, onPageChange: setPage,
          onPageSizeChange: setPageSize,
        })}
      >
        <table className="hr-table">
          <thead>
            <tr>
              <th>Complaint #</th>
              <th>Filed</th>
              <th>Severity</th>
              <th>Status</th>
              <th>Resolved</th>
              <th className="text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(3)].map((_, i) => <tr key={i}><td colSpan={6} className="py-3"><div className="h-5 w-full animate-pulse rounded bg-bg-base" /></td></tr>)
            ) : isError ? (
              <TableErrorRow colSpan={6} what="the POSH register" onRetry={() => refetch()} />
            ) : complaints.length === 0 ? (
              <tr><td colSpan={6} className="!p-0"><State kind="empty" icon="shield" title="No complaints on record" description="Registered complaints appear here with their inquiry status." /></td></tr>
            ) : complaints.map((c) => (
              <tr key={c.id}>
                <td className="font-medium text-text-primary">{c.complaintNo}</td>
                <td className="text-text-secondary">{fmtDate(c.filedDate)}</td>
                <td className="text-text-secondary">{c.severity || '—'}</td>
                <td><HrStatusPill tone={POSH_TONE[c.status]}>{POSH_LABEL[c.status] ?? c.status}</HrStatusPill></td>
                <td className="text-text-secondary">{fmtDate(c.resolvedDate)}</td>
                <td>
                  <div className="flex items-center justify-end gap-2">
                    {c.status !== 'RESOLVED' && c.status !== 'DISMISSED' ? (
                      <div className="w-40">
                        <select
                          value=""
                          onChange={(e) => { if (e.target.value) onAdvance(c.id, c.complaintNo, e.target.value as PoshStatus) }}
                          disabled={updateStatus.isPending}
                          className="ut-select ut-select-sm"
                          aria-label={`Update status of complaint ${c.complaintNo}`}
                        >
                          <option value="">Update status…</option>
                          {POSH_STATUSES.filter((s) => s !== c.status).map((s) => (
                            <option key={s} value={s}>{POSH_LABEL[s]}</option>
                          ))}
                        </select>
                      </div>
                    ) : (
                      <span className="text-xs text-text-tertiary">Closed</span>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableCard>

      {adding && <RegisterComplaintDrawer companyId={companyId} onClose={onAddClose} />}
      <ClosePoshModal target={closing} onClose={() => setClosing(null)} />
    </div>
  )
}

function RegisterComplaintDrawer({ companyId, onClose }: { companyId: string; onClose: () => void }) {
  const { toast } = useToast()
  const create = useCreatePoshComplaint()
  const [filedDate, setFiledDate] = useState(today())
  const [severity, setSeverity] = useState(POSH_SEVERITIES[1])
  const [description, setDescription] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  // PoshComplaintRequest: @NotNull filedDate; the register number is generated
  // server side when blank.
  const filedError = submitted && !filedDate ? 'Pick the filing date' : undefined
  const busy = create.isPending
  const close = () => { if (!busy) onClose() }

  const onSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    setSubmitted(true)
    setServerError(null)
    if (!filedDate) return
    try {
      await create.mutateAsync({
        companyId: companyId || undefined,
        filedDate,
        severity,
        description: description.trim() || undefined,
      })
      toast('Complaint registered', 'success')
      onClose()
    } catch (err) {
      setServerError(errMessage(err, 'Could not register the complaint'))
    }
  }

  return (
    <HrDrawer
      title="Register POSH complaint"
      onClose={close}
      footer={<>
        <HrButton variant="ghost" onClick={close} disabled={busy}>Cancel</HrButton>
        <HrButton type="submit" form="posh-complaint-form" disabled={busy}>{busy ? 'Registering…' : 'Register complaint'}</HrButton>
      </>}
    >
      <form id="posh-complaint-form" onSubmit={onSubmit} className="space-y-4" noValidate>
        <PoshNotice />
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Filed date" required error={filedError}>
            {(id) => <DateField id={id} value={filedDate} onChange={(e) => setFiledDate(e.target.value)} className="ut-input" format="short" icon={false} clearable />}
          </FormField>
          <FormField label="Severity">
            {(id) => (
              <select id={id} value={severity} onChange={(e) => setSeverity(e.target.value)} className="ut-select">
                {POSH_SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            )}
          </FormField>
        </div>
        <FormField label="Description" hint="Brief, factual summary. Visible only to holders of the POSH permission.">
          {(id) => <textarea id={id} value={description} onChange={(e) => setDescription(e.target.value)} rows={5} placeholder="Brief, factual summary" className="ut-input" />}
        </FormField>
        <FormError message={serverError} />
      </form>
    </HrDrawer>
  )
}

function ClosePoshModal({ target, onClose }: {
  target: { id: string; complaintNo: string; status: PoshStatus } | null
  onClose: () => void
}) {
  const { toast } = useToast()
  const updateStatus = useUpdatePoshStatus()
  const [resolution, setResolution] = useState('')
  const [serverError, setServerError] = useState<string | null>(null)
  const noteId = useId()
  const busy = updateStatus.isPending

  React.useEffect(() => { setResolution(''); setServerError(null) }, [target?.id, target?.status])

  // Cancel / Esc / the close button must not change the case. The old
  // window.prompt flow once collapsed Cancel and an empty answer together and
  // closed POSH cases by accident; on a confidential legal register that is an
  // unacceptable state change (2026-09-08 audit). Only the explicit submit
  // button calls the endpoint.
  const close = () => { if (!busy) onClose() }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!target) return
    setServerError(null)
    try {
      await updateStatus.mutateAsync({ id: target.id, status: target.status, resolution: resolution.trim() || undefined })
      toast('Status updated', 'success')
      onClose()
    } catch (err) {
      setServerError(errMessage(err, 'Could not close the complaint'))
    }
  }

  const verb = target?.status === 'DISMISSED' ? 'Dismiss' : 'Resolve'

  return (
    <Modal
      open={!!target}
      onOpenChange={(o) => { if (!o) close() }}
      title={`${verb} complaint ${target?.complaintNo ?? ''}`.trim()}
      description="Closing a complaint is final — its status cannot be changed afterwards."
      size="md"
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label htmlFor={noteId} className="mb-1 block text-[13px] font-semibold text-text-secondary">Resolution / closing note</label>
          <textarea id={noteId} value={resolution} onChange={(e) => setResolution(e.target.value)} rows={4} placeholder="Optional" className="ut-input" autoFocus />
        </div>
        <FormError message={serverError} />
        <div className="flex justify-end gap-2">
          <HrButton type="button" variant="ghost" onClick={close} disabled={busy}>Cancel</HrButton>
          <HrButton type="submit" variant={target?.status === 'DISMISSED' ? 'danger' : 'primary'} disabled={busy}>{busy ? 'Saving…' : `${verb} complaint`}</HrButton>
        </div>
      </form>
    </Modal>
  )
}
