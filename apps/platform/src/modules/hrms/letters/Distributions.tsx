import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { Can, P } from '@unifiedtree/sdk'
import { HrButton, HrStatusPill, TableCard, type PillTone } from '@/shared/components/hr'
import { ModulePage, State, stamp } from '@/design/module/ModuleKit'
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
  const { data, isLoading, isError, error, refetch } = useDistributions()
  const [wizardOpen, setWizardOpen] = useState(false)
  const jobs = data?.content ?? []

  return (
    <ModulePage crumb="Letters" title="Letter distributions" subtitle="Send one letter to many people in a single action."
      actions={<Can code={P.HRMS_LETTERS_DISTRIBUTE}><HrButton onClick={() => setWizardOpen(true)}><Plus size={15} /> New distribution</HrButton></Can>}>
      {isLoading ? (
        <State kind="loading" height={220} />
      ) : isError ? (
        <State kind="error" title="Couldn’t load distributions" description={(error as Error)?.message} onRetry={() => refetch()} />
      ) : jobs.length === 0 ? (
        <State kind="empty" icon="fileText" title="No distributions yet" description="Send a letter, like a policy update, to many people at once." />
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
                      {`${j.sentCount} of ${j.totalRecipients} sent${j.failedCount > 0 ? ` · ${j.failedCount} failed` : ''}`}
                    </td>
                    <td><HrStatusPill tone={s.tone}>{s.label}</HrStatusPill></td>
                    <td className="hidden sm:table-cell text-text-secondary">{j.createdAt ? stamp(j.createdAt) : '—'}</td>
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
    </ModulePage>
  )
}
