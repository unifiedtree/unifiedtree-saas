import React, { createContext, useContext, useState, useCallback, useId } from 'react'
import { cn } from '../lib/cn'

type TabsVariant = 'underline' | 'pills' | 'cards'

interface TabsContextValue {
  activeTab: string
  setActiveTab: (id: string) => void
  variant: TabsVariant
  baseId: string
}

const TabsContext = createContext<TabsContextValue | null>(null)

const useTabsContext = () => {
  const ctx = useContext(TabsContext)
  if (!ctx) throw new Error('Tabs compound components must be used within Tabs')
  return ctx
}

// ─── Tabs ─────────────────────────────────────────────────────

export interface TabsProps extends React.HTMLAttributes<HTMLDivElement> {
  defaultValue?: string
  value?: string
  onValueChange?: (value: string) => void
  variant?: TabsVariant
}

export const Tabs: React.FC<TabsProps> = ({
  defaultValue = '',
  value,
  onValueChange,
  variant = 'underline',
  className,
  children,
  ...props
}) => {
  const [internalValue, setInternalValue] = useState(defaultValue)
  const activeTab = value ?? internalValue
  const baseId = useId()

  const setActiveTab = useCallback(
    (id: string) => {
      if (value === undefined) setInternalValue(id)
      onValueChange?.(id)
    },
    [value, onValueChange]
  )

  return (
    <TabsContext.Provider value={{ activeTab, setActiveTab, variant, baseId }}>
      <div className={cn('flex flex-col', className)} {...props}>
        {children}
      </div>
    </TabsContext.Provider>
  )
}

// ─── TabsList ─────────────────────────────────────────────────

export const TabsList = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, children, ...props }, ref) => {
    const { variant } = useTabsContext()

    return (
      <div
        ref={ref}
        role="tablist"
        className={cn(
          'flex items-center',
          variant === 'underline' && 'border-b border-slate-700/60 gap-0',
          variant === 'pills' && 'bg-slate-800/60 rounded-xl p-1 gap-1 w-fit',
          variant === 'cards' && 'gap-2',
          className
        )}
        {...props}
      >
        {children}
      </div>
    )
  }
)
TabsList.displayName = 'TabsList'

// ─── TabsTrigger ──────────────────────────────────────────────

export interface TabsTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  value: string
}

export const TabsTrigger = React.forwardRef<HTMLButtonElement, TabsTriggerProps>(
  ({ value, className, children, ...props }, ref) => {
    const { activeTab, setActiveTab, variant, baseId } = useTabsContext()
    const isActive = activeTab === value

    return (
      <button
        ref={ref}
        role="tab"
        id={`${baseId}-tab-${value}`}
        aria-controls={`${baseId}-panel-${value}`}
        aria-selected={isActive}
        tabIndex={isActive ? 0 : -1}
        onClick={() => setActiveTab(value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setActiveTab(value)
          }
        }}
        className={cn(
          'inline-flex items-center gap-2 text-sm font-medium transition-all duration-200 outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50',
          variant === 'underline' &&
            cn(
              'px-4 py-2.5 border-b-2 -mb-px',
              isActive
                ? 'border-indigo-500 text-indigo-400'
                : 'border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-600'
            ),
          variant === 'pills' &&
            cn(
              'px-4 py-2 rounded-lg',
              isActive
                ? 'bg-slate-700 text-slate-100 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/40'
            ),
          variant === 'cards' &&
            cn(
              'px-4 py-2.5 rounded-xl border',
              isActive
                ? 'bg-indigo-600/20 border-indigo-500/50 text-indigo-300'
                : 'bg-slate-800/60 border-slate-700/50 text-slate-400 hover:text-slate-200 hover:border-slate-600'
            ),
          className
        )}
        {...props}
      >
        {children}
      </button>
    )
  }
)
TabsTrigger.displayName = 'TabsTrigger'

// ─── TabsContent ──────────────────────────────────────────────

export interface TabsContentProps extends React.HTMLAttributes<HTMLDivElement> {
  value: string
}

export const TabsContent = React.forwardRef<HTMLDivElement, TabsContentProps>(
  ({ value, className, children, ...props }, ref) => {
    const { activeTab, baseId } = useTabsContext()
    const isActive = activeTab === value

    return (
      <div
        ref={ref}
        role="tabpanel"
        id={`${baseId}-panel-${value}`}
        aria-labelledby={`${baseId}-tab-${value}`}
        hidden={!isActive}
        className={cn('outline-none', isActive && 'animate-fade-in', className)}
        tabIndex={0}
        {...props}
      >
        {isActive ? children : null}
      </div>
    )
  }
)
TabsContent.displayName = 'TabsContent'
