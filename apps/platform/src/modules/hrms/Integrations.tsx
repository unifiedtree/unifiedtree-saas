import React, { useMemo, useState } from 'react'
import { Plus, Trash2, Plug, PlugZap, Power, AlertTriangle, Boxes } from 'lucide-react'
import { format } from 'date-fns'
import { usePermission } from '@unifiedtree/sdk'
import { useToast } from '@/shared/hooks/useToast'
import {
  HrPageHeader, HrButton, HrStatCard, HrStatusPill, TableCard, type PillTone,
} from '@/shared/components/hr'
import { useCompanies } from './api/useOrg'
import {
  useIntegrationConnections, useCreateConnection, useToggleConnection, useDeleteConnection,
  type IntegrationStatus,
} from './api/useIntegration'

const STATUS_TONE: Record<IntegrationStatus, PillTone> = {
  CONNECTED: 'ok',
  DISCONNECTED: 'gray',
  ERROR: 'red',
}

const fmtStatus = (s: IntegrationStatus) =>
  s.charAt(0) + s.slice(1).toLowerCase()

export const Integrations: React.FC = () => {
  const { toast } = useToast()
  const canWrite = usePermission('hrms.integration.write')
  const { data: companies = [] } = useCompanies()
  const [companyId, setCompanyId] = useState('')
  const activeCompany = companyId || companies[0]?.id || ''

  const { data, isLoading } = useIntegrationConnections(activeCompany || undefined, 0)
  const create = useCreateConnection()
  const toggle = useToggleConnection()
  const remove = useDeleteConnection()
  const connections = data?.content ?? []

  const [name, setName] = useState('')
  const [provider, setProvider] = useState('')
  const [category, setCategory] = useState('')

  const stats = useMemo(() => {
    const connected = connections.filter((c) => c.status === 'CONNECTED').length
    const errored = connections.filter((c) => c.status === 'ERROR').length
    return { total: connections.length, connected, errored }
  }, [connections])

  const onCreate = async () => {
    if (!activeCompany) { toast('Select a company first', 'error'); return }
    if (!name.trim()) { toast('Give the integration a name', 'error'); return }
    if (!provider.trim()) { toast('Provider is required', 'error'); return }
    try {
      await create.mutateAsync({
        companyId: activeCompany,
        name: name.trim(),
        provider: provider.trim(),
        category: category.trim() || undefined,
      })
      toast('Integration added', 'success')
      setName(''); setProvider(''); setCategory('')
    } catch (e) {
      toast((e as Error)?.message ?? 'Failed to add integration', 'error')
    }
  }

  const onToggle = async (id: string, status: IntegrationStatus) => {
    try {
      await toggle.mutateAsync(id)
      toast(status === 'CONNECTED' ? 'Disconnected' : 'Connected', 'success')
    } catch (e) {
      toast((e as Error)?.message ?? 'Failed', 'error')
    }
  }

  const onRemove = async (id: string) => {
    try {
      await remove.mutateAsync(id)
      toast('Integration removed', 'success')
    } catch (e) {
      toast((e as Error)?.message ?? 'Failed', 'error')
    }
  }

  const inputCls = 'rounded-lg border border-border-default bg-white px-3 py-2 text-sm text-text-primary focus:border-[#FF9D00] focus:outline-none focus:ring-2 focus:ring-[#FF9D00]/20'

  return (
    <div className="mx-auto max-w-5xl p-6 sm:p-8">
      <HrPageHeader crumb="Integrations" title="Integrations Directory" subtitle="Connect and manage your third-party services" />

      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <HrStatCard icon={<Boxes size={18} />} color="blue" value={stats.total} label="Integrations" loading={isLoading} />
        <HrStatCard icon={<PlugZap size={18} />} color="green" value={stats.connected} label="Connected" loading={isLoading} />
        <HrStatCard icon={<AlertTriangle size={18} />} color="orange" value={stats.errored} label="Needs Attention" loading={isLoading} />
      </div>

      {companies.length > 1 && (
        <div className="mb-4">
          <select value={activeCompany} onChange={(e) => setCompanyId(e.target.value)} className={inputCls}>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      )}

      {canWrite && (
        <div className="mb-5 flex flex-wrap items-end gap-2 rounded-2xl border border-border-default bg-white p-4 shadow-sm">
          <div className="min-w-[180px] flex-1">
            <label className="mb-1 block text-xs font-medium text-text-secondary">Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Payroll Slack alerts" className={`${inputCls} w-full`} />
          </div>
          <div className="min-w-[140px] flex-1">
            <label className="mb-1 block text-xs font-medium text-text-secondary">Provider</label>
            <input value={provider} onChange={(e) => setProvider(e.target.value)} placeholder="e.g. Slack" className={`${inputCls} w-full`} />
          </div>
          <div className="min-w-[140px] flex-1">
            <label className="mb-1 block text-xs font-medium text-text-secondary">Category</label>
            <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Communication" className={`${inputCls} w-full`} />
          </div>
          <HrButton onClick={onCreate} disabled={create.isPending}>
            <Plus size={15} /> {create.isPending ? 'Adding…' : 'Add Integration'}
          </HrButton>
        </div>
      )}

      <TableCard>
        <table className="hr-table">
          <thead>
            <tr>
              <th>Integration</th>
              <th>Provider</th>
              <th>Category</th>
              <th>Status</th>
              <th className="hidden sm:table-cell">Last Synced</th>
              {canWrite && <th className="text-right">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(4)].map((_, i) => (
                <tr key={i}><td colSpan={canWrite ? 6 : 5} className="py-3"><div className="h-5 w-full animate-pulse rounded bg-bg-base" /></td></tr>
              ))
            ) : connections.length === 0 ? (
              <tr>
                <td colSpan={canWrite ? 6 : 5} className="py-14 text-center">
                  <p className="text-sm font-semibold text-text-secondary">No integrations yet</p>
                  <p className="mt-1 text-xs text-text-tertiary">{canWrite ? 'Use the form above to add your first connection.' : 'Connections added by an admin will appear here.'}</p>
                </td>
              </tr>
            ) : connections.map((c) => (
              <tr key={c.id}>
                <td className="font-medium text-text-primary">
                  {c.name}
                  {c.configSummary && <p className="mt-0.5 text-xs font-normal text-text-tertiary">{c.configSummary}</p>}
                </td>
                <td className="text-text-secondary">{c.provider}</td>
                <td className="text-text-secondary">{c.category || '—'}</td>
                <td><HrStatusPill tone={STATUS_TONE[c.status]}>{fmtStatus(c.status)}</HrStatusPill></td>
                <td className="hidden sm:table-cell text-text-secondary">{c.lastSyncedAt ? format(new Date(c.lastSyncedAt), 'd MMM yyyy, HH:mm') : '—'}</td>
                {canWrite && (
                  <td>
                    <div className="flex items-center justify-end gap-2">
                      <HrButton size="sm" variant={c.status === 'CONNECTED' ? 'ghost' : undefined} onClick={() => onToggle(c.id, c.status)} disabled={toggle.isPending}>
                        {c.status === 'CONNECTED' ? <><Power size={14} /> Disconnect</> : <><Plug size={14} /> Connect</>}
                      </HrButton>
                      <button onClick={() => onRemove(c.id)} disabled={remove.isPending} className="rounded-lg p-1.5 text-text-tertiary hover:bg-[#FEE2E2] hover:text-[#B91C1C]" title="Remove">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </TableCard>
    </div>
  )
}
