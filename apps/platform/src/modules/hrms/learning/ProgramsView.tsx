// Learning · Programs (PgGrow p-learn tab 0): the tiles from the server (in the catalogue,
// running now, enrollments this year, BW-85), and every program with its category, dates,
// seats, mode and place, status, Enroll, Details and the roster.
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Button, CellActions, EmptyState, MiniStat, MiniStatGrid, Section, StatusPill, Table, errorText, type TableColumn,
} from '@/design/kit/display'
import { Pager } from '@/design/kit/data'
import { Dialog, PanelButton, Select, useToast } from '@/design/kit/overlays'
import { istToday } from '@/design/dc/dates'
import {
  useChangeProgramStatus, useEnroll, useMyEnrollments, useProgramsSummary, useTrainingPrograms, ALLOWED_TRANSITIONS,
  type ProgramStatus, type TrainingProgram,
} from '../api/useLearning'
import { PROGRAM_LABEL, PROGRAM_TONE, ProgramFormPanel, RosterPanel, isOpenEnrollment, modeLabel, schedule } from './programs'

export function ProgramsView({ canWrite, canEnroll, addKey }: { canWrite: boolean; canEnroll: boolean; addKey: number }) {
  const toast = useToast()
  const navigate = useNavigate()
  const today = istToday()
  const [page, setPage] = useState(0)
  const programs = useTrainingPrograms(page)
  const summary = useProgramsSummary()
  const mine = useMyEnrollments(canEnroll)
  const changeStatus = useChangeProgramStatus()
  const enroll = useEnroll()
  const [creating, setCreating] = useState(false)
  const [roster, setRoster] = useState<TrainingProgram | null>(null)
  const [confirm, setConfirm] = useState<{ program: TrainingProgram; status: ProgramStatus } | null>(null)
  useEffect(() => { if (addKey) setCreating(true) }, [addKey])
  const enrolledIn = useMemo(() => new Set((mine.data ?? []).filter((e) => isOpenEnrollment(e.status)).map((e) => e.programId)), [mine.data])
  const rows = programs.data?.content ?? []

  const onEnroll = async (p: TrainingProgram) => {
    try { await enroll.mutateAsync(p.id); toast.success(`You’re enrolled in ${p.title}`) }
    catch (e) { toast.error('Couldn’t enroll you', { detail: errorText(e, 'Try again in a moment.') }) }
  }
  const setStatus = async (p: TrainingProgram, status: ProgramStatus) => {
    try { await changeStatus.mutateAsync({ id: p.id, status }); toast.success(`Program marked ${PROGRAM_LABEL[status].toLowerCase()}`); setConfirm(null) }
    catch (e) { toast.error('Couldn’t change the status', { detail: errorText(e, 'Try again in a moment.') }) }
  }
  // Completing or cancelling is final, so it's confirmed first (cancelling drops everyone still enrolled).
  const onStatus = (p: TrainingProgram, status: ProgramStatus) => {
    if (status === p.status) return
    if (status === 'CANCELLED' || status === 'COMPLETED') setConfirm({ program: p, status })
    else void setStatus(p, status)
  }

  const columns: TableColumn<TrainingProgram>[] = [
    { key: 'title', header: 'Program', primary: true, render: (p) => (
      <button type="button" className="grw-link grw-strong" style={{ color: 'inherit' }} onClick={() => navigate(`/hrms/learning/programs/${p.id}`)}>{p.title}</button>
    ) },
    { key: 'category', header: 'Category', render: (p) => p.category || '—' },
    { key: 'when', header: 'When', render: (p) => <span style={{ whiteSpace: 'nowrap' }}>{schedule(p, today)}</span> },
    { key: 'seats', header: 'Seats', render: (p) => <span className="grw-num">{p.capacity != null ? `${p.enrolledCount} / ${p.capacity}` : p.enrolledCount ? `${p.enrolledCount} · Unlimited` : 'Unlimited'}</span> },
    { key: 'mode', header: 'Mode', render: (p) => modeLabel(p.mode, p.location) },
    { key: 'status', header: 'Status', render: (p) => {
      const closed = p.status === 'COMPLETED' || p.status === 'CANCELLED'
      return canWrite && !closed ? (
        <div style={{ minWidth: 130 }}>
          <Select aria-label={`Status of ${p.title}`} value={p.status} disabled={changeStatus.isPending} onChange={(e) => onStatus(p, e.target.value as ProgramStatus)}
            options={ALLOWED_TRANSITIONS[p.status].map((s) => ({ value: s, label: PROGRAM_LABEL[s] }))} />
        </div>
      ) : <StatusPill tone={PROGRAM_TONE[p.status]}>{PROGRAM_LABEL[p.status]}</StatusPill>
    } },
    { key: 'act', header: <span className="uk-sr">Actions</span>, label: 'Actions', align: 'right', render: (p) => {
      const closed = p.status === 'COMPLETED' || p.status === 'CANCELLED'
      const full = p.capacity != null && p.enrolledCount >= p.capacity
      return (
        <CellActions>
          {canEnroll && !closed && (enrolledIn.has(p.id) ? <StatusPill tone="success">You’re enrolled</StatusPill>
            : <Button size={30} disabled={enroll.isPending || full} onClick={() => onEnroll(p)}>{full ? 'Full' : 'Enroll'}</Button>)}
          <Button variant="secondary" size={30} onClick={() => navigate(`/hrms/learning/programs/${p.id}`)}>{canWrite && !closed ? 'Details & edit' : 'Details'}</Button>
          {canWrite && <Button variant="secondary" size={30} onClick={() => setRoster(p)}>Roster</Button>}
        </CellActions>
      )
    } },
  ]
  const s = summary.data
  return (
    <>
      <Section title="Programs" loading={summary.isLoading} skeleton="stats" error={summary.error} onRetry={() => summary.refetch()}>
        {s && (
          <MiniStatGrid>
            <MiniStat label="In the catalogue" value={s.inCatalogue} note={`${s.planned} planned`} tone="neutral" />
            <MiniStat label="Ongoing" value={s.ongoing} note="Running now" tone="info" />
            <MiniStat label="Enrollments" value={s.enrollmentsThisYear} note={`In ${s.year}`} tone="success" />
            {canEnroll && <MiniStat label="You’re enrolled in" value={enrolledIn.size} note="Open programs" tone="warning" />}
          </MiniStatGrid>
        )}
      </Section>
      <Section title="All programs" body="flush" error={programs.error} onRetry={() => programs.refetch()}
        footer={programs.data && programs.data.totalPages > 1 ? <Pager page={page} pageSize={20} total={programs.data.totalElements} onPageChange={setPage} noun="programs" /> : undefined}>
        <Table label="Programs" columns={columns} rows={rows} rowKey={(p) => p.id} loading={programs.isLoading} mobile="cards"
          empty={<EmptyState variant="plain" icon="award" title="No training programs yet" hint={canWrite ? 'Use “New program” to schedule the first one.' : 'Programs HR schedules appear here.'} />} />
      </Section>
      {creating && <ProgramFormPanel onClose={() => setCreating(false)} />}
      {roster && <RosterPanel program={rows.find((p) => p.id === roster.id) ?? roster} onClose={() => setRoster(null)} />}
      <Dialog open={!!confirm} onClose={() => setConfirm(null)} busy={changeStatus.isPending} tone={confirm?.status === 'CANCELLED' ? 'danger' : 'brand'}
        title={confirm?.status === 'CANCELLED' ? `Cancel ${confirm.program.title}?` : `Mark ${confirm?.program.title ?? ''} completed?`}
        sub={confirm?.status === 'CANCELLED' ? 'Everyone still enrolled is dropped, and a cancelled program can’t be reopened or edited.' : 'A completed program can’t be reopened or edited.'}
        footer={<>
          <PanelButton variant="secondary" onClick={() => setConfirm(null)}>Keep it</PanelButton>
          <PanelButton variant={confirm?.status === 'CANCELLED' ? 'danger' : 'primary'} busy={changeStatus.isPending} onClick={() => confirm && setStatus(confirm.program, confirm.status)}>
            {confirm?.status === 'CANCELLED' ? 'Cancel program' : 'Mark completed'}
          </PanelButton>
        </>} />
    </>
  )
}
