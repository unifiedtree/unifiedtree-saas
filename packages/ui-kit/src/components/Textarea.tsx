import React, { useEffect, useRef } from 'react'
import { cn } from '../lib/cn'

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  error?: string
  helperText?: string
  autoResize?: boolean
  containerClassName?: string
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  (
    {
      label,
      error,
      helperText,
      autoResize = false,
      disabled,
      className,
      containerClassName,
      id,
      onChange,
      ...props
    },
    forwardedRef
  ) => {
    const innerRef = useRef<HTMLTextAreaElement>(null)
    const ref = (forwardedRef as React.RefObject<HTMLTextAreaElement>) ?? innerRef
    const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-')

    const resize = () => {
      const el = ref.current
      if (!el || !autoResize) return
      el.style.height = 'auto'
      el.style.height = `${el.scrollHeight}px`
    }

    useEffect(() => {
      if (autoResize) resize()
    })

    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      if (autoResize) resize()
      onChange?.(e)
    }

    return (
      <div className={cn('flex flex-col gap-1.5', containerClassName)}>
        {label && (
          <label htmlFor={inputId} className="text-sm font-medium text-slate-300">
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={inputId}
          disabled={disabled}
          onChange={handleChange}
          className={cn(
            'w-full min-h-[80px] rounded-xl border bg-slate-900/60 text-slate-100 placeholder:text-slate-500',
            'px-3 py-2.5 text-sm leading-relaxed',
            'transition-all duration-200 outline-none resize-y',
            'focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20',
            'disabled:opacity-50 disabled:cursor-not-allowed disabled:resize-none',
            error
              ? 'border-red-500/60 focus:border-red-500 focus:ring-red-500/20'
              : 'border-slate-700/60 hover:border-slate-600',
            autoResize && 'resize-none overflow-hidden',
            className
          )}
          {...props}
        />
        {error && <p className="text-xs text-red-400">{error}</p>}
        {helperText && !error && <p className="text-xs text-slate-500">{helperText}</p>}
      </div>
    )
  }
)
Textarea.displayName = 'Textarea'
