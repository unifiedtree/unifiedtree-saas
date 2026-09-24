import React, { useState } from 'react'
import { Download } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { Drawer, EmptyState, Skeleton } from '@unifiedtree/ui-kit'
import { Can, P } from '@unifiedtree/sdk'
import { HrPageHeader, HrButton, HrStatusPill, TableCard, type PillTone, type FilterDef } from '@/shared/components/hr'
import { hrPaginationFooter, useClampedPage } from '@/shared/components/HrPagination'
import { useDebounce } from '@/shared/hooks/useDebounce'
import { useAuditEvents } from '@/modules/hrms/api/useAudit'
import type { AuditEventDto } from '@/modules/hrms/api/useAudit'

const ACTIONS = ['CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'EXPORT', 'ACCESS', 'PERMISSION_CHANGE']
/* Resource types the trail records. Enumerated rather than free text because
   the API matches on an exact value — a typo in a text box would silently
   return an empty trail, which on an audit screen reads as "nothing happened". */
const RESOURCES = ['EMPLOYEE', 'LEAVE_REQUEST', 'ATTENDANCE', 'PAYROLL_RUN', 'POLICY',
  'DOCUMENT', 'EXPENSE_CLAIM', 'USER', 'ROLE', 'COMPANY', 'DEPARTMENT', 'SETTINGS']
const PAGE_SIZE = 25

function actionTone(action: string): PillTone {
  if (action === 'CREATE') return 'ok'
  if (action === 'UPDATE') return 'info'
  if (action === 'DELETE') return 'red'
  if (action === 'EXPORT') return 'warn'
  return 'gray'
}

export const AuditLogs: React.FC = () => {
  const [actionFilter, setActionFilter] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  /* actor / resource / resourceId have always been supported by
     GET /v1/audit/events (see AuditFilters in useAudit.ts) but were never
     exposed. On a trail this long, "who did this" and "what did they touch"
     are the two questions an incident actually starts from. */
  const [actor, setActor] = useState('')
  const [resource, setResource] = useState('')
  const [resourceId, setResourceId] = useState('')
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(PAGE_SIZE)
  const [selected, setSelected] = useState<AuditEventDto | null>(null)

  /* Free-text filters are debounced so a request is not issued per keystroke.
     The select and the two dates apply immediately — they change in one
     discrete action, so there is nothing to wait for. */
  const debouncedActor = useDebounce(actor, 350)
  const debouncedResourceId = useDebounce(resourceId, 350)

  const filters = {
    ...(actionFilter ? { action: actionFilter } : {}),
    // Date semantics preserved exactly: the API takes an instant, the input
    // gives a yyyy-MM-dd, and the original converted with `new Date(x)`.
    ...(from ? { from: new Date(from).toISOString() } : {}),
    ...(to ? { to: new Date(to).toISOString() } : {}),
    ...(debouncedActor ? { actor: debouncedActor } : {}),
    ...(resource ? { resource } : {}),
    ...(debouncedResourceId ? { resourceId: debouncedResourceId } : {}),
    page,
    size: pageSize,
  }

  const { data, isLoading, error, refetch } = useAuditEvents(filters)
  const events = data?.data ?? []
  const meta = data?.meta
  const totalPages = meta ? Math.ceil(meta.total / pageSize) : 0

  const resetPage = () => setPage(0)
  /* Every filter is its own useState slot, so FilterBar's default clear-all
     (one onChange('') per active filter) is safe here — unlike the
     URL-backed Attendance screen, where each write derived from the same
     searchParams snapshot and the last one won. */
  const auditFilters: FilterDef[] = [
    { key: 'action', allLabel: 'All Actions', value: actionFilter,
      options: ACTIONS.map((a) => ({ value: a, label: a })),
      onChange: (v) => { setActionFilter(v); resetPage() } },
    { key: 'resource', allLabel: 'All Resources', value: resource,
      options: RESOURCES.map((r) => ({ value: r, label: r.replace(/_/g, ' ') })),
      onChange: (v) => { setResource(v); resetPage() } },
    { key: 'actor', type: 'text', allLabel: 'Actor email', value: actor,
      onChange: (v) => { setActor(v); resetPage() } },
    { key: 'resourceId', type: 'text', allLabel: 'Resource ID', value: resourceId,
      onChange: (v) => { setResourceId(v); resetPage() } },
    { key: 'from', type: 'date', allLabel: 'From date', value: from,
      onChange: (v) => { setFrom(v); resetPage() } },
    { key: 'to', type: 'date', allLabel: 'To date', value: to,
      onChange: (v) => { setTo(v); resetPage() } },
  ]

  // Pull the view back into range when a filter shrinks the trail beneath it.
  useClampedPage(page, totalPages || undefined, setPage)

  // Drives the empty-state wording: "no events at all" and "none match your
  // filters" are different problems and need different next steps.
  const hasFilters = auditFilters.some((f) => f.value !== '')

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6 sm:p-8">
      <HrPageHeader
        crumb="Settings"
        title="System Audit Logs"
        subtitle="Track all user actions and system events"
        // Export intentionally not rendered. The button had no onClick and
        // there is no export endpoint — AuditController exposes only a paged
        // GET /v1/audit/events. It was the most convincing dead control in the
        // app precisely because it was permission-gated behind audit.export,
        // which implies a real feature. Someone pulling the trail for a
        // compliance review or incident would click it, get no file and no
        // error, and assume the export was empty. The permission code stays
        // defined for when the endpoint is built.
        actions={undefined}
      />

      {error && !isLoading ? (
        <EmptyState
          variant="error"
          title="Failed to load audit events"
          description={error.message}
          primaryAction={{ label: 'Retry', onClick: () => refetch() }}
        />
      ) : (
        <TableCard
          filters={auditFilters}
          footer={meta
            ? hrPaginationFooter({
                page, pageSize, totalElements: meta.total, totalPages,
                onPageChange: setPage, onPageSizeChange: setPageSize,
              })
            : undefined}
        >
          {isLoading ? (
            <div className="space-y-2 p-3">
              {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-10 w-full rounded-xl" />)}
            </div>
          ) : events.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-sm font-semibold text-text-secondary">No audit events</p>
              <p className="mt-1 text-xs text-text-tertiary">{hasFilters ? 'Try adjusting your filters.' : 'Events will appear here once actions are recorded.'}</p>
            </div>
          ) : (
            <table className="hr-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Actor</th>
                  <th>Action</th>
                  <th className="hidden md:table-cell">Resource</th>
                  <th className="hidden lg:table-cell">IP</th>
                  <th>Diff</th>
                </tr>
              </thead>
              <tbody>
                {events.map((row) => (
                  <tr key={row.id} onClick={() => setSelected(row)} className="cursor-pointer">
                    <td className="whitespace-nowrap text-xs text-text-secondary">{formatDistanceToNow(new Date(row.occurredAt), { addSuffix: true })}</td>
                    <td className="text-text-primary">{row.actorName ?? row.actorEmail ?? (row.actorUserId ? 'A user' : 'System')}</td>
                    <td><HrStatusPill tone={actionTone(row.action)}>{row.action}</HrStatusPill></td>
                    <td className="hidden md:table-cell text-text-secondary">
                      {row.resourceType ?? '—'}
                      {row.resourceId && <span className="hr-mono ml-1">{row.resourceId.slice(0, 8)}…</span>}
                    </td>
                    <td className="hidden lg:table-cell"><span className="hr-mono">{row.ip ?? '—'}</span></td>
                    <td>
                      {row.diff ? (
                        <button onClick={(e) => { e.stopPropagation(); setSelected(row) }} className="text-xs font-semibold text-[#047857] underline underline-offset-2">View</button>
                      ) : <span className="text-xs text-text-tertiary">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </TableCard>
      )}

      <Drawer open={!!selected} onOpenChange={(open) => { if (!open) setSelected(null) }} title="Event Details">
        {selected && <EventDetail event={selected} />}
      </Drawer>
    </div>
  )
}

function EventDetail({ event }: { event: AuditEventDto }) {
  const [diffOpen, setDiffOpen] = useState(false)

  const fields: Array<{ label: string; value: React.ReactNode }> = [
    { label: 'Event ID',    value: <span className="hr-mono break-all">{event.id}</span> },
    { label: 'Timestamp',   value: new Date(event.occurredAt).toLocaleString() },
    { label: 'Actor',       value: [event.actorName, event.actorEmail].filter(Boolean).join(' · ') || event.actorUserId || 'System' },
    { label: 'Action',      value: <HrStatusPill tone={actionTone(event.action)}>{event.action}</HrStatusPill> },
    { label: 'Resource',    value: event.resourceType ?? '—' },
    { label: 'Resource ID', value: event.resourceId ? <span className="hr-mono break-all">{event.resourceId}</span> : '—' },
    { label: 'IP Address',  value: event.ip ?? '—' },
    { label: 'Trace ID',    value: event.traceId ? <span className="hr-mono break-all">{event.traceId}</span> : '—' },
  ]

  let parsedDiff: string | null = null
  if (event.diff) {
    try {
      parsedDiff = JSON.stringify(JSON.parse(event.diff), null, 2)
    } catch {
      parsedDiff = event.diff
    }
  }

  return (
    <div className="space-y-4">
      {fields.map(({ label, value }) => (
        <div key={label} className="flex flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-wider text-text-tertiary">{label}</span>
          <span className="text-sm text-text-primary">{value}</span>
        </div>
      ))}

      {parsedDiff && (
        <div>
          <button onClick={() => setDiffOpen((o) => !o)} className="text-xs font-semibold text-[#047857]">
            {diffOpen ? 'Hide diff ▲' : 'Show diff ▼'}
          </button>
          {diffOpen && (
            <pre className="mt-2 max-h-96 overflow-x-auto overflow-y-auto whitespace-pre-wrap break-all rounded-xl border border-border-default bg-bg-base p-3 text-xs text-text-primary">
              {parsedDiff}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}
