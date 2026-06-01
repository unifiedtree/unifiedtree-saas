import React from 'react'
import { cn } from '../lib/cn'
import { X } from 'lucide-react'

const tagColors = {
  default: 'bg-slate-700/60 text-slate-300 border-slate-600/50 hover:bg-slate-700',
  primary: 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30 hover:bg-indigo-500/25',
  success: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/25',
  warning: 'bg-amber-500/15 text-amber-400 border-amber-500/30 hover:bg-amber-500/25',
  danger: 'bg-red-500/15 text-red-400 border-red-500/30 hover:bg-red-500/25',
  info: 'bg-blue-500/15 text-blue-400 border-blue-500/30 hover:bg-blue-500/25',
  purple: 'bg-purple-500/15 text-purple-400 border-purple-500/30 hover:bg-purple-500/25',
  cyan: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30 hover:bg-cyan-500/25',
} as const

export interface TagProps extends React.HTMLAttributes<HTMLSpanElement> {
  color?: keyof typeof tagColors
  onRemove?: () => void
  removable?: boolean
  size?: 'sm' | 'md'
}

export const Tag: React.FC<TagProps> = ({
  color = 'default',
  onRemove,
  removable = false,
  size = 'md',
  className,
  children,
  ...props
}) => {
  const isRemovable = removable || !!onRemove
  const sizeClasses = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs'

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border font-medium transition-colors',
        tagColors[color],
        sizeClasses,
        className
      )}
      {...props}
    >
      {children}
      {isRemovable && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onRemove?.()
          }}
          className={cn(
            'shrink-0 rounded-full p-0.5 transition-colors opacity-60 hover:opacity-100',
            'focus:outline-none focus-visible:ring-1 focus-visible:ring-current'
          )}
          aria-label="Remove tag"
        >
          <X size={10} />
        </button>
      )}
    </span>
  )
}
