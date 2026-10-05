import React, { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useToast } from '@/design/kit/overlays'
import { istToday } from '@/design/dc/dates'
import { format } from 'date-fns'
import { Search, X } from 'lucide-react'
import { apiJson } from '@/core/api/client'
import { HrButton } from '@/shared/components/hr'
import { DateField } from '@/shared/components/calendar'
import { useAnyPermission, usePermission } from '@unifiedtree/sdk'
import { httpStatusOf } from '@/core/api/featureNotReady'
import { EMPLOYEE_SEARCH_PERMISSION, type EmployeeSearchHit } from '@/shared/search/useEmployeeSearch'
import {
  useDelegateSearch, delegateSearchVia, DELEGATE_APPROVER_PERMISSIONS, DELEGATE_SEARCH_MIN_CHARS, type DelegateSearchSource,
} from './delegateSearch'

/**
 * "I'm away — my approvals go to Alice." One card on the Profile page.
 * Adds a delegation window (from / to / delegate) and lists the current +
 * upcoming windows. Any submit (leave / WFH / expense / advance / OT) that
 * would normally route to the signed-in user during that window is redirected
 * to the delegate. Already-routed requests are not moved. Expired rows are
 * hidden from the list.
 *
 * Backend: GET/POST/DELETE /v1/me/delegation (isAuthenticated). The colleague
 * picker: approvers use GET /v1/approvals/delegation/candidates (so managers
 * without hrms.employee.read can choose someone; until it is deployed, the
 * directory search); others with hrms.employee.read keep /v1/search; anyone else
 * sees the "you can't look up colleagues" note instead of a search box.
 * See delegateSearch.ts.
 */

interface DelegationDto {
  id: string
  delegateEmployeeId: string
  delegateName: string | null
  fromDate: string
  toDate: string
  reason: string | null
  active: boolean
}

// Today in India (the app's calendar): the UTC date is still yesterday before 05:30.
const todayIso = () => istToday()

