// "Send wishes" on Home's Celebrations card and the Celebrations page (backend V143_84): the
// button, the composer and "Your wishes". The rules are in wishModel.ts (the same file as the
// mobile app's). Everything here hides itself while the server has no wishes (404, or 503 before
// its migration), so the cards look exactly as before.
import { useEffect, useMemo, useState } from 'react'
import { PartyPopper } from 'lucide-react'
import { Avatar, Button, ListRow, ListRows, Section, errorText } from '@/design/kit/display'
import { Dialog, PanelButton, Textarea, useToast } from '@/design/kit/overlays'
import { timeAgo } from '@/core/notifications/notificationRoutes'
import { useCelebrationWishes, useMeEmployee, useSendWish } from './homeApi'
import { initialsOfName, type Celebration } from './peopleModel'
import {
  WISHED_LABEL, WISH_LABEL, WISH_MAX, canWish, composerTitle, firstNameOf, isWished, occasionOf, occasionWords,
  receivedLine, sentKeys, wishMessage, wishPresets, type WishesData,
} from './wishModel'
import './home.css'

/** What the cards need to offer wishes; null while the server has none. */
export interface WishControls {
  canWish: (c: Celebration) => boolean
  isWished: (c: Celebration) => boolean
  open: (c: Celebration) => void
  /** "12 people wished you", or ''. */
  receivedLine: string
  data: WishesData
}

/** The wishes read, the signed-in person's own id, and the composer's target. */
export function useWishControls(today: string): { controls: WishControls | null; target: Celebration | null; close: () => void } {
  const q = useCelebrationWishes()
  const me = useMeEmployee()
  const [target, setTarget] = useState<Celebration | null>(null)
  const data = q.data
  const myId = me.data?.id
  const sent = useMemo(() => sentKeys(data?.sent ?? []), [data])
  const controls = useMemo<WishControls | null>(() => (data
    ? {
      canWish: (c) => canWish(c, today, myId),
      isWished: (c) => isWished(c, sent),
      open: setTarget,
      receivedLine: receivedLine(data),
      data,
    }
    : null), [data, myId, sent, today])
  return { controls, target, close: () => setTarget(null) }
}

/** The button under a face (Home, compact: "Wish") or at the end of a row (the page: "Send wishes"); "Wished ✓" once sent. */
export function WishButton({ c, wishes, compact = false }: { c: Celebration; wishes: WishControls | null; compact?: boolean }) {
  if (!wishes || !wishes.canWish(c)) return null
  const first = firstNameOf(c.name)
  if (wishes.isWished(c)) {
    return <span className={`uh-wished${compact ? ' uh-wished--compact' : ''}`} aria-label={`You wished ${first}`}>{WISHED_LABEL}</span>
  }
  if (compact) {
    return (
      <button type="button" className="uh-wish" onClick={() => wishes.open(c)} aria-label={`${WISH_LABEL} to ${c.name}`}>
        <PartyPopper size={12} aria-hidden="true" />Wish
      </button>
    )
  }
  return (
    <Button variant="soft" size={30} icon={<PartyPopper size={14} aria-hidden="true" />} onClick={() => wishes.open(c)} aria-label={`${WISH_LABEL} to ${c.name}`}>
      {WISH_LABEL}
    </Button>
  )
}

