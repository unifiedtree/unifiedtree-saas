import { InspectionFiles } from './InspectionFiles'
import { useState, type FormEvent } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { usePermission } from '@unifiedtree/sdk'
import { apiJson } from '@/core/api/client'
import { HrButton, HrStatusPill, TableCard } from '@/shared/components/hr'
import { HrPagination } from '@/shared/components/HrPagination'
import { useToast } from '@/shared/hooks/useToast'

interface Session {
  id: string
  inspectorName: string
  inspectorOrg?: string
  purpose: string
  status: string
  expiresAt: string
  lastAccessedAt?: string
}
export function InspectorSessions({ companyId }: { companyId: string }) {
  const write = usePermission('hrms.compliance.write'),
    inspectorWrite = usePermission('hrms.compliance.inspector.write')
  const [page, setPage] = useState(0)
  const [link, setLink] = useState('')
  const [documentSession, setDocumentSession] = useState<string | null>(null)
  const [form, setForm] = useState({
    inspectorName: '',
    inspectorOrg: '',
    purpose: '',
    expiresAt: '',
  })
  const qc = useQueryClient(),
    { toast } = useToast()
  const query = useQuery({
    queryKey: ['hrms', 'compliance', 'inspectors', companyId, page],
    queryFn: () =>
      apiJson<{ content: Session[]; totalElements: number; totalPages: number }>(
        `/v1/compliance/inspector-sessions?companyId=${companyId}&page=${page}&size=20`
      ),
    enabled: !!companyId,
  })
  const create = useMutation({
    mutationFn: () =>
      apiJson<Session>('/v1/compliance/inspector-sessions', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          companyId,
          expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : undefined,
        }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'compliance', 'inspectors'] }),
  })
  const revoke = useMutation({
    mutationFn: (id: string) =>
      apiJson(`/v1/compliance/inspector-sessions/${id}/revoke`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'compliance', 'inspectors'] }),
  })
  async function share(id: string) {
    try {
      const result = await apiJson<{ token: string }>(
        `/v1/compliance/inspector-sessions/${id}/link`,
        { method: 'POST' }
      )
      setLink(`${window.location.origin}/inspection#${result.token}`)
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }
  async function save(e: FormEvent) {
    e.preventDefault()
    try {
      const session = await create.mutateAsync()
      setPage(0)
      await share(session.id)
      toast('Inspection access created', 'success')
      setForm({ inspectorName: '', inspectorOrg: '', purpose: '', expiresAt: '' })
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }
  return (
    <div className="space-y-4">
      <p className="ut-card p-4 text-sm text-text-secondary">
        Share time-limited, read-only access to this company's compliance deadlines and filing
        status. Access stops when the session expires or is revoked.
      </p>
      {(write || inspectorWrite) && (
        <form onSubmit={save} className="ut-card grid gap-3 p-5 sm:grid-cols-2">
          {(['inspectorName', 'inspectorOrg', 'purpose', 'expiresAt'] as const).map((field) => (
            <label key={field}>
              {
                {
                  inspectorName: 'Inspector name',
                  inspectorOrg: 'Organisation',
                  purpose: 'Audit purpose',
                  expiresAt: 'Expires at (within 7 days)',
                }[field]
              }
              <input
                className="ut-input"
                required={field !== 'inspectorOrg'}
                type={field === 'expiresAt' ? 'datetime-local' : 'text'}
                maxLength={200}
                value={form[field]}
                onChange={(e) => setForm({ ...form, [field]: e.target.value })}
              />
            </label>
          ))}
          <div>
            <HrButton type="submit" disabled={create.isPending || !companyId}>
              Create inspection link
            </HrButton>
          </div>
        </form>
      )}
      {link && (
        <div className="ut-card space-y-2 p-4">
          <label className="block text-sm">
            Inspection link
            <input
              readOnly
              aria-label="Inspection link"
              className="ut-input"
              value={link}
              onFocus={(e) => e.target.select()}
            />
          </label>
          <a className="text-primary underline" href={link} target="_blank" rel="noreferrer">
            Open read-only inspection
          </a>
          <p className="text-xs text-text-secondary">
            Anyone with this link can view the shared compliance information until access ends.
          </p>
        </div>
      )}
      {documentSession && (
        <InspectionFiles
          key={documentSession}
          sessionId={documentSession}
          canWrite={write || inspectorWrite}
        />
      )}
      {query.isError ? (
        <div role="alert">
          <p>{query.error.message}</p>
          <HrButton onClick={() => query.refetch()}>Retry</HrButton>
        </div>
      ) : (
        <TableCard>
          <div className="overflow-x-auto">
            <table className="hr-table">
              <thead>
                <tr>
                  <th>Audit</th>
                  <th>Inspector</th>
                  <th>Expires</th>
                  <th>Last opened</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {query.isLoading ? (
                  <tr>
                    <td colSpan={6}>Loading inspection sessions...</td>
                  </tr>
                ) : !query.data?.content.length ? (
                  <tr>
                    <td colSpan={6}>No inspection sessions.</td>
                  </tr>
                ) : (
                  query.data.content.map((s) => (
                    <tr key={s.id}>
                      <td>{s.purpose}</td>
                      <td>
                        {s.inspectorName}
                        <p className="text-xs">{s.inspectorOrg}</p>
                      </td>
                      <td>{new Date(s.expiresAt).toLocaleString()}</td>
                      <td>
                        {s.lastAccessedAt
                          ? new Date(s.lastAccessedAt).toLocaleString()
                          : 'Not opened'}
                      </td>
                      <td>
                        <HrStatusPill tone={s.status === 'ACTIVE' ? 'ok' : 'gray'}>
                          {s.status}
                        </HrStatusPill>
                      </td>
                      <td>
                        {s.status === 'ACTIVE' && (write || inspectorWrite) && (
                          <div className="flex gap-2">
                            <HrButton variant="ghost" onClick={() => share(s.id)}>
                              Get link
                            </HrButton>
                            <HrButton
                              variant="ghost"
                              onClick={() =>
                                setDocumentSession(documentSession === s.id ? null : s.id)
                              }
                            >
                              Documents
                            </HrButton>
                            <HrButton
                              variant="ghost"
                              disabled={revoke.isPending}
                              onClick={async () => {
                                try {
                                  await revoke.mutateAsync(s.id)
                                  setLink('')
                                  setDocumentSession(null)
                                  toast('Access revoked', 'success')
                                } catch (e) {
                                  toast((e as Error).message, 'error')
                                }
                              }}
                            >
                              Revoke
                            </HrButton>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </TableCard>
      )}
      <HrPagination
        page={page}
        pageSize={20}
        totalElements={query.data?.totalElements || 0}
        totalPages={query.data?.totalPages || 0}
        onPageChange={setPage}
      />
    </div>
  )
}
