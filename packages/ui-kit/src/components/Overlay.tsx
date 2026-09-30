import React, { useCallback } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { cn } from '../cn';

// The HRMS redesign's pop-up look (design README "Popups"), in the design's tokens with their
// light defaults: dialogs 12px radius with the popover shadow, side panels square with a 1px
// left border, and one backdrop — a soft gradient with a light blur. The blur sits on the
// backdrop, a SIBLING of the content, never on the content itself: backdrop-filter makes an
// element the containing block for fixed descendants (that broke 14 drawers on 23 Aug).
const BACKDROP: React.CSSProperties = {
  background: 'linear-gradient(270deg, rgba(14,27,22,.38), rgba(14,27,22,.2))',
  backdropFilter: 'blur(4px) saturate(.85)',
  WebkitBackdropFilter: 'blur(4px) saturate(.85)',
};
const SURFACE: React.CSSProperties = {
  background: 'var(--u-sf, #fff)',
  color: 'var(--u-ink, #0E1B16)',
  borderColor: 'var(--u-ln, #E3E9E6)',
  fontFamily: "var(--u-font, 'Plus Jakarta Sans', system-ui, sans-serif)",
};
const EASE: [number, number, number, number] = [0.2, 0.8, 0.2, 1];
const CLOSE_BTN =
  'flex shrink-0 items-center justify-center rounded-full bg-[var(--u-hv,#F0F4F2)] text-[var(--u-ink2,#4A5A54)] transition-colors ' +
  'hover:bg-[var(--u-ln,#E3E9E6)] hover:text-[var(--u-ink,#0E1B16)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--u-br,#0F6E56)]';

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
                className="fixed inset-0 z-[var(--z-modal-backdrop)]"
                style={BACKDROP}
              />
            </Dialog.Overlay>
            <Dialog.Content
              onInteractOutside={handleInteractOutside}
              asChild
            >
              {/*
                CENTRING LIVES IN framer-motion's x/y, NOT in Tailwind.

                This used to be `-translate-x-1/2 -translate-y-1/2` in the
                className with `animate={{ y: 0 }}` on the motion props. Motion
                writes its animated values into an INLINE `transform`, which
                wins over the utility classes — so the resting transform became
                effectively `none` and the panel's TOP-LEFT CORNER pinned to the
                viewport centre instead of the panel being centred on it.

                At 1280x720 the Invite-user modal measured x=640 y=360 h=676:
                316px hung below the fold, and because it is `position: fixed`
                it could not be scrolled to. The role pickers and the Send-invite
                button were physically unreachable — an admin could not invite
                anyone (QA 2026-08-30, P0-4). Five modals share this component.

                Expressing the -50%/-50% as motion values means they compose
                into the same inline transform as scale/opacity instead of
                fighting it. The 8px entry offset is folded into the y calc so
                the slide-up feel is unchanged.

                max-h + overflow-y-auto is the belt-and-braces half: a panel
                taller than the viewport now scrolls internally rather than
                putting its footer out of reach.
              */}
              <motion.div
                initial={{ opacity: 0, scale: 0.98, x: '-50%', y: 'calc(-50% - 6px)' }}
                animate={{ opacity: 1, scale: 1, x: '-50%', y: '-50%' }}
                exit={{ opacity: 0, scale: 0.98, x: '-50%', y: 'calc(-50% - 6px)' }}
                transition={{ duration: 0.26, ease: EASE }}
                style={{ ...SURFACE, boxShadow: 'var(--u-shp, 0 24px 60px -20px rgba(14,27,22,.35))' }}
                className={cn(
                  'fixed left-1/2 top-1/2 z-[var(--z-modal)] w-full',
                  'max-h-[calc(100vh-2rem)] overflow-y-auto',
                  'rounded-[12px] border p-6',
                  modalSizes[size],
                  className,
                )}
              >
                {/* Title + Description always render (sr-only when absent) so
                    Radix never warns about a missing accessible name/description. */}
                <div className={cn(title || description ? 'mb-4 pr-10' : '')}>
                  <Dialog.Title className={cn('text-[18px] font-medium leading-6 tracking-[-0.01em]', !title && 'sr-only')}>
                    {title ?? 'Dialog'}
                  </Dialog.Title>
                  <Dialog.Description className={cn('mt-1 text-[13.5px] leading-[1.5] text-[var(--u-ink2,#4A5A54)]', !description && 'sr-only')}>
                    {description ?? title ?? 'Dialog content'}
                  </Dialog.Description>
                </div>
                {children}
                <Dialog.Close className={cn('absolute right-4 top-4 h-[34px] w-[34px]', CLOSE_BTN)}>
                  <X size={17} aria-hidden="true" />
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
                className="fixed inset-0 z-[var(--z-modal-backdrop)]"
                style={BACKDROP}
                onClick={() => onOpenChange(false)}
              />
            </Dialog.Overlay>
            <Dialog.Content asChild>
              <motion.div
                initial={{ x: 24, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: 24, opacity: 0 }}
                transition={{ duration: 0.26, ease: EASE }}
                style={{ ...SURFACE, boxShadow: '-30px 0 70px -30px rgba(14,27,22,.45)' }}
                className={cn(
                  'fixed right-0 top-0 z-[var(--z-modal)] flex h-full w-full max-w-md flex-col',
                  'rounded-none border-l',
                  className,
                )}
              >
                <div className="flex shrink-0 items-start justify-between gap-3 px-6 pb-4 pt-[22px] shadow-[inset_0_-1px_0_var(--u-ln2,#EDF1EF)]">
                  <Dialog.Title className={cn('m-0 text-[20px] font-medium leading-[26px] tracking-[-0.01em]', !title && 'sr-only')}>
                    {title ?? 'Panel'}
                  </Dialog.Title>
                  <Dialog.Description className="sr-only">{title ?? 'Panel content'}</Dialog.Description>
                  <Dialog.Close className={cn('h-[38px] w-[38px]', CLOSE_BTN)}>
                    <X size={18} />
                    <span className="sr-only">Close</span>
                  </Dialog.Close>
                </div>
                <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
