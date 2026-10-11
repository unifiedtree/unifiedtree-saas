// /hrms/shifts/planner/import — import a shift roster from Excel (design §1.7 "Web"): 1 Import · 2 Validate ·
// 3 Preview · 4 Apply. The server reads the file (the client's S13 layout: Employee, Department, Designation,
// Building, one column per day with codes A, B, C, G, WO, PH, L, COFF, then totals), matches people, checks every
// cell and runs the planner; this page only shows what it says. Apply saves a DRAFT (a new one, or the days of a
// draft that was never published); nothing reaches people until HR publishes it in the planner.
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { P, usePermission } from '@unifiedtree/sdk'
import {
  Button, Callout, EmptyState, FilterPills, PageFrame, PageHeader, Section, SegmentedControl, StatCard, StatGrid, StatusPill, StepTrack, Table,
  errorText, type TableColumn,
} from '@/design/kit/display'
import { UploadDrop, UploadFile } from '@/design/kit/data'
import { DateRangeInput, FieldGrid, Input, MonthInput, Select, useToast } from '@/design/kit/overlays'
import { istToday } from '@/design/dc/dates'
import { apiJson } from '@/core/api/client'
import { errorCodeOf } from '@/core/api/featureNotReady'
import { isShiftPlanningOff } from '../../../api/useShiftPlanning'
import { useCurrentCompany } from '../../../company/CurrentCompany'
import { useBranches, useDepartments } from '../../../api/useOrg'
import type { PlanResponse, RosterDetail } from '../../../api/rosterTypes'
import {
  useApplyRosterImport, useDownloadRosterTemplate, useImportRosters, useValidateRosterImport, type ImportScope,
} from '../../../api/useRosterImport'
import {
  ACCEPT, MAX_FILE_BYTES, NAME_MAX, SEVERITY_LABEL, applyError, applySummary, canOpen, changeScope, checkLines, defaultName,
  filterProblems, initialState, monthPeriod, periodLabel, periodLength, plannableDepartments, previewTable, problemCounts,
  problemWhere, rangeProblem, replaceableDrafts, stepStates, validateBlocker, withDraft,
  type ImportProblem, type ImportState, type ImportStep, type PreviewRow, type ProblemFilter,
} from './importModel'
import './rosterImport.css'

const SEVERITY_TONE = { error: 'danger', warning: 'amber', info: 'info' } as const
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

