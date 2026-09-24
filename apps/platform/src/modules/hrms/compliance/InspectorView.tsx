import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format, endOfMonth } from 'date-fns'
import { HrButton } from '@/shared/components/hr'
import { API_BASE_URL } from '@/core/api/client'
import { inspectorCsv } from './inspectorCsv'
interface View {
  inspectorName: string
  purpose: string
  expiresAt: string
  documents: { id: string; title: string; sizeBytes: number }[]
  events: { id: string; title: string; date: string; status: string; category?: string }[]
}
// The link opens on the workspace's own host (<tenant>.unifiedtree.com), which
// only serves the web app, so these calls must go to the API host itself — a
// relative /api path there returns the app's HTML, not data.
const INSPECTOR_VIEW_URL = `${API_BASE_URL}/v1/public/inspector-view`
const INSPECTOR_DOCUMENT_URL = `${API_BASE_URL}/v1/public/inspector-view/document`

/** The server's error message when the reply is JSON; null for anything else (e.g. an HTML error page). */
async function errorMessage(response: Response): Promise<string | null> {
  try {
    const body = await response.json()
    return typeof body?.message === 'string' && body.message ? body.message : null
  } catch {
    return null
  }
}
export default function InspectorView() {
  const [token] = useState(() => window.location.hash.slice(1))
  const [month, setMonth] = useState(() => format(new Date(), 'yyyy-MM'))
  const [exporting, setExporting] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [exportError, setExportError] = useState('')
  const query = useQuery({
    queryKey: ['inspection', token, month],
    retry: false,
    gcTime: 0,
    queryFn: async () => {
      const response = await fetch(INSPECTOR_VIEW_URL, {
        method: 'POST',
        credentials: 'omit',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          from: `${month}-01`,
          to: format(endOfMonth(new Date(`${month}-01T12:00:00`)), 'yyyy-MM-dd'),
        }),
      })
      if (!response.ok)
        throw new Error((await errorMessage(response)) || 'This inspection link is invalid, expired or revoked.')
      return (await response.json()) as View
    },
    enabled: !!token && /^\d{4}-\d{2}$/.test(month),
  })
  async function downloadDocument(id: string) {
    setDownloading(true)
    setExportError('')
    try {
      const response = await fetch(INSPECTOR_DOCUMENT_URL, {
        method: 'POST',
        credentials: 'omit',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, id }),
      })
      if (!response.ok)
        throw new Error((await errorMessage(response)) || 'Document access is no longer available')
      const url = URL.createObjectURL(await response.blob())
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `inspection-${id}.pdf`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (error) {
      setExportError((error as Error).message)
    } finally {
      setDownloading(false)
    }
  }
  async function exportRecords() {
    setExporting(true)
    setExportError('')
    try {
      // Always revalidate the capability. Never export cached records after revocation or expiry.
      const result = await query.refetch({ throwOnError: true })
      if (!result.data) throw new Error('No inspection records returned.')
      const blob = new Blob(['\uFEFF', inspectorCsv(result.data.events)], {
        type: 'text/csv;charset=utf-8',
      })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `compliance-inspection-${month}.csv`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (error) {
      setExportError((error as Error).message)
    } finally {
      setExporting(false)
    }
  }
  return (
    <main className="mx-auto min-h-screen max-w-5xl space-y-5 bg-bg-base p-6">
      <h1 className="text-2xl font-semibold">Compliance inspection</h1>
      <p className="text-sm text-text-secondary">Read-only company compliance records</p>
      {exportError && (
        <p role="alert" className="text-red-700">
          {exportError}
        </p>
      )}
      {!token ? (
        <p role="alert">Open the complete inspection link supplied by the company administrator.</p>
      ) : query.isError ? (
        <div role="alert" className="ut-card p-5">
          {query.error.message}
        </div>
      ) : (
        <>
          <label className="block">
            Reporting month
            <input
              className="ut-input max-w-xs"
              type="month"
              disabled={exporting}
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
          </label>
          <HrButton
            variant="ghost"
            disabled={exporting || query.isFetching || !query.data}
            onClick={exportRecords}
          >
            {exporting ? 'Preparing export...' : 'Export records (CSV)'}
          </HrButton>
          {query.isLoading ? (
            <p role="status">Checking inspection access...</p>
          ) : (
            query.data && (
              <>
                <div className="ut-card p-5">
                  <h2 className="font-semibold">{query.data.purpose}</h2>
                  <p>{query.data.inspectorName}</p>
                  <p className="text-sm">
                    Access expires {new Date(query.data.expiresAt).toLocaleString()}
                  </p>
                </div>
                <section className="ut-card p-5">
                  <h2 className="font-semibold">Shared documents</h2>
                  {!query.data.documents?.length ? (
                    <p className="mt-2 text-sm text-text-secondary">
                      No documents shared with this inspection.
                    </p>
                  ) : (
                    <ul>
                      {query.data.documents.map((document) => (
                        <li
                          className="flex items-center justify-between gap-3 py-2"
                          key={document.id}
                        >
                          <span>{document.title}</span>
                          <HrButton
                            variant="ghost"
                            disabled={downloading}
                            onClick={() => downloadDocument(document.id)}
                          >
                            Download PDF
                          </HrButton>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
                <div className="ut-card overflow-x-auto">
                  <table className="hr-table">
                    <thead>
                      <tr>
                        <th>Obligation / filing</th>
                        <th>Due date</th>
                        <th>Category</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {query.data.events.length ? (
                        query.data.events.map((e) => (
                          <tr key={e.id}>
                            <td>{e.title}</td>
                            <td>{e.date}</td>
                            <td>{e.category || '-'}</td>
                            <td>{e.status}</td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={4}>No recorded deadlines for this month.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )
          )}
        </>
      )}
    </main>
  )
}
