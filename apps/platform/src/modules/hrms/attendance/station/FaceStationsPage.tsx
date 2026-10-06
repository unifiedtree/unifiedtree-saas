// Attendance → Face stations: set up a shared face-punch device for a branch, start it on this
// computer, switch it off. Admin / HR only (attendance.policy.manage AND attendance.assisted_punch.any,
// as the server checks). The station itself is /station (StationPage.tsx). Design:
// docs/redesign/FACE_STATION.md.
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore as useSdkStore, usePermission } from '@unifiedtree/sdk'
import { Button, StatusPill } from '@/design/kit/display'
import { Dialog, FieldGrid, Input, PanelButton, Select, useToast } from '@/design/kit/overlays'
import { ModulePage, Note, Panel, Row, RowList, State, stamp } from '@/design/module/ModuleKit'
import { isFeatureNotReady } from '@/core/api/featureNotReady'
import { useAuthStore } from '@/core/auth/authStore'
import { useBranches } from '../../api/useOrg'
import { canSetUpStations, saveStation, useFaceStations, useStationActions, type FaceStation } from './stationApi'
import './station.css'

type Confirm = { kind: 'revoke' | 'delete' | 'here'; station: FaceStation }

function said(e: unknown, fallback: string): string {
  const m = e instanceof Error ? e.message : ''
  return m && !/^Request failed/.test(m) ? m : fallback
}

export function FaceStationsPage() {
  const policy = usePermission('attendance.policy.manage')
  const anyone = usePermission('attendance.assisted_punch.any')
  const allowed = canSetUpStations((c) => (c === 'attendance.policy.manage' ? policy : anyone))
  const list = useFaceStations(allowed)
  const act = useStationActions()
  const toast = useToast()
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)
  const [confirm, setConfirm] = useState<Confirm | null>(null)

  const stations = list.data ?? []
  const busy = act.revoke.isPending || act.remove.isPending || act.startHere.isPending

  const doConfirm = async () => {
    if (!confirm) return
    const st = confirm.station
    try {
      if (confirm.kind === 'revoke') {
        await act.revoke.mutateAsync(st.id)
        toast.success(`${st.name} is switched off. Its devices can’t punch any more.`)
      } else if (confirm.kind === 'delete') {
        await act.remove.mutateAsync(st.id)
        toast.success(`${st.name} was deleted.`)
      } else {
        const session = await act.startHere.mutateAsync(st.id)
        saveStation(session)
        // A shared computer must not keep the admin's session: sign out for real (the refresh cookie too).
        try { await useSdkStore.getState().logout() } catch { /* signed out locally below */ }
        useAuthStore.getState().logout()
        window.location.assign('/station')
        return
      }
      setConfirm(null)
    } catch (e) {
      toast.error(said(e, 'That didn’t work. Try again.'))
    }
  }

  if (!allowed) {
    return (
      <ModulePage crumb="Attendance & time" title="Face stations">
        <State kind="empty" icon="lock" title="Not available for your role"
          description="Setting up face stations needs the attendance settings and punch-for-anyone permissions." />
      </ModulePage>
    )
  }

  return (
    <ModulePage crumb="Attendance & time" title="Face stations"
      subtitle="A shared tablet or computer at a branch where people punch in and out with their face, without their own phone."
      actions={<Button variant="primary" icon="plus" onClick={() => setCreating(true)} disabled={isFeatureNotReady(list.error)}>New station</Button>}>
      <Panel title="How it works" sub="Set up a station for a branch, then start it on the device that stays there.">
        <ul className="ufs-how">
          <li>People of that branch tap Punch in or Punch out, find their name, and look at the camera.</li>
          <li>The face is checked against their own enrolled face, and the device must be inside their work area.</li>
          <li>When the match isn’t certain, the punch waits on <strong>Face Punch → To check</strong> for their manager or HR.</li>
          <li>A station can only punch. It can’t see anyone’s attendance, pay or details.</li>
        </ul>
      </Panel>

      {list.isLoading ? <State kind="loading" />
        : isFeatureNotReady(list.error) ? <State kind="empty" icon="tablet" title="Face stations aren’t switched on yet" description="They will appear here once your workspace is updated." />
          : list.isError ? <State kind="error" title="Couldn’t load the stations" description={said(list.error, '')} onRetry={() => void list.refetch()} />
            : stations.length === 0 ? <State kind="empty" icon="tablet" title="No stations yet" description="Add one for a branch, then start it on the device at that branch." />
              : (
                <RowList>
                  {stations.map((st) => {
                    const on = st.status === 'ACTIVE'
                    return (
                      <Row key={st.id} muted={!on}
                        title={st.name}
                        meta={[st.branchName || 'Branch', on
                          ? (st.lastUsedAt ? `last punch ${stamp(st.lastUsedAt)} · ${st.punchesToday} today` : 'no punches yet')
                          : `switched off${st.revokedByName ? ` by ${st.revokedByName}` : ''}${st.revokedAt ? ` · ${stamp(st.revokedAt)}` : ''}`].join(' · ')}
                        note={on && st.lastStartedAt ? `Started on a device ${stamp(st.lastStartedAt)}${st.lastStartedByName ? ` by ${st.lastStartedByName}` : ''}` : undefined}
                        trail={
                          <span className="ufs-trail">
                            {st.waitingApproval > 0 && (
                              <button type="button" className="ufs-wait" onClick={() => navigate('/hrms/attendance?section=daily&tab=face')}>
                                <StatusPill tone="warning" size="xs">{`${st.waitingApproval} to confirm`}</StatusPill>
                              </button>
                            )}
                            <StatusPill tone={on ? 'success' : 'muted'} size="xs">{on ? 'On' : 'Switched off'}</StatusPill>
                            {on && <Button size={32} variant="soft" icon="scanFace" onClick={() => setConfirm({ kind: 'here', station: st })}>Open on this computer</Button>}
                            {on && <Button size={32} variant="danger-outline" onClick={() => setConfirm({ kind: 'revoke', station: st })}>Switch off</Button>}
                            {!on && !st.lastUsedAt && <Button size={32} variant="plain" icon="trash" aria-label={`Delete ${st.name}`} onClick={() => setConfirm({ kind: 'delete', station: st })} />}
                          </span>
                        } />
                    )
                  })}
                </RowList>
              )}

      <Note>On a tablet, sign in to the UnifiedTree app as an admin and open Attendance tools → Face station to start it there.</Note>

      {creating && <CreateDialog onClose={() => setCreating(false)} />}

      <Dialog open={!!confirm} onClose={() => { if (!busy) setConfirm(null) }} busy={busy}
        tone={confirm?.kind === 'here' ? 'brand' : 'danger'} icon={confirm?.kind === 'here' ? 'scanFace' : confirm?.kind === 'delete' ? 'trash' : 'circleX'}
        title={confirm?.kind === 'here' ? `Open ${confirm.station.name} on this computer?`
          : confirm?.kind === 'delete' ? `Delete ${confirm?.station.name}?` : `Switch off ${confirm?.station.name}?`}
        sub={confirm?.kind === 'here'
          ? `You’ll be signed out here. This computer then shows only the punch screen for ${confirm.station.branchName || 'that branch'}, using its camera and location.`
          : confirm?.kind === 'delete' ? 'It never punched anyone, so nothing else changes.'
            : 'Every device running it stops at once. Punches it already made stay. You can set up a new station any time.'}
        footer={
          <>
            <PanelButton variant="secondary" onClick={() => setConfirm(null)} disabled={busy}>Cancel</PanelButton>
            <PanelButton variant={confirm?.kind === 'here' ? 'primary' : 'danger'} busy={busy} onClick={() => void doConfirm()}>
              {confirm?.kind === 'here' ? 'Sign out and open' : confirm?.kind === 'delete' ? 'Delete' : 'Switch off'}
            </PanelButton>
          </>
        } />
    </ModulePage>
  )
}

