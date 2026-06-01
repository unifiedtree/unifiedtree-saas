import React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../cn';

// ─── Badge ──────────────────────────────────────────────────────────────────
const badgeVariants = cva(
  'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors',
  {
    variants: {
      tone: {
        default:  'bg-[var(--bg-subtle)] text-[var(--text-secondary)]',
        success:  'bg-[var(--status-success-bg)] text-[var(--status-success-fg)]',
        warning:  'bg-[var(--status-warning-bg)] text-[var(--status-warning-fg)]',
        error:    'bg-[var(--status-error-bg)] text-[var(--status-error-fg)]',
        info:     'bg-[var(--status-info-bg)] text-[var(--status-info-fg)]',
        accent:   'bg-[var(--accent-bg)] text-[var(--accent-fg-strong)]',
      },
    },
    defaultVariants: { tone: 'default' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

// ─── Avatar ──────────────────────────────────────────────────────────────────
const avatarSizes = {
  xs: 'h-6 w-6 text-[10px]',
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-12 w-12 text-base',
  xl: 'h-16 w-16 text-lg',
};

interface AvatarProps extends React.HTMLAttributes<HTMLSpanElement> {
  src?: string;
  alt?: string;
  name?: string;
  size?: keyof typeof avatarSizes;
}

export function Avatar({ src, alt, name, size = 'md', className, ...props }: AvatarProps) {
  const initials = name
    ? name
        .split(' ')
        .map(w => w[0])
        .slice(0, 2)
        .join('')
        .toUpperCase()
    : '?';

  return (
    <span
      className={cn(
        'inline-flex flex-shrink-0 items-center justify-center rounded-full bg-[var(--accent-bg)] font-semibold text-[var(--accent-fg-strong)] overflow-hidden',
        avatarSizes[size],
        className,
      )}
      {...props}
    >
      {src ? (
        <img src={src} alt={alt ?? name} className="h-full w-full object-cover" />
      ) : (
        initials
      )}
    </span>
  );
}

// ─── Card ────────────────────────────────────────────────────────────────────
export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] shadow-xs',
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-1 p-6 pb-4', className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn('text-base font-semibold leading-none tracking-tight text-[var(--text-primary)]', className)}
      {...props}
    />
  );
}

export function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-sm text-[var(--text-tertiary)]', className)} {...props} />;
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-6 pt-0', className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('flex items-center p-6 pt-0', className)} {...props} />
  );
}

// ─── Separator ───────────────────────────────────────────────────────────────
interface SeparatorProps extends React.HTMLAttributes<HTMLHRElement> {
  orientation?: 'horizontal' | 'vertical';
}

export function Separator({ orientation = 'horizontal', className, ...props }: SeparatorProps) {
  return (
    <hr
      role="separator"
      aria-orientation={orientation}
      className={cn(
        'border-[var(--border-default)]',
        orientation === 'horizontal' ? 'w-full border-t' : 'h-full border-l',
        className,
      )}
      {...props}
    />
  );
}
