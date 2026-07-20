import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const dsPreset = require('@unifiedtree/design-system/tailwind-preset.cjs')

/** @type {import('tailwindcss').Config} */
export default {
  presets: [dsPreset],
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
    '../../packages/ui-kit/src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: '#059669',
        'primary-dark': '#047857',
        'primary-light': '#ECFDF5',
        'primary-muted': '#10B981',
        bg: '#FAFAFA',
        surface: '#FFFFFF',
        // ── Semantic theme tokens — wired to design-system CSS vars in
        //    packages/design-system/tokens.css; switch automatically on
        //    [data-theme='dark']. These back the bg-bg-*, text-text-*,
        //    border-border-*, *-accent-* utility classes used across the app.
        'text-primary':      'var(--text-primary)',
        'text-secondary':    'var(--text-secondary)',
        'text-tertiary':     'var(--text-tertiary)',
        'text-disabled':     'var(--text-disabled)',
        'text-inverse':      'var(--text-inverse)',
        'text-on-accent':    'var(--text-on-accent)',
        'bg-base':           'var(--bg-base)',
        'bg-surface':        'var(--bg-surface)',
        'bg-surface-raised': 'var(--bg-surface-raised)',
        'bg-subtle':         'var(--bg-subtle)',
        'bg-muted':          'var(--bg-muted)',
        'border-default':    'var(--border-default)',
        'border-strong':     'var(--border-strong)',
        'border-subtle':     'var(--border-subtle)',
        'accent-default':    'var(--accent-fg)',
        'accent-subtle':     'var(--accent-bg)',
        'accent-hover':      'var(--interactive-primary-hover)',
        success: '#10B981',
        'success-light': '#D1FAE5',
        danger: '#EF4444',
        'danger-light': '#FEE2E2',
        warning: '#F59E0B',
        'warning-light': '#FEF3C7',
        info: '#3B82F6',
        'info-light': '#DBEAFE',
        border: '#E5E5E5',
        'border-light': '#F5F5F5',
        divider: '#E5E5E5',
        // ── Literal semantic aliases (palette source of truth = Attendance app).
        //    These mirror the var-backed *-text-*/*-bg-* tokens above so that
        //    `text-text-primary`, `border-border-light`, etc. always resolve to
        //    the exact teal-grey palette regardless of theme var wiring.
        'text-primary-fixed':   '#171717',
        'text-secondary-fixed': '#525252',
        'text-tertiary-fixed':  '#737373',
        'text-inverse-fixed':   '#FFFFFF',
        'surface-2': '#F5F5F5',
        brand: {
          50:   '#ECFDF5',
          100:  '#D1FAE5',
          200:  '#A7F3D0',
          300:  '#6EE7B7',
          400:  '#34D399',
          500:  '#059669',
          600:  '#047857',
          700:  '#065F46',
          800:  '#064E3B',
          900:  '#053B2E',
          950:  '#022C22',
          mint: '#34D399',
          soft: '#D1FAE5',
          cream: '#ECFDF5',
        },
      },
      fontFamily: {
        heading: ['Inter', '-apple-system', 'sans-serif'],
        body: ['Inter', '-apple-system', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
        display: ['Inter', '-apple-system', 'sans-serif'],
      },
      fontSize: {
        'display': ['clamp(2.8rem, 5vw, 4.5rem)', { lineHeight: '1.1', fontWeight: '800' }],
        'h2': ['clamp(2rem, 3.5vw, 3rem)', { lineHeight: '1.2', fontWeight: '700' }],
        'h3': ['1.5rem', { lineHeight: '1.3', fontWeight: '700' }],
      },
      animation: {
        'float': 'float 4s ease-in-out infinite',
        'float-leaf': 'floatLeaf 8s ease-in-out infinite',
        'pulse-slow': 'pulse 3s ease-in-out infinite',
        'spin-slow': 'spin 8s linear infinite',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-12px)' },
        },
        floatLeaf: {
          '0%': { transform: 'translateY(0) rotate(0deg)', opacity: '0.8' },
          '100%': { transform: 'translateY(-100vh) rotate(360deg)', opacity: '0' },
        },
      },
      backgroundImage: {
        'brand-gradient': 'linear-gradient(135deg, #047857 0%, #059669 50%, #34D399 100%)',
      },
      boxShadow: {
        'teal': '0 0 0 3px rgba(5, 150, 105, 0.16)',
        'teal-lg': '0 12px 40px rgba(5, 150, 105, 0.15)',
        'card': '0 1px 2px 0 rgba(16,24,40,0.04), 0 6px 16px -6px rgba(16,24,40,0.10)',
        'card-hover': '0 4px 8px -2px rgba(16,24,40,0.05), 0 16px 32px -8px rgba(16,24,40,0.14)',
        'glow-brand': '0 18px 48px -16px rgba(5,150,105,0.45)',
      },
    },
  },
  plugins: [],
}
