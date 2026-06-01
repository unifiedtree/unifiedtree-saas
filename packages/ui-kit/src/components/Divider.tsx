import React from 'react'
import { cn } from '../lib/cn'

type DividerStyle = 'solid' | 'dashed' | 'dotted'
type DividerOrientation = 'horizontal' | 'vertical'

export interface DividerProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'style'> {
  orientation?: DividerOrientation
  style?: DividerStyle
  label?: React.ReactNode
  labelPosition?: 'left' | 'center' | 'right'
}

const styleClasses: Record<DividerStyle, string> = {
  solid: 'border-solid',
  dashed: 'border-dashed',
  dotted: 'border-dotted',
}

export const Divider: React.FC<DividerProps> = ({
  orientation = 'horizontal',
  style: divStyle = 'solid',
  label,
  labelPosition = 'center',
  className,
  ...props
}) => {
  if (orientation === 'vertical') {
    return (
      <div
        role="separator"
        aria-orientation="vertical"
        className={cn('inline-block self-stretch w-px bg-slate-700/60', className)}
        {...props}
      />
    )
  }

  if (label) {
    const justifyMap = { left: 'justify-start', center: 'justify-center', right: 'justify-end' }
    return (
      <div
        role="separator"
        className={cn('flex items-center gap-3 w-full', justifyMap[labelPosition], className)}
        {...props}
      >
        <div className={cn('flex-1 border-t border-slate-700/60', styleClasses[divStyle])} />
        <span className="shrink-0 text-xs text-slate-500 font-medium">{label}</span>
        <div className={cn('flex-1 border-t border-slate-700/60', styleClasses[divStyle])} />
      </div>
    )
  }

  return (
    <hr
      role="separator"
      className={cn('border-0 border-t border-slate-700/60 w-full', styleClasses[divStyle], className)}
      {...(props as React.HTMLAttributes<HTMLHRElement>)}
    />
  )
}
