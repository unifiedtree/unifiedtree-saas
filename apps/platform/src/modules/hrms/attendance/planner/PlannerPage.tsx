// /hrms/shifts/planner/new and /hrms/shifts/planner/:rosterId — the shift planner (design §1.6 "PlannerPage").
// Split screen: the seven steps on the LEFT (about 400 px, scrolling on their own), the live preview on the RIGHT.
// Every change on the left asks POST /v1/rosters/preview again (300 ms after the last one); pattern, weekly-off mode,
// people, start days and the period lay the pattern again, the rest only refresh coverage and checks. Cell edits paint
// at once. Save draft keeps the working copy (nothing reaches people); Publish (attendance.roster.publish) saves
// first if needed, runs the full check and publishes the days from today on.
// Phone width: the header, the check summary and a note that the planner needs a wider screen.
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Button, Callout, EmptyState, PageFrame, PageHeader, SegmentedControl, StatusPill, errorText } from '@/design/kit/display'
import { Checkbox, Dialog, Menu, PanelButton, Select, useToast, type MenuEntry } from '@/design/kit/overlays'
import { fmtShort, istToday } from '@/design/dc/dates'
import { apiJson } from '@/core/api/client'
import { httpStatusOf, isFeatureNotReady } from '@/core/api/featureNotReady'
import { guardedGo, useNavigationGuard } from '@/design/shell/navigationGuard'
import { useCurrentCompany } from '../../company/CurrentCompany'
import { useShiftPolicies } from '../../api/useShiftPolicies'
import { useBranches, useDesignations } from '../../api/useOrg'
import { useHolidays } from '../../api/useSettings'
import type { Checks, Issue, RosterDetail } from '../../api/rosterTypes'
import {
  ROSTER_CHANGED, ROSTER_HAS_ERRORS, ROSTER_HAS_WARNINGS, checksFromError, downloadRosterExport, fetchRosterCheck, previewPlan,
  rosterErrorCode, rosterKeys, useDeleteRoster, useDiscardRosterChanges, usePlannerPeople, usePublishRoster, useRoster,
  useRosterSettings, useRosters, useRotationTemplates, useSaveRoster,
} from '../../api/useRosters'
import {
  STEPS, checkCountLabel, continueCandidates, coverageView, draftBody, fromDetail, gridView, groupPeople, initialState, isDirty,
  otherRostersOf, patternCodes, periodLabel, planRequest, plannerReducer, previousRoster, publishReach, rangeProblem,
  saveProblem, savedLabel, signature, toShiftLites, type CellEdit, type GridRow, type StepKey,
} from './plannerModel'
import { RosterGrid, TOTAL_COLUMNS, type GridFlash } from './preview/RosterGrid'
import { CoverageRows } from './preview/CoverageRows'
import { ScheduleCheck } from './preview/ScheduleCheck'
import { PublishDialog, INFO_ONLY_NOTE } from './PublishDialog'
import { PatternChips } from './PatternList'
import { rosterStatus } from './RosterList'
import { StepCard } from './steps/StepCard'
import { PeriodStep } from './steps/PeriodStep'
import { ShiftsStep } from './steps/ShiftsStep'
import { PatternStep } from './steps/PatternStep'
import { StaffingStep } from './steps/StaffingStep'
import { PeopleStep } from './steps/PeopleStep'
import { OFF_MODES, OffsStep } from './steps/OffsStep'
import { GenerateStep, editedCount, generateBlocker } from './steps/GenerateStep'
import { usePlannerScope } from './usePlannerScope'
import './planner.css'
import '../analytics/analytics.css'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PREVIEW_DEBOUNCE_MS = 300

export function PlannerPage() {
  const { rosterId: param } = useParams<{ rosterId?: string }>()
  if (param && !UUID_RE.test(param)) {
    return (
      <PageFrame label="Shift planner">
        <PageHeader eyebrow="Shifts & overtime" title="Shift planner" />
        <EmptyState icon="calendarDays" title="This page isn’t available." hint="Open a roster from Shifts & overtime › Shift Planner." />
      </PageFrame>
    )
  }
  return <Planner rosterId={param ?? null} />
}

