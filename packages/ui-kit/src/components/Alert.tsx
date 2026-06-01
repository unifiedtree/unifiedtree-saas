import React, { useState } from 'react'
import { cn } from '../lib/cn'
import { CheckCircle2, AlertCircle, Info, AlertTriangle, X } from 'lucide-react'

const alertVariants = {
  info: {
    container: 'bg-blue-500/10 border-blue-500/30 text-blue-300',
    icon: <Info size={18} className="text-blue-400 shrink-0 mt-0.5" />,
    title: 'text-blue-200',
  },
  success: {
    container: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300',
    icon: <CheckCircle2 size={18} className="text-emerald-400 shrink-0 mt-0.5" />,
    title: 'text-emerald-200',
  },
  warning: {
    container: 'bg-amber-500/10 border-amber-500/30 text-amber-300',
    icon: <AlertTriangle size={18} className="text-amber-400 shrink-0 mt-0.5" />,
    title: 'text-amber-200',
  },
  danger: {
    container: 'bg-red-500/10 border-red-500/30 text-red-300',
    icon: <AlertCircle size={18} className="text-red-400 shrink-0 mt-0.5" />,
    title: 'text-red-200',
  },
} as const

export interface AlertProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: keyof typeof alertVariants
  title?: string
  description?: string
  dismissable?: boolean
  icon?: React.ReactNode | false
  onDismiss?: () => void
}

export const Alert: React.FC<AlertProps> = ({
  variant = 'info',
  title,
  description,
  dismissable = false,
  icon,
  onDismiss,
  className,
  children,
  ...props
}) => {
  const [dismissed, setDismissed] = useState(false)
  const config = alertVariants[variant]

  if (dismissed) return null

  const handleDismiss = () => {
    setDismissed(true)
    onDismiss?.()
  }

  const showIcon = icon !== false

  return (
    <div
      role="alert"
      className={cn(
        'flex gap-3 rounded-xl border px-4 py-3.5 text-sm',
        config.container,
        className
      )}
      {...props}
    >
      {showIcon && (icon !== undefined ? icon : config.icon)}
      <div className="flex-1 min-w-0">
        {title && (
          <p className={cn('font-semibold leading-tight', config.title, description && 'mb-1')}>
            {title}
          </p>
        )}
        {description && <p className="leading-relaxed opacity-90">{description}</p>}
        {children && <div className="mt-1">{children}</div>}
      </div>
      {dismissable && (
        <button
          onClick={handleDismiss}
          className="shrink-0 opacity-60 hover:opacity-100 transition-opacity mt-0.5"
          aria-label="Dismiss alert"
        >
          <X size={16} />
        </button>
      )}
    </div>
  )
}
