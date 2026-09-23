import { useQuery } from '@tanstack/react-query'
import { apiJson } from '@/core/api/client'
import { HrButton } from '@/shared/components/hr'

export interface OnboardingRecordData {
  details?: Record<string, string>
  assets?: { type: string; model: string; serial: string; issuedOn: string }[]
  selectedPolicies?: string[]
  joiningChecklist?: Record<string, boolean>
  documentChecklist?: Record<string, { fileName: string; status: string }>
}
export const saveOnboardingRecord = (employeeId: string, data: OnboardingRecordData) =>
  apiJson<OnboardingRecordData>(`/v1/hrms/employees/${employeeId}/onboarding-record`, { method: 'PUT', body: JSON.stringify(data) })

const label = (value: string) => value.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ').replace(/^./, c => c.toUpperCase())

/** Render only for employee-write permission: these are HR working notes. */
export function OnboardingRecord({ employeeId }: { employeeId: string }) {
  const query = useQuery({ queryKey: ['hrms', 'onboarding-record', employeeId], queryFn: () => apiJson<OnboardingRecordData>(`/v1/hrms/employees/${employeeId}/onboarding-record`) })
  const record = query.data
  return <section className="ut-card mt-5 p-5"><h2 className="text-base font-semibold">Onboarding record</h2>
    {query.isPending ? <p className="mt-3 text-sm" role="status">Loading onboarding record...</p>
      : query.isError ? <div role="alert" className="mt-3 text-sm"><p>Unable to load onboarding details.</p><HrButton variant="ghost" onClick={() => query.refetch()}>Try again</HrButton></div>
      : !record || !Object.keys(record).length ? <p className="mt-3 text-sm text-text-secondary">No supplementary onboarding record has been saved.</p>
      : <div className="mt-4 space-y-5">
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{Object.entries(record.details ?? {}).filter(([, value]) => value).map(([key, value]) => <div key={key}><dt className="text-xs text-text-secondary">{label(key)}</dt><dd className="mt-1 break-words text-sm">{value}</dd></div>)}</dl>
        {!!record.assets?.length && <div><h3 className="text-sm font-semibold">Recorded asset issues</h3><div className="mt-2 overflow-x-auto"><table className="hr-table"><thead><tr><th>Type</th><th>Model</th><th>Serial</th><th>Issued on</th></tr></thead><tbody>{record.assets.map((asset,i) => <tr key={i}><td>{asset.type}</td><td>{asset.model}</td><td>{asset.serial}</td><td>{asset.issuedOn}</td></tr>)}</tbody></table></div></div>}
        {!!record.selectedPolicies?.length && <div><h3 className="text-sm font-semibold">Policies selected for the hire</h3><p className="mt-1 text-sm">{record.selectedPolicies.join(', ')}</p><p className="mt-1 text-xs text-text-secondary">Selection does not record an employee acknowledgement.</p></div>}
        {!!Object.keys(record.joiningChecklist ?? {}).length && <div><h3 className="text-sm font-semibold">Joining checklist</h3><ul className="mt-2 grid gap-2 text-sm sm:grid-cols-2">{Object.entries(record.joiningChecklist ?? {}).map(([key, checked]) => <li key={key}>{label(key)}: {checked ? 'Confirmed' : 'Pending'}</li>)}</ul></div>}
        {!!Object.keys(record.documentChecklist ?? {}).length && <div><h3 className="text-sm font-semibold">Document verification checklist</h3><ul className="mt-2 space-y-2 text-sm">{Object.entries(record.documentChecklist ?? {}).map(([key, doc]) => <li key={key}>{label(key)} — {doc.fileName}: {label(doc.status.toLowerCase())}</li>)}</ul><p className="mt-2 text-xs text-text-secondary">This is the verification record. Store the actual files in Employee Documents.</p></div>}
      </div>}
  </section>
}
