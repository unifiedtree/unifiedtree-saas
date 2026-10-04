// The supplementary record the new-hire wizard saves with an onboarding (prototype PgTalent
// "Onboarding record"): hire details, the joining-day checklist, assets recorded as issued,
// policies picked for the hire and the document verification list. HR working notes, so the
// endpoint needs hrms.employee.write; callers render it only with that permission.
import { useQuery } from '@tanstack/react-query'
import { apiJson } from '@/core/api/client'
import { KeyValueGrid, Section, StatusPill, Table, type TableColumn } from '@/design/kit/display'
import { SectionCell, SectionGrid } from '@/design/kit/data'
import './onboarding.css'

export interface OnboardingRecordData {
  details?: Record<string, string>
  assets?: { type: string; model: string; serial: string; issuedOn: string }[]
  selectedPolicies?: string[]
  joiningChecklist?: Record<string, boolean>
  documentChecklist?: Record<string, { fileName: string; status: string }>
  /** Read-only, from the GET: offer accepted date, hiring manager, recruiter, source and buddy (V143.20). */
  hire?: {
    offerAcceptedOn?: string | null; source?: string | null; fromHiring?: boolean
    hiringManager?: { id: string; name: string } | null; recruiter?: { id: string; name: string } | null; buddy?: { id: string; name: string } | null
  }
}
export const saveOnboardingRecord = (employeeId: string, data: OnboardingRecordData) =>
  apiJson<OnboardingRecordData>(`/v1/hrms/employees/${employeeId}/onboarding-record`, { method: 'PUT', body: JSON.stringify(data) })

const label = (value: string) => value.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ').replace(/^./, (c) => c.toUpperCase())

type Asset = NonNullable<OnboardingRecordData['assets']>[number]
const ASSET_COLUMNS: TableColumn<Asset>[] = [
  { key: 'type', header: 'Type', primary: true, render: (a) => a.type || '—' },
  { key: 'model', header: 'Model', render: (a) => a.model || '—' },
  { key: 'serial', header: 'Serial', render: (a) => a.serial || '—' },
  { key: 'issued', header: 'Issued on', render: (a) => a.issuedOn || '—' },
]
type Check = { key: string; done: boolean }
const CHECK_COLUMNS: TableColumn<Check>[] = [
  { key: 'task', header: 'Task', primary: true, render: (c) => label(c.key) },
  { key: 'status', header: 'Status', render: (c) => <StatusPill tone={c.done ? 'success' : 'warning'}>{c.done ? 'Confirmed' : 'Pending'}</StatusPill> },
]
type Doc = { key: string; fileName: string; status: string }
const docTone = (s: string) => (s === 'VERIFIED' ? 'success' : s === 'REJECTED' ? 'danger' : 'warning') as 'success' | 'danger' | 'warning'
const DOC_COLUMNS: TableColumn<Doc>[] = [
  { key: 'doc', header: 'Document', primary: true, render: (d) => label(d.key) },
  { key: 'file', header: 'File', render: (d) => <span className="onb-clip" title={d.fileName}>{d.fileName || '—'}</span> },
  { key: 'status', header: 'Status', render: (d) => <StatusPill tone={docTone(d.status)}>{label(d.status.toLowerCase())}</StatusPill> },
]

/** Render only for employee-write permission: these are HR working notes. */
export function OnboardingRecord({ employeeId }: { employeeId: string }) {
  const query = useQuery({ queryKey: ['hrms', 'onboarding-record', employeeId], queryFn: () => apiJson<OnboardingRecordData>(`/v1/hrms/employees/${employeeId}/onboarding-record`) })
  const record = query.data
  const details = Object.entries(record?.details ?? {}).filter(([, v]) => v)
  const checks: Check[] = Object.entries(record?.joiningChecklist ?? {}).map(([key, done]) => ({ key, done }))
  const docs: Doc[] = Object.entries(record?.documentChecklist ?? {}).map(([key, d]) => ({ key, fileName: d.fileName, status: d.status }))
  const assets = record?.assets ?? []
  const policies = record?.selectedPolicies ?? []
  const nothing = !details.length && !checks.length && !docs.length && !assets.length && !policies.length
  if (query.isPending || query.isError || nothing) {
    return (
      <Section title="Onboarding record" sub="Saved with onboarding by the new-hire form." loading={query.isPending} skeleton="text" error={query.error} onRetry={() => query.refetch()} retrying={query.isRefetching}
        empty={{ title: 'No supplementary onboarding record has been saved.', hint: 'The new-hire form saves one when HR adds someone through Start onboarding.', variant: 'dashed' }} />
    )
  }
  return (
    <SectionGrid label="Onboarding record">
      {details.length > 0 && (
        <SectionCell>
          <Section title="Onboarding record" sub="Saved with onboarding by the new-hire form.">
            <KeyValueGrid items={details.map(([k, v]) => ({ key: k, label: label(k), value: v }))} />
          </Section>
        </SectionCell>
      )}
      {checks.length > 0 && (
        <SectionCell width="half">
          <Section title="Joining checklist" body="flush"><Table label="Joining checklist" columns={CHECK_COLUMNS} rows={checks} rowKey={(c) => c.key} minWidth={320} /></Section>
        </SectionCell>
      )}
      {assets.length > 0 && (
        <SectionCell width="half">
          <Section title="Recorded asset issues" body="flush"><Table label="Recorded asset issues" columns={ASSET_COLUMNS} rows={assets} rowKey={(_a, i) => i} mobile="cards" /></Section>
        </SectionCell>
      )}
      {policies.length > 0 && (
        <SectionCell>
          <Section title="Policies selected for the hire" sub="Selection does not record an employee acknowledgement." body="list">
            <div className="onb-row" style={{ padding: '4px 20px 20px' }}>{policies.map((p) => <StatusPill key={p} tone="neutral" size="md">{p}</StatusPill>)}</div>
          </Section>
        </SectionCell>
      )}
      {docs.length > 0 && (
        <SectionCell>
          <Section title="Document verification checklist" sub="This is the verification record. Store the actual files in Employee Documents." body="flush">
            <Table label="Document verification checklist" columns={DOC_COLUMNS} rows={docs} rowKey={(d) => d.key} mobile="cards" />
          </Section>
        </SectionCell>
      )}
    </SectionGrid>
  )
}
