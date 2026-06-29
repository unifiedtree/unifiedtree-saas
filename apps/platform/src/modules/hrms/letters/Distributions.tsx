import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { Can, P } from '@unifiedtree/sdk'
import { TableSkeleton, EmptyState } from '@unifiedtree/ui-kit'
import { format } from 'date-fns'
import { HrPageHeader, HrButton, HrStatusPill, TableCard, type PillTone } from '@/shared/components/hr'
import { useDistributions, type DistributionStatus } from './api/useDistribution'
import { DistributionWizard } from './DistributionWizard'

const STATUS_TONE: Record<DistributionStatus, { label: string; tone: PillTone }> = {
  PENDING:         { label: 'Pending',    tone: 'gray' },
  PROCESSING:      { label: 'Processing', tone: 'info' },
  COMPLETED:       { label: 'Completed',  tone: 'ok' },
  PARTIAL_FAILURE: { label: 'Partial',    tone: 'warn' },
  FAILED:          { label: 'Failed',     tone: 'red' },
}

export function Distributions() {
  const navigate = useNavigate()
  const { data, isLoading } = useDistributions()
  const [wizardOpen, setWizardOpen] = useState(false)
  const jobs = data?.content ?? []

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6 sm:p-8">
      <HrPageHeader
        crumb="Recruitment & Onboarding"
        title="Letter Distributions"
        subtitle="Send a letter to many employees in one action"
        actions={
          <Can code={P.HRMS_LETTERS_DISTRIBUTE}>
            <HrButton onClick={() => setWizardOpen(true)}><Plus size={15} /> New Distribution</HrButton>
          </Can>
        }
      />

      {isLoading ? (
        <TableSkeleton />
      ) : jobs.length === 0 ? (
        <EmptyState variant="first-run" title="No distributions yet"
          description="Send a letter (payslips, policy broadcasts…) to many employees at once." />
      ) : (
        <TableCard>
          <table className="hr-table">
            <thead>
              <tr><th>Title</th><th>Recipients</th><th>Status</th><th className="hidden sm:table-cell">Created</th></tr>
            </thead>
            <tbody>
              {jobs.map((j) => {
                const s = STATUS_TONE[j.status] ?? { label: j.status, tone: 'gray' as PillTone }
                return (
                  <tr key={j.id} onClick={() => navigate(`/hrms/letters/distributions/${j.id}`)} className="cursor-pointer">
                    <td className="font-medium text-text-primary">{j.title}</td>
                    <td className="text-text-secondary">
                      {j.sentCount}/{j.totalRecipients} sent{j.failedCount > 0 ? ` · ${j.failedCount} failed` : ''}
                    </td>
                    <td><HrStatusPill tone={s.tone}>{s.label}</HrStatusPill></td>
                    <td className="hidden sm:table-cell text-text-secondary">{j.createdAt ? format(new Date(j.createdAt), 'dd MMM yyyy, HH:mm') : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </TableCard>
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