export function RosterImportPage() {
  const navigate = useNavigate()
  const toast = useToast()
  const { companyId } = useCurrentCompany()
  const canPlan = usePermission(P.ATTENDANCE_ROSTER_PLAN)
  const companyWide = usePermission('attendance.workforce.admin')

  const [state, setState] = useState<ImportState>(() => initialState(istToday()))
  const [file, setFile] = useState<File | null>(null)
  const [step, setStep] = useState<ImportStep>('import')
  const [filter, setFilter] = useState<ProblemFilter>('all')
  const [name, setName] = useState<string | null>(null)

  // The same query (and key) the planner uses for the signed-in person's employee id.
  const me = useQuery({ queryKey: ['employees', 'me'], queryFn: () => apiJson<{ id: string }>('/v1/employees/me'), enabled: canPlan && !companyWide, staleTime: 300_000 })
  const departmentsQ = useDepartments(companyId)
  const branchesQ = useBranches(companyId || undefined)
  const rostersQ = useImportRosters(companyId, '', '', { enabled: canPlan })
  const validate = useValidateRosterImport()
  const apply = useApplyRosterImport()
  const template = useDownloadRosterTemplate()

  const departments = useMemo(() => plannableDepartments(departmentsQ.data ?? [], companyWide, me.data?.id), [departmentsQ.data, companyWide, me.data?.id])
  const branches = (branchesQ.data ?? []).filter((b) => b.active !== false)
  const drafts = useMemo(() => replaceableDrafts(rostersQ.data ?? []), [rostersQ.data])
  const scope: ImportScope = { companyId, startDate: state.startDate, endDate: state.endDate, departmentId: state.departmentId, branchId: state.branchId }
  const scopeName = [departments.find((d) => d.id === state.departmentId)?.name, branches.find((b) => b.id === state.branchId)?.name].filter(Boolean).join(' · ')
  const blocker = validateBlocker(state, { hasFile: !!file, companyId, companyWide })
  const v = state.validation
  const notReady = isShiftPlanningOff(rostersQ.error) || isShiftPlanningOff(validate.error) || isShiftPlanningOff(apply.error)

  const update = (patch: Parameters<typeof changeScope>[1]) => { setState((s) => changeScope(s, patch)); validate.reset(); setStep('import') }
  const go = (to: ImportStep) => { if (canOpen(to, state)) setStep(to) }

  const runValidate = async () => {
    if (!file || blocker) return
    try {
      const result = await validate.mutateAsync({ file, scope, rosterId: state.draft?.id })
      setState((s) => ({ ...s, fileName: file.name, validation: result }))
      setFilter(result.summary.errors > 0 ? 'error' : 'all')
      setStep('validate')
    } catch {
      // shown from validate.error
    }
  }

  const runApply = async () => {
    if (!file || !v) return
    try {
      let lockVersion: number | null = null
      if (state.target === 'replace' && state.draft) {
        lockVersion = (await apiJson<RosterDetail>(`/v1/rosters/${state.draft.id}`)).roster.lockVersion
      }
      const detail = await apply.mutateAsync({
        file, scope, rosterId: state.target === 'replace' ? state.draft?.id : null, lockVersion,
        name: state.target === 'new' ? (name ?? defaultName(state.startDate, state.endDate, scopeName)).trim() : undefined,
      })
      toast.success('Draft created. Check it and publish it when ready.')
      navigate(`/hrms/shifts/planner/${detail.roster.id}`)
    } catch {
      // shown from apply.error
    }
  }

  const downloadTemplate = () => {
    if (rangeProblem(state.startDate, state.endDate) || !companyId) return
    template.mutate(scope, { onError: (e) => toast.error(errorText(e, 'Couldn’t download the template. Try again.')) })
  }

  const header = (
    <PageHeader
      eyebrow={<span className="rim-crumbs"><button type="button" onClick={() => navigate('/hrms/shifts?tab=planner')}>Shift Planner</button><span aria-hidden="true">/</span>Import</span>}
      title="Import a roster from Excel"
      sub="Upload the roster sheet, check it, see the preview, then create a draft. Nobody sees it until it is published in the planner."
      actions={<Button size={40} icon="chevronLeft" onClick={() => navigate('/hrms/shifts?tab=planner')}>Back to Shift Planner</Button>} />
  )

  if (!canPlan) {
    return <PageFrame label="Import a roster">{header}<EmptyState icon="calendarDays" title="Importing rosters needs Plan shift rosters." hint="Ask HR or an admin for access." /></PageFrame>
  }
  if (notReady) {
    return <PageFrame label="Import a roster">{header}<EmptyState icon="calendarDays" title="Shift planning isn’t switched on yet." hint="The roster import opens once it is." /></PageFrame>
  }
  if (!companyWide && !me.isLoading && !departmentsQ.isLoading && !departments.length) {
    return <PageFrame label="Import a roster">{header}<EmptyState icon="users" title="You don’t head a department." hint="HR plans rosters for the company." /></PageFrame>
  }

  return (
    <PageFrame label="Import a roster">
      {header}
      <div className="rim-page">
        <StepTrack label="Import steps" steps={stepStates(step).map((s) => ({ key: s.key, label: s.label, state: s.state }))} />

        {step === 'import' && (
          <Section title="1 · Import" sub="Choose the period, download the template if you need it, then upload the filled-in sheet.">
            <div className="rim-form">
              <SegmentedControl label="Import into" semantics="radio" size="sm" value={state.target}
                onChange={(t) => update({ target: t })}
                options={[{ value: 'new', label: 'A new draft' }, { value: 'replace', label: 'The days of a draft', disabled: !drafts.length }]} />
              {state.target === 'replace' && (
                <Select label="Draft" size="md" required value={state.draft?.id ?? ''} placeholder="Choose a draft"
                  hint="Only drafts that were never published. The file replaces their people and days; the period, department and building stay."
                  onChange={(e) => { setState((s) => withDraft(s, drafts.find((d) => d.id === e.target.value) ?? null)); validate.reset() }}
                  options={drafts.map((d) => ({ value: d.id, label: `${d.name} (${periodLabel(d.startDate, d.endDate)})` }))} />
              )}
              <fieldset className="rim-scope" disabled={state.target === 'replace'}>
                <SegmentedControl label="Period" semantics="radio" size="sm" value={state.periodType}
                  onChange={(t) => {
                    if (t === 'MONTH') { const m = monthPeriod(state.startDate.slice(0, 7)); update({ periodType: 'MONTH', ...m }) }
                    else update({ periodType: 'RANGE' })
                  }}
                  options={[{ value: 'MONTH', label: 'Monthly' }, { value: 'RANGE', label: 'Custom range' }]} />
                {state.periodType === 'MONTH' ? (
                  <MonthInput label="Month" size="md" required value={state.startDate.slice(0, 7)} presets={false}
                    onChange={(_e, m) => { if (m) update({ ...monthPeriod(m) }) }} />
                ) : (
                  <DateRangeInput label="Dates" size="md" required months={1} presets={false} value={{ from: state.startDate, to: state.endDate }}
                    error={rangeProblem(state.startDate, state.endDate) ?? undefined}
                    hint={rangeProblem(state.startDate, state.endDate) ? undefined : `${periodLength(state.startDate, state.endDate)} days (at most 62).`}
                    onChange={(_e, r) => { if (r.from && r.to) update({ startDate: r.from, endDate: r.to }) }} />
                )}
                <FieldGrid columns={2} size="md">
                  <Select label="Department" size="md" required={!companyWide} value={state.departmentId ?? ''}
                    placeholder={companyWide ? 'Whole company' : 'Choose a department'}
                    hint={departmentsQ.error ? 'Couldn’t load the departments.' : !companyWide ? 'You import for the departments you head.' : undefined}
                    onChange={(e) => update({ departmentId: e.target.value || null })}
                    options={departments.map((d) => ({ value: d.id, label: d.name }))} />
                  <Select label="Building" size="md" value={state.branchId ?? ''} placeholder="All buildings"
                    onChange={(e) => update({ branchId: e.target.value || null })}
                    options={branches.map((b) => ({ value: b.id, label: b.name }))} />
                </FieldGrid>
              </fieldset>
              <div className="rim-row">
                <Button size={40} icon="download" loading={template.isPending} disabled={!companyId || !!rangeProblem(state.startDate, state.endDate) || (!companyWide && !state.departmentId)}
                  onClick={downloadTemplate}>Download template</Button>
                <span className="rim-muted">The people of {scopeName || 'the company'} for {periodLabel(state.startDate, state.endDate)}, one column per day, and the codes.</span>
              </div>
              {file ? (
                <UploadFile name={file.name} size={file.size} progress={null}
                  onRemove={validate.isPending ? undefined : () => { setFile(null); update({ fileName: null }) }} removeLabel="Choose another file" />
              ) : (
                <UploadDrop variant="zone" accept={ACCEPT} maxSize={MAX_FILE_BYTES} ariaLabel="Choose the roster file"
                  title="Drop the roster sheet here, or choose it" hint="Excel (.xlsx) or CSV · up to 2 MB and 2,000 people"
                  onFiles={(fs) => { if (fs[0]) { setFile(fs[0]); update({ fileName: fs[0].name }) } }} onReject={(r) => r[0] && toast.error(r[0].message)} />
              )}
              <ul className="rim-notes">
                <li>Day codes: each shift’s code (A, B, C, G…), WO for a weekly off, PH, L and COFF. A blank day stays unplanned.</li>
                <li>People are found by employee code, else by full name. The import never changes employee records.</li>
                <li>PH, L and COFF come from Settings › Holidays and approved leave; the sheet only says where they are.</li>
              </ul>
              {validate.isError && !isShiftPlanningOff(validate.error) && (
                <Callout tone="danger" icon="alertTriangle" live>{errorText(validate.error, 'The file couldn’t be checked. Try again.')}</Callout>
              )}
              <div className="rim-row rim-row--end">
                {blocker && file && <span className="rim-muted">{blocker}</span>}
                <Button variant="primary" size={40} icon="check" loading={validate.isPending} disabled={!!blocker} onClick={runValidate}>Check the file</Button>
              </div>
            </div>
          </Section>
        )}

        {step === 'validate' && v && (
          <ValidateStep validation={v} filter={filter} setFilter={setFilter} fileName={state.fileName}
            onBack={() => setStep('import')} onNext={canOpen('preview', state) ? () => go('preview') : undefined} />
        )}

        {step === 'preview' && v?.plan && (
          <Section title="3 · Preview" sub={`${periodLabel(v.startDate, v.endDate)} · ${plural(v.summary.matched, 'person', 'people')}. This is what the draft will hold; the planner’s checks are below.`}
            body="flush" footer={<div className="rim-row"><Button size={40} icon="chevronLeft" onClick={() => setStep('validate')}>Back</Button>
              <Button variant="primary" size={40} trailingIcon="arrowRight" onClick={() => go('apply')}>Continue</Button></div>}>
            <PreviewGrid plan={v.plan} />
            <ul className="rim-checks" aria-label="Schedule check">
              {checkLines(v.plan).map((l) => (
                <li key={l.label} data-level={l.count ? l.level : 'ok'}>
                  <span aria-hidden="true">{!l.count ? '✓' : l.level === 'error' ? '✕' : l.level === 'warning' ? '⚠' : 'i'}</span>{l.label}
                </li>
              ))}
            </ul>
            <p className="rim-muted rim-pad">Warnings don’t stop a draft. Publishing in the planner asks you to look at them first.</p>
          </Section>
        )}

        {step === 'apply' && v && (
          <Section title="4 · Apply">
            <div className="rim-form">
              <p className="rim-lead">{applySummary(state)}</p>
              {state.target === 'new' && (
                <Input label="Roster name" size="md" required maxLength={NAME_MAX} value={name ?? defaultName(state.startDate, state.endDate, scopeName)}
                  onChange={(e) => setName(e.target.value)} />
              )}
              <Callout tone="info">It is saved as a draft. Nothing changes for anyone until it is published in the planner.</Callout>
              {apply.isError && !isShiftPlanningOff(apply.error) && (
                <Callout tone="danger" icon="alertTriangle" live>{applyError(errorCodeOf(apply.error), errorText(apply.error, ''))}</Callout>
              )}
              <div className="rim-row">
                <Button size={40} icon="chevronLeft" disabled={apply.isPending} onClick={() => setStep('preview')}>Back</Button>
                <Button variant="primary" size={40} icon="calendarCheck" loading={apply.isPending}
                  disabled={state.target === 'new' && !(name ?? defaultName(state.startDate, state.endDate, scopeName)).trim()}
                  onClick={runApply}>{state.target === 'replace' ? 'Replace the draft’s days' : 'Create draft roster'}</Button>
              </div>
            </div>
          </Section>
        )}
      </div>
    </PageFrame>
  )
}

