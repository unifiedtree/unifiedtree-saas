import React, { useId } from 'react';
import { cn } from '../cn';

// ─── Label ──────────────────────────────────────────────────────────────────
interface LabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  required?: boolean;
}

export const Label = React.forwardRef<HTMLLabelElement, LabelProps>(
  ({ className, required, children, ...props }, ref) => (
    <label
      ref={ref}
      className={cn('block text-[13px] font-medium text-[var(--text-secondary)]', className)}
      {...props}
    >
      {children}
      {required && (
        <span className="ml-0.5 text-[var(--status-error-fg)]" aria-hidden="true">*</span>
      )}
    </label>
  ),
);
Label.displayName = 'Label';

// ─── Input ──────────────────────────────────────────────────────────────────
export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  leftElement?: React.ReactNode;
  rightElement?: React.ReactNode;
}

const inputBase = [
  'h-10 w-full rounded-lg border bg-[var(--bg-surface)] px-3 text-sm text-[var(--text-primary)]',
  'placeholder:text-[var(--text-tertiary)] transition-[border-color,box-shadow] duration-150',
  'border-[var(--border-default)] shadow-xs outline-none',
  'focus:border-[var(--border-focus)] focus:ring-4 focus:ring-[var(--accent-solid)]/12',
  'disabled:cursor-not-allowed disabled:opacity-60 disabled:bg-[var(--bg-subtle)]',
  'read-only:bg-[var(--bg-subtle)]',
].join(' ');

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, invalid, leftElement, rightElement, ...props }, ref) => (
    <div className="relative flex items-center">
      {leftElement && (
        <div className="pointer-events-none absolute left-3 flex items-center text-[var(--text-tertiary)]">
          {leftElement}
        </div>
      )}
      <input
        ref={ref}
        className={cn(
          inputBase,
          invalid &&
            'border-[var(--status-error-border)] focus:border-[var(--status-error-fg)] focus:ring-[var(--status-error-fg)]/12',
          leftElement && 'pl-9',
          rightElement && 'pr-9',
          className,
        )}
        aria-invalid={invalid}
        {...props}
      />
      {rightElement && (
        <div className="absolute right-3 flex items-center text-[var(--text-tertiary)]">
          {rightElement}
        </div>
      )}
    </div>
  ),
);
Input.displayName = 'Input';

// ─── Field wrapper ──────────────────────────────────────────────────────────
interface FieldProps {
  label?: string;
  required?: boolean;
  hint?: string;
  error?: string;
  children: React.ReactElement;
  className?: string;
}

export function Field({ label, required, hint, error, children, className }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  const child = React.cloneElement(children, {
    id,
    'aria-describedby': describedBy,
    'aria-invalid': error ? true : undefined,
    invalid: error ? true : undefined,
    ...children.props,
  } as React.HTMLAttributes<HTMLElement>);

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label && (
        <Label htmlFor={id} required={required}>
          {label}
        </Label>
      )}
      {child}
      {hint && !error && (
        <p id={hintId} className="text-xs text-[var(--text-tertiary)]">{hint}</p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-xs font-medium text-[var(--status-error-fg)]">{error}</p>
      )}
    </div>
  );
}
