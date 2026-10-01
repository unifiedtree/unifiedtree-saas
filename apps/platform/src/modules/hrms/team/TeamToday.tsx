// Team today (/team; prototype TeamToday.dc.html): who is in, late, at home, on leave or not in yet
// (the five tiles filter the roster), "Send a reminder", what is waiting for you (with Undo),
// probation dates, the review cycle and who is out soon. Every block shows only with its
// permission and reads its own API; a block that fails shows its error with Retry.
import { useMemo, useState } from 'react'
import { useQueries } from '@tanstack/react-query'
import { apiJson } from '@/core/api/client'
import {
  Avatar, Button, EmptyState, ListRow, ListRows, PageHeader, Section, StatCard, StatGrid, StatusPill, errorText,
} from '@/design/kit/display'
import { ApprovalRow, useToast } from '@/design/kit/overlays'
import { istToday } from '@/design/dc/dates'
import { addDays } from '@/shared/components/calendar/dateMath'
import { useTeamDashboard } from '../api/useAttendance'
import { useReviewCycles } from '../api/usePerformance'
import type { CycleProgress } from '../api/usePerformanceAdmin'
import { useApprovalsInbox } from '../api/shared/useApprovalsInbox'
import { useRecentDecisions } from '../api/shared/useRecentDecisions'
import { useReminders, useSendReminders } from '../api/shared/useReminders'
import { useTeamProbation } from '../api/shared/useTeamProbation'
import { useTeamTimeOff } from '../api/shared/useTeamTimeOff'
import type { InboxRow, InboxTab, RecentDecision, TeamProbationRow, TeamSummary } from '../api/shared/contracts'
import type { SharedQueryResult } from '../api/shared/available'
import { ConfirmProbationDialog, ExtendProbationDialog, RejectReasonDialog } from './TeamDialogs'
import { useTeamDecisions } from './useTeamDecisions'
import {
  type Bucket, type RosterRow, type TeamTile, type TeamView, decisionWord, firstName, inboxWhat, offTodayMembers, outSoon, probationWhen,
  relTime, reviewsModel, roleLine, rosterBucket, rosterWhen, teamSub, teamTiles,
} from './teamModel'

export interface TeamTodayProps {
  summary: SharedQueryResult<TeamSummary>
  canTeam: boolean
  canInbox: boolean
  canTimeOff: boolean
  canPerformance: boolean
  canDecideProbation: boolean
  canMessage: boolean
  onView: (view: TeamView, tab?: InboxTab) => void
  onMessage: () => void
  onAttendance: () => void
}

const PILL: Partial<Record<Bucket, [string, 'success' | 'warning' | 'info' | 'neutral' | 'amber' | 'muted']>> = {
  in: ['In', 'success'], late: ['Late', 'warning'], wfh: ['Home', 'info'], leave: ['On leave', 'neutral'], half: ['Half day', 'amber'], off: ['Off', 'muted'],
}

export function TeamToday(p: TeamTodayProps) {
  const today = istToday()
  const inbox = useApprovalsInbox({ tab: 'all', page: 0, size: 3 }, { enabled: p.canInbox })
  const team = useTeamDashboard(today, undefined, p.canTeam)
  const [filter, setFilter] = useState<Bucket | null>(null)
  const rows = useMemo(() => (team.data?.staffStatuses ?? []) as RosterRow[], [team.data])
  const tiles = useMemo(() => teamTiles(rows), [rows])
  const waiting = inbox.data?.counts.all ?? 0
  return (
    <>
      <PageHeader
        title="Team today"
        sub={teamSub(p.summary.data, today)}
        actions={(p.canTeam || p.canInbox || p.canMessage) ? (
          <>
            {p.canTeam && <Button variant="neutral" size={40} icon="clock" onClick={p.onAttendance}>Team attendance</Button>}
            {p.canMessage && <Button variant="secondary" size={40} icon="mail" onClick={p.onMessage}>Message team</Button>}
            {p.canTeam && <Button variant="secondary" size={40} onClick={() => p.onView('schedule')}>Team schedule</Button>}
            {p.canInbox && <Button variant="primary" size={40} onClick={() => p.onView('approvals')}>{`Approvals · ${waiting}`}</Button>}
          </>
        ) : undefined}
      />
      {p.canTeam && (
        <StatGrid min={140} gap={12} label="Filter by status">
          {tiles.map((t, i) => (
            <StatCard key={t.key} variant="stat" index={i} label={t.label} value={team.isLoading ? null : t.count} note={t.note}
              icon={t.icon} tone={t.tone} loading={team.isLoading} active={filter === t.key}
              onClick={() => setFilter(filter === t.key ? null : t.key)} />
          ))}
        </StatGrid>
      )}
      <div className="tm-cols">
        {p.canTeam && (
          <div className="tm-main">
            <Roster today={today} summary={p.summary.data} team={team} rows={rows} tiles={tiles} filter={filter} onFilter={setFilter} />
          </div>
        )}
        <div className="tm-side">
          {p.canInbox && <WaitingCard inbox={inbox} onSeeAll={() => p.onView('approvals')} />}
          {p.canTeam && <ProbationCard canDecide={p.canDecideProbation} />}
          {p.canPerformance && <ReviewsCard />}
          {p.canTimeOff && <OutSoonCard today={today} />}
        </div>
      </div>
    </>
  )
}

