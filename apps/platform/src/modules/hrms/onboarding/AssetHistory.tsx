// Who has had an asset, in order (GET /v1/onboarding/assets/:id/history), in a drawer.
import { useQuery } from '@tanstack/react-query'
import { apiJson } from '@/core/api/client'
import { HrButton, HrDrawer } from '@/shared/components/hr'
import { State, dmy } from '@/design/module/ModuleKit'

interface Allocation { id: string; employeeId: string; employeeName: string; assignedAt: string; returnedAt?: string; notes?: string }

export function AssetHistory({ assetId, tag, onClose }: { assetId: string; tag: string; onClose: () => void }) {
  const query = useQuery({ queryKey: ['hrms', 'onboarding', 'assets', 'history', assetId], queryFn: () => apiJson<Allocation[]>(`/v1/onboarding/assets/${assetId}/history`) })
  return (
    <HrDrawer title={`History · ${tag}`} onClose={onClose} footer={<HrButton variant="ghost" onClick={onClose}>Close</HrButton>}>
      <section aria-label="Asset allocation history">
        {query.isLoading ? <State kind="loading" />
          : query.isError ? <State kind="error" title="Couldn’t load the history" description={query.error.message} onRetry={() => query.refetch()} />
            : !query.data?.length ? <State kind="empty" icon="clock" title="Never assigned" description="Each hand-over and return shows up here." />
              : (
                <ol className="space-y-3">
                  {query.data.map((a) => (
                    <li key={a.id} className="border-l-2 border-[#059669] pl-4 text-sm">
                      <strong>{a.employeeName}</strong>
                      <p className="text-text-secondary">{`Given ${dmy(a.assignedAt)} · ${a.returnedAt ? `back ${dmy(a.returnedAt)}` : 'still with them'}`}</p>
                      {a.notes && <p className="text-text-secondary italic">{a.notes}</p>}
                    </li>
                  ))}
                </ol>
              )}
      </section>
    </HrDrawer>
  )
}
