/** @type {import('tailwindcss').Config} */
/* ============================================================
 * UnifiedTree Design System — Tailwind Preset
 * Consumed by apps via `presets: [require('.../tailwind-preset.cjs')]`.
 * Everything here is token-backed (CSS custom properties) so a single
 * edit to tokens.css re-themes every utility across every app.
 * ========================================================== */
module.exports = {
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        /* Semantic surface colors */
        'bg-base':             'var(--bg-base)',
        'bg-surface':          'var(--bg-surface)',
        'bg-surface-raised':   'var(--bg-surface-raised)',
        'bg-subtle':           'var(--bg-subtle)',
        'bg-inset':            'var(--bg-inset)',
        'bg-muted':            'var(--bg-muted)',
        'bg-hover':            'var(--bg-hover)',
        /* Accent */
        'accent-bg':           'var(--accent-bg)',
        'accent-bg-strong':    'var(--accent-bg-strong)',
        'accent-fg':           'var(--accent-fg)',
        'accent-fg-strong':    'var(--accent-fg-strong)',
        'accent-border':       'var(--accent-border)',
        'accent-solid':        'var(--accent-solid)',
        /* Text */
        'text-primary':        'var(--text-primary)',
        'text-secondary':      'var(--text-secondary)',
        'text-tertiary':       'var(--text-tertiary)',
        'text-disabled':       'var(--text-disabled)',
        'text-inverse':        'var(--text-inverse)',
        'text-link':           'var(--text-link)',
        /* Border */
        'border-default':      'var(--border-default)',
        'border-strong':       'var(--border-strong)',
        'border-subtle':       'var(--border-subtle)',
        'border-focus':        'var(--border-focus)',
        /* Interactive */
        'interactive-primary':   'var(--interactive-primary)',
        'interactive-danger':    'var(--interactive-danger)',
        /* Status */
        'status-success':  'var(--status-success-fg)',
        'status-warning':  'var(--status-warning-fg)',
        'status-error':    'var(--status-error-fg)',
        'status-info':     'var(--status-info-fg)',
        /* Chart */
        'chart-1': 'var(--chart-1)',
        'chart-2': 'var(--chart-2)',
        'chart-3': 'var(--chart-3)',
        'chart-4': 'var(--chart-4)',
        'chart-5': 'var(--chart-5)',
        'chart-6': 'var(--chart-6)',
      },
      backgroundColor: {
        'surface':          'var(--bg-surface)',
        'surface-raised':   'var(--bg-surface-raised)',
        'subtle':           'var(--bg-subtle)',
        'inset':            'var(--bg-inset)',
        'hover':            'var(--bg-hover)',
        'accent':           'var(--accent-bg)',
        'accent-strong':    'var(--accent-bg-strong)',
        'accent-solid':     'var(--accent-solid)',
        'success':          'var(--status-success-bg)',
        'warning':          'var(--status-warning-bg)',
        'error':            'var(--status-error-bg)',
        'info':             'var(--status-info-bg)',
      },
      textColor: {
        'primary':          'var(--text-primary)',
        'secondary':        'var(--text-secondary)',
        'tertiary':         'var(--text-tertiary)',
        'disabled':         'var(--text-disabled)',
        'inverse':          'var(--text-inverse)',
        'on-accent':        'var(--text-on-accent)',
        'link':             'var(--text-link)',
        'accent-fg':        'var(--accent-fg)',
        'success':          'var(--status-success-fg)',
        'warning':          'var(--status-warning-fg)',
        'error':            'var(--status-error-fg)',
        'info':             'var(--status-info-fg)',
      },
      borderColor: {
        'default':          'var(--border-default)',
        'strong':           'var(--border-strong)',
        'subtle':           'var(--border-subtle)',
        'focus':            'var(--border-focus)',
        'accent':           'var(--border-accent)',
        'success':          'var(--status-success-border)',
        'warning':          'var(--status-warning-border)',
        'error':            'var(--status-error-border)',
        'info':             'var(--status-info-border)',
      },
      ringColor: {
        'focus':   'var(--border-focus)',
        'accent':  'var(--accent-solid)',
      },
      fontFamily: {
        sans:    ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        display: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
        mono:    ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      fontSize: {
        /* A refined scale tuned for a 14px base. [size, {lineHeight, letterSpacing}] */
        '2xs':  ['0.6875rem', { lineHeight: '1rem',    letterSpacing: '0.01em' }],   /* 11 */
        'xs':   ['0.75rem',   { lineHeight: '1.125rem', letterSpacing: '0.005em' }], /* 12 */
        'sm':   ['0.8125rem', { lineHeight: '1.25rem' }],                            /* 13 */
        'base': ['0.875rem',  { lineHeight: '1.375rem' }],                           /* 14 */
        'md':   ['0.9375rem', { lineHeight: '1.5rem' }],                             /* 15 */
        'lg':   ['1rem',      { lineHeight: '1.5rem' }],                             /* 16 */
        'xl':   ['1.125rem',  { lineHeight: '1.6rem',  letterSpacing: '-0.01em' }],  /* 18 */
        '2xl':  ['1.375rem',  { lineHeight: '1.8rem',  letterSpacing: '-0.015em' }], /* 22 */
        '3xl':  ['1.75rem',   { lineHeight: '2.1rem',  letterSpacing: '-0.02em' }],  /* 28 */
        '4xl':  ['2.1875rem', { lineHeight: '2.5rem',  letterSpacing: '-0.022em' }], /* 35 */
        '5xl':  ['2.75rem',   { lineHeight: '3rem',    letterSpacing: '-0.024em' }], /* 44 */
        '6xl':  ['3.5rem',    { lineHeight: '3.75rem', letterSpacing: '-0.026em' }], /* 56 */
        '7xl':  ['4.5rem',    { lineHeight: '4.75rem', letterSpacing: '-0.028em' }], /* 72 */
      },
      letterSpacing: {
        tightest: '-0.03em',
        tighter:  '-0.02em',
        tight:    '-0.01em',
        normal:   '0',
        wide:     '0.02em',
        wider:    '0.04em',
        widest:   '0.08em',
      },
      borderRadius: {
        'xs':   'var(--radius-xs)',
        'sm':   'var(--radius-sm)',
        'md':   'var(--radius-md)',
        'lg':   'var(--radius-lg)',
        'xl':   'var(--radius-xl)',
        '2xl':  'var(--radius-2xl)',
        '3xl':  'var(--radius-3xl)',
        'full': 'var(--radius-full)',
      },
      boxShadow: {
        'xs':   'var(--shadow-xs)',
        'sm':   'var(--shadow-sm)',
        'md':   'var(--shadow-md)',
        'lg':   'var(--shadow-lg)',
        'xl':   'var(--shadow-xl)',
        '2xl':  'var(--shadow-2xl)',
        'glow': 'var(--shadow-glow)',
        'focus':'var(--shadow-focus)',
      },
      zIndex: {
        'dropdown':       '100',
        'sticky':         '200',
        'fixed':          '300',
        'modal-backdrop': '400',
        'modal':          '500',
        'toast':          '600',
        'tooltip':        '700',
      },
      transitionTimingFunction: {
        'out-expo': 'cubic-bezier(0.16, 1, 0.3, 1)',
        'in-out-smooth': 'cubic-bezier(0.65, 0, 0.35, 1)',
      },
      transitionDuration: {
        fast: '120',
        base: '200',
        slow: '320',
      },
      keyframes: {
        'fade-in':      { from: { opacity: '0' }, to: { opacity: '1' } },
        'fade-up':      { from: { opacity: '0', transform: 'translateY(8px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        'fade-down':    { from: { opacity: '0', transform: 'translateY(-8px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        'scale-in':     { from: { opacity: '0', transform: 'scale(0.96)' }, to: { opacity: '1', transform: 'scale(1)' } },
        'slide-in-right': { from: { transform: 'translateX(100%)' }, to: { transform: 'translateX(0)' } },
        'slide-in-left':  { from: { transform: 'translateX(-100%)' }, to: { transform: 'translateX(0)' } },
        'accordion-down': { from: { height: '0' }, to: { height: 'var(--radix-accordion-content-height)' } },
        'accordion-up':   { from: { height: 'var(--radix-accordion-content-height)' }, to: { height: '0' } },
        'shimmer':      { '100%': { transform: 'translateX(100%)' } },
        'pulse-subtle': { '0%, 100%': { opacity: '1' }, '50%': { opacity: '0.55' } },
        'spin':         { to: { transform: 'rotate(360deg)' } },
        'float':        { '0%, 100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-10px)' } },
      },
      animation: {
        'fade-in':        'fade-in 200ms cubic-bezier(0.16, 1, 0.3, 1)',
        'fade-up':        'fade-up 320ms cubic-bezier(0.16, 1, 0.3, 1)',
        'fade-down':      'fade-down 200ms cubic-bezier(0.16, 1, 0.3, 1)',
        'scale-in':       'scale-in 160ms cubic-bezier(0.16, 1, 0.3, 1)',
        'slide-in-right': 'slide-in-right 320ms cubic-bezier(0.16, 1, 0.3, 1)',
        'slide-in-left':  'slide-in-left 320ms cubic-bezier(0.16, 1, 0.3, 1)',
        'accordion-down': 'accordion-down 200ms cubic-bezier(0.16, 1, 0.3, 1)',
        'accordion-up':   'accordion-up 200ms cubic-bezier(0.16, 1, 0.3, 1)',
        'shimmer':        'shimmer 1.6s infinite',
        'pulse-subtle':   'pulse-subtle 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'float':          'float 5s ease-in-out infinite',
      },
    },
  },
};
