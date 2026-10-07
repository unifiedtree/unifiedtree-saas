import React, { useCallback, useEffect, useState } from 'react'
import { useAuthStore as useSdkStore } from '@unifiedtree/sdk'
import { apiJson, HttpError } from '@/core/api/client'
import { HrButton, HrStatusPill } from '@/shared/components/hr'
import { ModulePage, State } from '@/design/module/ModuleKit'
import { SettingsNote } from '@/design/settings/SettingsKit'

/** GET /v1/workspace/ownership-transfer (OwnershipTransferService.Transfer). */
interface Transfer {
  id: string; status: 'PENDING' | 'TRANSITION'
  fromUserId: string; fromEmail: string | null; toUserId: string; toEmail: string | null
  note: string | null; requestedAt: string; expiresAt: string; acceptedAt: string | null; transitionEndsAt: string | null
  youAreOwner: boolean; youAreNewOwner: boolean; youAreOldOwner: boolean
}
interface Candidate { userId: string; email: string; name: string | null }

const day = (iso: string | null) => iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : ''
const card: React.CSSProperties = { display: 'grid', gap: 14, padding: '20px 22px', borderRadius: 16, background: 'var(--u-sf,#fff)', border: '1px solid var(--u-ln,#E3E9E6)' }
const input: React.CSSProperties = { width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--u-ln,#E3E9E6)', background: 'var(--u-sf,#fff)', color: 'inherit', font: 'inherit' }

/**
 * Business settings → Ownership (owner decisions, 6 Oct 2026): the owner hands the business to someone
 * who already has a login here; they accept within 7 days; the old owner keeps full Admin for 15 days
 * to help, then only their employee self-service. Exactly one owner.
 */
export const Ownership: React.FC = () => {
  const isOwner = useSdkStore((s) => (s.user?.roles ?? []).includes('OWNER'))
  const [transfer, setTransfer] = useState<Transfer | null | undefined>(undefined)
  const [failed, setFailed] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    setFailed(null)
    apiJson<Transfer | null>('/v1/workspace/ownership-transfer')
      .then((t) => setTransfer(t ?? null))
      .catch((e: unknown) => { setTransfer(null); setFailed(e instanceof Error ? e.message : 'Couldn’t load ownership.') })
  }, [])
  useEffect(load, [load])

  const act = async (path: string, done?: () => void) => {
    setBusy(true)
    setFailed(null)
    try {
      await apiJson(`/v1/workspace/ownership-transfer/${path}`, { method: 'POST', body: '{}' })
      if (done) done(); else load()
    } catch (e) {
      setFailed(e instanceof Error ? e.message : 'That didn’t work.')
    } finally {
      setBusy(false)
    }
  }

  let body: React.ReactNode
  if (transfer === undefined) body = <State kind="loading" />
  else if (transfer === null) body = isOwner ? <StartTransfer onStarted={load} /> : (
    <State kind="empty" icon="lock" title="Only the owner can hand over the business" description="If you’ve been offered ownership, the offer shows here." />
  )
  else if (transfer.status === 'PENDING') body = (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><strong>Ownership offer</strong><HrStatusPill tone="warn">Waiting for an answer</HrStatusPill></div>
      {transfer.youAreNewOwner ? (
        <>
          <p style={{ margin: 0 }}><b>{transfer.fromEmail}</b> wants to make you the owner of this business.{transfer.note ? <> Their note: “{transfer.note}”.</> : null}</p>
          <SettingsNote>If you accept, you become the owner straight away: billing, users and every setting. {transfer.fromEmail} keeps full Admin access for 15 days to help with the handover. You’ll both be signed out once, to sign in with the new access. The offer ends on {day(transfer.expiresAt)}.</SettingsNote>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <HrButton disabled={busy} onClick={() => act(`${transfer.id}/accept`, () => { window.location.href = '/login' })}>Accept and become the owner</HrButton>
            <HrButton variant="ghost" disabled={busy} onClick={() => act(`${transfer.id}/decline`)}>Decline</HrButton>
          </div>
        </>
      ) : (
        <>
          <p style={{ margin: 0 }}>You offered ownership to <b>{transfer.toEmail}</b> on {day(transfer.requestedAt)}. They have until {day(transfer.expiresAt)} to accept. You stay the owner until they do.</p>
          {transfer.youAreOldOwner && <div><HrButton variant="ghost" disabled={busy} onClick={() => act(`${transfer.id}/cancel`)}>Cancel the offer</HrButton></div>}
        </>
      )}
    </div>
  )
  else body = (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><strong>Handover</strong><HrStatusPill tone="ok">Ownership moved</HrStatusPill></div>
      {transfer.youAreNewOwner ? (
        <>
          <p style={{ margin: 0 }}>You’re the owner. <b>{transfer.fromEmail}</b> has full Admin access until {day(transfer.transitionEndsAt)} to help with the handover; after that they keep only their own employee access.</p>
          <div><HrButton variant="ghost" disabled={busy} onClick={() => act(`${transfer.id}/end-transition`)}>End the handover now</HrButton></div>
        </>
      ) : (
        <p style={{ margin: 0 }}>You handed ownership to <b>{transfer.toEmail}</b> on {day(transfer.acceptedAt)}. Your Admin access for the handover ends on {day(transfer.transitionEndsAt)}.</p>
      )}
    </div>
  )

  return (
    <ModulePage crumb="Business settings" title="Ownership" subtitle="Hand the business to someone else. There is always exactly one owner.">
      {failed && <SettingsNote tone="amber">{failed}</SettingsNote>}
      {body}
    </ModulePage>
  )
}

