import React from 'react'
import { cn } from '../lib/cn'

const switchSizes = {
  sm: { track: 'w-8 h-4', thumb: 'w-3 h-3', translate: 'translate-x-4' },
  md: { track: 'w-11 h-6', thumb: 'w-5 h-5', translate: 'translate-x-5' },
  lg: { track: 'w-14 h-7', thumb: 'w-6 h-6', translate: 'translate-x-7' },
} as const

export interface SwitchProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  label?: string
  description?: string
  size?: keyof typeof switchSizes
  labelPlacement?: 'left' | 'right'
}

export const Switch = React.forwardRef<HTMLInputElement, SwitchProps>(
  (
    { label, description, size = 'md', labelPlacement = 'right', disabled, className, id, ...props },
    ref
  ) => {
    const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-')
    const { track, thumb, translate } = switchSizes[size]

    return (
      <label
        htmlFor={inputId}
        className={cn(
          'inline-flex items-start gap-3 cursor-pointer',
          labelPlacement === 'left' && 'flex-row-reverse',
          disabled && 'opacity-50 cursor-not-allowed'
        )}
      >
        <div className="relative shrink-0 mt-0.5">
          <input
            ref={ref}
            id={inputId}
            type="checkbox"
            role="switch"
            disabled={disabled}
            className="sr-only peer"
            {...props}
          />
          <div
            className={cn(
              'rounded-full border border-slate-600 bg-slate-700 transition-all duration-200',
              'peer-checked:bg-indigo-600 peer-checked:border-indigo-500',
              'peer-focus-visible:ring-2 peer-focus-visible:ring-indigo-500/40 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-slate-900',
              track,
              className
            )}
          />
          <div
            className={cn(
              'absolute left-0.5 top-0.5 rounded-full bg-white shadow-sm',
              'transition-transform duration-200',
              'peer-checked:' + translate,
              thumb
            )}
          />
        </div>
        {(label || description) && (
          <div className="flex flex-col gap-0.5">
            {label && <span className="text-sm font-medium text-slate-200">{label}</span>}
            {description && <span className="text-xs text-slate-400">{description}</span>}
          </div>
        )}
      </label>
    )
  }
)
Switch.displayName = 'Switch'