function ValidateStep({ validation: v, filter, setFilter, fileName, onBack, onNext }: {
  validation: NonNullable<ImportState['validation']>
  filter: ProblemFilter
  setFilter: (f: ProblemFilter) => void
  fileName: string | null
  onBack: () => void
  onNext?: () => void
}) {
  const counts = problemCounts(v.problems)
  const shown = filterProblems(v.problems, filter)
  const columns: TableColumn<ImportProblem>[] = [
    { key: 'row', header: 'Row', width: 70, render: (p) => <span className="rim-mono">{p.rowNo ?? '—'}</span> },
    { key: 'where', header: 'Where', width: 150, render: (p) => <span className="rim-mono">{problemWhere(p) || 'Whole file'}</span> },
    {
      key: 'msg', header: 'Problem', className: 'rim-wrap',
      render: (p) => <span className="rim-problem"><StatusPill tone={SEVERITY_TONE[p.severity]} size="xs">{SEVERITY_LABEL[p.severity]}</StatusPill>{p.message}</span>,
    },
  ]
  return (
    <>
      <StatGrid min={150} label="Check result">
        <StatCard variant="stat" index={0} icon="fileText" tone="gray" label="Rows" value={v.summary.rows} note={fileName ?? `Sheet ${v.sheetName}`} />
        <StatCard variant="stat" index={1} icon="users" tone="brand" label="Matched" value={v.summary.matched} note="People found" />
        <StatCard variant="stat" index={2} icon={v.summary.errors ? 'circleX' : 'checkCircle'} tone={v.summary.errors ? 'red' : 'brand'} label="Errors" value={v.summary.errors}
          note={v.summary.errors ? 'Fix the file and upload it again' : 'None'} />
        <StatCard variant="stat" index={3} icon="alertTriangle" tone={v.summary.warnings ? 'gold' : 'gray'} label="Warnings" value={v.summary.warnings} note="They don’t stop the draft" />
      </StatGrid>
      <Section title="2 · Validate" sub={`Sheet “${v.sheetName}”, header on row ${v.headerRow}, ${periodLabel(v.startDate, v.endDate)}.`} body="flush"
        actions={v.problems.length ? (
          <FilterPills label="Show" size="sm" value={filter} onChange={setFilter} options={[
            { value: 'all', label: 'All', count: counts.all }, { value: 'error', label: 'Errors', count: counts.error },
            { value: 'warning', label: 'Warnings', count: counts.warning }, { value: 'info', label: 'Notes', count: counts.info },
          ]} />
        ) : undefined}
        footer={
          <div className="rim-row">
            <Button size={40} icon="chevronLeft" onClick={onBack}>{v.summary.errors ? 'Upload a fixed file' : 'Back'}</Button>
            {onNext && <Button variant="primary" size={40} trailingIcon="arrowRight" onClick={onNext}>See the preview</Button>}
          </div>
        }>
        {v.summary.errors > 0 && <div className="rim-pad"><Callout tone="danger" icon="alertTriangle">Fix the file and upload it again. Nothing is saved while it has errors.</Callout></div>}
        {v.problems.length ? (
          <Table<ImportProblem> label="Problems in the file" columns={columns} rows={shown} rowKey={(p, i) => `${i}_${p.code}_${p.rowNo}_${p.column}`}
            minWidth={560} mobile="cards" stickyHeader maxHeight={520} empty="Nothing of this kind." />
        ) : (
          <div className="rim-pad"><EmptyState variant="success" title="No problems in the file." hint="See the preview, then create the draft." /></div>
        )}
      </Section>
    </>
  )
}

