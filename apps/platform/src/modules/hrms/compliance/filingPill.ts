// How a statutory filing's status reads. A DUE filing past its due date is
// overdue, as the Payroll dashboard's Statutory dues says; the server keeps it
// DUE until it is marked filed. LATE is only ever set by
// ComplianceService.fileFiling when the return was recorded after its due date,
// so it reads "Filed late" rather than suggesting the return is still open.
import type { PillTone } from '@/shared/components/hr'
import type { FilingStatus } from '../api/useCompliance'

const FILING_TONE: Record<FilingStatus, PillTone> = { DUE: 'warn', FILED: 'ok', LATE: 'red' }
const FILING_LABEL: Record<FilingStatus, string> = { DUE: 'Due', FILED: 'Filed', LATE: 'Filed late' }

/** `on` is today as yyyy-MM-dd in the browser's calendar. */
export function filingPill(status: FilingStatus, dueDate: string, on: string): { tone: PillTone; label: string } {
  if (status === 'DUE' && dueDate < on) return { tone: 'red', label: 'Overdue' }
  return { tone: FILING_TONE[status] ?? 'gray', label: FILING_LABEL[status] ?? status }
}
