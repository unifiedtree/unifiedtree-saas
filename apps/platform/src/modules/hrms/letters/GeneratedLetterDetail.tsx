// One generated letter (/hrms/letters/generated/:id), on the kit (P-DOCS): who
// it is for, which template, when it was issued, who generated it, its
// signature, the merge values it was filled with, its history, and the actions
// the person may take: Download, Send (or send again, optionally asking for a
// signature), Void (with a reason) and Delete (asked first).
import React, { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Can, P, usePermission } from '@unifiedtree/sdk'
import {
  Button, EmptyState, ErrorState, KeyValueGrid, PageFrame, PageHeader, Section, SkeletonBlock, StatusPill,
} from '@/design/kit/display'
import { SectionGrid, SectionCell, Timeline, type TimelineItem } from '@/design/kit/data'
import { useToast } from '@/design/kit/overlays'
import { useConfirmDialog } from '@/shared/components/ConfirmDialog'
import { useGeneratedLetter, useDeleteGeneratedLetter, downloadLetterPdf } from './api/useLetters'
import { LETTER_TYPE_LABEL, dayText, issuedDay, letterName, letterStatus, localDay, signatureNote } from './lettersModel'
import { SendLetterDialog, VoidLetterDialog } from './components/LetterDialogs'
import './components/letters.css'

const at = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '')

