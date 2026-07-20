import React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../cn';

// ─── Badge ──────────────────────────────────────────────────────────────────
const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full font-medium whitespace-nowrap transition-colors',
  {
    variants: {
      tone: {
        default:  'bg-[var(--bg-subtle)] text-[var(--text-secondary)] ring-1 ring-inset ring-[var(--border-default)]',
        neutral:  'bg-[var(--bg-subtle)] text-[var(--text-secondary)] ring-1 ring-inset ring-[var(--border-default)]',
        success:  'bg-[var(--status-success-bg)] text-[var(--status-success-fg)] ring-1 ring-inset ring-[var(--status-success-border)]',
        warning:  'bg-[var(--status-warning-bg)] text-[var(--status-warning-fg)] ring-1 ring-inset ring-[var(--status-warning-border)]',
        error:    'bg-[var(--status-error-bg)] text-[var(--status-error-fg)] ring-1 ring-inset ring-[var(--status-error-border)]',
        info:     'bg-[var(--status-info-bg)] text-[var(--status-info-fg)] ring-1 ring-inset ring-[var(--status-info-border)]',
        accent:   'bg-[var(--accent-bg)] text-[var(--accent-fg-strong)] ring-1 ring-inset ring-[var(--accent-border)]',
        solid:    'bg-[var(--accent-solid)] text-[var(--text-on-accent)]',
      },
      size: {
        sm: 'px-2 py-0.5 text-2xs',
        md: 'px-2.5 py-0.5 text-xs',
      },
    },
    defaultVariants: { tone: 'default', size: 'md' },
  },
);

const dotColor: Record<string, string> = {
  default: 'bg-[var(--text-tertiary)]',
  neutral: 'bg-[var(--text-tertiary)]',
  success: 'bg-[var(--status-success-solid)]',
  warning: 'bg-[var(--status-warning-solid)]',
  error:   'bg-[var(--status-error-solid)]',
  info:    'bg-[var(--status-info-solid)]',
  accent:  'bg-[var(--accent-solid)]',
  solid:   'bg-white',
};

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  dot?: boolean;
}

export function Badge({ className, tone, size, dot, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ tone, size }), className)} {...props}>
      {dot && <span className={cn('h-1.5 w-1.5 rounded-full', dotColor[tone ?? 'default'])} aria-hidden />}
      {children}
    </span>
  );
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
  ring?: boolean;
}

export function Avatar({ src, alt, name, size = 'md', ring, className, ...props }: AvatarProps) {
  const initials = name
    ? name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
    : '?';

  return (
    <span
      className={cn(
        'inline-flex flex-shrink-0 items-center justify-center rounded-full overflow-hidden font-semibold',
        'bg-[var(--accent-bg)] text-[var(--accent-fg-strong)]',
        ring && 'ring-2 ring-[var(--bg-surface)] shadow-sm',
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
interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  interactive?: boolean;
}

export function Card({ className, interactive, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] shadow-sm',
        interactive && 'card-interactive cursor-pointer',
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-1 p-5 pb-3', className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn('text-md font-semibold leading-tight tracking-tight text-[var(--text-primary)]', className)}
      {...props}
    />
  );
}

export function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-sm text-[var(--text-tertiary)]', className)} {...props} />;
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-5 pt-0', className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('flex items-center gap-2 border-t border-[var(--border-subtle)] p-5', className)} {...props} />
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