function Planner({ rosterId }: { rosterId: string | null }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const toast = useToast()
  const today = istToday()
  const { companyId: currentCompany } = useCurrentCompany()
  const detail = useRoster(rosterId)
  // A roster already in the cache (just created, or opened before) opens as it is, without a blank first frame.
  const [state, dispatch] = useReducer(plannerReducer, null, () => (detail.data ? fromDetail(detail.data, today) : initialState(today)))
  const companyId = detail.data?.roster.companyId ?? currentCompany
  const scope = usePlannerScope(companyId)
  const canEdit = scope.canPlan && (detail.data?.roster.canEdit ?? true)
  const canPublish = scope.canPublish && (detail.data?.roster.canPublish ?? true)

  // ── Loading a saved roster (once; later answers come through save / publish / discard) ──
  useEffect(() => {
    if (detail.data && state.rosterId !== detail.data.roster.id) dispatch({ type: 'load', detail: detail.data })
  }, [detail.data]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Reference data ──
  const policies = useShiftPolicies(companyId)
  const shifts = useMemo(() => toShiftLites(policies.data ?? []), [policies.data])
  const shiftMap = useMemo(() => new Map(shifts.map((s) => [s.id, s])), [shifts])
  const ticked = useMemo(() => state.config.shiftIds.map((id) => shiftMap.get(id)).filter((s): s is NonNullable<typeof s> => !!s), [state.config.shiftIds, shiftMap])
  const templates = useRotationTemplates(companyId, { enabled: scope.canPlan })
  const branches = useBranches(companyId)
  const designations = useDesignations(companyId)
  const rosters = useRosters(companyId)
  const settings = useRosterSettings(companyId, { enabled: scope.canPlan || scope.canPolicy })
  const y1 = Number(state.startDate.slice(0, 4)), y2 = Number(state.endDate.slice(0, 4))
  const hol1 = useHolidays(companyId, y1), hol2 = useHolidays(companyId, y2)
  const holidays = useMemo(() => [...(hol1.data ?? []), ...(y2 !== y1 ? hol2.data ?? [] : [])]
    .filter((h) => h.active !== false && h.holidayDate >= state.startDate && h.holidayDate <= state.endDate)
    .sort((a, b) => a.holidayDate.localeCompare(b.holidayDate)), [hol1.data, hol2.data, y1, y2, state.startDate, state.endDate])
  const periodOk = !rangeProblem(state.startDate, state.endDate)
  const people = usePlannerPeople({ companyId, departmentId: state.departmentId, branchId: state.branchId, from: state.startDate, to: state.endDate }, { enabled: scope.canPlan && periodOk && (scope.companyWide || !!state.departmentId) })
  const peopleMap = useMemo(() => new Map((people.data ?? []).map((p) => [p.employeeId, p])), [people.data])
  const groups = useMemo(() => groupPeople(people.data ?? []), [people.data])
  const designationNames = useMemo(() => new Map(groups.map((g) => [g.designationId, g.name])), [groups])
  const deptName = useMemo(() => new Map(scope.departments.map((d) => [d.id, d.name])), [scope.departments])
  const branchName = useMemo(() => new Map((branches.data ?? []).map((b) => [b.id, b.name])), [branches.data])
  const scopeLabel = useCallback((d: string | null, b: string | null) => [d ? deptName.get(d) : null, b ? branchName.get(b) : null].filter(Boolean).join(' · ') || null, [deptName, branchName])

  // ── A new roster's starting point: a department planner's own department, every shift, everyone in scope ──
  const started = useRef({ dept: false, shifts: false, peopleKey: '', peopleIds: '' })
  // Back to /new (browser history) from a roster: a new roster again. Saving a new one moves the other way and keeps it.
  const lastParam = useRef(rosterId)
  useEffect(() => {
    if (lastParam.current && !rosterId) { started.current = { dept: false, shifts: false, peopleKey: '', peopleIds: '' }; dispatch({ type: 'reset' }) }
    lastParam.current = rosterId
  }, [rosterId])
  useEffect(() => {
    if (state.status !== 'NEW' || started.current.dept || scope.loading || scope.companyWide || !scope.departments.length) return
    started.current.dept = true
    const d = scope.departments[0]
    dispatch({ type: 'scope', departmentId: d.id, branchId: null, scopeLabel: d.name })
    dispatch({ type: 'baseline' })
  }, [state.status, scope.loading, scope.companyWide, scope.departments])
  useEffect(() => {
    if (state.status !== 'NEW' || started.current.shifts || !shifts.length) return
    started.current.shifts = true
    dispatch({ type: 'shifts', shiftIds: shifts.map((s) => s.id) })
    dispatch({ type: 'baseline' })
  }, [state.status, shifts])
  useEffect(() => {
    if (state.status !== 'NEW' || !people.data) return
    const key = JSON.stringify([state.departmentId, state.branchId, state.startDate, state.endDate])
    if (started.current.peopleKey === key) return
    const now = state.members.map((m) => m.employeeId).join(',')
    // Once the planner has ticked people themselves, a new scope leaves their choice alone.
    if (state.members.length && now !== started.current.peopleIds) { started.current.peopleKey = key; return }
    const ids = groups.flatMap((g) => g.people).filter((p) => !otherRostersOf(p, null).length).map((p) => p.employeeId)
    started.current.peopleKey = key
    started.current.peopleIds = ids.join(',')
    const wasDirty = isDirty(state)
    dispatch({ type: 'members', employeeIds: ids })
    dispatch({ type: 'designations', designationIds: groups.filter((g) => g.people.some((p) => ids.includes(p.employeeId))).map((g) => g.designationId) })
    if (!wasDirty) dispatch({ type: 'baseline' })
  }, [people.data]) // eslint-disable-line react-hooks/exhaustive-deps

  // Shift Schedules may be open in another tab: read the shifts again on coming back, and refresh the preview when they changed.
  const refetchShifts = policies.refetch
  useEffect(() => {
    const f = () => { void refetchShifts() }
    window.addEventListener('focus', f)
    return () => window.removeEventListener('focus', f)
  }, [refetchShifts])
  const shiftsSeen = useRef(0)
  useEffect(() => {
    if (!policies.dataUpdatedAt) return
    if (shiftsSeen.current && shiftsSeen.current !== policies.dataUpdatedAt) dispatch({ type: 'refresh' })
    shiftsSeen.current = policies.dataUpdatedAt
  }, [policies.dataUpdatedAt])

  // ── The live preview ──
  const latest = useRef(state)
  latest.current = state
  const [updating, setUpdating] = useState(false)
  const [previewError, setPreviewError] = useState<unknown>(null)
  useEffect(() => {
    const s = latest.current
    if (!s.generated || s.rev <= s.planRev || !companyId || rangeProblem(s.startDate, s.endDate)) { setUpdating(false); return }
    const ctrl = new AbortController()
    const body = planRequest(s), rev = s.rev
    setUpdating(true)
    const t = window.setTimeout(() => {
      previewPlan(companyId, body, ctrl.signal)
        .then((plan) => { if (!ctrl.signal.aborted) { dispatch({ type: 'plan', rev, regenerate: body.regenerate, plan }); setPreviewError(null) } })
        .catch((e) => { if (!ctrl.signal.aborted) setPreviewError(e) })
        .finally(() => { if (!ctrl.signal.aborted) setUpdating(false) })
    }, PREVIEW_DEBOUNCE_MS)
    return () => { window.clearTimeout(t); ctrl.abort() }
  }, [state.rev, state.generated, companyId])

  // ── Save, check, publish ──
  const dirty = isDirty(state)
  const save = useSaveRoster()
  const publish = usePublishRoster()
  const discard = useDiscardRosterChanges()
  const remove = useDeleteRoster()
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(t) }, [])
  const [conflict, setConflict] = useState(false)
  const [fullChecks, setFullChecks] = useState<{ checks: Checks; rev: number } | null>(null)
  const [publishOpen, setPublishOpen] = useState(false)
  const [checking, setChecking] = useState(false)
  const [checkError, setCheckError] = useState<unknown>(null)
  const [showCheck, setShowCheck] = useState(false)

  const saveDraft = async (quiet = false): Promise<RosterDetail | null> => {
    const s = latest.current
    const problem = saveProblem(s)
    if (problem) { toast.error('Can’t save yet', { detail: problem }); return null }
    const sentSig = signature(s), sentRev = s.rev
    try {
      const d = await save.mutateAsync({ companyId, id: s.rosterId, body: draftBody(s) })
      dispatch({ type: 'saved', detail: d, sentSig, sentRev })
      setSavedAt(Date.now())
      if (!quiet) toast.success('Draft saved', { detail: 'No one sees it until it’s published.' })
      if (!s.rosterId) navigate(`/hrms/shifts/planner/${d.roster.id}`, { replace: true })
      return d
    } catch (e) {
      if (rosterErrorCode(e) === ROSTER_CHANGED) setConflict(true)
      else toast.error('Couldn’t save the roster', { detail: errorText(e, 'Try again in a moment.') })
      return null
    }
  }
  /** The roster as saved now (saving first when there are changes); null when that failed. */
  const ensureSaved = async () => {
    const s = latest.current
    if (s.rosterId && !isDirty(s)) return s.rosterId
    const d = await saveDraft(true)
    return d?.roster.id ?? null
  }
  const runCheck = async (id: string) => {
    setChecking(true); setCheckError(null)
    try {
      const c = await fetchRosterCheck(id)
      setFullChecks({ checks: c, rev: latest.current.rev })
      return c
    } catch (e) { setCheckError(e); return null } finally { setChecking(false) }
  }
  const onCheck = async () => {
    const id = await ensureSaved()
    if (!id) return
    setShowCheck(true)
    const c = await runCheck(id)
    if (c) toast.info(`Checked: ${checkCountLabel(c).toLowerCase()}`)
  }
  const onStartPublish = async () => {
    const id = await ensureSaved()
    if (!id) return
    setPublishOpen(true)
    await runCheck(id)
  }
  const reload = async () => {
    const id = latest.current.rosterId
    if (!id) return
    const d = await qc.fetchQuery({ queryKey: rosterKeys.detail(id), queryFn: () => apiJson<RosterDetail>(`/v1/rosters/${id}`), staleTime: 0 })
    dispatch({ type: 'load', detail: d })
    setFullChecks(null)
  }
  const onPublish = async (acknowledgeWarnings: boolean, note: string) => {
    const s = latest.current
    if (!s.rosterId || s.lockVersion == null) return
    try {
      const r = await publish.mutateAsync({ id: s.rosterId, body: { lockVersion: s.lockVersion, acknowledgeWarnings, ...(note ? { note } : {}) } })
      setPublishOpen(false)
      toast.success(`Published. ${r.peopleToNotify} ${r.peopleToNotify === 1 ? 'person' : 'people'} will be told.`,
        { detail: `${r.daysAdded} days added, ${r.daysChanged} changed, ${r.daysRemoved} removed · version ${r.version}` })
      await reload().catch(() => undefined)
    } catch (e) {
      const code = rosterErrorCode(e)
      const c = checksFromError(e)
      if ((code === ROSTER_HAS_ERRORS || code === ROSTER_HAS_WARNINGS) && c) setFullChecks({ checks: c, rev: s.rev })
      else if (code === ROSTER_CHANGED) { setPublishOpen(false); setConflict(true) }
      else toast.error('Couldn’t publish the roster', { detail: errorText(e, 'Try again in a moment.') })
    }
  }
  const onDiscard = async () => {
    const s = latest.current
    if (!s.rosterId || s.lockVersion == null) return
    try {
      const d = await discard.mutateAsync({ id: s.rosterId, body: { lockVersion: s.lockVersion } })
      dispatch({ type: 'load', detail: d })
      setDiscardOpen(false)
      toast.success('Changes discarded', { detail: 'The roster is back to what was published.' })
    } catch (e) {
      if (rosterErrorCode(e) === ROSTER_CHANGED) { setDiscardOpen(false); setConflict(true) } else toast.error('Couldn’t discard the changes', { detail: errorText(e, 'Try again in a moment.') })
    }
  }
  const onDelete = async () => {
    const s = latest.current
    if (!s.rosterId) return
    try {
      await remove.mutateAsync(s.rosterId)
      setDeleteOpen(false)
      toast.success(`${s.name} deleted`)
      navigate('/hrms/shifts?tab=planner', { replace: true })
    } catch (e) { toast.error('Couldn’t delete the roster', { detail: errorText(e, 'Try again in a moment.') }) }
  }
  const [discardOpen, setDiscardOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  // ── Leaving with unsaved changes asks first ──
  const [leave, setLeave] = useState<(() => void) | null>(null)
  useNavigationGuard(dirty && canEdit ? (proceed) => { setLeave(() => proceed); return true } : null)
  useEffect(() => {
    if (!dirty || !canEdit) return
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty, canEdit])

  // ── Undo (Ctrl+Z outside a field; the grid handles its own) ──
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z' || e.shiftKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.closest('input, textarea, select, [contenteditable="true"]') || t.closest('.spl-grid'))) return
      if (!latest.current.undo.length) return
      e.preventDefault()
      dispatch({ type: 'undo' })
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  // ── The preview's view ──
  const [step, setStep] = useState<StepKey>(rosterId ? 'generate' : 'period')
  const [compact, setCompact] = useState(false)
  const [filter, setFilter] = useState<string | null>(null)
  const [showCoverage, setShowCoverage] = useState(true)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [flash, setFlash] = useState<GridFlash | null>(null)
  const [offsetRow, setOffsetRow] = useState<GridRow | null>(null)
  const [offsetDay, setOffsetDay] = useState('1')
  const view = useMemo(() => gridView(state, shiftMap, peopleMap, filter), [state, shiftMap, peopleMap, filter])
  const coverage = useMemo(() => coverageView(state.plan, state.config.shiftIds, shiftMap, designationNames), [state.plan, state.config.shiftIds, shiftMap, designationNames])
  const checks = fullChecks && fullChecks.rev === state.rev ? fullChecks.checks : state.plan?.checks ?? null
  const reach = useMemo(() => publishReach(state), [state])
  const review = useCallback((i: Issue) => { setFilter(null); setFlash({ employeeId: i.employeeId, dates: i.dates, key: Date.now() }) }, [])
  const patternLen = state.config.pattern.length
  const rowMenu = useCallback((row: GridRow): MenuEntry[] => [
    { key: 'offset', label: 'Start on pattern day…', sub: row.offset != null ? `Now day ${row.offset + 1}` : undefined, disabled: !patternLen || !state.generated,
      onSelect: () => { setOffsetDay(String((row.offset ?? 0) + 1)); setOffsetRow(row) } },
    { key: 'clear', label: 'Clear row', sub: 'Every day left empty', onSelect: () => dispatch({ type: 'cells', edits: row.cells.map((_c, i) => ({ employeeId: row.employeeId, index: i, token: null })) }) },
    { key: 'sep', separator: true },
    { key: 'remove', label: 'Remove from roster', danger: true, onSelect: () => dispatch({ type: 'removeMember', employeeId: row.employeeId }) },
  ], [patternLen, state.generated])
  const onEdit = useCallback((edits: CellEdit[]) => dispatch({ type: 'cells', edits }), [])
  const onUndo = useCallback(() => dispatch({ type: 'undo' }), [])

  // ── Page states ──
  const notReady = isFeatureNotReady(detail.error) || isFeatureNotReady(previewError) || isFeatureNotReady(templates.error)
  const frame = (body: JSX.Element) => (
    <PageFrame label="Shift planner" className="apl-page spl-page">
      <PageHeader eyebrow={<BackLink />} title="Shift planner" />
      {body}
    </PageFrame>
  )
  if (!scope.canPlan && !scope.canPublish) return frame(<EmptyState icon="lock" title="Not available for your role" hint="Planning rosters needs Plan shift rosters." />)
  if (notReady) return frame(<EmptyState icon="calendarDays" title="Shift planning isn’t switched on yet." hint="Shifts & overtime works as before." />)
  if (rosterId && detail.isLoading) return frame(<EmptyState icon="calendarDays" title="Opening the roster…" />)
  if (rosterId && detail.error) {
    const st = httpStatusOf(detail.error)
    return frame(st === 404 ? <EmptyState icon="calendarDays" title="This roster doesn’t exist any more." hint="It may have been deleted." />
      : st === 403 ? <EmptyState icon="lock" title="You can’t open this roster." hint="It belongs to a department you don’t plan." />
        : <EmptyState icon="alert" title="Couldn’t open the roster" hint={errorText(detail.error)} action={<Button variant="secondary" onClick={() => detail.refetch()}>Try again</Button>} />)
  }
  if (!rosterId && scope.noDepartment) return frame(<EmptyState icon="users" title="You don’t head a department." hint="HR plans rosters for the company." />)

  const status = state.status === 'NEW' ? null : rosterStatus({ status: state.status, hasUnpublishedChanges: state.hasUnpublishedChanges || (state.status === 'PUBLISHED' && dirty) })
  const r = detail.data?.roster
  const saveState = state.status === 'NEW' && !dirty ? 'Not saved yet' : dirty ? 'Unsaved changes' : savedLabel(savedAt, now) || (r?.updatedAt ? `Saved ${fmtShort(r.updatedAt.slice(0, 10))}` : '')
  const stepSummary: Record<StepKey, string> = {
    period: [periodLabel(state.startDate, state.endDate), scopeLabel(state.departmentId, state.branchId) ?? 'Whole company'].join(' · '),
    shifts: ticked.length ? ticked.map((s) => s.code).join(', ') : 'None ticked',
    pattern: patternLen ? patternCodes(state.config.pattern, shiftMap).join(' ') : 'Not set',
    staffing: state.staffing.length ? `${state.staffing.length} ${state.staffing.length === 1 ? 'requirement' : 'requirements'}` : 'No requirements',
    people: `${state.members.length} ${state.members.length === 1 ? 'person' : 'people'} · ${state.config.staggerMode === 'SPREAD' ? 'spread start days' : state.config.staggerMode === 'SAME' ? 'same start' : 'continued'}`,
    offs: `${OFF_MODES.find((m) => m.value === state.config.weeklyOffMode)?.label ?? ''} · ${holidays.length} ${holidays.length === 1 ? 'holiday' : 'holidays'}`,
    generate: state.generated ? `Generated${editedCount(state) ? ` · ${editedCount(state)} days edited` : ''}` : 'Not generated yet',
  }
  const done: Record<StepKey, boolean> = {
    period: periodOk, shifts: ticked.length > 0, pattern: patternLen > 0, staffing: state.staffing.length > 0,
    people: state.members.length > 0, offs: true, generate: state.generated,
  }
  const outOfScope = people.data ? state.members.map((m) => m.employeeId).filter((id) => !peopleMap.has(id)) : []
  const more: MenuEntry[] = [
    ...(state.rosterId ? [{ key: 'export', label: 'Export to Excel', icon: 'download', onSelect: () => { downloadRosterExport({ id: state.rosterId!, name: state.name }).catch((e) => toast.error('Couldn’t export the roster', { detail: errorText(e) })) } }] : []),
    ...(canEdit && state.status === 'PUBLISHED' && (state.hasUnpublishedChanges || dirty) ? [{ key: 'discard', label: 'Discard changes', sub: 'Back to what was published', onSelect: () => setDiscardOpen(true) }] : []),
    ...(canEdit && state.status === 'DRAFT' && state.version === 0 ? [{ key: 'delete', label: 'Delete draft', danger: true, onSelect: () => setDeleteOpen(true) }] : []),
  ]
  const publishLabel = state.status === 'PUBLISHED' ? 'Publish changes' : 'Publish'
  const canPublishNow = state.status !== 'PUBLISHED' || state.hasUnpublishedChanges || dirty

  const header = (
    <PageHeader eyebrow={<BackLink />}
      title={canEdit ? <input className="spl-title" aria-label="Roster name" maxLength={120} value={state.name} onChange={(e) => dispatch({ type: 'name', name: e.target.value })} /> : state.name}
      sub={(
        <span className="spl-sub">
          {status && <StatusPill tone={status.tone} size="xs">{status.label}</StatusPill>}
          {r?.publishedAt && <span>Published by {r.publishedByName ?? 'HR'} on {fmtShort(r.publishedAt.slice(0, 10))} · version {r.version}</span>}
          {canEdit && <span className="spl-sub__save" data-dirty={dirty ? '' : undefined}>{saveState}</span>}
        </span>
      )}
      actions={(
        <div className="spl-actions">
          {canEdit && <Button variant="secondary" loading={save.isPending && !publishOpen} disabled={!dirty && !!state.rosterId} onClick={() => saveDraft()}>Save draft</Button>}
          {(canEdit || state.rosterId) && <Button variant="secondary" loading={checking && !publishOpen} disabled={!state.generated} onClick={onCheck}>Check</Button>}
          {canPublish
            ? <Button disabled={!state.generated || !canPublishNow || !state.members.length} onClick={onStartPublish} loading={save.isPending && publishOpen}>{publishLabel}</Button>
            : <span className="spl-sub__note">HR publishes this roster when it’s ready.</span>}
          {more.length > 0 && <Menu label="More roster actions" items={more} width={240} trigger={({ props }) => <Button variant="ghost" icon="menu" aria-label="More roster actions" {...props} />} />}
        </div>
      )} />
  )

  const preview = (
    <section className="spl-preview" aria-label="Live preview">
      <div className="spl-toolbar">
        <div className="spl-toolbar__left">
          <strong className="spl-toolbar__period">{periodLabel(state.startDate, state.endDate)}</strong>
          <ul className="spl-legend" aria-label="Legend">
            {ticked.map((s) => <li key={s.id} title={`${s.name} ${s.start}–${s.end}`}><span className="spl-code spl-code--sm" data-tone={s.tone}>{s.code}</span>{s.name}</li>)}
            <li><span className="spl-code spl-code--sm" data-tone="wo">WO</span>Weekly off</li>
            <li><span className="spl-badge" data-type="PH">PH</span>Holiday</li>
            <li><span className="spl-badge" data-type="L">L</span>Leave</li>
            <li><span className="spl-badge" data-type="COFF">CO</span>Comp-off</li>
          </ul>
        </div>
        <div className="spl-toolbar__right">
          <SegmentedControl label="Row size" size="sm" value={compact ? 'compact' : 'comfy'} onChange={(v) => setCompact(v === 'compact')}
            options={[{ value: 'comfy', label: 'Comfortable' }, { value: 'compact', label: 'Compact' }]} />
          {groups.length > 1 && (
            <Select size="md" aria-label="Show designation" fieldClassName="spl-inline-select" value={filter ?? '*'} onChange={(e) => setFilter(e.target.value === '*' ? null : e.target.value)}
              options={[{ value: '*', label: 'All designations' }, ...groups.map((g) => ({ value: g.designationId, label: g.name }))]} />
          )}
          <Checkbox checked={showCoverage} onChange={setShowCoverage} label="Coverage" />
          <Button variant={showCheck ? 'soft' : 'secondary'} size={32} icon="checkCircle" disabled={!checks} onClick={() => setShowCheck((v) => !v)} aria-expanded={showCheck}>
            {checks ? checkCountLabel(checks) : 'Schedule check'}
          </Button>
        </div>
      </div>
      {updating && <div className="spl-updating" role="status">Updating…</div>}
      {!!previewError && !updating && !isFeatureNotReady(previewError) && (
        <div className="spl-note" data-tone="red">Couldn’t update the preview: {errorText(previewError, 'Try again in a moment.')} <button type="button" className="spl-link" onClick={() => dispatch({ type: 'refresh' })}>Try again</button></div>
      )}
      {showCheck && <ScheduleCheck checks={checks} updating={updating} full={!!fullChecks && fullChecks.rev === state.rev} onReview={review} />}
      {!state.generated && (
        <div className="spl-before">
          {patternLen > 0 ? <><span className="spl-field__label">Pattern</span><PatternChips days={state.config.pattern} shifts={shiftMap} max={31} /></> : <span className="apl-muted">Choose a pattern in step 3.</span>}
          <span className="apl-muted">{generateBlocker(state) ?? 'Generate the schedule to lay the pattern over the period.'}</span>
          {!generateBlocker(state) && canEdit && <Button icon="calendarCheck" onClick={() => { dispatch({ type: 'generate' }); setStep('generate') }}>Generate schedule</Button>}
        </div>
      )}
      <RosterGrid view={view} shifts={ticked} compact={compact} readOnly={!canEdit || !state.generated} onEdit={onEdit} onUndo={onUndo}
        rowMenu={canEdit ? rowMenu : undefined} flash={flash} maxHeight="calc(100vh - 300px)"
        empty={people.isLoading ? 'Loading the people…' : 'Tick people in step 5.'}
        footer={showCoverage && state.generated ? <CoverageRows groups={coverage} dayCount={view.days.length} trailing={TOTAL_COLUMNS} expanded={expanded}
          onToggle={(id) => setExpanded((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })} /> : undefined} />
      {state.undo.length > 0 && canEdit && <p className="spl-hint">Ctrl+Z undoes the last edit ({state.undo.length} to undo).</p>}
    </section>
  )

  const steps = canEdit ? (
    <aside className="spl-left" aria-label="Plan the roster">
      {STEPS.map((st, i) => (
        <StepCard key={st.key} index={i + 1} title={st.label} summary={stepSummary[st.key]} done={done[st.key]} open={step === st.key} onOpen={() => setStep(st.key)}>
          {st.key === 'period' && <PeriodStep state={state} dispatch={dispatch} departments={scope.departments} branches={branches.data ?? []} companyWide={scope.companyWide} departmentsError={!!scope.error} scopeLabel={scopeLabel} />}
          {st.key === 'shifts' && <ShiftsStep state={state} dispatch={dispatch} shifts={shifts} canEditShifts={scope.companyWide} loading={policies.isLoading} />}
          {st.key === 'pattern' && <PatternStep state={state} dispatch={dispatch} templates={templates.data ?? []} shifts={shifts} ticked={ticked} companyId={companyId} canSaveTemplate={scope.canPlan} />}
          {st.key === 'staffing' && <StaffingStep state={state} dispatch={dispatch} ticked={ticked} groups={groups} designations={designations.data ?? []} previous={previousRoster(rosters.data ?? [], state)} />}
          {st.key === 'people' && <PeopleStep state={state} dispatch={dispatch} groups={groups} loading={people.isLoading} error={people.error} onRetry={() => people.refetch()}
            continueFrom={continueCandidates(rosters.data ?? [], state)} outOfScope={outOfScope} />}
          {st.key === 'offs' && <OffsStep state={state} dispatch={dispatch} holidays={holidays} holidaysLoading={hol1.isLoading} companyId={companyId} canAddHoliday={scope.canAddHoliday}
            onHolidayAdded={() => dispatch({ type: 'refresh' })} />}
          {st.key === 'generate' && <GenerateStep state={state} dispatch={dispatch} busy={updating} />}
        </StepCard>
      ))}
    </aside>
  ) : (
    <aside className="spl-left" aria-label="Roster">
      <div className="spl-step spl-step--plain">
        <dl className="spl-facts spl-facts--stack">
          <div><dt>Period</dt><dd>{stepSummary.period}</dd></div>
          <div><dt>Pattern</dt><dd>{stepSummary.pattern}</dd></div>
          <div><dt>People</dt><dd>{stepSummary.people}</dd></div>
          <div><dt>Weekly offs</dt><dd>{stepSummary.offs}</dd></div>
        </dl>
        <p className="spl-note">You can review and publish this roster. Changing it needs Plan shift rosters.</p>
      </div>
    </aside>
  )

  return (
    <PageFrame label="Shift planner" className="apl-page spl-page">
      {header}
      {settings.data?.rostersDriveAttendance !== true && <Callout tone="info" icon="info" className="spl-info">{INFO_ONLY_NOTE}</Callout>}
      <div className="spl-split">
        {steps}
        {preview}
      </div>
      <div className="spl-narrow">
        <ScheduleCheck checks={checks} updating={updating} compact />
        <p className="spl-note">The planner needs a wider screen. Open it on a computer.</p>
      </div>

      <PublishDialog open={publishOpen} onClose={() => setPublishOpen(false)} state={state} reach={reach} checks={fullChecks?.checks ?? null}
        checking={checking} checkError={checkError} onRetryCheck={() => state.rosterId && runCheck(state.rosterId)} busy={publish.isPending} onPublish={onPublish} />

      <Dialog open={!!offsetRow} onClose={() => setOffsetRow(null)} title={offsetRow ? `Start ${offsetRow.name} on…` : ''} sub={`The day of the pattern ${offsetRow?.name.split(' ')[0] ?? 'they'} work on ${periodLabel(state.startDate, state.startDate)}.`}
        footer={(
          <>
            <PanelButton variant="secondary" onClick={() => setOffsetRow(null)}>Cancel</PanelButton>
            <PanelButton variant="primary" onClick={() => { if (offsetRow) dispatch({ type: 'offset', employeeId: offsetRow.employeeId, offset: Math.max(0, Number(offsetDay) - 1) }); setOffsetRow(null) }}>Lay this row again</PanelButton>
          </>
        )}>
        <Select label="Pattern day" value={offsetDay} onChange={(e) => setOffsetDay(e.target.value)}
          options={patternCodes(state.config.pattern, shiftMap).map((c, i) => ({ value: String(i + 1), label: `Day ${i + 1} · ${c}` }))} />
      </Dialog>

      <Dialog open={conflict} onClose={() => setConflict(false)} tone="warning" icon="alert" title="Someone else saved this roster" sub="Reload to see their changes. Your unsaved changes here will be lost."
        footer={(
          <>
            <PanelButton variant="secondary" onClick={() => setConflict(false)}>Not now</PanelButton>
            <PanelButton variant="primary" onClick={() => { setConflict(false); reload().catch((e) => toast.error('Couldn’t reload the roster', { detail: errorText(e) })) }}>Reload</PanelButton>
          </>
        )} />

      <Dialog open={discardOpen} onClose={() => setDiscardOpen(false)} busy={discard.isPending} tone="warning" icon="alert" title="Discard the changes?" sub="Days from today on go back to what was published. Earlier days never change."
        footer={(
          <>
            <PanelButton variant="secondary" onClick={() => setDiscardOpen(false)} disabled={discard.isPending}>Keep editing</PanelButton>
            <PanelButton variant="danger" busy={discard.isPending} onClick={onDiscard}>Discard changes</PanelButton>
          </>
        )} />

      <Dialog open={deleteOpen} onClose={() => setDeleteOpen(false)} busy={remove.isPending} tone="danger" icon="trash" title={`Delete ${state.name}?`} sub="It was never published, so no one has seen it. This can’t be undone."
        footer={(
          <>
            <PanelButton variant="secondary" onClick={() => setDeleteOpen(false)} disabled={remove.isPending}>Cancel</PanelButton>
            <PanelButton variant="danger" busy={remove.isPending} onClick={onDelete}>Delete draft</PanelButton>
          </>
        )} />

      <Dialog open={!!leave} onClose={() => setLeave(null)} tone="warning" icon="alert" title="Leave without saving?" sub="Your changes to this roster haven’t been saved."
        footer={(
          <>
            <PanelButton variant="secondary" onClick={() => setLeave(null)}>Stay</PanelButton>
            <PanelButton variant="danger" onClick={() => { const go = leave; setLeave(null); go?.() }}>Leave</PanelButton>
          </>
        )} />
    </PageFrame>
  )
}

function BackLink() {
  const navigate = useNavigate()
  return <button type="button" className="spl-back" onClick={() => guardedGo(() => navigate('/hrms/shifts?tab=planner'))}>‹ Shift planner</button>
}

