import React, { useState } from 'react'
import { Download, X } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { Drawer, EmptyState, Skeleton } from '@unifiedtree/ui-kit'
import { Can, P } from '@unifiedtree/sdk'
import { HrPageHeader, HrButton, HrStatusPill, TableCard, type PillTone } from '@/shared/components/hr'
import { useAuditEvents } from '@/modules/hrms/api/useAudit'
import type { AuditEventDto } from '@/modules/hrms/api/useAudit'

const ACTIONS = ['CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'EXPORT', 'ACCESS', 'PERMISSION_CHANGE']
const PAGE_SIZE = 25

function actionTone(action: string): PillTone {
  if (action === 'CREATE') return 'ok'
  if (action === 'UPDATE') return 'info'
  if (action === 'DELETE') return 'red'
  if (action === 'EXPORT') return 'warn'
  return 'gray'
}

const filterCls = 'rounded-lg border border-border-default bg-white px-3 py-2 text-sm text-text-primary focus:border-[#FF9D00] focus:outline-none'

export const AuditLogs: React.FC = () => {
  const [actionFilter, setActionFilter] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState<AuditEventDto | null>(null)

  const filters = {
    ...(actionFilter ? { action: actionFilter } : {}),
    ...(from ? { from: new Date(from).toISOString() } : {}),
    ...(to ? { to: new Date(to).toISOString() } : {}),
    page,
    size: PAGE_SIZE,
  }

  const { data, isLoading, error, refetch } = useAuditEvents(filters)
  const events = data?.data ?? []
  const meta = data?.meta
  const totalPages = meta ? Math.ceil(meta.total / PAGE_SIZE) : 0
  const hasFilters = !!(actionFilter || from || to)

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6 sm:p-8">
      <HrPageHeader
        crumb="Settings"
        title="System Audit Logs"
        subtitle="Track all user actions and system events"
        actions={
          <Can code={P.AUDIT_EXPORT}>
            <HrButton variant="ghost"><Download size={14} /> Export</HrButton>
          </Can>
        }
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
          actions={
            <>
              <select value={actionFilter} onChange={(e) => { setActionFilter(e.target.value); setPage(0) }} className={filterCls}>
                <option value="">All Actions</option>
                {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
              <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(0) }} className={filterCls} />
              <input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(0) }} className={filterCls} />
              {hasFilters && (
                <button onClick={() => { setActionFilter(''); setFrom(''); setTo(''); setPage(0) }}
                  className="flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm font-semibold text-[#C16E00] hover:bg-[#FFF4E1]">
                  <X size={14} /> Clear
                </button>
              )}
            </>
          }
          footer={meta && meta.total > PAGE_SIZE ? (
            <div className="flex items-center justify-between">
              <p className="text-xs text-text-secondary">{meta.total.toLocaleString()} total events</p>
              <div className="flex items-center gap-1">
                <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} className="rounded-lg border border-border-default px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary disabled:opacity-40">Previous</button>
                <span className="px-2 text-xs text-text-secondary">Page {page + 1} of {totalPages}</span>
                <button onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} className="rounded-lg border border-border-default px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary disabled:opacity-40">Next</button>
              </div>
            </div>
          ) : undefined}
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
                    <td className="text-text-primary">{row.actorEmail ?? row.actorUserId ?? '—'}</td>
                    <td><HrStatusPill tone={actionTone(row.action)}>{row.action}</HrStatusPill></td>
                    <td className="hidden md:table-cell text-text-secondary">
                      {row.resourceType ?? '—'}
                      {row.resourceId && <span className="hr-mono ml-1">{row.resourceId.slice(0, 8)}…</span>}
                    </td>
                    <td className="hidden lg:table-cell"><span className="hr-mono">{row.ip ?? '—'}</span></td>
                    <td>
                      {row.diff ? (
                        <button onClick={(e) => { e.stopPropagation(); setSelected(row) }} className="text-xs font-semibold text-[#C16E00] underline underline-offset-2">View</button>
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
    { label: 'Actor',       value: event.actorEmail ?? event.actorUserId ?? '—' },
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
          <button onClick={() => setDiffOpen((o) => !o)} className="text-xs font-semibold text-[#C16E00]">
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
