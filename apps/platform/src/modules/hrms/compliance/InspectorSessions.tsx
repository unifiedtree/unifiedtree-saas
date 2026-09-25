// Inspector access, on the module kit: time-limited, read-only signed links
// to this company's compliance deadlines and filings (no OTP), plus the PDFs
// shared with each inspection.
//   list / documents: hrms.compliance.inspector.read or compliance.read
//   create, link, revoke, share PDFs: hrms.compliance.inspector.write or compliance.write
import { useState, type FormEvent } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { usePermission } from '@unifiedtree/sdk'
import { apiJson } from '@/core/api/client'
import { HrButton, HrStatusPill, TableCard } from '@/shared/components/hr'
import { HrPagination } from '@/shared/components/HrPagination'
import { Panel, State, Note, SubHeading, useDesignToast, stamp } from '@/design/module/ModuleKit'
import { InspectionFiles } from './InspectionFiles'

interface Session { id: string; inspectorName: string; inspectorOrg?: string; purpose: string; status: string; expiresAt: string; lastAccessedAt?: string }
const words = (v: string) => v.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase())
const label = 'mb-1.5 block text-[13px] font-semibold text-text-secondary'
/** yyyy-MM-ddTHH:mm in local time, for datetime-local bounds. */
const localInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)