/** The small composer: ready-made messages, or the person's own words (up to 280 characters). */
export function WishComposer({ target, onClose }: { target: Celebration | null; onClose: () => void }) {
  const toast = useToast()
  const send = useSendWish()
  const presets = useMemo(() => (target ? wishPresets(target) : []), [target])
  const [pick, setPick] = useState(0)
  const [own, setOwn] = useState('')
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { setPick(0); setOwn(''); setError(null) }, [target])
  const occasion = target ? occasionOf(target.kind) : null
  if (!target || !occasion || !target.employeeId) return null
  const first = firstNameOf(target.name)
  const message = wishMessage(presets[pick] ?? '', own)
  const go = async () => {
    setError(null)
    try {
      const r = await send.mutateAsync({ toEmployeeId: target.employeeId!, occasion, message })
      if (!r.available) { toast.error('Wishes aren’t switched on for this workspace yet.'); onClose(); return }
      if (r.value.created) toast.success(`Wishes sent to ${first}`, { detail: 'They’ll see it in their notifications.' })
      else toast.info(`You’d already wished ${first}`, { detail: 'They were told the first time.' })
      onClose()
    } catch (e) {
      setError(errorText(e, 'Couldn’t send your wishes. Try again in a moment.'))
    }
  }
  return (
    <Dialog open onClose={onClose} busy={send.isPending} title={composerTitle(target)} width={460}
      sub="They’ll see who sent it in their notifications, in the app and on their phone."
      icon={occasion === 'BIRTHDAY' ? 'cake' : occasion === 'ANNIVERSARY' ? 'award' : 'users'} initialFocus="first"
      footer={(
        <>
          <PanelButton variant="secondary" onClick={onClose} disabled={send.isPending}>Cancel</PanelButton>
          <PanelButton variant="primary" busy={send.isPending} onClick={() => void go()} blockedReason={message ? null : 'Pick a message or write your own.'}>
            {WISH_LABEL}
          </PanelButton>
        </>
      )}>
      <WishComposerBody presets={presets} pick={pick} own={own} error={error} first={first} onPick={(i) => { setPick(i); setOwn('') }} onOwn={setOwn} />
    </Dialog>
  )
}

/** The composer's form: the ready-made messages to pick from (picking one clears your own words), your own words, and what went wrong. */
export function WishComposerBody({ presets, pick, own, error, first, onPick, onOwn }: {
  presets: readonly string[]; pick: number; own: string; error: string | null; first: string
  onPick: (i: number) => void; onOwn: (text: string) => void
}) {
  return (
    <div className="uh-wishform">
      <div role="radiogroup" aria-label="Ready-made messages" className="uh-wishform__presets">
        {presets.map((p, i) => (
          <label key={p} className={`uh-wishform__preset${i === pick && !own.trim() ? ' is-on' : ''}`}>
            <input type="radio" name="wish-preset" checked={i === pick && !own.trim()} onChange={() => onPick(i)} />
            <span>{p}</span>
          </label>
        ))}
      </div>
      <Textarea label="Or write your own" hint={`Optional · up to ${WISH_MAX} characters`} rows={3} maxLength={WISH_MAX}
        value={own} onChange={(e) => onOwn(e.target.value)} placeholder={`Write something for ${first}`} />
      <div className="uh-wishform__meta" aria-live="polite">
        <span>{own.trim() ? 'Your own words are sent instead of the message above.' : ''}</span>
        <span>{own.length}/{WISH_MAX}</span>
      </div>
      {error && <p className="uh-wishform__error" role="alert">{error}</p>}
    </div>
  )
}

/** The Celebrations page: who wished me this week, with their words. */
export function WishesReceivedCard({ data }: { data: WishesData }) {
  if (!data.received.length) return null
  return (
    <Section variant="panel" title="Your wishes" sub={`${receivedLine(data)} this week`} count={data.received.length} countTone="neutral"
      countLabel={`${data.received.length} wishes`} body="list">
      <ListRows label="Your wishes">
        {data.received.map((w) => (
          <ListRow key={w.id} variant="divided" density="default"
            leading={<Avatar name={w.fromName} initials={initialsOfName(w.fromName)} size={36} tone="pale" />}
            title={w.fromName} sub={<span className="uh-wishmsg">{w.message}</span>}
            end={<span className="uh-off-when">{[occasionWords(w.occasion), timeAgo(w.createdAt)].filter(Boolean).join(' · ')}</span>} />
        ))}
      </ListRows>
    </Section>
  )
}
