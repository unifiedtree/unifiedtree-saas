import React, { useState } from 'react'
import { cn } from '../lib/cn'
import { Eye, EyeOff, Search, Loader2 } from 'lucide-react'

const inputSizes = {
  sm: 'h-8 text-sm px-3',
  md: 'h-10 text-sm px-3',
  lg: 'h-12 text-base px-4',
} as const

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'prefix' | 'size'> {
  label?: string
  error?: string
  helperText?: string
  prefix?: React.ReactNode
  suffix?: React.ReactNode
  loading?: boolean
  size?: keyof typeof inputSizes
  containerClassName?: string
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    {
      label,
      error,
      helperText,
      prefix,
      suffix,
      loading,
      size = 'md',
      type = 'text',
      disabled,
      className,
      containerClassName,
      id,
      ...props
    },
    ref
  ) => {
    const [showPassword, setShowPassword] = useState(false)
    const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-')
    const resolvedType = type === 'password' ? (showPassword ? 'text' : 'password') : type
    const isPassword = type === 'password'
    const isSearch = type === 'search'

    return (
      <div className={cn('flex flex-col gap-1.5', containerClassName)}>
        {label && (
          <label
            htmlFor={inputId}
            className="text-sm font-medium text-slate-300"
          >
            {label}
          </label>
        )}
        <div className="relative flex items-center">
          {(prefix || isSearch) && (
            <div className="pointer-events-none absolute left-3 flex items-center text-slate-400">
              {isSearch ? <Search size={16} /> : prefix}
            </div>
          )}
          <input
            ref={ref}
            id={inputId}
            type={resolvedType}
            disabled={disabled || loading}
            className={cn(
              'w-full rounded-xl border bg-slate-900/60 text-slate-100 placeholder:text-slate-500',
              'transition-all duration-200 outline-none',
              'focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20',
              'disabled:opacity-50 disabled:cursor-not-allowed',
              error
                ? 'border-red-500/60 focus:border-red-500 focus:ring-red-500/20'
                : 'border-slate-700/60 hover:border-slate-600',
              inputSizes[size],
              (prefix || isSearch) && 'pl-9',
              (suffix || isPassword || loading) && 'pr-10',
              className
            )}
            {...props}
          />
          <div className="absolute right-3 flex items-center gap-1">
            {loading && <Loader2 size={16} className="animate-spin text-slate-400" />}
            {isPassword && !loading && (
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="text-slate-400 hover:text-slate-300 transition-colors"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            )}
            {!isPassword && !loading && suffix && (
              <span className="text-slate-400">{suffix}</span>
            )}
          </div>
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}
        {helperText && !error && <p className="text-xs text-slate-500">{helperText}</p>}
      </div>
    )
  }
)
Input.displayName = 'Input'