// ── The roster ──────────────────────────────────────────────────────────────

function Roster({ today, summary, team, rows, tiles, filter, onFilter }: {
  today: string
  summary: TeamSummary | undefined
  team: ReturnType<typeof useTeamDashboard>
  rows: RosterRow[]
  tiles: TeamTile[]
  filter: Bucket | null
  onFilter: (b: Bucket | null) => void
}) {
  const toast = useToast()
  const reminders = useReminders(today)
  const send = useSendReminders()
  const [sending, setSending] = useState<string | null>(null)
  const members = useMemo(() => new Map((summary?.members ?? []).map((m) => [m.employeeId, m])), [summary])
  const off = useMemo(() => offTodayMembers(summary?.members, rows), [summary, rows])
  const sent = new Set((reminders.data ?? []).map((r) => r.employeeId))
  const canRemind = !reminders.notAvailable && !send.notAvailable

  const remind = async (r: RosterRow) => {
    setSending(r.employeeId)
    try {
      const res = await send.mutateAsync({ date: today, reason: 'NOT_CHECKED_IN', employeeIds: [r.employeeId] })
      if (!res.available) { toast.info('Reminders aren’t switched on for this workspace yet.'); return }
      const one = res.value.find((x) => x.employeeId === r.employeeId)
      if (one?.outcome === 'SENT') toast.success(`Reminder sent to ${firstName(r.fullName)}`)
      else if (one?.outcome === 'ALREADY_SENT') toast.info(`${firstName(r.fullName)} was already reminded today`)
      else toast.error(`No reminder sent to ${firstName(r.fullName)}`, { detail: one?.message || undefined })
    } catch (e) {
      toast.error('Couldn’t send the reminder', { detail: errorText(e, 'Try again in a moment.') })
    } finally {
      setSending(null)
    }
  }

  const shown = rows.filter((r) => !filter || rosterBucket(r) === filter)
  const showOff = !filter || filter === 'off'
  const active = tiles.find((t) => t.key === filter)
  const count = shown.length + (showOff ? off.length : 0)
  const title = active ? `${active.label} · ${count}` : `Who’s in · ${count} ${count === 1 ? 'person' : 'people'}`

  return (
    <Section title={team.isLoading || team.error ? 'Who’s in' : title}
      body="list" loading={team.isLoading} error={team.error} onRetry={() => team.refetch()} retrying={team.isFetching}
      actions={filter ? <Button variant="ghost" size={30} onClick={() => onFilter(null)}>Show everyone</Button> : undefined}
      empty={count === 0
        ? (filter
          ? { title: `No one is in “${active?.label ?? ''}” right now.`, variant: 'plain', icon: 'users' }
          : { title: 'No one in your team yet', hint: 'People who report to you appear here with today’s punches.', variant: 'plain', icon: 'users' })
        : false}>
      <ListRows label="Your team today">
        {shown.map((r) => {
          const b = rosterBucket(r)
          const pill = PILL[b]
          const isSent = sent.has(r.employeeId)
          const remindable = b === 'none' && canRemind && !reminders.isLoading && !reminders.error
          return (
            <ListRow key={r.employeeId} variant="divided" density="comfy"
              leading={<Avatar name={r.fullName} src={r.profilePhotoUrl} size={40} />}
              title={r.fullName || 'Someone in your team'}
              sub={roleLine(r.jobTitle ?? r.departmentName, members.get(r.employeeId), today) || undefined}
              meta={rosterWhen(r, b, today)}
              end={pill ? <StatusPill tone={pill[1]} size="sm">{pill[0]}</StatusPill>
                : !remindable || isSent ? <StatusPill tone={isSent ? 'muted' : 'danger'} size="sm">{isSent ? 'Reminder sent' : 'Not in yet'}</StatusPill>
                  : undefined}
              actions={remindable && !isSent ? (
                <button type="button" className="tm-remind" onClick={() => remind(r)} disabled={sending === r.employeeId}
                  aria-busy={sending === r.employeeId || undefined} aria-label={`Send a reminder to ${r.fullName}`}>
                  {sending === r.employeeId ? 'Sending…' : 'Send a reminder'}
                </button>
              ) : undefined}
            />
          )
        })}
        {showOff && off.map((m) => (
          <ListRow key={m.employeeId} variant="divided" density="comfy"
            leading={<Avatar name={m.name} src={m.profilePhotoUrl} size={40} />}
            title={m.name}
            sub={roleLine(m.jobTitle ?? m.departmentName, m, today) || undefined}
            meta={m.offToday === 'HOLIDAY' ? 'Holiday' : 'Weekly off'}
            end={<StatusPill tone="muted" size="sm">Off</StatusPill>}
          />
        ))}
      </ListRows>
    </Section>
  )
}

