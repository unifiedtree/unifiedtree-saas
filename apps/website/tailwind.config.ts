import type { Config } from 'tailwindcss'

// Palette direction inspired by modern fintech marketing sites: a monochrome
// "organic green" system — green-black ink, soft green-cream tints, deep
// forest for dark surfaces, and a lime pop reserved for key CTAs/highlights.
const config: Config = {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Structural ink (buttons, dark surfaces, icons). The palette shifted
        // off forest-green to a near-black "ink" so the site reads as
        // ink + neutral + a lime pop — no green in the UI chrome.
        primary: '#0B0D0C',
        'primary-dark': '#060706',
        'primary-darker': '#000000',
        'primary-light': '#F5F5F3',
        'primary-muted': '#2A2D2B',
        // Neutral dark for subtle gradients (was a green accent).
        accent: '#2A2D2B',
        // Lime pop — the single accent, used sparingly on CTAs & highlights
        lime: '#A3E635',
        'lime-soft': '#D9F0A3',
        forest: '#0B0D0C',
        ink: '#0A0B0A',
        tint: '#F5F5F3',
        'tint-2': '#ECECEA',
        bg: '#FFFFFF',
        surface: '#FFFFFF',
        'surface-2': '#F5F5F3',
        // Neutral text ramp
        'text-primary': '#0A0B0A',
        'text-secondary': '#57595A',
        'text-tertiary': '#8A8C8A',
        success: '#3A7D22',
        danger: '#C0362C',
        warning: '#B4791A',
        info: '#2563EB',
        border: '#E7E7E4',
        'border-light': '#F2F2F0',
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
        heading: ['Inter', '-apple-system', 'sans-serif'],
        body: ['Inter', '-apple-system', 'sans-serif'],
        display: ['Inter', '-apple-system', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      fontSize: {
        'display': ['clamp(2.75rem, 5.4vw, 5rem)', { lineHeight: '1.02', letterSpacing: '-0.04em', fontWeight: '600' }],
        'h2': ['clamp(2rem, 3.8vw, 3.25rem)', { lineHeight: '1.06', letterSpacing: '-0.035em', fontWeight: '600' }],
        'h3': ['1.5rem', { lineHeight: '1.2', letterSpacing: '-0.025em', fontWeight: '600' }],
      },
      letterSpacing: {
        tightest: '-0.045em',
        tighter: '-0.035em',
        tight: '-0.02em',
      },
      animation: {
        'float': 'float 5s ease-in-out infinite',
        'float-leaf': 'floatLeaf 8s ease-in-out infinite',
        'pulse-slow': 'pulse 3s ease-in-out infinite',
        'spin-slow': 'spin 8s linear infinite',
        'fade-up': 'fadeUp 0.6s cubic-bezier(0.16,1,0.3,1) both',
        'marquee': 'marquee 28s linear infinite',
      },
      keyframes: {
        float: { '0%, 100%': { transform: 'translateY(0px)' }, '50%': { transform: 'translateY(-12px)' } },
        floatLeaf: { '0%': { transform: 'translateY(0) rotate(0deg)', opacity: '0.8' }, '100%': { transform: 'translateY(-100vh) rotate(360deg)', opacity: '0' } },
        fadeUp: { from: { opacity: '0', transform: 'translateY(16px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        marquee: { from: { transform: 'translateX(0)' }, to: { transform: 'translateX(-50%)' } },
      },
      boxShadow: {
        'teal': '0 0 0 4px rgba(24, 40, 14, 0.10)',
        'teal-lg': '0 16px 40px -12px rgba(24, 40, 14, 0.30)',
        'card': '0 1px 2px 0 rgba(9,15,5,0.04), 0 8px 24px -10px rgba(9,15,5,0.10)',
        'card-hover': '0 4px 8px -2px rgba(9,15,5,0.06), 0 20px 44px -12px rgba(9,15,5,0.16)',
        'glow-brand': '0 24px 60px -22px rgba(24,40,14,0.5)',
      },
      backgroundImage: {
        'brand-gradient': 'linear-gradient(135deg, #060706 0%, #0B0D0C 60%, #17191B 100%)',
      },
    },
  },
  plugins: [],
}

export default config
