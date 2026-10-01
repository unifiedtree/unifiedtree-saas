// My assets (/me/assets), as cards (P-DOCS; prototype EmpDocs `e-assets`): the
// company equipment handed to the signed-in employee (GET /v1/me/assets,
// hrms.onboarding.asset.self; always the caller's own record). A new hand-over
// waits for "Yes, I have it" (gold ring); "Report a problem" tells the people who
// manage assets (lost, damaged, not working, something else). Returned items
// are listed after, with their dates and note. Confirm and Report come from
// P-HIRE's BW-70 endpoints; until they are switched on, nothing asks to be
// confirmed and the actions say so.
import { useMemo, useState } from 'react'
import { Callout, EmptyState, ErrorState, ListRow, ListRows, PageFrame, PageHeader, Section, SkeletonBlock, StatusPill, IconTile } from '@/design/kit/display'
import { ActionCard, ActionCardGrid } from '@/design/kit/data'
import { Dialog, PanelButton, Select, Textarea, useToast } from '@/design/kit/overlays'
import { useMyAssets } from './api/useOnboarding'
import { PROBLEM_KINDS, useConfirmMyAsset, useReportAssetProblem, type AssetProblemKind, type MyAssetCare } from './myAssetsApi'
import { assetCard, assetsBanner, day } from '../vault/vaultModel'
import '../letters/components/letters.css'

const meta = (a: MyAssetCare) => [a.assetType, a.serialNo ? `Serial ${a.serialNo}` : null].filter(Boolean).join(' · ')

export function MyAssets() {
  const toast = useToast()
  const q = useMyAssets()
  const confirm = useConfirmMyAsset()
  const [reporting, setReporting] = useState<MyAssetCare | null>(null)
  const list = useMemo(() => (q.data ?? []) as MyAssetCare[], [q.data])
  const withMe = list.filter((a) => a.withMe)
  const returned = list.filter((a) => !a.withMe)
  const banner = assetsBanner(withMe)

  const yes = (a: MyAssetCare) => confirm.mutate(a.assetId, {
    onSuccess: (done) => done ? toast.success(`Confirmed: ${a.assetName}`) : toast.info('Confirming assets isn’t switched on yet.'),
    onError: (e) => toast.error('Couldn’t confirm it', { detail: (e as Error)?.message }),
  })

  return (
    <PageFrame label="My assets" width="narrow" className="lt-page">
      <PageHeader title="My assets" sub="Company equipment you have. Confirm new items when you get them." />
      {q.isLoading ? <SkeletonBlock style={{ height: 200 }} label="Loading your assets" />
        : q.error ? <ErrorState title="Couldn’t load your assets" error={q.error} onRetry={() => q.refetch()} />
          : list.length === 0 ? <EmptyState icon="laptop" title="No equipment recorded for you" hint="When HR hands you a laptop, ID card or anything else, it shows up here." />
            : (
              <div className="lt-stack">
                {banner && <Callout tone="warning" icon="alert">{banner}</Callout>}
                {withMe.length === 0 ? <Callout tone="neutral">You don’t hold any company equipment right now.</Callout> : (
                  <ActionCardGrid label="With you">
                    {withMe.map((a, i) => {
                      const c = assetCard(a)
                      return (
                        <ActionCard key={`${a.assetId}-${a.assignedAt}`} index={i} icon="laptop" title={a.assetName} sub={c.sub} status={c.state} tone={c.tone}
                          primary={c.confirm ? { label: 'Yes, I have it', onClick: () => yes(a), loading: confirm.isPending && confirm.variables === a.assetId, ariaLabel: `Yes, I have the ${a.assetName}` } : undefined}
                          secondary={!a.openIssue ? { label: 'Report a problem', onClick: () => setReporting(a), ariaLabel: `Report a problem with the ${a.assetName}` } : undefined} />
                      )
                    })}
                  </ActionCardGrid>
                )}
                {withMe.length > 0 && <p className="lt-foot">Lost or broken something? Report it the same day.</p>}
                {returned.length > 0 && (
                  <Section title="Returned" count={returned.length} body="list" cardClass={false}>
                    <ListRows>
                      {returned.map((a) => (
                        <ListRow key={`${a.assetId}-${a.assignedAt}-${a.returnedAt}`} leading={<IconTile icon="laptop" />}
                          title={a.assetName} sub={[a.assetTag, meta(a), `Had it ${day(a.assignedAt)} to ${day(a.returnedAt)}`, a.returnNotes].filter(Boolean).join(' · ')}
                          end={<StatusPill tone="neutral">Returned</StatusPill>} />
                      ))}
                    </ListRows>
                  </Section>
                )}
              </div>
            )}
      {reporting && <ReportProblem asset={reporting} onClose={() => setReporting(null)} />}
    </PageFrame>
  )
}

function ReportProblem({ asset, onClose }: { asset: MyAssetCare; onClose: () => void }) {
  const toast = useToast()
  const report = useReportAssetProblem()
  const [kind, setKind] = useState<AssetProblemKind>('NOT_WORKING')
  const [note, setNote] = useState('')
  const submit = () => report.mutate({ assetId: asset.assetId, kind, note }, {
    onSuccess: (done) => {
      if (done) toast.success('Reported. The people who look after assets have been told.')
      else toast.info('Reporting problems isn’t switched on yet.')
      onClose()
    },
    onError: (e) => toast.error('Couldn’t report it', { detail: (e as Error)?.message }),
  })
  return (
    <Dialog open onClose={onClose} busy={report.isPending} icon="alertTriangle" tone="warning" title="Report a problem"
      sub={`${asset.assetName}${asset.assetTag ? ` · ${asset.assetTag}` : ''}. HR is told straight away.`}
      footer={<>
        <PanelButton onClick={onClose} disabled={report.isPending}>Cancel</PanelButton>
        <PanelButton variant="primary" busy={report.isPending} onClick={submit}>Report it</PanelButton>
      </>}>
      <div className="lt-stack">
        <Select label="What’s wrong" full value={kind} onChange={(e) => setKind(e.target.value as AssetProblemKind)} options={PROBLEM_KINDS} />
        <Textarea label="Anything else HR should know (optional)" full rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. The screen flickers since Monday" />
      </div>
    </Dialog>
  )
}
