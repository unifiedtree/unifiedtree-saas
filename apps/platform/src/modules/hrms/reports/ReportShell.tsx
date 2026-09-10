import React from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Download } from 'lucide-react'
import { EmptyState } from '@unifiedtree/ui-kit'
import { P, usePermission } from '@unifiedtree/sdk'
import { HrPageHeader, HrButton } from '@/shared/components/hr'
import { apiBlob } from '@/core/api/client'
import { useToast } from '@/shared/hooks/useToast'
import { useCompanies } from '@/modules/hrms/api/useOrg'

// ── CSV export wiring ─────────────────────────────────────────────────────────
//
// The header used to carry `TODO restore Export CSV once GET
// /v1/reports/{name}/export lands`. That TODO went stale: ReportController
// shipped six `…/export.csv` siblings (one per report), so all six pages sat
// there with no Export button for no reason while the client escalated that
// "reports don't work".
//
// Each entry below is transcribed from ReportController.java — `path` is the
// literal @GetMapping and `permission` is the literal @PreAuthorize on THAT
// method. The backend deliberately refused a single generic /{type}/export
// route because it would have to collapse five different guards into one; the
// mapping is duplicated here for the same reason, so the button a user sees
// can never be wider than the endpoint behind it.
type ReportKey =
  | 'headcount' | 'attrition' | 'attendance-summary'
  | 'leave-balance' | 'late-marks' | 'diversity'

const EXPORT_SPEC: Record<ReportKey, { path: string; permission: string }> = {
  'headcount':          { path: '/v1/reports/headcount/export.csv',          permission: P.HRMS_REPORT_HEADCOUNT },
  'attrition':          { path: '/v1/reports/attrition/export.csv',          permission: P.HRMS_REPORT_ATTRITION },
  'attendance-summary': { path: '/v1/reports/attendance-summary/export.csv', permission: P.HRMS_REPORT_ATTENDANCE },
  'leave-balance':      { path: '/v1/reports/leave-balance/export.csv',      permission: P.HRMS_REPORT_LEAVE },
  // Late marks reads attendance data, so the backend guards it with
  // hrms.report.attendance — the same code as attendance-summary, NOT a
  // "report.latemarks" code (no such permission exists).
  'late-marks':         { path: '/v1/reports/late-marks/export.csv',         permission: P.HRMS_REPORT_ATTENDANCE },
  'diversity':          { path: '/v1/reports/diversity/export.csv',          permission: P.HRMS_REPORT_DIVERSITY },
}

interface ReportShellProps {
  title: string
  description: string
  filters: React.ReactNode
  companyId: string | null
  isLoading: boolean
  error: Error | null
  hasData: boolean
  onRetry: () => void
  /** Which of the six reports this is — selects the export path + permission. */
  report: ReportKey
  /**
   * Every filter the page feeds its JSON query hook EXCEPT companyId (added
   * below). Required rather than optional so a new report cannot quietly ship
   * an export that ignores the on-screen date range and hands the user a CSV
   * that disagrees with the table above it.
   */
  exportParams: Record<string, string>
  children: React.ReactNode
}

