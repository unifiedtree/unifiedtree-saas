// The design's empty state (prototype UtEmpty = the kit EmptyState): a 56px icon
// tile with a soft brand ring, a short title, a quiet line under it, and the next
// action as the kit's primary button. Same props as before.
import React from 'react'
import type { LucideIcon } from 'lucide-react'
import { EmptyState as KitEmptyState } from '@/design/kit/EmptyState'
import { Button } from '@/design/kit/Button'

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description: string
  action?: { label: string; onClick: () => void }
}

export const EmptyState: React.FC<EmptyStateProps> = ({ icon: Icon, title, description, action }) => (
  <KitEmptyState
    icon={<Icon size={24} aria-hidden="true" />}
    title={title}
    hint={description}
    action={action ? <Button variant="primary" size={38} onClick={action.onClick}>{action.label}</Button> : undefined}
  />
)
