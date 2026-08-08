import { Link } from 'react-router-dom'
import { Linkedin, Twitter, Github, Youtube, Mail, MessageCircle, ArrowRight } from 'lucide-react'

const columns = [
  {
    title: 'Product',
    links: [
      { label: 'Modules', to: '/modules' },
      { label: 'Pricing', to: '/pricing' },
      { label: 'Features', to: '/features' },
    ],
  },
  {
    title: 'Company',
    links: [
      { label: 'About', to: '/about' },
      { label: 'Industries', to: '/industries' },
      { label: 'Careers', to: '/careers' },
    ],
  },
  {
    title: 'Resources',
    links: [
      { label: 'Help Center', to: '/help' },
      { label: 'Security', to: '/security' },
    ],
  },
]

const legalLinks = [
  { label: 'Privacy Policy', to: '/privacy' },
  { label: 'Terms of Service', to: '/terms' },
  { label: 'Cookie Policy', to: '/cookies' },
]

const socials = [
  { icon: Linkedin, href: '#', label: 'LinkedIn' },
  { icon: Twitter, href: '#', label: 'Twitter' },
  { icon: Github, href: '#', label: 'GitHub' },
  { icon: Youtube, href: '#', label: 'YouTube' },
]

const linkCls =
  'text-[14.5px] text-white/70 transition-colors duration-200 hover:text-[#A7F3D0]'
const headingCls =
  'mb-5 text-[11.5px] font-semibold uppercase tracking-[0.14em] text-white/45'

/**
 * The closing band: the deepest emerald we use (#04503A), so the page ends on
 * the same landscape it opened with. A low ridge silhouette and the translucent
 * wordmark sit behind the content — decorative only, everything readable lives
 * on the z-10 layer.
 */
export function Footer() {
  return (
    <footer className="relative overflow-hidden bg-[#04503A]">
      {/* ── Backdrop ──────────────────────────────────────────────── */}
      <div aria-hidden className="pointer-events-none absolute inset-0 select-none">
        {/* soft emerald bloom */}
        <div className="absolute -top-40 right-[-8%] h-[460px] w-[460px] rounded-full bg-[#10B981]/20 blur-3xl" />
        <div className="absolute -bottom-32 left-[-10%] h-[380px] w-[380px] rounded-full bg-[#047857]/30 blur-3xl" />

        {/* the wordmark rising from behind the ridge */}
        <div
          className="absolute inset-x-0 bottom-6 whitespace-nowrap text-center font-heading font-extrabold leading-none text-white/[0.05]"
          style={{ fontSize: 'clamp(4rem, 15vw, 13rem)', letterSpacing: '-0.045em' }}
        >
          UnifiedTree
        </div>

        {/* ridge line */}
        <svg
          viewBox="0 0 1440 200"
          preserveAspectRatio="none"
          className="absolute inset-x-0 bottom-0 h-40 w-full"
        >
          <defs>
            <linearGradient id="ft-ridge-back" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#047857" stopOpacity="0.55" />
              <stop offset="100%" stopColor="#047857" stopOpacity="0.2" />
            </linearGradient>
            <linearGradient id="ft-ridge-front" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#022C22" stopOpacity="0.7" />
              <stop offset="100%" stopColor="#011E17" stopOpacity="0.9" />
            </linearGradient>
          </defs>
          <path
            d="M0 92 C 200 40, 360 96, 560 74 C 780 50, 940 8, 1140 56 C 1270 86, 1360 74, 1440 88 L1440 200 L0 200 Z"
            fill="url(#ft-ridge-back)"
          />
          <path
            d="M0 148 C 260 108, 470 156, 700 138 C 950 118, 1160 92, 1440 132 L1440 200 L0 200 Z"
            fill="url(#ft-ridge-front)"
          />
        </svg>
      </div>

      {/* ── Content ───────────────────────────────────────────────── */}
      <div className="relative z-10 mx-auto max-w-7xl px-4 pb-14 pt-20 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 gap-x-8 gap-y-12 md:grid-cols-4 lg:grid-cols-12">
          {/* Brand */}
          <div className="col-span-2 lg:col-span-3">
            <img
              src="/UnifiedTreeLogo.png"
              alt="UnifiedTree"
              className="mb-6 h-9 w-auto brightness-0 invert"
            />
            <p
              className="max-w-xs font-heading text-[19px] font-bold leading-[1.25] text-white"
              style={{ letterSpacing: '-0.03em' }}
            >
              One root. Every branch connected.
            </p>
            <p className="mt-3 max-w-xs text-[14.5px] leading-relaxed text-white/60">
              The offline-first ERP platform built for growing businesses.
            </p>
          </div>

          {/* Link columns */}
          {columns.map((col) => (
            <div key={col.title} className="lg:col-span-2">
              <h4 className={headingCls}>{col.title}</h4>
              <ul className="space-y-3.5">
                {col.links.map((link) => (
                  <li key={link.label}>
                    <Link to={link.to} className={linkCls}>
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {/* Contact */}
          <div className="col-span-2 md:col-span-2 lg:col-span-3">
            <h4 className={headingCls}>Contact</h4>
            <ul className="space-y-3.5">
              <li>
                <a href="mailto:support@unifiedtree.com" className={`flex items-center gap-2 ${linkCls}`}>
                  <Mail size={14} className="flex-shrink-0 text-white/40" />
                  support@unifiedtree.com
                </a>
              </li>
              <li>
                <a href="#" className={`flex items-center gap-2 ${linkCls}`}>
                  <MessageCircle size={14} className="flex-shrink-0 text-white/40" />
                  WhatsApp Support
                </a>
              </li>
              <li>
                <Link
                  to="/talk-to-us?intent=demo"
                  className="group inline-flex items-center gap-1.5 text-[14.5px] font-semibold text-[#A7F3D0] transition-colors hover:text-white"
                >
                  Book a demo
                  <ArrowRight size={14} className="transition-transform duration-200 group-hover:translate-x-0.5" />
                </Link>
              </li>
            </ul>
          </div>
        </div>
      </div>

      {/* ── Bottom bar ────────────────────────────────────────────── */}
      <div className="relative z-10 border-t border-white/10">
        <div className="mx-auto flex max-w-7xl flex-col items-center gap-5 px-4 py-6 sm:px-6 lg:flex-row lg:justify-between lg:gap-8 lg:px-8">
          <p className="order-3 text-[12.5px] text-white/45 lg:order-1">
            © 2026 Our Unique. All rights reserved.
          </p>

          <div className="order-2 flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
            {legalLinks.map((item) => (
              <Link
                key={item.label}
                to={item.to}
                className="text-[12.5px] text-white/55 transition-colors duration-200 hover:text-[#A7F3D0]"
              >
                {item.label}
              </Link>
            ))}
          </div>

          <div className="order-1 flex items-center gap-2.5 lg:order-3">
            {socials.map(({ icon: Icon, href, label }) => (
              <a
                key={label}
                href={href}
                aria-label={label}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/15 bg-white/5 text-white/70 transition-all duration-200 hover:-translate-y-0.5 hover:border-[#A7F3D0]/50 hover:bg-white/10 hover:text-[#A7F3D0]"
              >
                <Icon size={16} />
              </a>
            ))}
          </div>
        </div>
      </div>
    </footer>
  )
}
