import React from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Download } from 'lucide-react'
import { Skeleton, EmptyState } from '@unifiedtree/ui-kit'
import { HrPageHeader, HrButton } from '@/shared/components/hr'
import { useCompanies } from '@/modules/hrms/api/useOrg'

interface ReportShellProps {
  title: string
  description: string
  filters: React.ReactNode
  companyId: string | null
  isLoading: boolean
  error: Error | null
  hasData: boolean
  onRetry: () => void
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
  children,
}: ReportShellProps) {
  return (
    <div className="mx-auto max-w-7xl p-6 sm:p-8 space-y-6">
      <div className="flex items-start gap-3">
        <Link
          to="/hrms/reports"
          className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border-default text-text-secondary transition-colors hover:border-[#FFD68A] hover:text-[#C16E00]"
        >
          <ArrowLeft size={15} />
        </Link>
        <div className="flex-1">
          <HrPageHeader
            crumb="Reports & Analytics"
            title={title}
            subtitle={description}
            actions={
              /* TODO[backend]: CSV export endpoints not implemented */
              <HrButton variant="ghost" disabled title="Export not yet available">
                <Download size={14} />
                Export CSV
              </HrButton>
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
          <Skeleton className="h-64 w-full rounded-2xl" />
          <Skeleton className="h-48 w-full rounded-2xl" />
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
  const { data: companies = [], isLoading } = useCompanies()

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="min-w-[180px] rounded-xl border border-border-default bg-white px-3 py-2.5 text-sm text-text-primary transition-all focus:border-[#FF9D00] focus:outline-none focus:ring-2 focus:ring-[#FF9D00]/20"
      disabled={isLoading}
    >
      <option value="">Select company…</option>
      {companies.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  )
}
