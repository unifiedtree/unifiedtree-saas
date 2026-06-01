import React from 'react';
import {
  Sparkles, FilterX, AlertTriangle, ShieldOff,
} from 'lucide-react';
import { cn } from '../cn';
import { Button } from '../primitives/Button';

type EmptyVariant = 'first-run' | 'filtered' | 'error' | 'forbidden';

const DEFAULTS: Record<EmptyVariant, {
  icon: React.ReactNode;
  title: string;
  description: string;
}> = {
  'first-run': {
    icon: <Sparkles className="text-[var(--accent-fg)]" size={36} />,
    title: 'Nothing here yet',
    description: "You're all set up. Add your first record to get started.",
  },
  filtered: {
    icon: <FilterX className="text-[var(--text-tertiary)]" size={36} />,
    title: 'No results found',
    description: 'Try adjusting your filters or search terms.',
  },
  error: {
    icon: <AlertTriangle className="text-[var(--status-error-fg)]" size={36} />,
    title: 'Something went wrong',
    description: 'An error occurred while loading this data. Please try again.',
  },
  forbidden: {
    icon: <ShieldOff className="text-[var(--text-tertiary)]" size={36} />,
    title: 'Access restricted',
    description: "You don't have permission to view this content.",
  },
};

interface EmptyStateAction {
  label: string;
  onClick: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
}

interface EmptyStateProps {
  variant?: EmptyVariant;
  icon?: React.ReactNode;
  title?: string;
  description?: string;
  primaryAction?: EmptyStateAction;
  secondaryAction?: EmptyStateAction;
  traceId?: string;
  className?: string;
}

export function EmptyState({
  variant = 'first-run',
  icon,
  title,
  description,
  primaryAction,
  secondaryAction,
  traceId,
  className,
}: EmptyStateProps) {
  const defaults = DEFAULTS[variant];

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-4 py-16 text-center',
        className,
      )}
    >
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--bg-subtle)]">
        {icon ?? defaults.icon}
      </div>
      <div className="max-w-sm">
        <p className="text-base font-semibold text-[var(--text-primary)]">
          {title ?? defaults.title}
        </p>
        <p className="mt-1 text-sm text-[var(--text-tertiary)]">
          {description ?? defaults.description}
        </p>
      </div>
      {(primaryAction || secondaryAction) && (
        <div className="flex gap-2">
          {primaryAction && (
            <Button variant={primaryAction.variant ?? 'primary'} size="sm" onClick={primaryAction.onClick}>
              {primaryAction.label}
            </Button>
          )}
          {secondaryAction && (
            <Button variant={secondaryAction.variant ?? 'secondary'} size="sm" onClick={secondaryAction.onClick}>
              {secondaryAction.label}
            </Button>
          )}
        </div>
      )}
      {traceId && (
        <p className="text-xs text-[var(--text-disabled)] font-mono">
          trace: {traceId}
        </p>
      )}
    </div>
  );
}
