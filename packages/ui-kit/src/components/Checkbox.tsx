import React, { useRef, useEffect } from 'react'
import { cn } from '../lib/cn'
import { Check, Minus } from 'lucide-react'

export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  label?: string
  description?: string
  error?: string
  indeterminate?: boolean
}

export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ label, description, error, indeterminate = false, disabled, className, id, ...props }, forwardedRef) => {
    const innerRef = useRef<HTMLInputElement>(null)
    const ref = (forwardedRef as React.RefObject<HTMLInputElement>) ?? innerRef
    const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-')

    useEffect(() => {
      if (ref.current) {
        ref.current.indeterminate = indeterminate
      }
    }, [indeterminate, ref])

    return (
      <div className="flex flex-col gap-1">
        <label
          htmlFor={inputId}
          className={cn(
            'flex items-start gap-3 cursor-pointer group',
            disabled && 'opacity-50 cursor-not-allowed'
          )}
        >
          <div className="relative mt-0.5 shrink-0">
            <input
              ref={ref}
              id={inputId}
              type="checkbox"
              disabled={disabled}
              className="sr-only peer"
              {...props}
            />
            <div
              className={cn(
                'w-4 h-4 rounded border-2 flex items-center justify-center transition-all duration-200',
                'border-slate-600 bg-slate-800/60',
                'peer-checked:border-indigo-500 peer-checked:bg-indigo-600',
                'peer-indeterminate:border-indigo-500 peer-indeterminate:bg-indigo-600',
                'group-hover:border-indigo-400 peer-focus-visible:ring-2 peer-focus-visible:ring-indigo-500/40',
                error && 'border-red-500',
                className
              )}
            >
              {indeterminate ? (
                <Minus size={10} className="text-white" />
              ) : (
                <Check size={10} className="text-white opacity-0 peer-checked:opacity-100" />
              )}
            </div>
          </div>
          {(label || description) && (
            <div className="flex flex-col gap-0.5">
              {label && <span className="text-sm font-medium text-slate-200">{label}</span>}
              {description && <span className="text-xs text-slate-400">{description}</span>}
            </div>
          )}
        </label>
        {error && <p className="text-xs text-red-400 ml-7">{error}</p>}
      </div>
    )
  }
)
Checkbox.displayName = 'Checkbox'
