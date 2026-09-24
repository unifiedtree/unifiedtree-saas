/**
 * Performance — this employee's goals/KPIs and recorded skills.
 *
 * Two real per-employee reads, both already on the backend:
 *   GET /v1/performance/kpis?ownerId={employeeId}   (hrms.performance.read)
 *   GET /v1/learning/skills/{employeeId}            (hrms.learning.skill.read)
 *
 * What is deliberately NOT here: review history. The only admin route,
 * GET /v1/performance/reviews, filters by cycleId and has no employeeId
 * parameter — the per-employee lookup exists in the service but is reachable
 * only through the JWT-bound /reviews/my. Showing an employee's reviews would
 * therefore mean paging the whole organisation's reviews, or one request per
 * cycle, to find one person's. Both are the fan-out this milestone forbids, so
 * the section says plainly that review history needs a backend filter rather
 * than quietly fetching everyone's reviews.
 */

import React from 'react'
import { format } from 'date-fns'
import { Target, Award, Info } from 'lucide-react'
import { usePermission } from '@unifiedtree/sdk'
import { TableCard, HrStatusPill, type PillTone } from '@/shared/components/hr'
import { useEmployeeKpis } from '../../api/usePerformance'
import { useEmployeeSkills } from '../../api/useLearning'
import { SectionState, SubSection } from './shared'

const KPI_TONE: Record<string, PillTone> = {
  ACTIVE: 'info', COMPLETED: 'green', DROPPED: 'gray',
  ON_TRACK: 'green', AT_RISK: 'warn', OFF_TRACK: 'red',
}


function ProgressBar({ pct }: { pct: number }) {
  const clamped = Math.max(0, Math.min(100, pct))
  return (
    <div className="flex items-center gap-2 min-w-[120px]">
      <div className="h-1.5 flex-1 rounded-full bg-gray-200 overflow-hidden">
        <div
          className="h-full rounded-full bg-[#059669] transition-all"
          style={{ width: `${clamped}%` }}
        />
      </div>
      <span className="text-xs font-semibold text-text-secondary tabular-nums w-9 text-right">
        {Math.round(clamped)}%
      </span>
    </div>
  )
}

export function EmployeePerformance({ employeeId }: { employeeId: string }) {
  const canReadPerformance = usePermission('hrms.performance.read')
  const canReadSkills = usePermission('hrms.learning.skill.read')

  const kpis = useEmployeeKpis(employeeId, { enabled: canReadPerformance })
  const skills = useEmployeeSkills(employeeId, canReadSkills)

  const kpiRows = kpis.data?.items ?? []
  const skillRows = skills.data ?? []

  if (!canReadPerformance && !canReadSkills) {
    return (
      <SectionState
        error={{ status: 403 }}
        forbiddenTitle="You don’t have access to performance"
        forbiddenHint="Goals and skills need the performance or learning read permission."
      />
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {canReadPerformance && (
        <SubSection title="Goals & KPIs" hint="What this employee is currently measured on.">
          <SectionState
            isLoading={kpis.isLoading}
            error={kpis.error}
            isEmpty={!kpis.isLoading && !kpis.error && kpiRows.length === 0}
            emptyIcon={Target}
            emptyTitle="No goals set"
            emptyHint="Goals assigned to this employee will appear here with their progress."
            onRetry={() => kpis.refetch()}
          >
            <TableCard>
              <table className="hr-table">
                <thead>
                  <tr><th>Goal</th><th>Category</th><th>Progress</th><th>Target</th><th>Due</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {kpiRows.map((k) => (
                    <tr key={k.id}>
                      <td>
                        <span className="text-text-primary font-medium">{k.title}</span>
                        {k.description && (
                          <span className="block text-xs text-text-tertiary truncate max-w-xs">{k.description}</span>
                        )}
                      </td>
                      <td className="text-text-secondary">{k.category || '—'}</td>
                      <td><ProgressBar pct={Number(k.progressPct ?? 0)} /></td>
                      <td className="text-text-secondary whitespace-nowrap">
                        {k.currentValue ?? '—'} / {k.targetValue ?? '—'}{k.unit ? ` ${k.unit}` : ''}
                      </td>
                      <td className="text-text-secondary whitespace-nowrap">
                        {k.dueDate ? (() => { try { return format(new Date(k.dueDate), 'd MMM yyyy') } catch { return k.dueDate } })() : '—'}
                      </td>
                      <td>
                        {k.status
                          ? <HrStatusPill tone={KPI_TONE[k.status] ?? 'gray'}>{k.status.replace(/_/g, ' ')}</HrStatusPill>
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableCard>
          </SectionState>
        </SubSection>
      )}

      {canReadSkills && (
        <SubSection title="Skills & certifications">
          <SectionState
            isLoading={skills.isLoading}
            error={skills.error}
            isEmpty={!skills.isLoading && !skills.error && skillRows.length === 0}
            emptyIcon={Award}
            emptyTitle="No skills recorded"
            emptyHint="Skills and certifications captured for this employee will appear here."
            onRetry={() => skills.refetch()}
          >
            <div className="flex flex-wrap gap-2">
              {skillRows.map((s) => (
                <div key={s.id} className="flex items-center gap-2.5" style={{ padding: '8px 12px', borderRadius: 10, background: '#f8fafc' }}>
                  <div>
                    <p className="text-sm font-medium text-text-primary">{s.skillName}</p>
                    {s.certified && s.certificationName && (
                      <p className="text-[11px] text-text-tertiary">
                        {s.certificationName}
                        {s.certifiedOn ? ` · ${(() => { try { return format(new Date(s.certifiedOn), 'MMM yyyy') } catch { return s.certifiedOn } })()}` : ''}
                      </p>
                    )}
                  </div>
                  {/* 1–5 integer scale, shown exactly as the Learning screen
                      shows it so the same skill never reads two different ways. */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    <div className="h-1.5 w-12 rounded-full bg-gray-200 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-[#059669]"
                        style={{ width: `${(Math.min(Math.max(s.proficiency, 0), 5) / 5) * 100}%` }}
                      />
                    </div>
                    <span className="text-xs font-semibold text-text-secondary">{s.proficiency}/5</span>
                  </div>
                  {s.certified && <HrStatusPill tone="green">Certified</HrStatusPill>}
                </div>
              ))}
            </div>
          </SectionState>
        </SubSection>
      )}

      {/* Stated, not hidden: the reader needs to know this section is partial,
          otherwise "no reviews shown" reads as "never reviewed". */}
      <div className="flex gap-3" style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: '14px 16px' }}>
        <Info size={15} className="text-text-tertiary shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-text-primary">Review history isn’t shown here yet</p>
          <p className="text-xs text-text-secondary mt-0.5">
            Appraisal reviews can only be listed per cycle today, not per employee, so this
            page would have to read every employee’s reviews to find this one’s. Open
            Performance → Reviews for the cycle you need.
          </p>
        </div>
      </div>
    </div>
  )
}
