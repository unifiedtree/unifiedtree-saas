import React, { useState, useRef, useCallback, useEffect } from 'react'
import { cn } from '../lib/cn'

type TooltipSide = 'top' | 'right' | 'bottom' | 'left'

export interface TooltipProps {
  content: React.ReactNode
  side?: TooltipSide
  delay?: number
  children: React.ReactElement
  className?: string
}

const sideClasses: Record<TooltipSide, { tooltip: string; arrow: string }> = {
  top: {
    tooltip: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
    arrow: 'top-full left-1/2 -translate-x-1/2 border-l-transparent border-r-transparent border-b-transparent border-t-slate-700',
  },
  bottom: {
    tooltip: 'top-full left-1/2 -translate-x-1/2 mt-2',
    arrow: 'bottom-full left-1/2 -translate-x-1/2 border-l-transparent border-r-transparent border-t-transparent border-b-slate-700',
  },
  left: {
    tooltip: 'right-full top-1/2 -translate-y-1/2 mr-2',
    arrow: 'left-full top-1/2 -translate-y-1/2 border-t-transparent border-b-transparent border-r-transparent border-l-slate-700',
  },
  right: {
    tooltip: 'left-full top-1/2 -translate-y-1/2 ml-2',
    arrow: 'right-full top-1/2 -translate-y-1/2 border-t-transparent border-b-transparent border-l-transparent border-r-slate-700',
  },
}

export const Tooltip: React.FC<TooltipProps> = ({
  content,
  side = 'top',
  delay = 500,
  children,
  className,
}) => {
  const [visible, setVisible] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const show = useCallback(() => {
    timerRef.current = setTimeout(() => setVisible(true), delay)
  }, [delay])

  const hide = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setVisible(false)
  }, [])

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])

  const { tooltip, arrow } = sideClasses[side]

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {visible && content && (
        <span
          role="tooltip"
          className={cn(
            'pointer-events-none absolute z-50 px-2.5 py-1.5 rounded-lg',
            'bg-slate-800 border border-slate-700 text-xs text-slate-200 whitespace-nowrap shadow-xl',
            'animate-fade-in',
            tooltip,
            className
          )}
        >
          {content}
          <span
            className={cn('absolute w-0 h-0 border-4', arrow)}
            aria-hidden="true"
          />
        </span>
      )}
    </span>
  )
}
