import React from 'react'
import type { LucideIcon } from 'lucide-react'

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description: string
  action?: { label: string; onClick: () => void }
}

export const EmptyState: React.FC<EmptyStateProps> = ({ icon: Icon, title, description, action }) => (
  <div className="flex flex-col items-center justify-center py-20 text-center">
    <div className="w-16 h-16 bg-white border border-border-default rounded-2xl flex items-center justify-center mb-4 text-text-tertiary">
      <Icon size={28} />
    </div>
    <h3 className="text-text-primary font-semibold text-base mb-1">{title}</h3>
    <p className="text-text-secondary text-sm max-w-xs leading-relaxed">{description}</p>
    {action && (
      <button
        onClick={action.onClick}
        className="mt-5 px-4 py-2 bg-[#FF9D00] hover:bg-[#E08A00] text-white text-sm font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-[#FF9D00]/30"
      >
        {action.label}
      </button>
    )}
  </div>
)
