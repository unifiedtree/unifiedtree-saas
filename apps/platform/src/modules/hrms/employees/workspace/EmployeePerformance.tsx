/**
 * Performance — this employee's goals/KPIs, reviews and recorded skills.
 *
 * Per-employee reads:
 *   GET /v1/performance/kpis?ownerId={employeeId}   (hrms.performance.read)
 *   GET /v1/performance/employees/{employeeId}      (hrms.performance.read; team-scoped for managers)
 *   GET /v1/learning/skills/{employeeId}            (hrms.learning.skill.read)
 *
 * Review history comes from the per-employee performance endpoint (2026-09-25),
 * and "Open performance page" leads to the full page with ratings over time.
 */

import React from 'react'
import { useNavigate } from 'react-router-dom'
import { format } from 'date-fns'
import { Target, Award, ClipboardList } from 'lucide-react'
import { usePermission } from '@unifiedtree/sdk'
import { TableCard, HrStatusPill, HrButton, type PillTone } from '@/shared/components/hr'
import { useEmployeeKpis, useEmployeePerformanceProfile } from '../../api/usePerformance'
import { useEmployeeSkills } from '../../api/useLearning'
import { SectionState, SubSection } from './shared'

const REVIEW_TONE: Record<string, PillTone> = { PENDING: 'warn', IN_PROGRESS: 'info', SUBMITTED: 'ok', ACKNOWLEDGED: 'teal', MISSED: 'red' }
const words = (v?: string | null) => (v || '').replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase())
const day = (v?: string | null) => { if (!v) return '—'; try { return format(new Date(v.length === 10 ? `${v}T12:00:00` : v), 'd MMM yyyy') } catch { return v } }

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

  const navigate = useNavigate()
  const kpis = useEmployeeKpis(employeeId, { enabled: canReadPerformance })
  const profile = useEmployeePerformanceProfile(employeeId, canReadPerformance)
  const skills = useEmployeeSkills(employeeId, canReadSkills)
  const reviews = profile.data?.reviews ?? []
  const openPage = <HrButton size="sm" variant="ghost" onClick={() => navigate(`/hrms/performance/employees/${employeeId}`)}>Open performance page</HrButton>

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
        <SubSection title="Goals & KPIs" hint="What this employee is currently measured on." action={openPage}>
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

      {canReadPerformance && (
        <SubSection title="Reviews" hint="Every review about this employee, newest cycle first.">
          <SectionState
            isLoading={profile.isLoading}
            error={profile.error}
            isEmpty={!profile.isLoading && !profile.error && reviews.length === 0}
            emptyIcon={ClipboardList}
            emptyTitle="No reviews yet"
            emptyHint="Reviews appear here once a review cycle includes this employee."
            forbiddenTitle="Outside your team"
            forbiddenHint="You can see the reviews of people in your own team only."
            onRetry={() => profile.refetch()}
          >
            <TableCard>
              <table className="hr-table">
                <thead>
                  <tr><th>Cycle</th><th>Reviewer</th><th>Rating</th><th>Status</th><th>Submitted</th></tr>
                </thead>
                <tbody>
                  {reviews.map((r) => (
                    <tr key={r.id}>
                      <td className="text-text-primary font-medium">{r.cycleName || 'Review cycle'}</td>
                      <td className="text-text-secondary">{r.reviewerType === 'SELF' || !r.reviewerId || r.reviewerId === employeeId ? 'Self review' : r.reviewerName || 'Reviewer'}</td>
                      <td className="tabular-nums font-semibold">{r.overallRating == null ? '—' : `${r.overallRating} / 5`}</td>
                      <td><HrStatusPill tone={REVIEW_TONE[r.status] ?? 'gray'}>{words(r.status)}</HrStatusPill></td>
                      <td className="text-text-secondary whitespace-nowrap">{day(r.submittedAt)}</td>
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

    </div>
  )
}
