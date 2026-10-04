// Who has had an asset, in order (GET /v1/onboarding/assets/:id/history), in a kit side panel.
import { useQuery } from '@tanstack/react-query'
import { apiJson } from '@/core/api/client'
import { EmptyState, ErrorState, SkeletonList } from '@/design/kit/display'
import { Timeline } from '@/design/kit/data'
import { PanelButton, SidePanel } from '@/design/kit/overlays'
import { fullDate } from './onboardingModel'

interface Allocation { id: string; employeeId: string; employeeName: string; assignedAt: string; returnedAt?: string; notes?: string }

export function AssetHistory({ assetId, tag, onClose }: { assetId: string; tag: string; onClose: () => void }) {
  const query = useQuery({ queryKey: ['hrms', 'onboarding', 'assets', 'history', assetId], queryFn: () => apiJson<Allocation[]>(`/v1/onboarding/assets/${assetId}/history`) })
  const rows = query.data ?? []
  return (
    <SidePanel open onClose={onClose} width={480} closeLabel="Close panel" title={`History · ${tag}`} sub="Each hand-over and return, newest last."
      footer={<PanelButton variant="secondary" size="lg" onClick={onClose}>Close</PanelButton>}>
      <section aria-label="Asset allocation history">
        {query.isLoading ? <SkeletonList rows={3} label="Loading the history" />
          : query.isError ? <ErrorState title="Couldn’t load the history" error={query.error} onRetry={() => query.refetch()} retrying={query.isRefetching} />
            : !rows.length ? <EmptyState icon="clock" title="Never handed out" hint="Each hand-over and return shows up here." />
              : (
                <Timeline variant="rail" label={`Who has had ${tag}`} items={rows.map((a) => ({
                  key: a.id,
                  label: a.employeeName,
                  sub: [`Given ${fullDate(a.assignedAt)} · ${a.returnedAt ? `back ${fullDate(a.returnedAt)}` : 'still with them'}`, a.notes].filter(Boolean).join(' · '),
                  state: a.returnedAt ? 'done' : 'current',
                }))} />
              )}
      </section>
    </SidePanel>
  )
}