function CreateDialog({ onClose }: { onClose: () => void }) {
  const branches = useBranches()
  const { create } = useStationActions()
  const toast = useToast()
  const [name, setName] = useState('')
  const [branchId, setBranchId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const options = (branches.data ?? []).filter((b) => (b as { active?: boolean }).active !== false)
    .map((b) => ({ value: b.id, label: b.name }))
  const ok = name.trim().length >= 2 && name.trim().length <= 80 && !!branchId

  const save = async () => {
    if (!ok) return
    setError(null)
    try {
      const st = await create.mutateAsync({ name: name.trim(), branchId })
      toast.success(`${st.name} is set up. Start it on the device at ${st.branchName || 'the branch'}.`)
      onClose()
    } catch (e) {
      setError(said(e, 'The station couldn’t be saved. Try again.'))
    }
  }

  return (
    <Dialog open onClose={onClose} busy={create.isPending} icon="tablet" title="New face station"
      sub="One station per device. People of the branch you pick can punch on it."
      footer={
        <>
          <PanelButton variant="secondary" onClick={onClose} disabled={create.isPending}>Cancel</PanelButton>
          <PanelButton variant="primary" busy={create.isPending} disabled={!ok} onClick={() => void save()}>Set up station</PanelButton>
        </>
      }>
      <FieldGrid>
        <Input label="Name" required full size="md" placeholder="Front desk" value={name} maxLength={80}
          onChange={(e) => setName(e.target.value)} hint="Shown on the station and on each punch it makes." />
        <Select label="Branch" required full size="md" value={branchId} onChange={(e) => setBranchId(e.target.value)}
          placeholder={branches.isLoading ? 'Loading branches…' : 'Choose a branch'} options={options}
          error={branches.isError ? 'Couldn’t load the branches.' : undefined} />
      </FieldGrid>
      {error && <Note tone="red">{error}</Note>}
    </Dialog>
  )
}
