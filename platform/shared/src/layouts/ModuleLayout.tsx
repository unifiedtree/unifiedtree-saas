import React from 'react'
import { Outlet, useLocation, Link } from 'react-router-dom'

interface BreadcrumbItem {
  label: string
  path?: string
}

interface ModuleLayoutProps {
  moduleKey: string
  moduleName: string
  moduleIcon: React.ReactNode
  children?: React.ReactNode
  breadcrumbs?: BreadcrumbItem[]
}

export function ModuleLayout({
  moduleName,
  moduleIcon,
  children,
  breadcrumbs,
}: ModuleLayoutProps) {
  const location = useLocation()

  // Auto-generate breadcrumbs from path if not provided
  const autoBreadcrumbs: BreadcrumbItem[] = breadcrumbs ?? location.pathname
    .split('/')
    .filter(Boolean)
    .map((segment, index, arr) => ({
      label: segment.charAt(0).toUpperCase() + segment.slice(1).replace(/-/g, ' '),
      path: index < arr.length - 1 ? '/' + arr.slice(0, index + 1).join('/') : undefined,
    }))

  return (
    <div className="flex flex-col h-full">
      {/* Module sub-header */}
      <div className="flex-shrink-0 bg-[#0D1117] border-b border-white/[0.06] px-6 py-3">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-indigo-400">{moduleIcon}</span>
            <span className="text-white font-semibold text-sm">{moduleName}</span>
          </div>
          {autoBreadcrumbs.length > 0 && (
            <>
              <span className="text-slate-700">/</span>
              <nav className="flex items-center gap-2">
                {autoBreadcrumbs.map((crumb, i) => (
                  <React.Fragment key={i}>
                    {i > 0 && <span className="text-slate-700 text-xs">/</span>}
                    {crumb.path ? (
                      <Link
                        to={crumb.path}
                        className="text-slate-400 hover:text-white text-xs transition-colors"
                      >
                        {crumb.label}
                      </Link>
                    ) : (
                      <span className="text-slate-300 text-xs">{crumb.label}</span>
                    )}
                  </React.Fragment>
                ))}
              </nav>
            </>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {children ?? <Outlet />}
      </div>
    </div>
  )
}
