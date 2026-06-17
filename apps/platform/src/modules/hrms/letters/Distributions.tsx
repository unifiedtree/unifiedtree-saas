import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { clsx } from 'clsx'
import { Can, P } from '@unifiedtree/sdk'
import { TableSkeleton, EmptyState } from '@unifiedtree/ui-kit'
import { format } from 'date-fns'
import { useDistributions, type DistributionStatus } from './api/useDistribution'
import { DistributionWizard } from './DistributionWizard'

const STATUS_STYLE: Record<DistributionStatus, { label: string; cls: string }> = {
  PENDING:         { label: 'Pending',    cls: 'text-slate-500 bg-slate-100' },
  PROCESSING:      { label: 'Processing', cls: 'text-blue-600 bg-blue-50' },
  COMPLETED:       { label: 'Completed',  cls: 'text-emerald-600 bg-emerald-50' },
  PARTIAL_FAILURE: { label: 'Partial',    cls: 'text-amber-600 bg-amber-50' },
  FAILED:          { label: 'Failed',     cls: 'text-red-600 bg-red-50' },
}

export function Distributions() {
  const navigate = useNavigate()
  const { data, isLoading } = useDistributions()
  const [wizardOpen, setWizardOpen] = useState(false)
  const jobs = data?.content ?? []

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary">Letter Distributions</h1>
          <p className="text-text-secondary text-sm mt-1">Send a letter to many employees in one action</p>
        </div>
        <Can code={P.HRMS_LETTERS_DISTRIBUTE}>
          <button
            onClick={() => setWizardOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-xl transition-colors"
          >
            <Plus size={15} /> New Distribution
          </button>
        </Can>
      </div>

      {isLoading ? (
        <TableSkeleton />
      ) : jobs.length === 0 ? (
        <EmptyState variant="first-run" title="No distributions yet"
          description="Send a letter (payslips, policy broadcasts…) to many employees at once." />
      ) : (
        <div className="bg-white border border-border rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-text-secondary text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Title</th>
                <th className="text-left px-4 py-3 font-medium">Recipients</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="text-left px-4 py-3 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => {
                const s = STATUS_STYLE[j.status]
                return (
                  <tr
                    key={j.id}
                    onClick={() => navigate(`/hrms/letters/distributions/${j.id}`)}
                    className="border-t border-border hover:bg-slate-50 cursor-pointer"
                  >
                    <td className="px-4 py-3 font-medium text-text-primary">{j.title}</td>
                    <td className="px-4 py-3 text-text-secondary">
                      {j.sentCount}/{j.totalRecipients} sent{j.failedCount > 0 ? ` · ${j.failedCount} failed` : ''}
                    </td>
                    <td className="px-4 py-3">
                      <span className={clsx('inline-flex px-2 py-0.5 rounded-full text-xs font-medium', s.cls)}>{s.label}</span>
                    </td>
                    <td className="px-4 py-3 text-text-secondary">
                      {j.createdAt ? format(new Date(j.createdAt), 'dd MMM yyyy, HH:mm') : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {wizardOpen && (
        <DistributionWizard
          onClose={() => setWizardOpen(false)}
          onCreated={(id) => { setWizardOpen(false); navigate(`/hrms/letters/distributions/${id}`) }}
        />
      )}
    </div>
  )
}