export function ReportShell({
  title,
  description,
  filters,
  companyId,
  isLoading,
  error,
  hasData,
  onRetry,
  report,
  exportParams,
  children,
}: ReportShellProps) {
  const { toast } = useToast()
  const spec = EXPORT_SPEC[report]

  // Gated on the ONE permission this report's CSV endpoint checks, never an OR
  // across all five report codes: a role holding only hrms.report.leave must
  // see Export on Leave Balance and nowhere else. A broad OR renders a button
  // that 403s — the exact defect caught on the dashboard's headcount export.
  const canExport = usePermission(spec.permission)

  const [exporting, setExporting] = React.useState(false)

  async function handleExport() {
    if (!companyId || exporting) return
    setExporting(true)
    try {
      // apiBlob, not a plain <a href> / window.open: the CSV route is bearer
      // authenticated and tenant scoped, and a raw navigation carries neither
      // the Authorization header nor X-Tenant-ID. apiBlob also runs the
      // single-flight 401 refresh-and-retry, so an export that lands on a
      // just-rotated token succeeds instead of bouncing the user to login.
      const query = new URLSearchParams({ companyId, ...exportParams })
      const blob = await apiBlob(`${spec.path}?${query}`)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      // Mirrors the filename the backend puts in Content-Disposition; apiBlob
      // hands back only the body, so the name is rebuilt rather than parsed.
      link.download = `${report}-${new Date().toISOString().slice(0, 10)}.csv`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } catch (e) {
      // A real catch, not try/finally. apiBlob throws on every non-2xx, so
      // without this a 403 or 500 just flips the label back to "Export CSV"
      // and nothing downloads — a silent failure indistinguishable from a
      // browser blocking the save, and the pattern this codebase keeps
      // getting caught by.
      toast((e as Error).message, 'error')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="mx-auto max-w-7xl p-6 sm:p-8 space-y-6">
      <div className="flex items-start gap-3">
        <Link
          to="/hrms/reports"
          className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border-default text-text-secondary transition-colors hover:border-[#6EE7B7] hover:text-[#047857]"
        >
          <ArrowLeft size={15} />
        </Link>
        <div className="flex-1">
          <HrPageHeader
            crumb="Reports & Analytics"
            title={title}
            subtitle={description}
            actions={
              // Hidden without a company: companyId is a mandatory @RequestParam
              // on every CSV route, so with none picked the button could only
              // ever 400 — and the body is showing "Select a company" anyway.
              canExport && companyId ? (
                <HrButton variant="ghost" onClick={handleExport} disabled={exporting}>
                  <Download size={15} />
                  {exporting ? 'Preparing…' : 'Export CSV'}
                </HrButton>
              ) : undefined
            }
          />
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-3">{filters}</div>

      {/* Body */}
      {!companyId ? (
        <EmptyState
          variant="first-run"
          title="Select a company"
          description="Choose a company from the filter above to load this report."
        />
      ) : error ? (
        <EmptyState
          variant="error"
          title="Failed to load report"
          description={error.message}
          primaryAction={{ label: 'Retry', onClick: onRetry }}
        />
      ) : isLoading ? (
        <div className="space-y-3">
          <div className="ut-card ut-card-lg h-64 w-full animate-pulse" />
          <div className="ut-card h-48 w-full animate-pulse" />
        </div>
      ) : !hasData ? (
        <EmptyState
          variant="filtered"
          title="No data for this period"
          description="Try adjusting your filters or selecting a different date range."
        />
      ) : (
        children
      )}
    </div>
  )
}

// ── Company selector ──────────────────────────────────────────────────────────

interface CompanySelectorProps {
  value: string
  onChange: (id: string) => void
}

export function CompanySelector({ value, onChange }: CompanySelectorProps) {
  const { data: companies = [], isLoading, error } = useCompanies()

  // 2026-09-10: /v1/hrms/companies is gated on org.company.read. All eight
  // seeded roles that pass the report route guards also hold that, but a
  // CUSTOM role built with only report permissions passes the route guard
  // and then 403s on this list. The dropdown used to swallow the error and
  // sit on "Select a company" forever with no explanation — the same
  // "I clicked and nothing happened" pattern. Now the error is surfaced.
  const isForbidden = error != null && /403|forbidden|access/i.test((error as Error).message)

  return (
    <div className="min-w-[180px]">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-border-default bg-white px-3 py-2.5 text-sm text-text-primary transition-all focus:border-[#059669] focus:outline-none focus:ring-2 focus:ring-[#059669]/20 disabled:bg-bg-base disabled:text-text-tertiary"
        disabled={isLoading || isForbidden}
        title={isForbidden ? 'Your role cannot browse companies — ask an administrator to grant org.company.read' : undefined}
      >
        <option value="">
          {isForbidden ? 'Cannot browse companies' : 'Select company…'}
        </option>
        {companies.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      {isForbidden && (
        <p className="mt-1 text-xs text-red-700">
          Your role can generate reports but cannot browse the company list. Ask an administrator to grant the org.company.read permission.
        </p>
      )}
    </div>
  )
}