/** `bare`: drop the card's own heading and intro (a settings section supplies them). */
export const DelegationCard: React.FC<{ bare?: boolean }> = ({ bare }) => {
  const toast = useToast()
  const qc = useQueryClient()
  const list = useQuery({
    queryKey: ['me', 'delegation'],
    queryFn: () => apiJson<DelegationDto[]>('/v1/me/delegation'),
    staleTime: 30_000,
  })

  const [showForm, setShowForm] = useState(false)

  const removeMut = useMutation({
    mutationFn: (id: string) => apiJson(`/v1/me/delegation/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['me', 'delegation'] })
      toast.success('Delegation removed')
    },
    onError: (err) => toast.error('Could not remove delegation', { detail: (err as Error).message }),
  })

  return (
    <section>
      <div className={bare ? 'mb-3 flex items-center justify-end' : 'mb-1 flex items-center justify-between'}>
        {!bare && <h3 className="text-sm font-semibold text-text-primary">Approval delegation</h3>}
        {!showForm && (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="text-xs font-medium text-[var(--u-brt)] hover:underline"
          >
            + Add delegation
          </button>
        )}
      </div>
      {!bare && <p className="mb-4 text-xs text-text-secondary">
        Route your approvals to someone else while you're away. Only requests
        submitted during the window move; anything already assigned to you stays put.
      </p>}

      {showForm && (
        <DelegationForm
          onDone={() => {
            setShowForm(false)
            qc.invalidateQueries({ queryKey: ['me', 'delegation'] })
          }}
          onCancel={() => setShowForm(false)}
        />
      )}

      <div className="mt-3 space-y-2">
        {list.isLoading ? (
          <p className="text-xs text-text-tertiary">Loading…</p>
        ) : list.isError ? (
          <p className="text-xs text-red-600">Couldn't load your delegations.</p>
        ) : !list.data || list.data.length === 0 ? (
          <p className="text-xs text-text-tertiary">No delegation set.</p>
        ) : (
          list.data.map((d) => (
            <div
              key={d.id}
              className="ut-card ut-card-sm flex items-start justify-between gap-3 p-3"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-text-primary">
                  → {d.delegateName || d.delegateEmployeeId.slice(0, 8)}
                  {d.active && (
                    <span className="ml-2 rounded-full bg-[var(--u-brs)] px-2 py-0.5 text-[10px] font-semibold text-[var(--u-brt)]">
                      Active
                    </span>
                  )}
                </p>
                <p className="mt-0.5 text-xs text-text-secondary">
                  {format(new Date(`${d.fromDate}T00:00:00`), 'd MMM yyyy')} —{' '}
                  {format(new Date(`${d.toDate}T00:00:00`), 'd MMM yyyy')}
                </p>
                {d.reason && <p className="mt-1 text-xs text-text-tertiary">"{d.reason}"</p>}
              </div>
              <button
                type="button"
                onClick={() => {
                  if (confirm('Remove this delegation? New requests will route back to you.')) {
                    removeMut.mutate(d.id)
                  }
                }}
                disabled={removeMut.isPending}
                className="rounded-md p-1 text-text-tertiary hover:bg-red-50 hover:text-red-600"
                aria-label="Remove delegation"
              >
                <X size={16} />
              </button>
            </div>
          ))
        )}
      </div>
    </section>
  )
}

const DelegationForm: React.FC<{ onDone: () => void; onCancel: () => void }> = ({ onDone, onCancel }) => {
  const toast = useToast()
  const [query, setQuery] = useState('')
  const [delegate, setDelegate] = useState<EmployeeSearchHit | null>(null)
  const [fromDate, setFromDate] = useState(todayIso())
  const [toDate, setToDate] = useState(todayIso())
  const [reason, setReason] = useState('')

  const approver = useAnyPermission(DELEGATE_APPROVER_PERMISSIONS)
  const canReadDirectory = usePermission(EMPLOYEE_SEARCH_PERMISSION)
  const via = delegateSearchVia(approver, canReadDirectory)
  const search = useDelegateSearch(query, via)
  const hits: EmployeeSearchHit[] = useMemo(() => search.data?.employees ?? [], [search.data])

  const createMut = useMutation({
    mutationFn: (body: object) =>
      apiJson<{ id: string }>('/v1/me/delegation', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      toast.success('Delegation added')
      onDone()
    },
    onError: (err) => {
      const msg = (err as Error).message
      toast.error('Could not add delegation', { detail: msg })
    },
  })

  const submit = () => {
    if (!delegate) { toast.error('Pick a colleague to delegate to.'); return }
    if (!fromDate || !toDate) { toast.error('Both dates are required.'); return }
    createMut.mutate({
      delegateEmployeeId: delegate.id,
      fromDate,
      toDate,
      reason: reason.trim() || null,
    })
  }

  return (
    <div className="ut-card ut-card-sm space-y-3 p-4">
      <div>
        <label className="mb-1.5 block text-[13px] font-semibold text-text-tertiary">Delegate to</label>
        {delegate ? (
          <div className="flex items-center gap-2 rounded-xl border border-border-default bg-bg-base px-3 py-2 text-sm">
            <span className="font-medium">{delegate.displayName}</span>
            <span className="text-xs text-text-tertiary">{delegate.employeeCode}</span>
            <button
              type="button"
              onClick={() => setDelegate(null)}
              className="ml-auto text-xs text-text-tertiary hover:text-red-600"
            >
              Change
            </button>
          </div>
        ) : via === null ? (
          <p className="rounded-xl border border-border-subtle bg-bg-base px-3 py-2 text-xs text-text-secondary">
            {NO_SEARCH_MESSAGE}
          </p>
        ) : (
          <>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by name or employee ID"
                className="w-full rounded-xl border border-border-default bg-[var(--u-sf)] pl-9 pr-3 py-2 text-sm outline-none focus:border-[var(--u-brl)] focus:ring-4 focus:ring-[var(--u-brs)]"
              />
            </div>
            {query.trim().length >= DELEGATE_SEARCH_MIN_CHARS && (
              <DelegateHits
                hits={hits}
                fetching={search.isFetching}
                error={search.isError ? search.error : null}
                source={search.data?.source}
                onPick={(h) => {
                  setDelegate(h)
                  setQuery('')
                }}
              />
            )}
          </>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-[13px] font-semibold text-text-tertiary">From</label>
          <DateField
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            aria-label="From"
            className="w-full rounded-xl border border-border-default bg-[var(--u-sf)] px-3 py-2 text-sm outline-none focus:border-[var(--u-brl)] focus:ring-4 focus:ring-[var(--u-brs)]"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-[13px] font-semibold text-text-tertiary">To</label>
          <DateField
            value={toDate}
            min={fromDate}
            onChange={(e) => setToDate(e.target.value)}
            aria-label="To"
            className="w-full rounded-xl border border-border-default bg-[var(--u-sf)] px-3 py-2 text-sm outline-none focus:border-[var(--u-brl)] focus:ring-4 focus:ring-[var(--u-brs)]"
          />
        </div>
      </div>

      <div>
        <label className="mb-1.5 block text-[13px] font-semibold text-text-tertiary">Reason (optional)</label>
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Off-site training, annual leave, …"
          className="w-full rounded-xl border border-border-default bg-[var(--u-sf)] px-3 py-2 text-sm outline-none focus:border-[var(--u-brl)] focus:ring-4 focus:ring-[var(--u-brs)]"
        />
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-border-default bg-[var(--u-sf)] px-4 py-2 text-sm font-medium text-text-secondary hover:bg-bg-subtle"
        >
          Cancel
        </button>
        <HrButton onClick={submit} disabled={createMut.isPending || !delegate}>
          {createMut.isPending ? 'Saving…' : 'Save delegation'}
        </HrButton>
      </div>
    </div>
  )
}

const NO_SEARCH_MESSAGE = "You don't have permission to look up colleagues. Ask HR to set the delegation for you."

/**
 * The picker's results under the search box. `source` says which endpoint
 * answered: only the delegation picker's own lists just current colleagues who
 * can sign in, so only then does "No matches" say so.
 */
export const DelegateHits: React.FC<{
  hits: EmployeeSearchHit[]
  fetching: boolean
  error: unknown
  source?: DelegateSearchSource
  onPick: (hit: EmployeeSearchHit) => void
}> = ({ hits, fetching, error, source, onPick }) => (
  <div className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-border-subtle bg-[var(--u-sf)]">
    {error ? (
      <p className="p-3 text-xs text-red-600">
        {httpStatusOf(error) === 403 ? NO_SEARCH_MESSAGE : "Couldn't search colleagues just now. Try again."}
      </p>
    ) : hits.length === 0 && !fetching ? (
      <p className="p-3 text-xs text-text-tertiary">
        No matches.{source === 'candidates' && ' Only current colleagues who can sign in are listed.'}
      </p>
    ) : (
      hits.map((h) => (
        <button
          key={h.id}
          type="button"
          onClick={() => onPick(h)}
          className="flex w-full items-center gap-2 border-b border-border-subtle px-3 py-2 text-left text-sm last:border-b-0 hover:bg-bg-subtle"
        >
          <span className="font-medium">{h.displayName}</span>
          <span className="text-xs text-text-tertiary">{h.employeeCode}</span>
          {h.jobTitle && <span className="ml-auto text-xs text-text-tertiary">{h.jobTitle}</span>}
        </button>
      ))
    )}
  </div>
)

export default DelegationCard
