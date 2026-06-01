import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: '#0F6E56',
        'primary-dark': '#0A5240',
        'primary-light': '#E6F4F1',
        accent: '#14B8A6',
        bg: '#F8FAFC',
        surface: '#FFFFFF',
        'text-primary': '#0F172A',
        'text-secondary': '#64748B',
        success: '#22C55E',
        danger: '#EF4444',
        warning: '#F59E0B',
        border: '#E2E8F0',
        'surface-2': '#F1F5F9',
      },
      fontFamily: {
        heading: ['Fraunces', 'serif'],
        body: ['Manrope', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
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
      boxShadow: {
        'teal': '0 0 0 3px rgba(15, 110, 86, 0.2)',
        'teal-lg': '0 12px 40px rgba(15, 110, 86, 0.15)',
        'card': '0 4px 24px rgba(0, 0, 0, 0.06)',
        'card-hover': '0 12px 40px rgba(0, 0, 0, 0.12)',
      },
    },
  },
  plugins: [],
}

export default config
