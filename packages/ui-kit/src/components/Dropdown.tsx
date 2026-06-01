import React, { useState, useRef, useCallback, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '../lib/cn'

export interface DropdownItem {
  label?: string
  icon?: React.ReactNode
  shortcut?: string
  destructive?: boolean
  divider?: boolean
  disabled?: boolean
  onClick?: () => void
}

export interface DropdownProps {
  trigger: React.ReactNode
  items: DropdownItem[]
  align?: 'left' | 'right'
  className?: string
}

export const Dropdown: React.FC<DropdownProps> = ({
  trigger,
  items,
  align = 'left',
  className,
}) => {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const triggerRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [focused, setFocused] = useState(-1)

  const close = useCallback(() => {
    setOpen(false)
    setFocused(-1)
  }, [])

  const updatePosition = useCallback(() => {
    const el = triggerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const menuEl = menuRef.current
    const menuWidth = menuEl?.offsetWidth ?? 192
    let left = align === 'right' ? rect.right - menuWidth : rect.left
    // Keep within viewport
    left = Math.max(8, Math.min(left, window.innerWidth - menuWidth - 8))
    setPosition({ top: rect.bottom + 6, left })
  }, [align])

  const toggle = useCallback(() => {
    if (!open) updatePosition()
    setOpen((v) => !v)
  }, [open, updatePosition])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (
        !triggerRef.current?.contains(e.target as Node) &&
        !menuRef.current?.contains(e.target as Node)
      ) {
        close()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open, close])

  // Close on Escape; keyboard nav
  useEffect(() => {
    if (!open) return
    const navigable = items.filter((it) => !it.divider && !it.disabled)
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { close(); return }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setFocused((f) => Math.min(f + 1, navigable.length - 1))
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setFocused((f) => Math.max(f - 1, 0))
      }
      if (e.key === 'Enter' && focused >= 0) {
        navigable[focused]?.onClick?.()
        close()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, items, focused, close])

  const menu = open ? (
    <div
      ref={menuRef}
      className={cn(
        'fixed z-[9998] min-w-48 rounded-xl bg-slate-900 border border-slate-700/60 shadow-2xl shadow-black/50 py-1.5',
        'animate-fade-in',
        className
      )}
      style={{ top: position.top, left: position.left }}
      role="menu"
    >
      {items.map((item, i) => {
        if (item.divider) {
          return <div key={i} className="my-1 h-px bg-slate-700/50" role="separator" />
        }
        return (
          <button
            key={i}
            role="menuitem"
            disabled={item.disabled}
            className={cn(
              'flex w-full items-center gap-2.5 px-3.5 py-2 text-sm transition-colors text-left',
              item.destructive
                ? 'text-red-400 hover:bg-red-500/10 hover:text-red-300'
                : 'text-slate-300 hover:bg-slate-800 hover:text-slate-100',
              item.disabled && 'opacity-40 cursor-not-allowed',
              focused === i && 'bg-slate-800'
            )}
            onClick={() => {
              if (!item.disabled) {
                item.onClick?.()
                close()
              }
            }}
          >
            {item.icon && (
              <span className={cn('shrink-0', item.destructive ? 'text-red-400' : 'text-slate-400')}>
                {item.icon}
              </span>
            )}
            <span className="flex-1">{item.label}</span>
            {item.shortcut && (
              <kbd className="ml-auto text-xs text-slate-500 font-mono">{item.shortcut}</kbd>
            )}
          </button>
        )
      })}
    </div>
  ) : null

  return (
    <>
      <div ref={triggerRef} onClick={toggle} className="inline-flex cursor-pointer">
        {trigger}
      </div>
      {typeof document !== 'undefined' && menu ? createPortal(menu, document.body) : menu}
    </>
  )
}
