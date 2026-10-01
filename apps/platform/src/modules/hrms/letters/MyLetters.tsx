// My letters, as cards (P-DOCS; prototype EmpDocs `e-letters`): the letters HR
// has sent the signed-in person (GET /v1/letters/my; HR's unsent drafts are not
// there, and a sent letter HR voided shows as "Withdrawn"). A letter that asks
// for a signature has a gold ring, "Needs your signature" and "Review and
// sign": a panel shows the letter on its page and the person signs by ticking
// that they read it and typing their name (click to accept: the time, the name
// and their IP address are kept; nothing is stamped on the PDF).
import { useMemo, useState } from 'react'
import { Callout, EmptyState, ErrorState, SkeletonBlock } from '@/design/kit/display'
import { ActionCard, ActionCardGrid, Pager } from '@/design/kit/data'
import { Checkbox, Input, PanelButton, SidePanel, useToast } from '@/design/kit/overlays'
import { isFeatureNotReady } from '@/core/api/featureNotReady'
import { useMyLetters, useReadMyLetter, useSignLetter, useDownloadLetter, type GeneratedLetterDto } from './api/useLetters'
import { letterName, myLetterCard, signatureBanner } from './lettersModel'
import { LetterPaper } from './components/LetterPaper'
import './components/letters.css'

export function MyLetters() {
  const toast = useToast()
  const [page, setPage] = useState(0)
  const q = useMyLetters(page)
  const download = useDownloadLetter()
  const [signing, setSigning] = useState<GeneratedLetterDto | null>(null)
  const letters = useMemo(() => q.data?.content ?? [], [q.data])
  const total = q.data?.totalElements ?? 0
  const banner = signatureBanner(letters)

  if (q.isLoading) return <SkeletonBlock style={{ height: 200 }} label="Loading your letters" />
  if (q.error) return <ErrorState title="Couldn’t load your letters" error={q.error} onRetry={() => q.refetch()} />
  if (!letters.length) return <EmptyState icon="mail" title="No letters yet" hint="Letters HR sends you (offer, appointment, experience…) appear here." />

  const get = (l: GeneratedLetterDto) => download.mutate({ id: l.id, filename: `letter-${l.type.toLowerCase()}-${l.id.slice(0, 8)}.pdf` },
    { onError: (e) => toast.error((e as Error)?.message || 'Unable to download PDF') })

  return (
    <div className="lt-stack">
      {banner && <Callout tone="warning" icon="alert">{banner}</Callout>}
      <ActionCardGrid label="Your letters">
        {letters.map((l, i) => {
          const c = myLetterCard(l)
          return (
            <ActionCard key={l.id} index={i} icon="mail" title={letterName(l)} sub={c.sub} status={c.state} tone={c.tone}
              primary={c.sign ? { label: 'Review and sign', onClick: () => setSigning(l), ariaLabel: `Review and sign ${letterName(l)}` } : undefined}
              secondary={l.hasPdf && l.status !== 'VOID' ? { label: 'Download', onClick: () => get(l), ariaLabel: `Download ${letterName(l)}`, loading: download.isPending && download.variables?.id === l.id } : undefined} />
          )
        })}
      </ActionCardGrid>
      {total > 20 && <Pager page={page} pageSize={20} total={total} onPageChange={setPage} noun="letters" />}
      {signing && <SignPanel letter={signing} onClose={() => setSigning(null)} />}
    </div>
  )
}

function SignPanel({ letter, onClose }: { letter: GeneratedLetterDto; onClose: () => void }) {
  const toast = useToast()
  const read = useReadMyLetter(letter.id)
  const sign = useSignLetter()
  const [agreed, setAgreed] = useState(false)
  const [name, setName] = useState('')
  const [tried, setTried] = useState(false)
  const problem = !read.data ? 'The letter is still loading.' : !agreed ? 'Tick that you have read the letter.' : name.trim().length < 2 ? 'Type your full name to sign.' : null
  const submit = async () => {
    setTried(true)
    if (problem) return
    try {
      await sign.mutateAsync({ id: letter.id, typedName: name.trim() })
      toast.success(`Signed: ${letterName(letter)}`)
      onClose()
    } catch (e) {
      if (isFeatureNotReady(e)) toast.info('Signing letters isn’t switched on yet.')
      else toast.error('Couldn’t sign the letter', { detail: (e as Error)?.message })
    }
  }
  return (
    <SidePanel open onClose={onClose} width={720} busy={sign.isPending} closeLabel="Close panel" title="Review and sign"
      sub={`${letterName(letter)}. Read it, then sign by typing your name.`}
      footer={<>
        <PanelButton size="lg" onClick={onClose} disabled={sign.isPending}>Cancel</PanelButton>
        <PanelButton size="lg" variant="primary" busy={sign.isPending} blockedReason={problem} tipAlign="end" onBlockedClick={() => setTried(true)} onClick={submit}>Sign letter</PanelButton>
      </>}>
      <div className="lt-stack">
        {read.isLoading ? <SkeletonBlock style={{ height: 480 }} label="Loading the letter" />
          : read.error ? <ErrorState title="Couldn’t open the letter" error={read.error} onRetry={() => read.refetch()} />
            : read.data ? <LetterPaper html={read.data.html} page={read.data.page} title={`${letterName(letter)}, to read`} /> : null}
        <div className="lt-sign">
          <Checkbox checked={agreed} onChange={setAgreed} label="I have read this letter and I accept it" />
          <Input label="Type your full name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={200}
            placeholder={letter.employeeName ?? 'Your full name'} error={tried && problem && problem !== 'Tick that you have read the letter.' ? problem : undefined} />
          {tried && problem === 'Tick that you have read the letter.' && <p role="alert" className="lt-error">{problem}</p>}
          <p className="lt-muted lt-small">This is a click-to-accept signature. We keep your name, the time and your IP address with the letter. Nothing is added to the PDF.</p>
        </div>
      </div>
    </SidePanel>
  )
}
