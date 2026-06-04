import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, ClipboardList } from 'lucide-react'
import {
  DataTable, Badge, Drawer, TableSkeleton, EmptyState, Button,
} from '@unifiedtree/ui-kit'
import type { Column } from '@unifiedtree/ui-kit'
import { toast } from 'sonner'
import { Can, P } from '@unifiedtree/sdk'
import { useTemplates, useCreateTemplate } from './api/useOnboarding'
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

  const columns: Column<OnboardingTemplate>[] = [
    {
      key: 'name',
      header: 'Template',
      cell: (row) => (
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-accent-subtle">
            <ClipboardList size={13} className="text-accent-default" />
          </div>
          <div>
            <p className="text-sm font-medium text-text-primary">{row.name}</p>
            {row.description && (
              <p className="text-xs text-text-tertiary truncate max-w-[240px]">{row.description}</p>
            )}
          </div>
        </div>
      ),
    },
    {
      key: 'tasks',
      header: 'Tasks',
      cell: (row) => (
        <span className="text-sm text-text-secondary">{row.tasks?.length ?? 0}</span>
      ),
    },
    {
      key: 'active',
      header: 'Status',
      cell: (row) => (
        <Badge tone={row.active ? 'success' : 'default'}>
          {row.active ? 'Active' : 'Inactive'}
        </Badge>
      ),
    },
  ]

  return (
    <div className="p-6 animate-fade-in">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-text-primary">Onboarding Templates</h1>
          <p className="mt-0.5 text-sm text-text-secondary">
            Define reusable task checklists for new hires
          </p>
        </div>
        <Can code={P.HRMS_ONBOARDING_TEMPLATE_WRITE}>
          <Button size="sm" leftIcon={<Plus size={14} />} onClick={() => setCreateOpen(true)}>
            New template
          </Button>
        </Can>
      </div>

      {isLoading ? (
        <TableSkeleton />
      ) : error ? (
        <EmptyState
          variant="error"
          title="Failed to load templates"
          description={(error as Error).message}
          primaryAction={{ label: 'Retry', onClick: () => refetch() }}
        />
      ) : (
        <DataTable
          data={templates}
          columns={columns}
          getRowKey={(row) => row.id}
          onRowClick={(row) => navigate(`/hrms/onboarding/templates/${row.id}`)}
          emptyTitle="No templates yet"
          emptyDescription="Create your first onboarding template to get started."
          emptyVariant="first-run"
        />
      )}

      {createOpen && <CreateTemplateDrawer onClose={() => setCreateOpen(false)} />}
    </div>
  )
}
