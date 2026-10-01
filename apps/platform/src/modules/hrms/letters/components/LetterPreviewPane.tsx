// The live letter preview (client request, 2 Oct: "a preview option while
// uploading … everything about templates"). Shown next to the template editor,
// in Generate letter and in New distribution, before anything is saved:
//   - the workspace's letterhead (logo and company name) on top, as the PDF has it
//   - the merge fields filled from someone the viewer may see: by default their own
//     record; anyone else's with the employee directory. With no record of their
//     own, the catalogue's example values, and it says so.
//   - the page it prints on (A4) and how many pages it takes
//   - fields that have no value, named, and "Open as PDF" for the exact file.
// It follows the draft as it's typed (a short pause, then one request).
import { useEffect, useState } from 'react'
import { P, usePermission } from '@unifiedtree/sdk'
import { Button, Callout, EmptyState, Section, SkeletonBlock } from '@/design/kit/display'
import { useToast } from '@/design/kit/overlays'
import { openPreviewPdf, useLetterPreview, type LetterPreviewRequest } from '../api/useLetters'
import { LetterPaper } from './LetterPaper'
import { PersonSearch, fullName } from './PersonSearch'

/** The request, held back until typing pauses for `ms`. */
export function useSettled<T>(value: T, ms = 600): T {
  const [settled, setSettled] = useState(value)
  const key = JSON.stringify(value)
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ms])
  return settled
}

export function LetterPreviewPane({ request, ready, emptyHint, employeeLocked, title = 'Preview', sub, id }: {
  /** What to render. Its employeeId, when given, wins over the pane's own picker. */
  request: LetterPreviewRequest
  /** False until there's something to preview (e.g. no template picked yet). */
  ready: boolean
  emptyHint?: string
  /** The person is chosen elsewhere (Generate letter): no picker here. */
  employeeLocked?: boolean
  title?: string
  sub?: string
  id?: string
}) {
  const toast = useToast()
  const canPick = usePermission(P.HRMS_EMPLOYEE_READ) && !employeeLocked
  const [as, setAs] = useState<{ id: string; name: string } | null>(null)
  const [picking, setPicking] = useState(false)
  const [opening, setOpening] = useState(false)
  const req = useSettled<LetterPreviewRequest>({ ...request, employeeId: request.employeeId ?? as?.id ?? undefined })
  const q = useLetterPreview(req, { enabled: ready })
  const p = q.data

  const openPdf = async () => {
    setOpening(true)
    try { await openPreviewPdf(req) } catch (e) { toast.error('Couldn’t open the PDF', { detail: (e as Error)?.message }) } finally { setOpening(false) }
  }

  const who = !p ? null : p.sample ? 'Example values' : p.employeeName ? `${p.employeeName}${!request.employeeId && !as ? ' (you)' : ''}` : null
  return (
    <Section id={id} title={title} sub={sub ?? 'How the letter will look, before you save. Nothing is sent.'} cardClass={false}
      actions={ready && p ? <Button size={32} variant="secondary" icon="download" loading={opening} onClick={openPdf}>Open as PDF</Button> : undefined}>
      <div className="lt-preview">
        {!ready ? <EmptyState icon="fileText" title="Nothing to preview yet" hint={emptyHint ?? 'Write the letter to see it here.'} />
          : q.isError && !p ? <Callout tone="danger">{(q.error as Error)?.message || 'Couldn’t render the preview.'}</Callout>
            : !p ? <SkeletonBlock style={{ height: 420 }} />
              : <>
                <div className="lt-preview__bar">
                  <span className="lt-preview__as">
                    {who && <><span className="lt-muted">Filled for </span><strong>{who}</strong></>}
                  </span>
                  {canPick && <Button size={30} variant="ghost" onClick={() => setPicking((v) => !v)} aria-expanded={picking}>
                    {picking ? 'Done' : 'Preview as someone else'}</Button>}
                </div>
                {picking && canPick && (
                  <PersonSearch label="Preview as" selectedId={as?.id} companyId={request.companyId}
                    onPick={(e) => { setAs({ id: e.id, name: fullName(e) }); setPicking(false) }} />
                )}
                {p.sample && <Callout tone="neutral">You have no employee record, so the fields show example values.</Callout>}
                {p.unresolved.length > 0 && (
                  <Callout tone="warning">{`${p.unresolved.length === 1 ? 'This field has' : 'These fields have'} no value and print in red: ${p.unresolved.map((k) => `{{${k}}}`).join(', ')}.`}</Callout>
                )}
                {p.subject && <p className="lt-preview__subject"><span className="lt-muted">Subject: </span>{p.subject}</p>}
                <LetterPaper html={p.html} page={p.page} title="Letter preview" busy={q.isFetching} />
              </>}
      </div>
    </Section>
  )
}
