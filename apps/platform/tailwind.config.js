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
        primary: '#0F6E56',
        'primary-dark': '#0A5240',
        'primary-light': '#E6F4F1',
        bg: '#F8FAFC',
        surface: '#FFFFFF',
        'text-primary': '#0F172A',
        'text-secondary': '#64748B',
        success: '#22C55E',
        danger: '#EF4444',
        warning: '#F59E0B',
        border: '#E2E8F0',
        'surface-2': '#F1F5F9',
        brand: {
          50:   '#ecfdf5',
          100:  '#d1fae5',
          200:  '#a7f3d0',
          300:  '#6ee7b7',
          400:  '#34d399',
          500:  '#10b981',
          600:  '#0f6e56',
          700:  '#0a5240',
          800:  '#064e3b',
          900:  '#053024',
          950:  '#022c22',
          mint: '#35c98a',
          soft: '#e6f4f1',
          cream: '#fbf8f3',
        },
      },
      fontFamily: {
        heading: ['Fraunces', 'serif'],
        body: ['Manrope', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
        display: ['Fraunces', 'serif'],
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
        'brand-gradient': 'linear-gradient(135deg, #0a5240 0%, #0f6e56 45%, #35c98a 100%)',
      },
      boxShadow: {
        'teal': '0 0 0 3px rgba(15, 110, 86, 0.2)',
        'teal-lg': '0 12px 40px rgba(15, 110, 86, 0.15)',
        'card': '0 4px 24px rgba(0, 0, 0, 0.06)',
        'card-hover': '0 12px 40px rgba(0, 0, 0, 0.12)',
        'glow-brand': '0 18px 48px -16px rgba(15,110,86,0.45)',
      },
    },
  },
  plugins: [],
}
