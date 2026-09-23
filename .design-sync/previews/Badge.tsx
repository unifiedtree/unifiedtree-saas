import { Badge } from '@unifiedtree/design-sync-entry'
import type { BadgeProps } from '@unifiedtree/design-sync-entry'

type Tone = NonNullable<BadgeProps['tone']>

// Every tone, labelled the way the HRMS screens use it.
export function AllTones() {
  const tones: Array<[Tone, string]> = [
    ['default', 'Draft'],
    ['neutral', 'Contract'],
    ['success', 'Approved'],
    ['warning', 'Pending'],
    ['error', 'Rejected'],
    ['info', 'In review'],
    ['accent', 'New joiner'],
    ['solid', 'Locked'],
  ]
  return (
    <div className="flex flex-wrap gap-2">
      {tones.map(([tone, label]) => (
        <Badge key={tone} tone={tone}>{label}</Badge>
      ))}
    </div>
  )
}

// The dot variant: attendance day statuses on the muster roll.
export function WithDot() {
  return (
    <div className="flex flex-wrap gap-2">
      <Badge tone="success" dot>Present</Badge>
      <Badge tone="warning" dot>Late</Badge>
      <Badge tone="info" dot>Work from home</Badge>
      <Badge tone="accent" dot>Half day</Badge>
      <Badge tone="error" dot>Absent</Badge>
      <Badge tone="neutral" dot>Weekly off</Badge>
      <Badge tone="solid" dot>On leave</Badge>
    </div>
  )
}

// sm sits inside dense table cells; md is the default everywhere else.
export function Sizes() {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="w-8 text-xs text-gray-500">sm</span>
        <Badge size="sm" tone="success">Approved</Badge>
        <Badge size="sm" tone="warning" dot>Pending</Badge>
        <Badge size="sm" tone="default">EMP-0142</Badge>
      </div>
      <div className="flex items-center gap-2">
        <span className="w-8 text-xs text-gray-500">md</span>
        <Badge size="md" tone="success">Approved</Badge>
        <Badge size="md" tone="warning" dot>Pending</Badge>
        <Badge size="md" tone="default">EMP-0142</Badge>
      </div>
    </div>
  )
}

// Ported from PayrollRunDetail: run status beside the period heading, using
// the app's statusTone map (DRAFT/CANCELLED default, PROCESSING info,
// LOCKED/PAID success).
export function PayrollRunStatus() {
  const statusTone: Record<string, Tone> = {
    DRAFT: 'default',
    PROCESSING: 'info',
    LOCKED: 'success',
    PAID: 'success',
    CANCELLED: 'default',
  }
  const runs: Array<[string, string]> = [
    ['September 2026', 'DRAFT'],
    ['August 2026', 'PROCESSING'],
    ['July 2026', 'PAID'],
  ]
  return (
    <div className="flex flex-col gap-3">
      {runs.map(([period, status]) => (
        <div key={period} className="flex items-center gap-3">
          <span className="text-lg font-bold tracking-tight">{period}</span>
          <Badge tone={statusTone[status]}>{status}</Badge>
        </div>
      ))}
    </div>
  )
}
