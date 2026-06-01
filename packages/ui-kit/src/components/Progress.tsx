import React from 'react'
import { cn } from '../lib/cn'
import { Check } from 'lucide-react'

// ─── ProgressBar ──────────────────────────────────────────────

const progressColors = {
  primary: 'from-indigo-500 to-purple-500',
  success: 'from-emerald-500 to-teal-500',
  warning: 'from-amber-500 to-orange-500',
  danger: 'from-red-500 to-rose-500',
  info: 'from-blue-500 to-cyan-500',
} as const

const progressSizes = {
  xs: 'h-1',
  sm: 'h-1.5',
  md: 'h-2.5',
  lg: 'h-4',
} as const

export interface ProgressBarProps extends React.HTMLAttributes<HTMLDivElement> {
  value: number
  max?: number
  size?: keyof typeof progressSizes
  color?: keyof typeof progressColors
  showLabel?: boolean
  label?: string
  animated?: boolean
}

export const ProgressBar: React.FC<ProgressBarProps> = ({
  value,
  max = 100,
  size = 'md',
  color = 'primary',
  showLabel = false,
  label,
  animated = false,
  className,
  ...props
}) => {
  const pct = Math.min(100, Math.max(0, (value / max) * 100))

  return (
    <div className={cn('flex flex-col gap-1.5', className)} {...props}>
      {(showLabel || label) && (
        <div className="flex items-center justify-between">
          {label && <span className="text-sm font-medium text-slate-300">{label}</span>}
          {showLabel && (
            <span className="text-xs text-slate-400">{Math.round(pct)}%</span>
          )}
        </div>
      )}
      <div
        className={cn(
          'w-full rounded-full bg-slate-700/60 overflow-hidden',
          progressSizes[size]
        )}
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
      >
        <div
          className={cn(
            'h-full rounded-full bg-gradient-to-r transition-all duration-500 ease-out',
            progressColors[color],
            animated && 'animate-pulse'
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

// ─── ProgressCircle ───────────────────────────────────────────

export interface ProgressCircleProps extends React.HTMLAttributes<HTMLDivElement> {
  value: number
  max?: number
  size?: number
  strokeWidth?: number
  color?: keyof typeof progressColors
  showLabel?: boolean
  label?: React.ReactNode
}

export const ProgressCircle: React.FC<ProgressCircleProps> = ({
  value,
  max = 100,
  size = 64,
  strokeWidth = 6,
  color = 'primary',
  showLabel = true,
  label,
  className,
  ...props
}) => {
  const pct = Math.min(100, Math.max(0, (value / max) * 100))
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (pct / 100) * circumference

  const strokeColors: Record<keyof typeof progressColors, string> = {
    primary: '#6366f1',
    success: '#10B981',
    warning: '#F59E0B',
    danger: '#EF4444',
    info: '#3B82F6',
  }

  return (
    <div
      className={cn('relative inline-flex items-center justify-center', className)}
      style={{ width: size, height: size }}
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      {...props}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={strokeColors[color]}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="transition-all duration-700 ease-out"
        />
      </svg>
      {showLabel && (
        <span className="absolute text-xs font-semibold text-slate-200">
          {label ?? `${Math.round(pct)}%`}
        </span>
      )}
    </div>
  )
}

// ─── StepProgress ─────────────────────────────────────────────

export interface StepProgressStep {
  label: string
  description?: string
}

export interface StepProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  steps: StepProgressStep[]
  currentStep: number
  orientation?: 'horizontal' | 'vertical'
}

export const StepProgress: React.FC<StepProgressProps> = ({
  steps,
  currentStep,
  orientation = 'horizontal',
  className,
  ...props
}) => {
  return (
    <div
      className={cn(
        orientation === 'horizontal'
          ? 'flex items-start w-full'
          : 'flex flex-col gap-0',
        className
      )}
      {...props}
    >
      {steps.map((step, i) => {
        const isDone = i < currentStep
        const isActive = i === currentStep
        const isLast = i === steps.length - 1

        return (
          <React.Fragment key={i}>
            <div
              className={cn(
                'flex items-center gap-3',
                orientation === 'vertical' && 'flex-col items-start'
              )}
            >
              <div className="flex flex-col items-center">
                <div
                  className={cn(
                    'w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all duration-300',
                    isDone
                      ? 'bg-indigo-600 border-indigo-600 text-white'
                      : isActive
                      ? 'bg-transparent border-indigo-500 text-indigo-400'
                      : 'bg-transparent border-slate-700 text-slate-500'
                  )}
                >
                  {isDone ? <Check size={14} /> : <span>{i + 1}</span>}
                </div>
              </div>
              <div className="flex flex-col">
                <span
                  className={cn(
                    'text-sm font-semibold',
                    isDone || isActive ? 'text-slate-200' : 'text-slate-500'
                  )}
                >
                  {step.label}
                </span>
                {step.description && (
                  <span className="text-xs text-slate-500">{step.description}</span>
                )}
              </div>
            </div>
            {!isLast && (
              <div
                className={cn(
                  orientation === 'horizontal'
                    ? 'flex-1 h-0.5 mt-4 mx-2'
                    : 'w-0.5 h-8 ml-4',
                  isDone ? 'bg-indigo-600' : 'bg-slate-700'
                )}
              />
            )}
          </React.Fragment>
        )
      })}
    </div>
  )
}
