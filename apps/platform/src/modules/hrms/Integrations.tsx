// Integrations (/hrms/integrations), on the module kit. This is a registry:
// a record of the third-party services the company uses and whether someone
// has marked them configured. Adding a record doesn't authorise the provider
// or sync any data, and the page says so.
//   read: hrms.integration.read · add / mark / remove: hrms.integration.write
import React, { useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { usePermission } from '@unifiedtree/sdk'
import { useConfirmDialog } from '@/shared/components/ConfirmDialog'
import { HrPagination } from '@/shared/components/HrPagination'
import { HrButton, HrStatusPill, TableCard, type PillTone } from '@/shared/components/hr'
import { ModulePage, StatRow, State, Panel, Note, useDesignToast, dmy } from '@/design/module/ModuleKit'
import { useCompanies } from './api/useOrg'
import { useIntegrationConnections, useCreateConnection, useToggleConnection, useDeleteConnection, type IntegrationStatus } from './api/useIntegration'

const STATUS: Record<IntegrationStatus, [string, PillTone]> = { CONNECTED: ['Marked configured', 'ok'], DISCONNECTED: ['Not configured', 'gray'], ERROR: ['Needs attention', 'red'] }
const label = 'mb-1.5 block text-[13px] font-semibold text-text-secondary'

export const Integrations: React.FC = () => {
  const { show, node } = useDesignToast()
  const confirm = useConfirmDialog()
  const canWrite = usePermission('hrms.integration.write')
  const { data: companies = [] } = useCompanies()
  const [companyId, setCompanyId] = useState('')
  const activeCompany = companyId || companies[0]?.id || ''
  const [page, setPage] = useState(0)
  const { data, isLoading, error, refetch } = useIntegrationConnections(activeCompany || undefined, page)
  const create = useCreateConnection()
  const toggle = useToggleConnection()
  const remove = useDeleteConnection()
  const connections = useMemo(() => data?.content ?? [], [data])
  const [name, setName] = useState('')
  const [provider, setProvider] = useState('')
  const [category, setCategory] = useState('')
  const stats = useMemo(() => ({ connected: connections.filter((c) => c.status === 'CONNECTED').length, errored: connections.filter((c) => c.status === 'ERROR').length }), [connections])
  const pageNote = (data?.totalPages ?? 1) > 1 ? 'On this page' : undefined

  const onCreate = async () => {
    if (!activeCompany) { show('Choose a company first', true); return }
    if (!name.trim()) { show('Name the integration', true); return }
    if (!provider.trim()) { show('Say which provider it is', true); return }
    try {
      await create.mutateAsync({ companyId: activeCompany, name: name.trim(), provider: provider.trim(), category: category.trim() || undefined })
      show('Integration added'); setName(''); setProvider(''); setCategory('')
    } catch (e) { show('Couldn’t add the integration', true, (e as Error)?.message) }
  }
  const onToggle = async (id: string, was: IntegrationStatus) => {
    try { await toggle.mutateAsync(id); show(was === 'CONNECTED' ? 'Marked not configured' : 'Marked configured') } catch (e) { show('Couldn’t update it', true, (e as Error)?.message) }
  }
  const onRemove = async (c: { id: string; name: string; provider: string }) => {
    const ok = await confirm({ title: `Remove ${c.name}?`, body: `The ${c.provider} record and anything stored with it are deleted. This can’t be undone.`, confirmLabel: 'Remove', tone: 'danger' })
    if (!ok) return
    try { await remove.mutateAsync(c.id); show('Integration removed') } catch (e) { show('Couldn’t remove it', true, (e as Error)?.message) }
  }

  return (
    <ModulePage crumb="HR setup" title="Integrations" subtitle="A record of the outside services your company uses."
      actions={companies.length > 1 ? (
        <select aria-label="Company" value={activeCompany} onChange={(e) => { setCompanyId(e.target.value); setPage(0) }} className="ut-select ut-select-sm w-56">
          {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      ) : undefined}>
      <div style={{ display: 'grid', gap: 16, minWidth: 0 }}>
        <Note tone="amber">Status is set by hand. Adding a service here doesn’t connect to it, authorise it or sync any data.</Note>
        {isLoading ? <State kind="loading" height={96} /> : !error && <StatRow tiles={[
          { icon: 'workflow', color: 'blue', label: 'Services recorded', value: String(data?.totalElements ?? 0), sub: 'In this company' },
          { icon: 'checkCircle', color: 'green', label: 'Marked configured', value: String(stats.connected), sub: pageNote || 'Set up by someone' },
          { icon: 'alertTriangle', color: 'orange', label: 'Needs attention', value: String(stats.errored), sub: pageNote || 'Flagged' },
        ]} />}
        {canWrite && (
          <Panel title="Record a service">
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-[180px] flex-1"><label className={label} htmlFor="int-name">Name</label><input id="int-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Payroll alerts" className="ut-input" /></div>
              <div className="min-w-[140px] flex-1"><label className={label} htmlFor="int-provider">Provider</label><input id="int-provider" value={provider} onChange={(e) => setProvider(e.target.value)} placeholder="e.g. Slack" className="ut-input" /></div>
              <div className="min-w-[140px] flex-1"><label className={label} htmlFor="int-cat">Category</label><input id="int-cat" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Communication" className="ut-input" /></div>
              <HrButton onClick={onCreate} disabled={create.isPending}><Plus size={15} /> {create.isPending ? 'Adding…' : 'Add'}</HrButton>
            </div>
          </Panel>
        )}
        {error ? <State kind="error" title="Couldn’t load integrations" description={(error as Error).message} onRetry={() => refetch()} />
          : isLoading ? <State kind="loading" height={200} />
            : connections.length === 0 ? <State kind="empty" icon="workflow" title="No services recorded" description={canWrite ? 'Add the tools your company uses so everyone knows what’s in place.' : 'Services an admin records appear here.'} />
              : (
                <TableCard footer={(data?.totalPages ?? 0) > 1 ? <HrPagination page={page} pageSize={20} totalElements={data?.totalElements ?? 0} totalPages={data?.totalPages ?? 0} onPageChange={setPage} /> : undefined}>
                  <table className="hr-table">
                    <thead><tr><th>Service</th><th>Provider</th><th className="hidden sm:table-cell">Category</th><th>Status</th><th className="hidden md:table-cell">Recorded</th>{canWrite && <th><span className="sr-only">Actions</span></th>}</tr></thead>
                    <tbody>
                      {connections.map((c) => (
                        <tr key={c.id}>
                          <td className="font-semibold text-text-primary">{c.name}{c.configSummary && <p className="mt-0.5 text-xs font-normal text-text-tertiary">{c.configSummary}</p>}</td>
                          <td className="text-text-secondary">{c.provider}</td>
                          <td className="hidden sm:table-cell text-text-secondary">{c.category || '—'}</td>
                          <td><HrStatusPill tone={STATUS[c.status]?.[1] ?? 'gray'}>{STATUS[c.status]?.[0] ?? c.status}</HrStatusPill></td>
                          <td className="hidden md:table-cell text-text-secondary">{dmy(c.createdAt)}</td>
                          {canWrite && (
                            <td>
                              <div className="flex flex-wrap items-center justify-end gap-1.5">
                                <HrButton size="sm" variant="ghost" onClick={() => onToggle(c.id, c.status)} disabled={toggle.isPending}>{c.status === 'CONNECTED' ? 'Mark not configured' : 'Mark configured'}</HrButton>
                                <HrButton size="sm" variant="ghost" onClick={() => onRemove(c)} disabled={remove.isPending} aria-label={`Remove ${c.provider} integration ${c.name}`}>Remove</HrButton>
                              </div>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableCard>
              )}
      </div>
      {node}
    </ModulePage>
  )
}
