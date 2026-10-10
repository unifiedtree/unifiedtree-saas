// Shifts & overtime › Shift Planner (design §1.6 "Planner tab"): sub-tabs Rosters | Rotation patterns, and "Plan a
// roster" / "Import from Excel". Shown with attendance.roster.plan or attendance.roster.publish.
// Until the planner's tables are live (FEATURE_NOT_READY) this tab says so and nothing else on the page changes.
import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button, EmptyState, Section, SegmentedControl, errorText } from '@/design/kit/display'
import { Dialog, Input, PanelButton, useToast } from '@/design/kit/overlays'
import { isFeatureNotReady } from '@/core/api/featureNotReady'
import { useShiftPolicies } from '../../api/useShiftPolicies'
import { useRosterSettings, useRosters, useRotationTemplates, useSaveRosterSettings } from '../../api/useRosters'
import { RosterList } from './RosterList'
import { PatternList } from './PatternList'
import { toShiftLites } from './plannerModel'
import { usePlannerScope } from './usePlannerScope'
import './planner.css'

type Sub = 'rosters' | 'patterns'

export function PlannerHome({ companyId }: { companyId: string }) {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const scope = usePlannerScope(companyId)
  const sub: Sub = params.get('view') === 'patterns' && scope.canPlan ? 'patterns' : 'rosters'
  const setSub = (v: Sub) => { const sp = new URLSearchParams(params); if (v === 'rosters') sp.delete('view'); else sp.set('view', v); setParams(sp, { replace: true }) }

  const rosters = useRosters(companyId)
  const templates = useRotationTemplates(companyId, { enabled: scope.canPlan })
  const settings = useRosterSettings(companyId, { enabled: scope.canPlan || scope.canPolicy })
  const policies = useShiftPolicies(companyId)
  const shifts = useMemo(() => toShiftLites(policies.data ?? []), [policies.data])

  if (isFeatureNotReady(rosters.error) || isFeatureNotReady(templates.error)) {
    return <EmptyState icon="calendarDays" title="Shift planning isn’t switched on yet." hint="Rosters and rotation patterns appear here once it is." />
  }
  if (scope.noDepartment) {
    return <EmptyState icon="users" title="You don’t head a department." hint="HR plans rosters for the company." />
  }

  const actions = scope.canPlan ? (
    <div className="spl-actions">
      <Button variant="secondary" icon="upload" onClick={() => navigate('/hrms/shifts/planner/import')}>Import from Excel</Button>
      <Button icon="plus" onClick={() => navigate('/hrms/shifts/planner/new')}>Plan a roster</Button>
    </div>
  ) : null

  return (
    <>
      <div className="spl-home__bar">
        {scope.canPlan ? (
          <SegmentedControl label="Shift planner views" value={sub} onChange={(v) => setSub(v as Sub)}
            options={[{ value: 'rosters', label: 'Rosters', count: rosters.data?.length ?? null }, { value: 'patterns', label: 'Rotation patterns', count: templates.data?.length ?? null }]} />
        ) : <span />}
        {actions}
      </div>
      {sub === 'rosters' ? (
        <Section title="Rosters" body="flush" sub="Plans of who works which shift on each day. People see a roster once it’s published."
          error={rosters.error && !isFeatureNotReady(rosters.error) ? rosters.error : undefined} onRetry={() => rosters.refetch()}>
          <RosterList rosters={rosters.data ?? []} loading={rosters.isLoading} canPlan={scope.canPlan} />
        </Section>
      ) : (
        <Section title="Rotation patterns" body="flush" sub="Saved cycles of shifts and days off to plan rosters from."
          error={templates.error && !isFeatureNotReady(templates.error) ? templates.error : undefined} onRetry={() => templates.refetch()}>
          <PatternList companyId={companyId} templates={templates.data ?? []} loading={templates.isLoading || policies.isLoading} shifts={shifts}
            departments={scope.departments} companyWide={scope.companyWide} canPlan={scope.canPlan} />
        </Section>
      )}
      {settings.data && <RestSetting companyId={companyId} minutes={settings.data.minRestMinutes} canChange={scope.canPolicy} />}
    </>
  )
}

/** The rest the Schedule check asks for between two shifts (D-S8, a warning only; default 8 hours). */
function RestSetting({ companyId, minutes, canChange }: { companyId: string; minutes: number; canChange: boolean }) {
  const toast = useToast()
  const saveSettings = useSaveRosterSettings()
  const [open, setOpen] = useState(false)
  const [hours, setHours] = useState('')
  const h = Number(hours)
  const bad = !hours.trim() || !Number.isFinite(h) || h < 0 || h > 24 ? 'Enter hours between 0 and 24' : null
  const save = async () => {
    if (bad) return
    try {
      await saveSettings.mutateAsync({ companyId, body: { minRestMinutes: Math.round(h * 60) } })
      toast.success('Rest between shifts saved')
      setOpen(false)
    } catch (e) { toast.error('Couldn’t save the setting', { detail: errorText(e, 'Try again in a moment.') }) }
  }
  const label = minutes % 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes / 60} h`
  return (
    <div className="spl-setting">
      <span>Rest between shifts: at least <b>{label}</b>. Less than that is flagged in the Schedule check; it never blocks publishing.</span>
      {canChange && <Button variant="ghost" size={30} onClick={() => { setHours(String(Math.round((minutes / 60) * 100) / 100)); setOpen(true) }}>Change</Button>}
      <Dialog open={open} onClose={() => setOpen(false)} busy={saveSettings.isPending} title="Rest between shifts" sub="The least time from the end of one shift to the start of the next."
        footer={(
          <>
            <PanelButton variant="secondary" onClick={() => setOpen(false)} disabled={saveSettings.isPending}>Cancel</PanelButton>
            <PanelButton variant="primary" busy={saveSettings.isPending} blockedReason={bad} onClick={save}>Save</PanelButton>
          </>
        )}>
        <Input label="Hours" type="number" min={0} max={24} step={0.5} value={hours} onChange={(e) => setHours(e.target.value)} error={hours && bad ? bad : undefined} />
      </Dialog>
    </div>
  )
}
