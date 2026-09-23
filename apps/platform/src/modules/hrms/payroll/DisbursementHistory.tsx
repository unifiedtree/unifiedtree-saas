import { useState } from 'react'
import { useDisbursementBatches, useDisbursementBatch } from '../api/useDisbursement'
import { inr } from '../api/usePayrollRuns'
import { HrButton, HrStatusPill } from '@/shared/components/hr'

export function DisbursementHistory({ companyId }: { companyId?: string }) {
  const history = useDisbursementBatches(companyId ? { companyId } : {})
  const [selected, setSelected] = useState<string>()
  const detail = useDisbursementBatch(selected)
  return <section className="ut-card mt-5 p-5" aria-label="Disbursement history">
    <h2 className="mb-4 text-sm font-semibold">Historical batches</h2>
    {history.isLoading ? <p role="status">Loading batches...</p> : history.isError ? <div role="alert"><p>Unable to load batch history.</p><HrButton onClick={() => history.refetch()}>Retry</HrButton></div> :
      <div className="overflow-x-auto"><table className="hr-table"><thead><tr><th>Batch</th><th>Created</th><th>Total amount</th><th>Beneficiaries</th><th>Status</th><th>Details</th></tr></thead>
        <tbody>{!history.data?.length ? <tr><td colSpan={6}>No bank batches have been created.</td></tr> : history.data.map(batch => <tr key={batch.id}>
          <td>{batch.batchReference}</td><td>{new Date(batch.createdAt).toLocaleDateString()}</td><td>{inr(batch.totalAmount)}</td><td>{batch.beneficiaryCount}</td><td><HrStatusPill tone={batch.status === 'PAID' ? 'ok' : 'gray'}>{batch.status}</HrStatusPill></td>
          <td><HrButton variant="ghost" onClick={() => setSelected(batch.id)}>View details</HrButton></td>
        </tr>)}</tbody></table></div>}
    {selected && <div className="mt-5 border-t border-border-default pt-4">
      <div className="mb-3 flex items-center justify-between"><h3 className="font-semibold">Batch details</h3><HrButton variant="ghost" onClick={() => setSelected(undefined)}>Close</HrButton></div>
      {detail.isLoading ? <p role="status">Loading payment lines...</p> : detail.isError ? <div role="alert"><p>Unable to load payment lines.</p><HrButton onClick={() => detail.refetch()}>Retry</HrButton></div> : detail.data && <>
        <p className="mb-3 text-sm text-text-secondary">{detail.data.batch.batchReference} · Payment reference: {detail.data.batch.paymentReference || 'Not recorded'}</p>
        <div className="overflow-x-auto"><table className="hr-table"><thead><tr><th>Employee</th><th>Account</th><th>Amount</th><th>Status</th></tr></thead><tbody>{detail.data.lines.map(line => <tr key={line.id}><td>{line.beneficiaryName}</td><td>{line.accountNoMasked}</td><td>{inr(line.amount)}</td><td>{line.status}{line.failureReason && <p className="text-xs text-red-700">{line.failureReason}</p>}</td></tr>)}</tbody></table></div>
      </>}
    </div>}
  </section>
}
