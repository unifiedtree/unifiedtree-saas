// PDFs shared with one inspection (read: inspector.read or compliance.read;
// share / unshare: inspector.write or compliance.write), in a kit panel.
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiBlob, apiJson } from '@/core/api/client'
import { HrButton } from '@/shared/components/hr'
import { Panel, State, Note, RowList, Row, useDesignToast } from '@/design/module/ModuleKit'
import { fileSize } from '@/shared/export/fileExport'

export function InspectionFiles({ sessionId, canWrite, onClose }: { sessionId: string; canWrite: boolean; onClose?: () => void }) {
  const [title, setTitle] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const { show, node } = useDesignToast()
  const qc = useQueryClient()
  const path = `/v1/compliance/inspector-sessions/${sessionId}/documents`
  const query = useQuery({ queryKey: ['inspection-files', sessionId], queryFn: () => apiJson<{ id: string; title: string; sizeBytes: number }[]>(path) })
  return (
    <Panel title="Documents shared with this inspection" aside={onClose ? <HrButton size="sm" variant="ghost" onClick={onClose}>Close</HrButton> : undefined}>
      <Note tone="amber">Share only documents approved for this inspector. Anyone with the inspection link can download them until access ends.</Note>
      {canWrite && (
        <form className="flex flex-wrap items-end gap-3" onSubmit={async (e) => {
          e.preventDefault()
          if (!file) return
          if (file.size > 5 * 1024 * 1024) { show('Choose a PDF of 5 MB or less', true); return }
          const formElement = e.currentTarget
          setBusy(true)
          try {
            const body = new FormData()
            body.append('title', title)
            body.append('file', file)
            await apiBlob(path, { method: 'POST', body })
            await qc.invalidateQueries({ queryKey: ['inspection-files', sessionId] })
            setTitle(''); setFile(null); formElement.reset()
            show('Document shared')
          } catch (error) { show('Couldn’t share the document', true, (error as Error).message) } finally { setBusy(false) }
        }}>
          <div className="min-w-[200px] flex-1"><label className="mb-1.5 block text-[13px] font-semibold text-text-secondary" htmlFor={`if-title-${sessionId}`}>Document title</label>
            <input id={`if-title-${sessionId}`} aria-label="Shared document title" className="ut-input" maxLength={200} required value={title} onChange={(e) => setTitle(e.target.value)} /></div>
          <div><label className="mb-1.5 block text-[13px] font-semibold text-text-secondary" htmlFor={`if-file-${sessionId}`}>PDF (up to 5 MB)</label>
            <input id={`if-file-${sessionId}`} aria-label="Inspection PDF" type="file" accept="application/pdf,.pdf" required onChange={(e) => setFile(e.target.files?.[0] || null)} className="text-[13px]" /></div>
          <HrButton type="submit" disabled={busy}>{busy ? 'Uploading…' : 'Share PDF'}</HrButton>
        </form>
      )}
      {query.isError ? <State kind="error" title="Couldn’t load the documents" description={query.error.message} onRetry={() => query.refetch()} />
        : query.isLoading ? <State kind="loading" height={80} />
          : !query.data?.length ? <p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>No documents shared yet.</p>
            : (
              <RowList>
                {query.data.map((item) => (
                  <Row key={item.id} title={item.title} meta={`PDF · ${fileSize(item.sizeBytes)}`}
                    trail={canWrite ? <HrButton size="sm" variant="ghost" disabled={busy} onClick={async () => {
                      setBusy(true)
                      try {
                        await apiJson(`${path}/${item.id}`, { method: 'DELETE' })
                        await qc.invalidateQueries({ queryKey: ['inspection-files', sessionId] })
                        show('Document unshared')
                      } catch (error) { show('Couldn’t unshare the document', true, (error as Error).message) } finally { setBusy(false) }
                    }}>Unshare</HrButton> : undefined} />
                ))}
              </RowList>
            )}
      {node}
    </Panel>
  )
}
