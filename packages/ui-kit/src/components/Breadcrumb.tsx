import React from 'react'
import { cn } from '../lib/cn'
import { ChevronRight, Home } from 'lucide-react'

export interface BreadcrumbItem {
  label: string
  href?: string
  icon?: React.ReactNode
}

export interface BreadcrumbProps extends React.HTMLAttributes<HTMLElement> {
  items: BreadcrumbItem[]
  showHome?: boolean
  maxItems?: number
  separator?: React.ReactNode
}

export const Breadcrumb: React.FC<BreadcrumbProps> = ({
  items,
  showHome = false,
  maxItems = 4,
  separator,
  className,
  ...props
}) => {
  const allItems: BreadcrumbItem[] = [
    ...(showHome ? [{ label: 'Home', href: '/', icon: <Home size={14} /> }] : []),
    ...items,
  ]

  // Truncate: show first, ellipsis, last N-1 items
  const shouldTruncate = allItems.length > maxItems
  const displayItems: (BreadcrumbItem | null)[] = shouldTruncate
    ? [allItems[0], null, ...allItems.slice(allItems.length - (maxItems - 2))]
    : allItems

  const sep = separator ?? <ChevronRight size={14} className="text-slate-600 shrink-0" />

  return (
    <nav aria-label="Breadcrumb" className={cn('flex items-center', className)} {...props}>
      <ol className="flex items-center gap-1 flex-wrap">
        {displayItems.map((item, i) => {
          const isLast = i === displayItems.length - 1

          if (item === null) {
            return (
              <React.Fragment key="ellipsis">
                <li className="flex items-center">{sep}</li>
                <li>
                  <span className="px-1 text-sm text-slate-500">…</span>
                </li>
              </React.Fragment>
            )
          }

          return (
            <React.Fragment key={i}>
              {i > 0 && <li className="flex items-center">{sep}</li>}
              <li>
                {isLast || !item.href ? (
                  <span
                    className={cn(
                      'flex items-center gap-1.5 text-sm',
                      isLast
                        ? 'text-slate-200 font-medium'
                        : 'text-slate-400 hover:text-slate-200 transition-colors'
                    )}
                    aria-current={isLast ? 'page' : undefined}
                  >
                    {item.icon}
                    {item.label}
                  </span>
                ) : (
                  <a
                    href={item.href}
                    className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200 transition-colors"
                  >
                    {item.icon}
                    {item.label}
                  </a>
                )}
              </li>
            </React.Fragment>
          )
        })}
      </ol>
    </nav>
  )
}
