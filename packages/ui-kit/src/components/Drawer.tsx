import React, { useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '../lib/cn'
import { X } from 'lucide-react'

type DrawerPosition = 'left' | 'right' | 'top' | 'bottom'
type DrawerSize = 'sm' | 'md' | 'lg' | 'xl'

const positionClasses: Record<DrawerPosition, { panel: string; enter: string; leave: string }> = {
  right: {
    panel: 'inset-y-0 right-0 h-full',
    enter: 'translate-x-0',
    leave: 'translate-x-full',
  },
  left: {
    panel: 'inset-y-0 left-0 h-full',
    enter: 'translate-x-0',
    leave: '-translate-x-full',
  },
  top: {
    panel: 'inset-x-0 top-0 w-full',
    enter: 'translate-y-0',
    leave: '-translate-y-full',
  },
  bottom: {
    panel: 'inset-x-0 bottom-0 w-full',
    enter: 'translate-y-0',
    leave: 'translate-y-full',
  },
}

const sizeClasses: Record<DrawerPosition, Record<DrawerSize, string>> = {
  right: { sm: 'w-80', md: 'w-96', lg: 'w-[480px]', xl: 'w-[640px]' },
  left: { sm: 'w-80', md: 'w-96', lg: 'w-[480px]', xl: 'w-[640px]' },
  top: { sm: 'h-48', md: 'h-64', lg: 'h-80', xl: 'h-96' },
  bottom: { sm: 'h-48', md: 'h-64', lg: 'h-80', xl: 'h-96' },
}

export interface DrawerProps {
  isOpen: boolean
  onClose: () => void
  position?: DrawerPosition
  size?: DrawerSize
  title?: string
  description?: string
  children?: React.ReactNode
  className?: string
}

export const Drawer: React.FC<DrawerProps> = ({
  isOpen,
  onClose,
  position = 'right',
  size = 'md',
  title,
  description,
  children,
  className,
}) => {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) onClose()
    },
    [isOpen, onClose]
  )

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  useEffect(() => {
    document.body.style.overflow = isOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [isOpen])

  if (!isOpen) return null

  const pos = positionClasses[position]
  const isHorizontal = position === 'left' || position === 'right'

  const content = (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className={cn(
          'absolute flex flex-col bg-slate-900 border-slate-700/60 shadow-2xl',
          'transition-transform duration-300 ease-out',
          pos.panel,
          isHorizontal
            ? [sizeClasses[position][size], 'border-l']
            : [sizeClasses[position][size], 'border-t'],
          pos.enter,
          className
        )}
      >
        {(title || description) && (
          <DrawerHeader>
            <div className="flex-1 min-w-0">
              {title && <h2 className="text-lg font-semibold text-slate-100">{title}</h2>}
              {description && <p className="text-sm text-slate-400 mt-1">{description}</p>}
            </div>
            <button
              onClick={onClose}
              className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
              aria-label="Close drawer"
            >
              <X size={18} />
            </button>
          </DrawerHeader>
        )}
        {children}
      </div>
    </div>
  )

  return typeof document !== 'undefined' ? createPortal(content, document.body) : null
}

export const DrawerHeader: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  className,
  children,
  ...props
}) => (
  <div
    className={cn('flex items-start gap-3 px-6 py-5 border-b border-slate-700/50 shrink-0', className)}
    {...props}
  >
    {children}
  </div>
)

export const DrawerBody: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  className,
  children,
  ...props
}) => (
  <div className={cn('flex-1 overflow-y-auto px-6 py-5', className)} {...props}>
    {children}
  </div>
)

export const DrawerFooter: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  className,
  children,
  ...props
}) => (
  <div
    className={cn(
      'flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-700/50 shrink-0',
      className
    )}
    {...props}
  >
    {children}
  </div>
)