/** The owner's form: who, an optional note, and their password. */
const StartTransfer: React.FC<{ onStarted: () => void }> = ({ onStarted }) => {
  const [people, setPeople] = useState<Candidate[] | null>(null)
  const [to, setTo] = useState('')
  const [note, setNote] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    apiJson<Candidate[]>('/v1/workspace/ownership-transfer/candidates').then(setPeople).catch(() => setPeople([]))
  }, [])

  const send = async () => {
    setBusy(true)
    setError(null)
    try {
      await apiJson('/v1/workspace/ownership-transfer', { method: 'POST', body: JSON.stringify({ toUserId: to, password, note }) })
      setPassword('')
      onStarted()
    } catch (e) {
      setError(e instanceof HttpError || e instanceof Error ? e.message : 'That didn’t work.')
    } finally {
      setBusy(false)
    }
  }

  if (people === null) return <State kind="loading" />
  return (
    <div style={card}>
      <strong>Transfer ownership</strong>
      <SettingsNote>The person you choose becomes the owner when they accept (they have 7 days). You then keep full Admin access for 15 days to help them, and after that only your own employee access. They must already have an active login in this business — invite them from Users &amp; access first if they don’t.</SettingsNote>
      {error && <SettingsNote tone="amber">{error}</SettingsNote>}
      <label style={{ display: 'grid', gap: 6, fontSize: 13.5, fontWeight: 600 }}>
        New owner
        <select value={to} onChange={(e) => setTo(e.target.value)} style={input} aria-label="New owner">
          <option value="">Choose someone…</option>
          {people.map((p) => <option key={p.userId} value={p.userId}>{p.name ? `${p.name} (${p.email})` : p.email}</option>)}
        </select>
      </label>
      <label style={{ display: 'grid', gap: 6, fontSize: 13.5, fontWeight: 600 }}>
        Note for them (optional)
        <input value={note} onChange={(e) => setNote(e.target.value)} style={input} maxLength={300} placeholder="Why you’re handing over, anything they should know" />
      </label>
      <label style={{ display: 'grid', gap: 6, fontSize: 13.5, fontWeight: 600 }}>
        Your password, to confirm
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} style={input} autoComplete="current-password" />
      </label>
      <div><HrButton disabled={busy || !to || !password} onClick={send}>Send the offer</HrButton></div>
    </div>
  )
}
