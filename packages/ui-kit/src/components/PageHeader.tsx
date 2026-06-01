import React from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '../cn';

interface BreadcrumbItem {
  label: string;
  href?: string;
  onClick?: () => void;
}

interface PageHeaderProps {
  breadcrumbs?: BreadcrumbItem[];
  title: string;
  description?: string;
  actions?: React.ReactNode;
  meta?: React.ReactNode;
  className?: string;
}

export function PageHeader({
  breadcrumbs,
  title,
  description,
  actions,
  meta,
  className,
}: PageHeaderProps) {
  return (
    <div className={cn('mb-6 space-y-1', className)}>
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-xs text-[var(--text-tertiary)]">
          {breadcrumbs.map((crumb, i) => (
            <React.Fragment key={i}>
              {i > 0 && <ChevronRight size={12} className="flex-shrink-0" />}
              {crumb.href || crumb.onClick ? (
                <a
                  href={crumb.href}
                  onClick={crumb.onClick}
                  className="hover:text-[var(--text-primary)] transition-colors cursor-pointer"
                >
                  {crumb.label}
                </a>
              ) : (
                <span className={i === breadcrumbs.length - 1 ? 'text-[var(--text-primary)] font-medium' : ''}>
                  {crumb.label}
                </span>
              )}
            </React.Fragment>
          ))}
        </nav>
      )}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-[var(--text-primary)]">{title}</h1>
          {description && (
            <p className="mt-0.5 text-sm text-[var(--text-tertiary)]">{description}</p>
          )}
          {meta && <div className="mt-2">{meta}</div>}
        </div>
        {actions && <div className="flex flex-shrink-0 items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