// ── The right-hand cards ────────────────────────────────────────────────────

type Busy = Record<string, 'approve' | 'reject' | 'undo'>

/** "Waiting for you": the three newest requests, decided here; decisions you can still take back stay with Undo. */
function WaitingCard({ inbox, onSeeAll }: { inbox: ReturnType<typeof useApprovalsInbox>; onSeeAll: () => void }) {
  const toast = useToast()
  const recent = useRecentDecisions()
  const { decide, undo } = useTeamDecisions()
  const [busy, setBusy] = useState<Busy>({})
  const [rejecting, setRejecting] = useState<InboxRow | null>(null)
  const rows = inbox.data?.rows ?? []
  const decided = (recent.data ?? []).filter((d) => Date.parse(d.undoUntil) > Date.now()).slice(0, 3)
  const total = inbox.data?.counts.all ?? 0
  const mark = (id: string, v?: Busy[string]) => setBusy((b) => { const n = { ...b }; if (v) n[id] = v; else delete n[id]; return n })

  const run = async (r: InboxRow, approve: boolean, note: string) => {
    mark(r.requestId, approve ? 'approve' : 'reject')
    try {
      await decide(r.kind, r.requestId, approve, note)
      toast.success(`${approve ? 'Approved' : 'Rejected'} · ${firstName(r.employeeName)} has been told`)
      setRejecting(null)
    } catch (e) {
      toast.error('Couldn’t save the decision', { detail: errorText(e, 'Try again in a moment.') })
    } finally {
      mark(r.requestId)
    }
  }
  const takeBack = async (d: RecentDecision) => {
    mark(d.requestId, 'undo')
    try {
      const r = await undo(d.kind, d.requestId)
      if (r.ok) toast.success(`Undone · ${firstName(r.employeeName)} has been told`)
      else toast.info('This decision can’t be taken back here.')
    } catch (e) {
      toast.error('Couldn’t undo the decision', { detail: errorText(e, 'Try again in a moment.') })
    } finally {
      mark(d.requestId)
    }
  }

  const nothing = rows.length === 0 && decided.length === 0
  return (
    <Section title="Waiting for you" body="list" loading={inbox.isLoading} error={inbox.error} onRetry={() => inbox.refetch()}
      retrying={inbox.isFetching}
      action={total > 0 ? { label: `See all ${total}`, onClick: onSeeAll } : undefined}
      empty={inbox.notAvailable
        ? { title: 'Approvals aren’t available yet', variant: 'plain', icon: 'inbox' }
        : nothing ? { title: 'All caught up', hint: 'Nothing is waiting for you. New requests show up here and in the bell.', variant: 'success' } : false}>
      <div className="tm-waiting">
        {decided.map((d) => (
          <ApprovalRow key={`d-${d.id}`} variant="compact" name={d.employeeName} title={d.summary}
            status={d.decision === 'APPROVED' ? 'approved' : 'rejected'}
            statusLabel={`${decisionWord(d.decision)} · ${firstName(d.employeeName)} has been told`}
            busy={busy[d.requestId] === 'undo' ? 'undo' : false} onUndo={() => takeBack(d)} undoUntil={d.undoUntil} />
        ))}
        {rows.filter((r) => !decided.some((d) => d.requestId === r.requestId)).map((r) => (
          <ApprovalRow key={r.requestId} variant="compact" name={r.employeeName} title={inboxWhat(r)}
            meta={relTime(r.createdAt)} status="pending" busy={busy[r.requestId] ?? false}
            onApprove={r.canDecide ? (note) => run(r, true, note) : undefined}
            onReject={r.canDecide ? (note) => (r.rejectNeedsReason ? setRejecting(r) : run(r, false, note)) : undefined} />
        ))}
      </div>
      <RejectReasonDialog open={!!rejecting} name={rejecting?.employeeName ?? ''} busy={!!rejecting && busy[rejecting.requestId] === 'reject'}
        onClose={() => setRejecting(null)} onReject={(reason) => rejecting && run(rejecting, false, reason)} />
    </Section>
  )
}

