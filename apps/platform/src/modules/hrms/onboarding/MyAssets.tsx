// My assets (/me/assets): the company equipment handed to the signed-in
// employee and what they have returned (GET /v1/me/assets,
// hrms.onboarding.asset.self). Always the caller's own record.
import { HrStatusPill } from '@/shared/components/hr'
import { ModulePage, StatRow, SubHeading, RowList, Row, State, Note, dmy } from '@/design/module/ModuleKit'
import { useMyAssets, type MyAsset } from './api/useOnboarding'

const meta = (a: MyAsset) => [a.assetType, `Tag ${a.assetTag}`, a.serialNo ? `Serial ${a.serialNo}` : null].filter(Boolean).join(' · ')

export function MyAssets() {
  const q = useMyAssets()
  const list = q.data ?? []
  const withMe = list.filter((a) => a.withMe)
  const returned = list.filter((a) => !a.withMe)
  return (
    <ModulePage crumb="My workspace" title="My assets" subtitle="Company equipment handed to you, and what you’ve returned.">
      {q.isLoading ? <State kind="loading" height={200} />
        : q.error ? <State kind="error" title="Couldn’t load your assets" description={(q.error as Error).message} onRetry={() => q.refetch()} />
          : list.length === 0 ? <State kind="empty" icon="briefcase" title="No equipment recorded for you" description="When HR hands you a laptop, ID card or anything else, it shows up here." />
            : (
              <div style={{ display: 'grid', gap: 16 }}>
                <StatRow min={180} tiles={[
                  { icon: 'briefcase', color: 'blue', label: 'With you', value: String(withMe.length), sub: 'Look after these' },
                  { icon: 'checkCircle', color: 'green', label: 'Returned', value: String(returned.length), sub: 'Handed back to HR' },
                ]} />
                <SubHeading>With you</SubHeading>
                {withMe.length === 0 ? <Note>You don’t hold any company equipment right now.</Note> : (
                  <RowList>
                    {withMe.map((a) => <Row key={`${a.assetId}-${a.assignedAt}`} title={a.assetName} meta={meta(a)}
                      trail={<><span style={{ fontSize: 12.5, color: '#64748b' }}>{`Since ${dmy(a.assignedAt)}`}</span><HrStatusPill tone="info">With you</HrStatusPill></>} />)}
                  </RowList>
                )}
                {returned.length > 0 && <>
                  <SubHeading>Returned</SubHeading>
                  <RowList>
                    {returned.map((a) => <Row key={`${a.assetId}-${a.assignedAt}-${a.returnedAt}`} muted title={a.assetName} meta={`${meta(a)} · Had it ${dmy(a.assignedAt)} to ${dmy(a.returnedAt)}`}
                      note={a.returnNotes || undefined} trail={<HrStatusPill tone="gray">Returned</HrStatusPill>} />)}
                  </RowList>
                </>}
                <Note>Something missing or wrong here? Tell HR, who keep this list.</Note>
              </div>
            )}
    </ModulePage>
  )
}
