// Send and Void for one generated letter, as kit dialogs (P-DOCS). Used from the
// Generated letters list and from a letter's own page, so both act the same.
//   Send: To (the employee's work or personal email; others need the override
//         permission, the server checks), CC, and "Ask for a signature".
//   Void: needs a reason (the server requires one); the employee sees a sent
//         letter as withdrawn.
import { useState } from 'react'
import { Callout } from '@/design/kit/display'
import { Dialog, FieldGrid, Input, PanelButton, Textarea, Toggle, useToast } from '@/design/kit/overlays'
import { isFeatureNotReady } from '@/core/api/featureNotReady'
import { useSendLetter, useVoidLetter, type GeneratedLetterDto } from '../api/useLetters'
import { letterName } from '../lettersModel'

export function SendLetterDialog({ letter, onClose, signaturesReady }: {
  letter: GeneratedLetterDto | null
  onClose: () => void
  /** False while signatures aren't switched on: the switch is hidden. */
  signaturesReady: boolean
}) {
  if (!letter) return null
  return <SendBody letter={letter} onClose={onClose} signaturesReady={signaturesReady} />
}

function SendBody({ letter, onClose, signaturesReady }: { letter: GeneratedLetterDto; onClose: () => void; signaturesReady: boolean }) {
  const toast = useToast()
  const send = useSendLetter()
  const [to, setTo] = useState(letter.sentToEmail ?? '')
  const [cc, setCc] = useState('')
  const [ask, setAsk] = useState(false)
  const canAsk = signaturesReady && !letter.signatureRequested && letter.status !== 'SIGNED'
  const submit = async () => {
    try {
      await send.mutateAsync({ id: letter.id, req: { toEmail: to.trim() || undefined, ccEmail: cc.trim() || undefined, ...(ask ? { requestSignature: true } : {}) } })
      toast.success(ask ? 'Letter sent. They’ll be asked to sign it.' : 'Letter sent')
      onClose()
    } catch (e) {
      if (isFeatureNotReady(e)) toast.info('Asking for a signature isn’t switched on yet.')
      else toast.error('Failed to send letter', { detail: (e as Error)?.message })
    }
  }
  const who = letter.employeeName || letter.generationContext?.['employee.fullName'] || 'the employee'
  return (
    <Dialog open onClose={onClose} busy={send.isPending} icon="mail" title="Send letter"
      sub={`${letterName(letter)} to ${who}. Leave To empty to use their work email.`}
      footer={<>
        <PanelButton onClick={onClose} disabled={send.isPending}>Cancel</PanelButton>
        <PanelButton variant="primary" busy={send.isPending} onClick={submit}>{letter.sentAt ? 'Send again' : 'Send letter'}</PanelButton>
      </>}>
      <FieldGrid columns={1}>
        <Input label="To email" type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="Their work email" />
        <Input label="CC email (optional)" type="email" value={cc} onChange={(e) => setCc(e.target.value)} placeholder="manager@example.com" />
        {canAsk && <Toggle checked={ask} onChange={setAsk} label="Ask for a signature"
          description="They read it and sign in My letters by typing their name. We keep the time and their IP address; nothing is stamped on the PDF." />}
        {letter.signatureRequested && !letter.signedAt && <Callout tone="info">A signature is already asked for on this letter.</Callout>}
      </FieldGrid>
    </Dialog>
  )
}

export function VoidLetterDialog({ letter, onClose, onVoided }: { letter: GeneratedLetterDto | null; onClose: () => void; onVoided?: () => void }) {
  if (!letter) return null
  return <VoidBody letter={letter} onClose={onClose} onVoided={onVoided} />
}

function VoidBody({ letter, onClose, onVoided }: { letter: GeneratedLetterDto; onClose: () => void; onVoided?: () => void }) {
  const toast = useToast()
  const voidMut = useVoidLetter()
  const [reason, setReason] = useState('')
  const [tried, setTried] = useState(false)
  const problem = !reason.trim() ? 'Say why it’s being voided.' : null
  const submit = async () => {
    setTried(true)
    if (problem) return
    try {
      await voidMut.mutateAsync({ id: letter.id, reason: reason.trim() })
      toast.success('Letter voided')
      onVoided?.()
      onClose()
    } catch (e) {
      toast.error('Failed to void letter', { detail: (e as Error)?.message })
    }
  }
  return (
    <Dialog open onClose={onClose} busy={voidMut.isPending} icon="circleX" tone="danger" title="Void letter"
      sub={letter.sentAt ? 'They’ll see it as withdrawn in My letters. This can’t be undone.' : 'It was never sent, so they won’t see it. This can’t be undone.'}
      footer={<>
        <PanelButton onClick={onClose} disabled={voidMut.isPending}>Cancel</PanelButton>
        <PanelButton variant="danger" busy={voidMut.isPending} blockedReason={problem} onBlockedClick={() => setTried(true)} onClick={submit}>Void letter</PanelButton>
      </>}>
      <Textarea label="Reason" required full rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)}
        placeholder="e.g. Issued with the wrong joining date" error={tried ? problem ?? undefined : undefined} autoFocus />
    </Dialog>
  )
}
