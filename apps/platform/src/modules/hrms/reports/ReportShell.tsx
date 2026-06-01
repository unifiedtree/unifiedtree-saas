import React from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Download } from 'lucide-react'
import { Skeleton, EmptyState } from '@unifiedtree/ui-kit'
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
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link
            to="/hrms/reports"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#E2E8F0] text-[#64748B] hover:text-[#0F172A] hover:border-slate-600 transition-colors"
          >
            <ArrowLeft size={15} />
          </Link>
          <div>
            <h1 className="text-xl font-bold text-[#0F172A]">{title}</h1>
            <p className="text-[#64748B] text-sm mt-0.5">{description}</p>
          </div>
        </div>
        {/* TODO[backend]: CSV export endpoints not implemented */}
        <button
          disabled
          title="Export not yet available"
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-[#64748B] bg-white border border-[#E2E8F0]/40 rounded-xl cursor-not-allowed opacity-50"
        >
          <Download size={14} />
          Export CSV
        </button>
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
      className="bg-white border border-[#E2E8F0] rounded-xl px-3 py-2.5 text-sm text-[#334155] focus:outline-none focus:border-indigo-500 transition-all min-w-[180px]"
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
