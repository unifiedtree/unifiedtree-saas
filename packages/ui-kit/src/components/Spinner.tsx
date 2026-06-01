import React from 'react'
import { cn } from '../lib/cn'

const spinnerSizes = {
  xs: 'w-3 h-3 border-[1.5px]',
  sm: 'w-4 h-4 border-2',
  md: 'w-6 h-6 border-2',
  lg: 'w-8 h-8 border-[3px]',
  xl: 'w-12 h-12 border-4',
} as const

const spinnerColors = {
  default: 'border-indigo-500/30 border-t-indigo-500',
  white: 'border-white/20 border-t-white',
  muted: 'border-slate-600 border-t-slate-400',
} as const

export interface SpinnerProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: keyof typeof spinnerSizes
  color?: keyof typeof spinnerColors
}

export const Spinner: React.FC<SpinnerProps> = ({
  size = 'md',
  color = 'default',
  className,
  ...props
}) => (
  <div
    role="status"
    aria-label="Loading"
    className={cn(
      'rounded-full animate-spin',
      spinnerSizes[size],
      spinnerColors[color],
      className
    )}
    {...props}
  />
)

export interface FullPageSpinnerProps {
  message?: string
  className?: string
}

export const FullPageSpinner: React.FC<FullPageSpinnerProps> = ({ message, className }) => (
  <div
    className={cn(
      'fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-slate-950/80 backdrop-blur-sm',
      className
    )}
    role="status"
    aria-live="polite"
  >
    <Spinner size="xl" />
    {message && <p className="text-sm font-medium text-slate-400">{message}</p>}
  </div>
)