export function InspectorSessions({ companyId }: { companyId: string }) {
  const write = usePermission('hrms.compliance.write'), inspectorWrite = usePermission('hrms.compliance.inspector.write')
  const canManage = write || inspectorWrite
  const [page, setPage] = useState(0)
  const [link, setLink] = useState('')
  const [documentSession, setDocumentSession] = useState<string | null>(null)
  const [form, setForm] = useState({ inspectorName: '', inspectorOrg: '', purpose: '', expiresAt: '' })
  const qc = useQueryClient()
  const { show, node } = useDesignToast()
  const query = useQuery({
    queryKey: ['hrms', 'compliance', 'inspectors', companyId, page],
    queryFn: () => apiJson<{ content: Session[]; totalElements: number; totalPages: number }>(`/v1/compliance/inspector-sessions?companyId=${companyId}&page=${page}&size=20`),
    enabled: !!companyId,
  })
  const create = useMutation({
    mutationFn: () => apiJson<Session>('/v1/compliance/inspector-sessions', { method: 'POST', body: JSON.stringify({ ...form, companyId, expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : undefined }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'compliance', 'inspectors'] }),
  })
  const revoke = useMutation({
    mutationFn: (id: string) => apiJson(`/v1/compliance/inspector-sessions/${id}/revoke`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'compliance', 'inspectors'] }),
  })
  async function share(id: string) {
    try {
      const result = await apiJson<{ token: string }>(`/v1/compliance/inspector-sessions/${id}/link`, { method: 'POST' })
      setLink(`${window.location.origin}/inspection#${result.token}`)
    } catch (e) { show('Couldn’t create the link', true, (e as Error).message) }
  }
  async function save(e: FormEvent) {
    e.preventDefault()
    try {
      const session = await create.mutateAsync()
      setPage(0)
      await share(session.id)
      show('Inspection access created')
      setForm({ inspectorName: '', inspectorOrg: '', purpose: '', expiresAt: '' })
    } catch (err) { show('Couldn’t create the access', true, (err as Error).message) }
  }
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); show('Link copied') } catch { show('Copy failed; select the link and copy it', true) }
  }
  const now = new Date()
  const rows = query.data?.content ?? []
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Note>Share time-limited, read-only access to this company’s compliance deadlines and filing status. Access stops when it expires or you revoke it.</Note>
      {canManage && (
        <Panel title="Give an inspector access" sub="They get a signed link; no login or OTP.">
          <form onSubmit={save} className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2">
            <div><label className={label} htmlFor="ins-name">Inspector name</label><input id="ins-name" className="ut-input" required maxLength={200} value={form.inspectorName} onChange={(e) => setForm({ ...form, inspectorName: e.target.value })} /></div>
            <div><label className={label} htmlFor="ins-org">Organisation</label><input id="ins-org" className="ut-input" maxLength={200} placeholder="Optional" value={form.inspectorOrg} onChange={(e) => setForm({ ...form, inspectorOrg: e.target.value })} /></div>
            <div><label className={label} htmlFor="ins-purpose">Audit purpose</label><input id="ins-purpose" className="ut-input" required maxLength={200} value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} /></div>
            <div><label className={label} htmlFor="ins-exp">Access ends (within 7 days)</label><input id="ins-exp" className="ut-input" required type="datetime-local" min={localInput(now)} max={localInput(new Date(now.getTime() + 7 * 864e5))} value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} /></div>
            <div className="sm:col-span-2 flex justify-end"><HrButton type="submit" disabled={create.isPending || !companyId}>{create.isPending ? 'Creating…' : 'Create inspection link'}</HrButton></div>
          </form>
        </Panel>
      )}
      {link && (
        <Panel title="Inspection link" aside={<HrButton size="sm" variant="ghost" onClick={() => setLink('')}>Hide</HrButton>}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input readOnly aria-label="Inspection link" className="ut-input" style={{ flex: '1 1 320px' }} value={link} onFocus={(e) => e.target.select()} />
            <HrButton onClick={copy}>Copy</HrButton>
            <a className="inline-flex items-center text-[13px] font-semibold text-accent-fg hover:underline" href={link} target="_blank" rel="noreferrer">Open the read-only view ↗</a>
          </div>
          <Note tone="amber">Anyone with this link can see the shared compliance information until access ends.</Note>
        </Panel>
      )}
      {documentSession && <InspectionFiles key={documentSession} sessionId={documentSession} canWrite={canManage} onClose={() => setDocumentSession(null)} />}
      <SubHeading>Inspections</SubHeading>
      {query.isError ? <State kind="error" title="Couldn’t load inspections" description={query.error.message} onRetry={() => query.refetch()} />
        : query.isLoading ? <State kind="loading" />
          : !rows.length ? <State kind="empty" icon="lock" title="No inspections yet" description={canManage ? 'Create a link above when an inspector asks for access.' : 'Inspections HR sets up appear here.'} />
            : (
              <TableCard footer={(query.data?.totalPages ?? 0) > 1 ? <HrPagination page={page} pageSize={20} totalElements={query.data?.totalElements || 0} totalPages={query.data?.totalPages || 0} onPageChange={setPage} /> : undefined}>
                <div className="overflow-x-auto">
                  <table className="hr-table">
                    <thead><tr><th>Audit</th><th>Inspector</th><th>Access ends</th><th>Last opened</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
                    <tbody>
                      {rows.map((s) => (
                        <tr key={s.id}>
                          <td className="font-semibold text-text-primary">{s.purpose}</td>
                          <td>{s.inspectorName}{s.inspectorOrg && <p className="text-xs text-text-secondary">{s.inspectorOrg}</p>}</td>
                          <td className="text-text-secondary whitespace-nowrap">{stamp(s.expiresAt)}</td>
                          <td className="text-text-secondary whitespace-nowrap">{s.lastAccessedAt ? stamp(s.lastAccessedAt) : 'Not opened yet'}</td>
                          <td><HrStatusPill tone={s.status === 'ACTIVE' ? 'ok' : 'gray'}>{words(s.status)}</HrStatusPill></td>
                          <td>
                            <div className="flex flex-wrap gap-1.5">
                              <HrButton size="sm" variant="ghost" aria-pressed={documentSession === s.id} onClick={() => setDocumentSession(documentSession === s.id ? null : s.id)}>Documents</HrButton>
                              {s.status === 'ACTIVE' && canManage && <>
                                <HrButton size="sm" variant="ghost" onClick={() => share(s.id)}>Get link</HrButton>
                                <HrButton size="sm" variant="ghost" disabled={revoke.isPending} onClick={async () => {
                                  if (!window.confirm(`Revoke ${s.inspectorName}’s access now? Their link stops working straight away.`)) return
                                  try { await revoke.mutateAsync(s.id); setLink(''); setDocumentSession(null); show('Access revoked') } catch (e) { show('Couldn’t revoke the access', true, (e as Error).message) }
                                }}>Revoke</HrButton>
                              </>}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </TableCard>
            )}
      {node}
    </div>
  )
}
