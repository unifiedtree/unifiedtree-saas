import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiBlob, apiJson } from '@/core/api/client'
import { HrButton } from '@/shared/components/hr'
import { useToast } from '@/shared/hooks/useToast'

export function InspectionFiles({ sessionId, canWrite }: { sessionId: string; canWrite: boolean }) {
  const [title, setTitle] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const { toast } = useToast()
  const qc = useQueryClient()
  const path = `/v1/compliance/inspector-sessions/${sessionId}/documents`
  const query = useQuery({
    queryKey: ['inspection-files', sessionId],
    queryFn: () => apiJson<{ id: string; title: string; sizeBytes: number }[]>(path),
  })
  return (
    <section className="ut-card space-y-3 p-5">
      <h2 className="font-semibold">Documents shared with this inspection</h2>
      <p className="text-sm text-text-secondary">
        Attach only documents approved for this inspector. Anyone with this inspection link can
        download them until access expires or is revoked.
      </p>
      {canWrite && (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={async (e) => {
            e.preventDefault()
            if (!file) return
            if (file.size > 5 * 1024 * 1024) {
              toast('Choose a PDF of at most 5 MB', 'error')
              return
            }
            const formElement = e.currentTarget
            setBusy(true)
            try {
              const body = new FormData()
              body.append('title', title)
              body.append('file', file)
              await apiBlob(path, { method: 'POST', body })
              await qc.invalidateQueries({ queryKey: ['inspection-files', sessionId] })
              setTitle('')
              setFile(null)
              formElement.reset()
              toast('Document shared', 'success')
            } catch (error) {
              toast((error as Error).message, 'error')
            } finally {
              setBusy(false)
            }
          }}
        >
          <label className="text-sm">
            Document title
            <input
              aria-label="Shared document title"
              className="ut-input"
              maxLength={200}
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label className="text-sm">
            PDF (up to 5 MB)
            <input
              aria-label="Inspection PDF"
              type="file"
              accept="application/pdf,.pdf"
              required
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </label>
          <HrButton type="submit" disabled={busy}>
            {busy ? 'Uploading...' : 'Share PDF'}
          </HrButton>
        </form>
      )}
      {query.isError ? (
        <div role="alert">
          {query.error.message}
          <HrButton onClick={() => query.refetch()}>Retry</HrButton>
        </div>
      ) : query.isLoading ? (
        <p>Loading shared documents...</p>
      ) : !query.data?.length ? (
        <p className="text-sm text-text-secondary">No documents shared.</p>
      ) : (
        <ul className="divide-y divide-border">
          {query.data.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-3 py-3">
              <span>
                {item.title}{' '}
                <span className="text-xs text-text-secondary">
                  ({Math.ceil(item.sizeBytes / 1024)} KB)
                </span>
              </span>
              {canWrite && (
                <HrButton
                  variant="ghost"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true)
                    try {
                      await apiJson(`${path}/${item.id}`, { method: 'DELETE' })
                      await qc.invalidateQueries({ queryKey: ['inspection-files', sessionId] })
                      toast('Document unshared', 'success')
                    } catch (error) {
                      toast((error as Error).message, 'error')
                    } finally {
                      setBusy(false)
                    }
                  }}
                >
                  Unshare
                </HrButton>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
