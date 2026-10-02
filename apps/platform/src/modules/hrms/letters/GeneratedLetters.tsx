// Generated letters, on the kit (P-DOCS; prototype PgTalent h-letters tab 1):
// the employee and their department, the letter (template name, with the
// subject), the day it was issued, its status and signature, and the actions
// the person may take: Send for a draft; Download and Void once sent. A row
// opens the letter's own page. `mine` lists the signed-in person's own letters
// instead (My letters, as cards: ./MyLetters).
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { P, usePermission } from '@unifiedtree/sdk'
import { Button, CellActions, CellPerson, CellStack, Section, StatusPill, Table, type TableColumn } from '@/design/kit/display'
import { Pager } from '@/design/kit/data'
import { useToast } from '@/design/kit/overlays'
import { useGeneratedLetters, downloadLetterPdf, type GeneratedLetterDto } from './api/useLetters'
import { issuedDay, letterName, letterStatus, shortDay, signatureNote } from './lettersModel'
import { SendLetterDialog, VoidLetterDialog } from './components/LetterDialogs'
import { MyLetters } from './MyLetters'

const who = (l: GeneratedLetterDto) => l.employeeName || l.generationContext?.['employee.fullName'] || 'Employee record unavailable'

/** True when signatures are switched on, as far as the list can tell (an empty list can't tell, so yes). */
export function signaturesReadyFrom(letters: GeneratedLetterDto[] | undefined): boolean {
  if (!letters || letters.length === 0) return true
  return letters.some((l) => l.signatureRequested !== undefined && l.signatureRequested !== null)
}

export function GeneratedLettersList({ mine }: { mine: boolean }) {
  if (mine) return <MyLetters />
  return <AllLetters />
}

function AllLetters() {
  const navigate = useNavigate()
  const toast = useToast()
  const [page, setPage] = useState(0)
  const { data, isLoading, error, refetch, isFetching } = useGeneratedLetters(page)
  const canSend = usePermission(P.HRMS_LETTERS_SEND)
  const canVoid = usePermission(P.HRMS_LETTERS_VOID)
  const [sending, setSending] = useState<GeneratedLetterDto | null>(null)
  const [voiding, setVoiding] = useState<GeneratedLetterDto | null>(null)
  const letters = data?.content ?? []
  const total = data?.totalElements ?? 0
  const download = (l: GeneratedLetterDto) =>
    downloadLetterPdf(l.id, `letter-${l.type.toLowerCase()}-${l.id.slice(0, 8)}.pdf`).catch((e) => toast.error(e instanceof Error ? e.message : 'Unable to download PDF'))

  const columns: TableColumn<GeneratedLetterDto>[] = [
    { key: 'employee', header: 'Employee', label: 'Employee', primary: true, render: (l) => <CellPerson name={who(l)} sub={l.departmentName || l.employeeCode || l.generationContext?.['employee.code']} /> },
    {
      key: 'letter', header: 'Letter', render: (l) => (
        <span title={l.subject}><CellStack primary={letterName(l)} secondary={l.templateName && l.templateName !== l.subject ? l.subject : undefined} /></span>
      ),
    },
    { key: 'issued', header: 'Issued', render: (l) => shortDay(issuedDay(l)) },
    {
      key: 'status', header: 'Status', render: (l) => {
        const s = letterStatus(l.status), sig = signatureNote(l)
        return <span className="lt-pills"><StatusPill tone={s.tone}>{s.label}</StatusPill>{sig && <StatusPill tone={sig.tone}>{sig.label}</StatusPill>}</span>
      },
    },
    {
      key: 'actions', header: <span className="sr-only">Actions</span>, label: 'Actions', align: 'right', render: (l) => (
        <CellActions>
          {l.status === 'GENERATED' && canSend && <Button size={30} variant="soft" aria-label={`Send ${letterName(l)} to ${who(l)}`} onClick={() => setSending(l)}>Send</Button>}
          {l.status !== 'GENERATED' && l.hasPdf && <Button size={30} variant="secondary" aria-label={`Download ${letterName(l)} for ${who(l)}`} onClick={() => download(l)}>Download</Button>}
          {l.status !== 'GENERATED' && l.status !== 'VOID' && canVoid && <Button size={30} variant="secondary" aria-label={`Void ${letterName(l)} for ${who(l)}`} onClick={() => setVoiding(l)}>Void</Button>}
        </CellActions>
      ),
    },
  ]

  return (
    <>
      <Section title="Generated letters" body="flush" cardClass={false}
        loading={isLoading} skeleton="table" error={error} onRetry={() => refetch()} retrying={isFetching}
        empty={!isLoading && !error && letters.length === 0 ? { title: 'No letters issued yet', hint: 'Use “Generate letter” to create one from a template.' } : undefined}
        footer={total > 20 ? <Pager page={page} pageSize={20} total={total} onPageChange={setPage} noun="letters" /> : undefined}>
        <Table label="Generated letters" columns={columns} rows={letters} rowKey={(l) => l.id} mobile="cards"
          onRowClick={(l) => navigate(`/hrms/letters/generated/${l.id}`)} rowHref={(l) => `/hrms/letters/generated/${l.id}`} />
      </Section>
      <SendLetterDialog letter={sending} onClose={() => setSending(null)} signaturesReady={signaturesReadyFrom(letters)} />
      <VoidLetterDialog letter={voiding} onClose={() => setVoiding(null)} />
    </>
  )
}