/** Probation ending in the next 30 days (and any already past): dates for every manager; Confirm / Extend with the permission. */
function ProbationCard({ canDecide }: { canDecide: boolean }) {
  const q = useTeamProbation(30)
  const [confirming, setConfirming] = useState<TeamProbationRow | null>(null)
  const [extending, setExtending] = useState<TeamProbationRow | null>(null)
  const list = (q.data ?? []).slice(0, 3)
  if (q.notAvailable || (!q.isLoading && !q.error && list.length === 0)) return null
  return (
    <Section title="Probation" level={2} loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} retrying={q.isFetching}
      count={q.data && q.data.length > 3 ? `· ${q.data.length}` : undefined}>
      <div className="tm-prob-list">
        {list.map((r) => (
          <div key={r.employeeId} className="tm-prob">
            <div className="tm-prob-when">{probationWhen(r.probationEndDate, r.daysLeft)}</div>
            <div className="tm-prob-who">{[r.name, r.jobTitle].filter(Boolean).join(' · ')}</div>
            <p className="tm-prob-text">{r.overdue ? 'The end date has passed. HR is waiting for a decision.' : 'Decide before then.'}</p>
            {canDecide && (
              <div className="tm-prob-acts">
                <Button variant="primary" size={36} onClick={() => setConfirming(r)}>Confirm</Button>
                <Button variant="secondary" size={36} onClick={() => setExtending(r)}>Extend by a month</Button>
              </div>
            )}
          </div>
        ))}
      </div>
      <ConfirmProbationDialog row={confirming} onClose={() => setConfirming(null)} />
      <ExtendProbationDialog row={extending} onClose={() => setExtending(null)} />
    </Section>
  )
}

/** The newest active review cycle the team has assignments in: self-reviews in, then each person. */
function ReviewsCard() {
  const cycles = useReviewCycles(true)
  const active = useMemo(() => (cycles.data ?? []).filter((c) => c.status === 'ACTIVE')
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '')).slice(0, 6), [cycles.data])
  const progress = useQueries({
    queries: active.map((c) => ({
      queryKey: ['hrms', 'performance', 'cycle-progress', c.id],
      queryFn: () => apiJson<CycleProgress>(`/v1/performance/cycles/${c.id}/progress`),
      staleTime: 30_000,
    })),
  })
  const loading = cycles.isLoading || progress.some((x) => x.isLoading)
  const failed = cycles.error ?? progress.find((x) => x.error)?.error
  const pick = progress.map((x) => x.data).find((d) => d && d.reviewees.length > 0)
  if (!loading && !failed && !pick) return null
  const m = reviewsModel(pick)
  return (
    <Section title={pick?.cycleName ?? 'Reviews'} level={2} loading={loading} error={failed} body="list"
      onRetry={() => { cycles.refetch(); progress.forEach((x) => x.refetch()) }}
      sub={pick ? `${m.selfIn} of ${m.selfTotal} self-reviews are in.${m.ready > 0 ? ' Start with those.' : ''}` : undefined}>
      <ListRows label="Review progress">
        {m.rows.map((r) => (
          <ListRow key={r.id} variant="divided" density="compact" title={r.name}
            end={<span className={r.ready ? 'tm-review tm-review--ready' : 'tm-review'}>{r.text}</span>} />
        ))}
      </ListRows>
    </Section>
  )
}

/** Leave in the next two weeks, approved or waiting. */
function OutSoonCard({ today }: { today: string }) {
  const to = addDays(today, 13)
  const q = useTeamTimeOff(today, to)
  const items = outSoon(q.data, today)
  if (q.notAvailable) return null
  return (
    <Section title="Out soon" body="list" loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} retrying={q.isFetching}
      empty={items.length === 0 ? { title: 'No one is out in the next two weeks.', variant: 'plain', icon: 'calendar' } : false}>
      <ListRows label="Out soon">
        {items.map((o) => (
          <ListRow key={o.key} variant="divided" density="compact" title={o.name} sub={o.when}
            end={<span className={o.waiting ? 'tm-out tm-out--waiting' : 'tm-out'}>{o.status}</span>} />
        ))}
      </ListRows>
    </Section>
  )
}

export function NoTeamAccess() {
  return <EmptyState variant="plain" icon="lock" title="No team access" hint="Ask an admin if you manage people and can’t see them here." />
}
