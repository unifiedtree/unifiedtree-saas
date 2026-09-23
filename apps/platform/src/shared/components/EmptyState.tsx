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
    <div className="relative mb-6">
      <div className="absolute inset-0 rounded-full bg-emerald-100 opacity-50 blur-xl"></div>
      <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-white text-emerald-600 shadow-sm ring-1 ring-gray-200">
        <Icon size={28} />
      </div>
    </div>
    <h3 className="mb-2 text-lg font-bold text-gray-900">{title}</h3>
    <p className="max-w-sm text-[14px] font-medium leading-relaxed text-gray-500">{description}</p>
    {action && (
      <button
        onClick={action.onClick}
        className="mt-6 inline-flex items-center justify-center rounded-xl bg-emerald-600 px-5 py-2.5 text-[14px] font-bold text-white shadow-sm transition-all hover:bg-emerald-700 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"
      >
        {action.label}
      </button>
    )}
  </div>
)