export const GeneratedLetterDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const toast = useToast()
  const confirm = useConfirmDialog()
  const canReadAll = usePermission(P.HRMS_LETTERS_READ)
  const canAct = [usePermission(P.HRMS_LETTERS_SEND), usePermission(P.HRMS_LETTERS_VOID), usePermission(P.HRMS_LETTERS_DELETE)].some(Boolean)
  const { data: letter, isLoading, error, refetch } = useGeneratedLetter(id)
  const deleteMut = useDeleteGeneratedLetter()
  const [sending, setSending] = useState(false)
  const [voiding, setVoiding] = useState(false)
  const [showValues, setShowValues] = useState(false)

  const listPath = canReadAll ? '/hrms/letters/generated' : '/hrms/letters/my'
  const back = <Button variant="secondary" onClick={() => navigate(listPath)}>← All letters</Button>
  if (isLoading || error || !letter) {
    return (
      <PageFrame label="Letter">
        <PageHeader eyebrow="Letters" title="Letter" actions={back} />
        {isLoading ? <SkeletonBlock style={{ height: 260 }} />
          : error ? <ErrorState title="Couldn’t load the letter" error={error} onRetry={() => refetch()} />
            : <EmptyState icon="fileText" title="Letter not found" hint="It may have been deleted." />}
      </PageFrame>
    )
  }

  const status = letterStatus(letter.status)
  const sig = signatureNote(letter)
  const person = letter.employeeName || letter.generationContext?.['employee.fullName'] || 'Employee record unavailable'
  const code = letter.employeeCode || letter.generationContext?.['employee.code']
  const values = letter.generationContext ? Object.entries(letter.generationContext) : []
  const isVoid = letter.status === 'VOID'

  const download = () => downloadLetterPdf(letter.id, `letter-${letter.type.toLowerCase()}-${letter.id.slice(0, 8)}.pdf`)
    .catch((e) => toast.error(e instanceof Error ? e.message : 'Unable to download PDF'))
  const remove = async () => {
    const ok = await confirm({ title: 'Delete this letter?', body: 'It disappears from every list, including theirs. This can’t be undone.', confirmLabel: 'Delete letter', tone: 'danger' })
    if (!ok) return
    try { await deleteMut.mutateAsync(letter.id); toast.success('Letter deleted'); navigate('/hrms/letters/generated') } catch (e) { toast.error('Failed to delete letter', { detail: (e as Error)?.message }) }
  }

  const history: TimelineItem[] = [
    { key: 'gen', label: 'Generated', sub: [at(letter.createdAt), letter.generatedByName ? `by ${letter.generatedByName}` : ''].filter(Boolean).join(' · '), state: 'done' },
    { key: 'sent', label: letter.sentAt ? 'Sent' : 'Not sent yet', sub: letter.sentAt ? [at(letter.sentAt), letter.sentToEmail].filter(Boolean).join(' · ') : 'It’s a draft until it’s sent', state: letter.sentAt ? 'done' : 'todo' },
    ...(letter.viewedAt ? [{ key: 'viewed', label: 'Opened by them', sub: at(letter.viewedAt), state: 'done' as const }] : []),
    ...(letter.signatureRequested || letter.signedAt ? [{
      key: 'signed', label: letter.signedAt ? 'Signed' : 'Waiting for their signature',
      sub: letter.signedAt ? [at(letter.signedAt), letter.signedName ? `as “${letter.signedName}”` : ''].filter(Boolean).join(' · ') : `Asked ${at(letter.signatureRequestedAt)}`,
      state: letter.signedAt ? 'done' as const : 'current' as const,
    }] : []),
    ...(isVoid ? [{ key: 'void', label: 'Voided', sub: [at(letter.voidedAt), letter.voidedReason ? `“${letter.voidedReason}”` : ''].filter(Boolean).join(' · '), state: 'failed' as const }] : []),
  ]

  return (
    <PageFrame label="Letter" className="lt-page">
      <PageHeader eyebrow="Letters" title={letter.subject}
        sub={[`${person}${code ? ` (${code})` : ''}`, letter.departmentName].filter(Boolean).join(' · ')}
        actions={<>
          {back}
          {letter.hasPdf && <Button variant="secondary" icon="download" onClick={download}>Download PDF</Button>}
        </>} />
      <SectionGrid>
        <SectionCell width="half">
          <Section title="Letter" cardClass={false} actions={<span className="lt-pills"><StatusPill tone={status.tone}>{status.label}</StatusPill>{sig && <StatusPill tone={sig.tone}>{sig.label}</StatusPill>}</span>}>
            <KeyValueGrid items={[
              { label: 'Employee', value: `${person}${code ? ` · ${code}` : ''}` },
              { label: 'Department', value: letter.departmentName },
              { label: 'Letter template', value: letter.templateName ?? letterName(letter) },
              { label: 'Type', value: LETTER_TYPE_LABEL[letter.type] ?? letter.type },
              { label: 'Issued', value: dayText(issuedDay(letter)) },
              { label: 'Generated by', value: letter.generatedByName },
              { label: 'Generated on', value: dayText(localDay(letter.createdAt)) },
              { label: 'PDF size', value: letter.pdfSizeBytes != null ? `${(letter.pdfSizeBytes / 1024).toFixed(1)} KB` : '' },
            ]} />
          </Section>
        </SectionCell>
        <SectionCell width="half">
          {canAct && <Section title="Actions" cardClass={false}>
            <div className="lt-actions">
              <Can code={P.HRMS_LETTERS_SEND}>
                {!isVoid && <Button variant={letter.sentAt ? 'secondary' : 'primary'} icon="mail" block onClick={() => setSending(true)}>{letter.sentAt ? 'Send again' : 'Send letter'}</Button>}
              </Can>
              <Can code={P.HRMS_LETTERS_VOID}>
                <Button variant="secondary" icon="circleX" block disabled={isVoid} onClick={() => setVoiding(true)}>{isVoid ? 'Already voided' : 'Void letter'}</Button>
              </Can>
              <Can code={P.HRMS_LETTERS_DELETE}>
                <Button variant="danger-outline" icon="trash" block loading={deleteMut.isPending} onClick={remove}>Delete letter</Button>
              </Can>
            </div>
          </Section>}
          <Section title="History" cardClass={false}>
            <Timeline variant="rail" label="Letter history" items={history} />
          </Section>
        </SectionCell>
      </SectionGrid>
      {values.length > 0 && (
        <Section title="Merge values used" count={values.length} cardClass={false} body={showValues ? 'default' : 'tight'}
          actions={<Button size={30} variant="ghost" aria-expanded={showValues} onClick={() => setShowValues((v) => !v)}>{showValues ? 'Hide' : 'Show'}</Button>}>
          {showValues ? <KeyValueGrid items={values.map(([k, v]) => ({ key: k, label: <code className="lt-code">{k}</code>, value: v }))} />
            : <p className="lt-muted lt-small">The details this letter was filled with when it was generated.</p>}
        </Section>
      )}
      {sending && <SendLetterDialog letter={letter} onClose={() => setSending(false)} signaturesReady={letter.signatureRequested !== null && letter.signatureRequested !== undefined} />}
      {voiding && <VoidLetterDialog letter={letter} onClose={() => setVoiding(false)} />}
    </PageFrame>
  )
}
