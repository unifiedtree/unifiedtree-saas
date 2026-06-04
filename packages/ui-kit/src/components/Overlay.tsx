import React, { useCallback } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { cn } from '../cn';

// ─── Modal ───────────────────────────────────────────────────────────────────
type ModalSize = 'sm' | 'md' | 'lg' | 'xl';

const modalSizes: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
};

interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description?: string;
  size?: ModalSize;
  preventOutsideClose?: boolean;
  children: React.ReactNode;
  className?: string;
}

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  size = 'md',
  preventOutsideClose = false,
  children,
  className,
}: ModalProps) {
  const handleInteractOutside = useCallback(
    (e: Event) => {
      if (preventOutsideClose) e.preventDefault();
    },
    [preventOutsideClose],
  );

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="fixed inset-0 z-[var(--z-modal-backdrop)] bg-black/40 backdrop-blur-sm"
              />
            </Dialog.Overlay>
            <Dialog.Content
              onInteractOutside={handleInteractOutside}
              asChild
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.96, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: 8 }}
                transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                className={cn(
                  'fixed left-1/2 top-1/2 z-[var(--z-modal)] w-full -translate-x-1/2 -translate-y-1/2',
                  'rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-6 shadow-xl',
                  modalSizes[size],
                  className,
                )}
              >
                {/* Title + Description always render (sr-only when absent) so
                    Radix never warns about a missing accessible name/description. */}
                <div className={cn(title || description ? 'mb-4' : '')}>
                  <Dialog.Title className={cn('text-base font-semibold text-[var(--text-primary)]', !title && 'sr-only')}>
                    {title ?? 'Dialog'}
                  </Dialog.Title>
                  <Dialog.Description className={cn('mt-1 text-sm text-[var(--text-tertiary)]', !description && 'sr-only')}>
                    {description ?? title ?? 'Dialog content'}
                  </Dialog.Description>
                </div>
                {children}
                <Dialog.Close className="absolute right-4 top-4 rounded-md p-1 text-[var(--text-tertiary)] hover:bg-[var(--interactive-ghost-hover)] hover:text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--border-focus)]">
                  <X size={16} aria-hidden="true" />
                  <span className="sr-only">Close</span>
                </Dialog.Close>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}

// ─── Drawer ──────────────────────────────────────────────────────────────────
interface DrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  children: React.ReactNode;
  className?: string;
}

export function Drawer({ open, onOpenChange, title, children, className }: DrawerProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="fixed inset-0 z-[var(--z-modal-backdrop)] bg-black/30"
                onClick={() => onOpenChange(false)}
              />
            </Dialog.Overlay>
            <Dialog.Content asChild>
              <motion.div
                initial={{ x: '100%' }}
                animate={{ x: 0 }}
                exit={{ x: '100%' }}
                transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                className={cn(
                  'fixed right-0 top-0 z-[var(--z-modal)] flex h-full w-full max-w-md flex-col',
                  'border-l border-[var(--border-default)] bg-[var(--bg-surface)] shadow-xl',
                  className,
                )}
              >
                <div className="flex items-center justify-between border-b border-[var(--border-default)] px-6 py-4">
                  <Dialog.Title className={cn('text-base font-semibold text-[var(--text-primary)]', !title && 'sr-only')}>
                    {title ?? 'Panel'}
                  </Dialog.Title>
                  <Dialog.Description className="sr-only">{title ?? 'Panel content'}</Dialog.Description>
                  <Dialog.Close className="rounded-md p-1 text-[var(--text-tertiary)] hover:bg-[var(--interactive-ghost-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--border-focus)]">
                    <X size={16} />
                    <span className="sr-only">Close</span>
                  </Dialog.Close>
                </div>
                <div className="flex-1 overflow-y-auto p-6">{children}</div>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
