// The supplementary onboarding record saved with a new hire by the Add employee / onboarding
// wizard (GET /v1/hrms/employees/{id}/onboarding-record): joining-day checklist, the assets
// recorded as issued, the policies selected and the document verification notes. HR working
// notes: the API serves them only with hrms.employee.write, so callers render this only then.
// On the kit (P-HIRE; prototype PgTalent h-onb "Open record").
import { useQuery } from '@tanstack/react-query'
import { apiJson } from '@/core/api/client'
import { KeyValueGrid, Section, StatusPill, Table, type TableColumn } from '@/design/kit/display'
import { SectionCell, SectionGrid } from '@/design/kit/data'
import '../hiring/hiring.css'

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

/** "workEmail" → "Work email"; "itAccess" → "IT access". */
const label = (value: string) => value.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ').toLowerCase()
  .replace(/^./, (c) => c.toUpperCase()).replace(/^It\b/, 'IT').replace(/\b(hr|pan|uan|esi|ifsc)\b/gi, (w) => w.toUpperCase())
/** The joining-day checks as the wizard words them (OnboardingForm's CHECKLIST_ITEMS). */
const CHECK_LABEL: Record<string, string> = {
  documents: 'Documents verified', payroll: 'Payroll setup completed', itAccess: 'IT access created', assets: 'Laptop and assets ready', welcomeKit: 'Welcome kit prepared',
}

type Asset = NonNullable<OnboardingRecordData['assets']>[number]
const ASSET_COLUMNS: TableColumn<Asset>[] = [
  { key: 'type', header: 'Type', primary: true, render: (a) => a.type || '—' },
  { key: 'model', header: 'Model', render: (a) => a.model || '—' },
  { key: 'serial', header: 'Serial', render: (a) => a.serial || '—' },
  { key: 'issued', header: 'Issued on', render: (a) => <span className="hi-num">{a.issuedOn || '—'}</span> },
]
const CHECK_COLUMNS: TableColumn<[string, boolean]>[] = [
  { key: 'task', header: 'Task', primary: true, render: ([k]) => CHECK_LABEL[k] ?? label(k) },
  { key: 'status', header: 'Status', render: ([, done]) => <StatusPill tone={done ? 'success' : 'warning'}>{done ? 'Confirmed' : 'Pending'}</StatusPill> },
]

/** Render only for hrms.employee.write: these are HR working notes. Nothing shows when none were saved. */
export function OnboardingRecord({ employeeId }: { employeeId: string }) {
  const query = useQuery({
    queryKey: ['hrms', 'onboarding-record', employeeId],
    queryFn: () => apiJson<OnboardingRecordData>(`/v1/hrms/employees/${employeeId}/onboarding-record`),
    retry: false,
  })
  const r = query.data
  const details = Object.entries(r?.details ?? {}).filter(([, v]) => v)
  const checklist = Object.entries(r?.joiningChecklist ?? {})
  const documents = Object.entries(r?.documentChecklist ?? {})
  const assets = r?.assets ?? []
  const policies = r?.selectedPolicies ?? []
  const empty = !!r && !details.length && !checklist.length && !documents.length && !assets.length && !policies.length
  if (query.isSuccess && empty) return null
  return (
    <Section title="Onboarding record" sub="Saved with the new hire when they were added." level={3} body="tight"
      loading={query.isLoading} skeleton="text" error={query.error} onRetry={() => query.refetch()} retrying={query.isFetching}>
      {r && (
        <div className="hi-stack">
          {details.length > 0 && <KeyValueGrid items={details.map(([k, v]) => ({ key: k, label: label(k), value: v }))} />}
          {(checklist.length > 0 || assets.length > 0) && (
            <SectionGrid>
              {checklist.length > 0 && (
                <SectionCell width={assets.length ? 'half' : 'full'}>
                  <Section title="Joining checklist" level={3} variant="panel" body="flush" cardClass={false}>
                    <Table label="Joining checklist" columns={CHECK_COLUMNS} rows={checklist} rowKey={([k]) => k} minWidth={0} mobile="cards" />
                  </Section>
                </SectionCell>
              )}
              {assets.length > 0 && (
                <SectionCell width={checklist.length ? 'half' : 'full'}>
                  <Section title="Recorded asset issues" level={3} variant="panel" body="flush" cardClass={false}>
                    <Table label="Recorded asset issues" columns={ASSET_COLUMNS} rows={assets} rowKey={(a, i) => `${a.serial}-${i}`} minWidth={0} mobile="cards" />
                  </Section>
                </SectionCell>
              )}
            </SectionGrid>
          )}
          {policies.length > 0 && (
            <Section title="Policies selected for the hire" sub="Selection does not record an employee acknowledgement." level={3} variant="panel" cardClass={false}>
              <p className="hi-copy">{policies.join(', ')}</p>
            </Section>
          )}
          {documents.length > 0 && (
            <Section title="Document verification checklist" sub="This is the verification record. Store the actual files in Employee Documents." level={3} variant="panel" cardClass={false}>
              <KeyValueGrid items={documents.map(([k, d]) => ({ key: k, label: label(k), value: `${d.fileName}: ${label(d.status)}` }))} />
            </Section>
          )}
        </div>
      )}
    </Section>
  )
}
