import type { Config } from 'tailwindcss'

// Palette = the product app's palette (apps/platform). Emerald is the single
// brand colour, exactly as in packages/design-system/src/tokens.css:
//   primary #059669 · hover #047857 · active #065F46 · tint #ECFDF5
// Three colours only, 70:20:10 — 70% neutral surfaces, 20% emerald, 10% deep
// emerald for dark bands (header/footer/hero) and highlights.
const config: Config = {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Brand emerald — identical to the app (apps/platform/tailwind.config.js)
        primary: '#059669',
        'primary-dark': '#047857',
        'primary-darker': '#065F46',
        'primary-light': '#ECFDF5',
        'primary-muted': '#10B981',
        accent: '#047857',
        // Light emerald used where the old palette used lime: highlight text on
        // the dark emerald bands. Key name kept so existing markup keeps working.
        lime: '#A7F3D0',
        'lime-soft': '#D1FAE5',
        forest: '#065F46',
        ink: '#171717',
        tint: '#ECFDF5',
        'tint-2': '#D1FAE5',
        bg: '#FFFFFF',
        surface: '#FFFFFF',
        'surface-2': '#F5F5F5',
        // Neutral text ramp — the app's neutrals
        'text-primary': '#171717',
        'text-secondary': '#525252',
        'text-tertiary': '#737373',
        success: '#10B981',
        danger: '#EF4444',
        warning: '#F59E0B',
        info: '#3B82F6',
        border: '#E5E5E5',
        'border-light': '#F5F5F5',
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
        // Figtree carries the display voice — rounded geometric, warm at large
        // sizes. Body stays Inter, which is a better reading face at 16-19px.
        heading: ['Figtree', 'Inter', '-apple-system', 'sans-serif'],
        display: ['Figtree', 'Inter', '-apple-system', 'sans-serif'],
        body: ['Inter', '-apple-system', 'sans-serif'],
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
