import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, ClipboardList, Archive } from 'lucide-react'
import { Drawer, TableSkeleton, EmptyState, Button } from '@unifiedtree/ui-kit'
import { HrPageHeader, HrStatusPill, TableCard } from '@/shared/components/hr'
import { toast } from 'sonner'
import { Can, P } from '@unifiedtree/sdk'
import { useTemplates, useCreateTemplate, useDeleteTemplate } from './api/useOnboarding'
import type { OnboardingTemplate } from './api/useOnboarding'
import { useCompanies } from '../api/useOrg'

// ── Create drawer ──────────────────────────────────────────────────────────────

function CreateTemplateDrawer({ onClose }: { onClose: () => void }) {
  const create = useCreateTemplate()
  const { data: companies = [] } = useCompanies()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [companyId, setCompanyId] = useState('')

  // Default to the first company once the list loads (auto-picks when there's only one).
  React.useEffect(() => {
    if (!companyId && companies.length) setCompanyId(companies[0].id)
  }, [companies, companyId])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    if (!companyId) {
      toast.error('Create a company first (Organization → Companies)')
      return
    }
    create.mutate(
      { companyId, name: name.trim(), description: description.trim() || undefined, active: true },
      {
        onSuccess: () => {
          toast.success('Template created')
          onClose()
        },
        onError: () => toast.error('Failed to create template'),
      },
    )
  }

  return (
    <Drawer open onOpenChange={(open) => { if (!open) onClose() }} title="Create onboarding template">
      <form onSubmit={handleSubmit} className="space-y-4">
        {companies.length > 1 && (
          <div className="space-y-1">
            <label className="text-xs font-medium text-text-tertiary uppercase tracking-wider">
              Company *
            </label>
            <select
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
              className="w-full rounded-lg border border-border-default bg-bg-base px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-default/40"
            >
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        )}
        <div className="space-y-1">
          <label className="text-xs font-medium text-text-tertiary uppercase tracking-wider">
            Template name *
          </label>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Engineering Hire"
            className="w-full rounded-lg border border-border-default bg-bg-base px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent-default/40"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-text-tertiary uppercase tracking-wider">
            Description
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional description"
            rows={3}
            className="w-full rounded-lg border border-border-default bg-bg-base px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent-default/40 resize-none"
          />
        </div>
        <div className="flex gap-2 border-t border-border-default pt-4">
          <Button type="submit" size="sm" loading={create.isPending}>
            Create template
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Drawer>
  )
}

// ── Main ───────────────────────────────────────────────────────────────────────

export const Templates: React.FC = () => {
  const navigate = useNavigate()
  const [createOpen, setCreateOpen] = useState(false)

  const { data: templates = [], isLoading, error, refetch } = useTemplates()
  const del = useDeleteTemplate()

  const handleDelete = (template: OnboardingTemplate) => {
    if (!window.confirm(`Archive "${template.name}"? It will no longer be available for new hires.`)) return
    del.mutate(template.id, {
      onSuccess: () => toast.success('Template archived'),
      onError: () => toast.error('Failed to archive template'),
    })
  }

  return (
    <div className="mx-auto max-w-5xl p-6 sm:p-8">
      <HrPageHeader
        crumb="Recruitment & Onboarding"
        title="Onboarding Templates"
        subtitle="Define reusable task checklists for new hires"
        actions={
          <Can code={P.HRMS_ONBOARDING_TEMPLATE_WRITE}>
            <Button size="sm" leftIcon={<Plus size={14} />} onClick={() => setCreateOpen(true)}>New template</Button>
          </Can>
        }
      />

      {isLoading ? (
        <TableSkeleton />
      ) : error ? (
        <EmptyState
          variant="error"
          title="Failed to load templates"
          description={(error as Error).message}
          primaryAction={{ label: 'Retry', onClick: () => refetch() }}
        />
      ) : templates.length === 0 ? (
        <EmptyState variant="first-run" title="No templates yet" description="Create your first onboarding template to get started." />
      ) : (
        <TableCard>
          <table className="hr-table">
            <thead>
              <tr><th>Template</th><th>Tasks</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              {templates.map((row) => (
                <tr key={row.id} onClick={() => navigate(`/hrms/onboarding/templates/${row.id}`)} className="cursor-pointer">
                  <td>
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-[#FFF4E1]">
                        <ClipboardList size={13} className="text-[#FF9D00]" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-text-primary">{row.name}</p>
                        {row.description && <p className="max-w-[240px] truncate text-xs text-text-tertiary">{row.description}</p>}
                      </div>
                    </div>
                  </td>
                  <td className="text-text-secondary">{row.tasks?.length ?? 0}</td>
                  <td><HrStatusPill tone={row.active ? 'ok' : 'gray'}>{row.active ? 'Active' : 'Inactive'}</HrStatusPill></td>
                  <td>
                    {row.active && (
                      <Can code={P.HRMS_ONBOARDING_TEMPLATE_WRITE}>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDelete(row) }}
                          disabled={del.isPending}
                          className="rounded-lg p-1.5 text-text-tertiary transition-colors hover:bg-[#FEE2E2] hover:text-[#B91C1C] disabled:opacity-40"
                          aria-label="Archive template" title="Archive template"
                        >
                          <Archive size={14} />
                        </button>
                      </Can>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableCard>
      )}

      {createOpen && <CreateTemplateDrawer onClose={() => setCreateOpen(false)} />}
    </div>
  )
}
