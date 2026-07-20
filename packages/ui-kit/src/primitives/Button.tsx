import React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from '../cn';

const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium select-none',
    'transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)]',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-surface)]',
    'active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50',
    '[&_svg]:shrink-0',
  ].join(' '),
  {
    variants: {
      variant: {
        primary:
          'bg-[var(--interactive-primary)] text-[var(--text-on-accent)] shadow-sm hover:bg-[var(--interactive-primary-hover)] active:bg-[var(--interactive-primary-active)]',
        secondary:
          'bg-[var(--interactive-secondary)] text-[var(--text-primary)] border border-[var(--border-default)] shadow-xs hover:bg-[var(--interactive-secondary-hover)] hover:border-[var(--border-strong)]',
        outline:
          'bg-transparent text-[var(--text-primary)] border border-[var(--border-default)] hover:bg-[var(--bg-subtle)] hover:border-[var(--border-strong)]',
        ghost:
          'bg-transparent text-[var(--text-secondary)] hover:bg-[var(--interactive-ghost-hover)] hover:text-[var(--text-primary)]',
        danger:
          'bg-[var(--interactive-danger)] text-white shadow-sm hover:bg-[var(--interactive-danger-hover)]',
        'danger-ghost':
          'bg-transparent text-[var(--status-error-fg)] hover:bg-[var(--status-error-bg)]',
        link:
          'text-[var(--text-link)] underline-offset-4 hover:underline p-0 h-auto active:scale-100 shadow-none',
      },
      size: {
        xs:   'h-7 px-2.5 text-xs rounded-md [&_svg]:size-3.5',
        sm:   'h-8 px-3 text-xs rounded-lg [&_svg]:size-4',
        md:   'h-9 px-4 text-sm rounded-lg [&_svg]:size-4',
        lg:   'h-11 px-6 text-md rounded-xl [&_svg]:size-[18px]',
        icon: 'h-9 w-9 rounded-lg [&_svg]:size-[18px]',
        'icon-sm': 'h-8 w-8 rounded-lg [&_svg]:size-4',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading, leftIcon, rightIcon, children, disabled, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading ? <Loader2 className="animate-spin" size={16} aria-hidden /> : leftIcon}
        {children}
        {!loading && rightIcon}
      </Comp>
    );
  },
);
Button.displayName = 'Button';

export { buttonVariants };