function PreviewGrid({ plan }: { plan: PlanResponse }) {
  const { days, rows } = useMemo(() => previewTable(plan), [plan])
  const cell = (r: PreviewRow, i: number) => {
    const c = r.cells[i]
    const label = c.code ?? (c.outside ? '' : c.overlay ?? '')
    return (
      <td key={days[i].date} data-flag={c.flagged ?? undefined} data-outside={c.outside || undefined} data-holiday={days[i].holiday ? '' : undefined}>
        {c.code ? <span className="rim-code" data-wo={c.code === 'WO' || undefined}>{c.code}</span>
          : label ? <span className="rim-badge" data-type={label}>{label}</span> : null}
        {c.code && c.overlay && <span className="rim-dot" data-type={c.overlay} title={c.overlay} />}
      </td>
    )
  }
  return (
    <div className="rim-grid-wrap" role="region" aria-label="Roster preview" tabIndex={0}>
      <table className="rim-grid">
        <thead>
          <tr>
            <th scope="col" className="rim-grid__name">Employee</th>
            {days.map((d) => (
              <th key={d.date} scope="col" data-holiday={d.holiday ? '' : undefined} title={d.holiday ?? undefined}>
                <span>{d.day}</span><small>{d.weekday}</small>
              </th>
            ))}
            <th scope="col">Work</th><th scope="col">WO</th><th scope="col">PH</th><th scope="col">L</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.employeeId}>
              <th scope="row" className="rim-grid__name">
                <span>{r.name}</span>
                <small>{[r.code, r.designation].filter(Boolean).join(' · ')}</small>
              </th>
              {days.map((_d, i) => cell(r, i))}
              <td className="rim-total">{r.working}</td><td className="rim-total">{r.weeklyOff}</td>
              <td className="rim-total">{r.holiday}</td><td className="rim-total">{r.leave}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
