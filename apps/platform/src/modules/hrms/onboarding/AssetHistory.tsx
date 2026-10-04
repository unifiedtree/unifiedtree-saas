// Who has had an asset, in order (GET /v1/onboarding/assets/:id/history), in a side panel.
import { useQuery } from '@tanstack/react-query'
import { apiJson } from '@/core/api/client'
import { EmptyState, ErrorState, SkeletonList } from '@/design/kit/display'
import { PanelButton, SidePanel } from '@/design/kit/overlays'
import { dayMon, istTodayIso } from '../hiring/hiringModel'
import '../hiring/hiring.css'

interface Allocation { id: string; employeeId: string; employeeName: string; assignedAt: string; returnedAt?: string; notes?: string }

export function AssetHistory({ assetId, tag, onClose }: { assetId: string; tag: string; onClose: () => void }) {
  const query = useQuery({ queryKey: ['hrms', 'onboarding', 'assets', 'history', assetId], queryFn: () => apiJson<Allocation[]>(`/v1/onboarding/assets/${assetId}/history`) })
  const today = istTodayIso()
  return (
    <SidePanel open onClose={onClose} width={480} closeLabel="Close panel" title={`History · ${tag}`} sub="Every hand-over and return."
      footer={<PanelButton size="lg" onClick={onClose}>Close</PanelButton>}>
      <section aria-label="Asset allocation history">
        {query.isLoading ? <SkeletonList rows={3} label="Loading the history" />
          : query.isError ? <ErrorState title="Couldn’t load the history" error={query.error} onRetry={() => query.refetch()} retrying={query.isFetching} />
            : !query.data?.length ? <EmptyState icon="clock" variant="dashed" title="Never assigned" hint="Each hand-over and return shows up here." />
              : (
                <ol className="hi-history">
                  {query.data.map((a) => (
                    <li key={a.id} className="hi-history__item">
                      <strong>{a.employeeName}</strong>
                      <p className="hi-history__sub">{`Given ${dayMon(a.assignedAt, today)} · ${a.returnedAt ? `back ${dayMon(a.returnedAt, today)}` : 'still with them'}`}</p>
                      {a.notes && <p className="hi-history__sub" style={{ fontStyle: 'italic' }}>{a.notes}</p>}
                    </li>
                  ))}
                </ol>
              )}
      </section>
    </SidePanel>
  )
}
