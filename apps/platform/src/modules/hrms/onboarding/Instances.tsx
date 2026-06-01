import React from 'react'
import { Kanban } from 'lucide-react'

// TODO[backend]: GET /v1/onboarding/instances (list all instances for a tenant)
// is not yet implemented. Once it ships, replace this placeholder with a real
// Kanban board grouped by instance status (IN_PROGRESS / COMPLETED).

export const Instances: React.FC = () => {
  return (
    <div className="p-6 animate-fade-in">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-text-primary">Onboarding Instances</h1>
        <p className="mt-0.5 text-sm text-text-secondary">
          Track active and completed employee onboarding runs
        </p>
      </div>

      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border-default bg-bg-surface py-16 text-center space-y-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-accent-subtle">
          <Kanban size={28} className="text-accent-default" />
        </div>
        <div className="space-y-1">
          <h3 className="font-semibold text-text-primary">Kanban board coming soon</h3>
          <p className="max-w-sm text-sm text-text-secondary">
            The instance list endpoint (GET&nbsp;/v1/onboarding/instances) is not yet
            implemented. Once it ships, active and completed onboarding runs will
            appear here as a Kanban board grouped by status.
          </p>
        </div>
        <p className="text-xs text-text-tertiary">
          Individual employee instances are accessible via the ESS dashboard or
          by navigating to&nbsp;
          <code className="font-mono">/hrms/onboarding/instances/&#123;instanceId&#125;</code>.
        </p>
      </div>
    </div>
  )
}
