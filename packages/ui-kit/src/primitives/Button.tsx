import React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from '../cn';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary:
          'bg-[var(--interactive-primary)] text-[var(--text-on-accent)] hover:bg-[var(--interactive-primary-hover)] active:bg-[var(--interactive-primary-active)] shadow-sm',
        secondary:
          'bg-[var(--interactive-secondary)] text-[var(--text-primary)] border border-[var(--border-default)] hover:bg-[var(--interactive-secondary-hover)] hover:border-[var(--border-strong)]',
        ghost:
          'text-[var(--text-secondary)] hover:bg-[var(--interactive-ghost-hover)] hover:text-[var(--text-primary)]',
        danger:
          'bg-[var(--interactive-danger)] text-white hover:bg-[var(--interactive-danger-hover)] shadow-sm',
        link:
          'text-[var(--text-link)] underline-offset-4 hover:underline p-0 h-auto',
      },
      size: {
        sm:   'h-8 px-3 text-xs rounded-md',
        md:   'h-9 px-4 text-sm rounded-lg',
        lg:   'h-11 px-6 text-base rounded-xl',
        icon: 'h-9 w-9 rounded-lg',
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
        {...props}
      >
        {loading ? <Loader2 className="animate-spin" size={16} /> : leftIcon}
        {children}
        {!loading && rightIcon}
      </Comp>
    );
  },
);
Button.displayName = 'Button';

export { buttonVariants };
