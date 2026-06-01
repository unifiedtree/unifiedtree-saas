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
    <div className="w-16 h-16 bg-white border border-[#E2E8F0]/40 rounded-2xl flex items-center justify-center mb-4 text-[#64748B]">
      <Icon size={28} />
    </div>
    <h3 className="text-[#334155] font-semibold text-base mb-1">{title}</h3>
    <p className="text-[#64748B] text-sm max-w-xs leading-relaxed">{description}</p>
    {action && (
      <button
        onClick={action.onClick}
        className="mt-5 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-[#0F172A] text-sm font-medium rounded-lg transition-colors"
      >
        {action.label}
      </button>
    )}
  </div>
)
