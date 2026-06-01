import React, { useState } from 'react'
import { Download, X } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { DataTable, Badge, Drawer, EmptyState, Skeleton } from '@unifiedtree/ui-kit'
import type { Column } from '@unifiedtree/ui-kit'
import { Can, P } from '@unifiedtree/sdk'
import { useAuditEvents } from '@/modules/hrms/api/useAudit'
import type { AuditEventDto } from '@/modules/hrms/api/useAudit'

// ── Constants ─────────────────────────────────────────────────────────────────

const ACTIONS = ['CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'EXPORT', 'ACCESS', 'PERMISSION_CHANGE']
const PAGE_SIZE = 25

function actionTone(action: string): 'success' | 'info' | 'error' | 'warning' | 'default' {
  if (action === 'CREATE') return 'success'
  if (action === 'UPDATE') return 'info'
  if (action === 'DELETE') return 'error'
  if (action === 'EXPORT') return 'warning'
  return 'default'
}

// ── Component ─────────────────────────────────────────────────────────────────

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
  const meta   = data?.meta

  const totalPages = meta ? Math.ceil(meta.total / PAGE_SIZE) : 0

  // ── Columns ───────────────────────────────────────────────────────────────

  const columns: Column<AuditEventDto>[] = [
    {
      key: 'occurredAt',
      header: 'Timestamp',
      cell: (row) => (
        <span className="text-[#64748B] text-xs whitespace-nowrap">
          {formatDistanceToNow(new Date(row.occurredAt), { addSuffix: true })}
        </span>
      ),
    },
    {
      key: 'actor',
      header: 'Actor',
      cell: (row) => (
        <span className="text-[#0F172A] text-sm">{row.actorEmail ?? row.actorUserId ?? '—'}</span>
      ),
    },
    {
      key: 'action',
      header: 'Action',
      cell: (row) => <Badge tone={actionTone(row.action)}>{row.action}</Badge>,
    },
    {
      key: 'resource',
      header: 'Resource',
      cell: (row) => (
        <span className="text-[#334155] text-sm">
          {row.resourceType ?? '—'}
          {row.resourceId && (
            <span className="text-[#64748B] ml-1 text-xs font-mono">
              {row.resourceId.slice(0, 8)}…
            </span>
          )}
        </span>
      ),
      hideBelow: 'md',
    },
    {
      key: 'ip',
      header: 'IP',
      cell: (row) => (
        <span className="font-mono text-xs text-[#64748B]">{row.ip ?? '—'}</span>
      ),
      hideBelow: 'lg',
    },
    {
      key: 'diff',
      header: 'Diff',
      cell: (row) =>
        row.diff ? (
          <button
            onClick={(e) => { e.stopPropagation(); setSelected(row) }}
            className="text-xs text-[#0F6E56] hover:text-[#0F6E56] underline underline-offset-2 transition-colors"
          >
            View
          </button>
        ) : (
          <span className="text-slate-600 text-xs">—</span>
        ),
    },
  ]

  // ── Render ────────────────────────────────────────────────────────────────

  const hasFilters = !!(actionFilter || from || to)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[#0F172A]">Audit Logs</h1>
          <p className="text-[#64748B] text-sm mt-0.5">Track all user actions and system events</p>
        </div>
        <Can code={P.AUDIT_EXPORT}>
          <button className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-[#0F172A] bg-indigo-600 hover:bg-indigo-500 rounded-xl transition-colors">
            <Download size={14} />
            Export
          </button>
        </Can>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <select
          value={actionFilter}
          onChange={(e) => { setActionFilter(e.target.value); setPage(0) }}
          className="bg-white border border-[#E2E8F0] rounded-xl px-3 py-2.5 text-sm text-[#334155] focus:outline-none focus:border-indigo-500 transition-all"
        >
          <option value="">All Actions</option>
          {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <input
          type="date"
          value={from}
          onChange={(e) => { setFrom(e.target.value); setPage(0) }}
          className="bg-white border border-[#E2E8F0] rounded-xl px-3 py-2.5 text-sm text-[#334155] focus:outline-none focus:border-indigo-500 transition-all"
          placeholder="From"
        />
        <input
          type="date"
          value={to}
          onChange={(e) => { setTo(e.target.value); setPage(0) }}
          className="bg-white border border-[#E2E8F0] rounded-xl px-3 py-2.5 text-sm text-[#334155] focus:outline-none focus:border-indigo-500 transition-all"
          placeholder="To"
        />
        {hasFilters && (
          <button
            onClick={() => { setActionFilter(''); setFrom(''); setTo(''); setPage(0) }}
            className="flex items-center gap-1.5 px-3 py-2.5 text-sm text-[#64748B] hover:text-[#0F172A] border border-[#E2E8F0]/40 rounded-xl transition-colors"
          >
            <X size={14} /> Clear
          </button>
        )}
      </div>

      {/* Error state */}
      {error && !isLoading && (
        <EmptyState
          variant="error"
          title="Failed to load audit events"
          description={error.message}
          primaryAction={{ label: 'Retry', onClick: () => refetch() }}
        />
      )}

      {/* Table */}
      {!error && (
        <>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full rounded-xl" />
              ))}
            </div>
          ) : (
            <DataTable
              columns={columns}
              data={events}
              getRowKey={(row) => row.id}
              emptyTitle="No audit events"
              emptyDescription={hasFilters ? 'Try adjusting your filters.' : 'Events will appear here once actions are recorded.'}
              emptyVariant={hasFilters ? 'filtered' : 'first-run'}
              onRowClick={setSelected}
            />
          )}

          {/* Pagination */}
          {meta && meta.total > PAGE_SIZE && (
            <div className="flex items-center justify-between px-1">
              <p className="text-xs text-[#64748B]">{meta.total.toLocaleString()} total events</p>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="px-3 py-1.5 text-xs text-[#64748B] hover:text-[#0F172A] border border-[#E2E8F0]/40 rounded-lg disabled:opacity-40 transition-colors"
                >
                  Previous
                </button>
                <span className="text-xs text-[#64748B] px-2">
                  Page {page + 1} of {totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className="px-3 py-1.5 text-xs text-[#64748B] hover:text-[#0F172A] border border-[#E2E8F0]/40 rounded-lg disabled:opacity-40 transition-colors"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Event detail drawer */}
      <Drawer open={!!selected} onOpenChange={(open) => { if (!open) setSelected(null) }} title="Event Details">
        {selected && <EventDetail event={selected} />}
      </Drawer>
    </div>
  )
}

// ── Detail panel ──────────────────────────────────────────────────────────────

function EventDetail({ event }: { event: AuditEventDto }) {
  const [diffOpen, setDiffOpen] = useState(false)

  const fields: Array<{ label: string; value: React.ReactNode }> = [
    { label: 'Event ID',    value: <span className="font-mono text-xs break-all">{event.id}</span> },
    { label: 'Timestamp',   value: new Date(event.occurredAt).toLocaleString() },
    { label: 'Actor',       value: event.actorEmail ?? event.actorUserId ?? '—' },
    { label: 'Action',      value: <Badge tone={actionTone(event.action)}>{event.action}</Badge> },
    { label: 'Resource',    value: event.resourceType ?? '—' },
    { label: 'Resource ID', value: event.resourceId ? <span className="font-mono text-xs break-all">{event.resourceId}</span> : '—' },
    { label: 'IP Address',  value: event.ip ?? '—' },
    { label: 'Trace ID',    value: event.traceId ? <span className="font-mono text-xs break-all">{event.traceId}</span> : '—' },
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
          <span className="text-xs text-[#64748B] font-medium uppercase tracking-wider">{label}</span>
          <span className="text-sm text-[#0F172A]">{value}</span>
        </div>
      ))}

      {parsedDiff && (
        <div>
          <button
            onClick={() => setDiffOpen((o) => !o)}
            className="text-xs text-[#0F6E56] hover:text-[#0F6E56] font-medium transition-colors"
          >
            {diffOpen ? 'Hide diff ▲' : 'Show diff ▼'}
          </button>
          {diffOpen && (
            <pre className="mt-2 p-3 bg-slate-950 border border-[#E2E8F0] rounded-xl text-xs text-[#334155] overflow-x-auto whitespace-pre-wrap break-all max-h-96 overflow-y-auto">
              {parsedDiff}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}
