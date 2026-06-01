import React from 'react'
import { cn } from '../lib/cn'

const cardVariants = {
  default: 'bg-slate-900/60 border border-slate-700/50',
  elevated: 'bg-slate-900/80 border border-slate-700/50 shadow-xl shadow-black/40',
  glass: 'bg-white/5 border border-white/10 backdrop-blur-md',
  flat: 'bg-slate-900 border border-slate-800',
} as const

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: keyof typeof cardVariants
  hover?: boolean
  padding?: 'none' | 'sm' | 'md' | 'lg'
}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ variant = 'default', hover = false, padding = 'md', className, children, ...props }, ref) => {
    const paddingClasses = {
      none: '',
      sm: 'p-4',
      md: 'p-6',
      lg: 'p-8',
    }
    return (
      <div
        ref={ref}
        className={cn(
          'rounded-2xl',
          cardVariants[variant],
          paddingClasses[padding],
          hover &&
            'transition-all duration-300 hover:border-indigo-500/30 hover:shadow-lg hover:shadow-indigo-500/10 cursor-pointer',
          className
        )}
        {...props}
      >
        {children}
      </div>
    )
  }
)
Card.displayName = 'Card'

export const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, children, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-col gap-1.5 pb-4', className)} {...props}>
      {children}
    </div>
  )
)
CardHeader.displayName = 'CardHeader'

export const CardTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, children, ...props }, ref) => (
  <h3
    ref={ref}
    className={cn('text-base font-semibold text-slate-100 leading-tight', className)}
    {...props}
  >
    {children}
  </h3>
))
CardTitle.displayName = 'CardTitle'

export const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, children, ...props }, ref) => (
  <p ref={ref} className={cn('text-sm text-slate-400 leading-relaxed', className)} {...props}>
    {children}
  </p>
))
CardDescription.displayName = 'CardDescription'

export const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, children, ...props }, ref) => (
    <div ref={ref} className={cn('', className)} {...props}>
      {children}
    </div>
  )
)
CardContent.displayName = 'CardContent'

export const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('flex items-center justify-between pt-4 mt-4 border-t border-slate-700/50', className)}
      {...props}
    >
      {children}
    </div>
  )
)
CardFooter.displayName = 'CardFooter'

export interface CardBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  color?: 'indigo' | 'green' | 'yellow' | 'red' | 'blue' | 'purple' | 'cyan'
}

export const CardBadge = React.forwardRef<HTMLSpanElement, CardBadgeProps>(
  ({ color = 'indigo', className, children, ...props }, ref) => {
    const colorClasses = {
      indigo: 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30',
      green: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
      yellow: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
      red: 'bg-red-500/15 text-red-400 border-red-500/30',
      blue: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
      purple: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
      cyan: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
    }
    return (
      <span
        ref={ref}
        className={cn(
          'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border',
          colorClasses[color],
          className
        )}
        {...props}
      >
        {children}
      </span>
    )
  }
)
CardBadge.displayName = 'CardBadge'
