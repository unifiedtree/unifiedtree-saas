// Audit logs (/audit-logs), on the module kit: who did what, when, from where.
// GET /v1/audit/events (audit.read) is paged and filterable by action,
// resource, actor (user id or email), resource id and a date range. "Export
// all" downloads every matching event from GET /v1/audit/events/export.csv,
// streamed by the server with the same filters; the export is recorded in the
// Reports Center's download history and in this trail.
import React, { useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { HrButton, HrStatusPill, TableCard, HrDrawer, type PillTone, type FilterDef } from '@/shared/components/hr'
import { hrPaginationFooter, useClampedPage } from '@/shared/components/HrPagination'
import { useDebounce } from '@/shared/hooks/useDebounce'
import { apiBlob } from '@/core/api/client'
import { saveServerFile } from '@/shared/export/fileExport'
import { ModulePage, State, Facts, Note, useDesignToast, stamp, todayIso } from '@/design/module/ModuleKit'
import { dashIcon } from '@/design/dc/icons'
import { useAuditEvents, type AuditEventDto } from '@/modules/hrms/api/useAudit'

const ACTIONS = ['CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'EXPORT', 'ACCESS', 'PERMISSION_CHANGE']
// Enumerated: the API matches the exact value, so a typo would return an empty trail.
const RESOURCES = ['EMPLOYEE', 'LEAVE_REQUEST', 'ATTENDANCE', 'PAYROLL_RUN', 'POLICY', 'DOCUMENT', 'EXPENSE_CLAIM', 'USER', 'ROLE', 'COMPANY', 'DEPARTMENT', 'SETTINGS']
const PAGE_SIZE = 25
const words = (v: string) => v.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase())
function actionTone(action: string): PillTone {
  if (action === 'CREATE') return 'ok'
  if (action === 'UPDATE') return 'info'
  if (action === 'DELETE') return 'red'
  if (action === 'EXPORT' || action === 'PERMISSION_CHANGE') return 'warn'
  return 'gray'
}
/** A yyyy-MM-dd day in the browser's zone → the instant it starts (or, with `next`, the start of the next day). */
const dayStart = (d: string, next = false) => { const t = new Date(`${d}T00:00`); if (next) t.setDate(t.getDate() + 1); return t.toISOString() }
const actorOf = (e: AuditEventDto) => e.actorName ?? e.actorEmail ?? (e.actorUserId ? 'A user' : 'System')

export const AuditLogs: React.FC = () => {
  const { show, node } = useDesignToast()
  const [actionFilter, setActionFilter] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [actor, setActor] = useState('')
  const [resource, setResource] = useState('')
  const [resourceId, setResourceId] = useState('')
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(PAGE_SIZE)
  const [selected, setSelected] = useState<AuditEventDto | null>(null)
  const [exporting, setExporting] = useState(false)
  const debouncedActor = useDebounce(actor, 350)
  const debouncedResourceId = useDebounce(resourceId, 350)
  // The date boxes are whole local days: "to" includes all of that day (it used to stop at its UTC midnight).
  const filters = {
    ...(actionFilter ? { action: actionFilter } : {}),
    ...(from ? { from: dayStart(from) } : {}),
    ...(to ? { to: dayStart(to, true) } : {}),
    ...(debouncedActor ? { actor: debouncedActor } : {}),
    ...(resource ? { resource } : {}),
    ...(debouncedResourceId ? { resourceId: debouncedResourceId } : {}),
    page, size: pageSize,
  }
  const { data, isLoading, error, refetch, isFetching } = useAuditEvents(filters)
  const events = data?.data ?? []
  const meta = data?.meta
  const totalPages = meta ? Math.ceil(meta.total / pageSize) : 0
  const resetPage = () => setPage(0)
  const auditFilters: FilterDef[] = [
    { key: 'action', allLabel: 'All actions', value: actionFilter, options: ACTIONS.map((a) => ({ value: a, label: words(a) })), onChange: (v) => { setActionFilter(v); resetPage() } },
    { key: 'resource', allLabel: 'All resources', value: resource, options: RESOURCES.map((r) => ({ value: r, label: words(r) })), onChange: (v) => { setResource(v); resetPage() } },
    { key: 'actor', type: 'text', allLabel: 'Who (email)', value: actor, onChange: (v) => { setActor(v); resetPage() } },
    { key: 'resourceId', type: 'text', allLabel: 'Record ID', value: resourceId, onChange: (v) => { setResourceId(v); resetPage() } },
    { key: 'from', type: 'date', allLabel: 'From', value: from, onChange: (v) => { setFrom(v); resetPage() } },
    { key: 'to', type: 'date', allLabel: 'To', value: to, onChange: (v) => { setTo(v); resetPage() } },
  ]
  useClampedPage(page, totalPages || undefined, setPage)
  const hasFilters = auditFilters.some((f) => f.value !== '')
  // Every event matching the filters (not just this page), streamed by the server.
  const exportAll = async () => {
    if (exporting) return
    setExporting(true)
    try {
      const qs = new URLSearchParams(Object.entries(filters).filter(([k]) => k !== 'page' && k !== 'size').map(([k, v]) => [k, String(v)]))
      const blob = await apiBlob(`/v1/audit/events/export.csv${qs.toString() ? `?${qs}` : ''}`)
      saveServerFile(`audit-log-${todayIso()}.csv`, blob)
      show('Audit log exported', false, hasFilters ? 'Every event that matches these filters, newest first.' : 'Every event recorded, newest first.')
    } catch (e) {
      show('Couldn’t export the audit log', true, (e as Error)?.message)
    } finally {
      setExporting(false)
    }
  }

  return (
    <ModulePage crumb="Settings" title="Audit logs" subtitle="Who did what, and when: sign-ins, changes, exports and permission updates."
      actions={<>
        <HrButton variant="ghost" onClick={() => refetch()} disabled={isFetching}>{isFetching ? 'Refreshing…' : 'Refresh'}</HrButton>
        <HrButton onClick={exportAll} disabled={!events.length || exporting} title="Downloads every event that matches the filters as a CSV, not just this page">{dashIcon('download', 15)} {exporting ? 'Exporting…' : 'Export all (CSV)'}</HrButton>
      </>}>
      <div style={{ display: 'grid', gap: 16, minWidth: 0 }}>
        {meta && <Note>{`${meta.total.toLocaleString('en-IN')} ${meta.total === 1 ? 'event' : 'events'}${hasFilters ? ' match these filters' : ' recorded'}. Click a row for the full details and what changed.`}</Note>}
        {error && !isLoading ? <State kind="error" title="Couldn’t load the audit log" description={error.message} onRetry={() => refetch()} /> : (
          <TableCard filters={auditFilters}
            footer={meta ? hrPaginationFooter({ page, pageSize, totalElements: meta.total, totalPages, onPageChange: setPage, onPageSizeChange: setPageSize }) : undefined}>
            {isLoading ? <State kind="loading" height={320} />
              : events.length === 0 ? <State kind="empty" icon="list" title="No events" description={hasFilters ? 'Nothing matches these filters.' : 'Events appear here as people use the system.'} />
                : (
                  <table className="hr-table">
                    <thead><tr><th>When</th><th>Who</th><th>Action</th><th className="hidden md:table-cell">Resource</th><th className="hidden lg:table-cell">IP</th><th><span className="sr-only">Details</span></th></tr></thead>
                    <tbody>
                      {events.map((row) => (
                        <tr key={row.id} onClick={() => setSelected(row)} className="cursor-pointer">
                          <td className="whitespace-nowrap text-text-secondary" title={new Date(row.occurredAt).toLocaleString('en-IN')}>
                            <div className="text-[13px] text-text-primary">{stamp(row.occurredAt)}</div>
                            <div className="text-xs text-text-tertiary">{formatDistanceToNow(new Date(row.occurredAt), { addSuffix: true })}</div>
                          </td>
                          <td className="text-text-primary">{actorOf(row)}{row.actorName && row.actorEmail && <div className="text-xs text-text-tertiary">{row.actorEmail}</div>}</td>
                          <td><HrStatusPill tone={actionTone(row.action)}>{words(row.action)}</HrStatusPill></td>
                          <td className="hidden md:table-cell text-text-secondary">{row.resourceType ? words(row.resourceType) : '—'}{row.resourceName && <div className="text-xs text-text-tertiary">{row.resourceName}</div>}</td>
                          <td className="hidden lg:table-cell"><span className="hr-mono text-xs">{row.ip ?? '—'}</span></td>
                          <td className="text-right"><HrButton size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setSelected(row) }}>{row.diff ? 'What changed' : 'Details'}</HrButton></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
          </TableCard>
        )}
      </div>
      {selected && <HrDrawer title="Event details" width="max-w-xl" onClose={() => setSelected(null)}><EventDetail event={selected} /></HrDrawer>}
      {node}
    </ModulePage>
  )
}

function EventDetail({ event }: { event: AuditEventDto }) {
  let parsedDiff: string | null = null
  if (event.diff) { try { parsedDiff = JSON.stringify(JSON.parse(event.diff), null, 2) } catch { parsedDiff = event.diff } }
  return (
    <div className="space-y-4">
      <Facts min={200} items={[
        { k: 'When', v: new Date(event.occurredAt).toLocaleString('en-IN') },
        { k: 'Who', v: [event.actorName, event.actorEmail].filter(Boolean).join(' · ') || (event.actorUserId ? 'A user' : 'System') },
        { k: 'Action', v: <HrStatusPill tone={actionTone(event.action)}>{words(event.action)}</HrStatusPill> },
        { k: 'Resource', v: event.resourceType ? words(event.resourceType) : '—' },
        ...(event.resourceName ? [{ k: 'Record', v: event.resourceName }] : []),
        { k: 'IP address', v: event.ip ?? '—' },
      ]} />
      <Facts min={260} items={[
        { k: 'Record ID', v: event.resourceId ? <span className="hr-mono text-xs">{event.resourceId}</span> : '—' },
        { k: 'Event ID', v: <span className="hr-mono text-xs">{event.id}</span> },
        { k: 'Trace ID', v: event.traceId ? <span className="hr-mono text-xs">{event.traceId}</span> : '—' },
        ...(event.userAgent ? [{ k: 'Browser / device', v: <span className="text-xs">{event.userAgent}</span> }] : []),
      ]} />
      {parsedDiff && (
        <div>
          <p className="mb-1.5 text-[13px] font-semibold text-text-secondary">What changed</p>
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all rounded-xl border border-border-default bg-bg-base p-3 text-xs text-text-primary">{parsedDiff}</pre>
        </div>
      )}
    </div>
  )
}
