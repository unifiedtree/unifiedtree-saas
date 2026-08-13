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
  'text-[14.5px] text-white/90 transition-colors duration-200 hover:text-[#D1FAE5]'
const headingCls =
  'mb-5 text-[11.5px] font-semibold uppercase tracking-[0.14em] text-[#D1FAE5]/95'

/**
 * The closing band, on the hero's vivid emerald ground (#047857→#059669 with
 * soft radial lifts) rather than the old near-flat deep slab. A low ridge
 * silhouette and the translucent wordmark sit behind the content — decorative
 * only, everything readable lives on the z-10 layer at AA opacities for the
 * brighter field.
 */
export function Footer() {
  return (
    <footer
      className="relative overflow-hidden"
      style={{
        backgroundColor: '#047857',
        backgroundImage: [
          // soft radial lifts at the crown, echoing the hero band
          'radial-gradient(56% 44% at 12% -10%, rgba(52, 211, 153, 0.30), transparent 64%)',
          'radial-gradient(48% 40% at 90% -8%, rgba(16, 185, 129, 0.36), transparent 68%)',
          // low glow behind the wordmark / ridge
          'radial-gradient(72% 40% at 50% 98%, rgba(16, 185, 129, 0.20), transparent 70%)',
          // vivid at the very top, settling to the ground the text sits on
          'linear-gradient(172deg, #059669 0%, #047857 16%, #065F46 100%)',
        ].join(', '),
      }}
    >
      {/* ── Backdrop ──────────────────────────────────────────────── */}
      <div aria-hidden className="pointer-events-none absolute inset-0 select-none">
        {/* soft emerald bloom */}
        <div className="absolute -top-56 right-[-14%] h-[480px] w-[480px] rounded-full bg-[#34D399]/20 blur-3xl" />
        <div className="absolute -bottom-32 left-[-10%] h-[380px] w-[380px] rounded-full bg-[#065F46]/50 blur-3xl" />

        {/* Wordmark sitting behind the footer. Was white/[0.05] and pinned to
            bottom-6, which put it under the ridge — effectively invisible.
            Lifted clear of the ridge and taken up to 10% so it actually reads. */}
        <div
          className="absolute inset-x-0 bottom-24 whitespace-nowrap text-center font-heading font-extrabold leading-none text-white/[0.13]"
          style={{ fontSize: 'clamp(3.48rem, 13.2vw, 11.31rem)', letterSpacing: '-0.045em' }}
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
              {/* deeper than the new vivid ground so the ridge still reads */}
              <stop offset="0%" stopColor="#04503A" stopOpacity="0.65" />
              <stop offset="100%" stopColor="#04503A" stopOpacity="0.3" />
            </linearGradient>
            <linearGradient id="ft-ridge-front" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#022C22" stopOpacity="0.85" />
              <stop offset="100%" stopColor="#011E17" stopOpacity="0.95" />
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
              className="max-w-xs font-heading text-[17px] font-bold leading-[1.25] text-white"
              style={{ letterSpacing: '-0.03em' }}
            >
              One root. Every branch connected.
            </p>
            <p className="mt-3 max-w-xs text-[14.5px] leading-relaxed text-white/90">
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
                  <Mail size={14} className="flex-shrink-0 text-white/75" />
                  support@unifiedtree.com
                </a>
              </li>
              <li>
                <a href="#" className={`flex items-center gap-2 ${linkCls}`}>
                  <MessageCircle size={14} className="flex-shrink-0 text-white/75" />
                  WhatsApp Support
                </a>
              </li>
              <li>
                <Link
                  to="/talk-to-us?intent=demo"
                  className="group inline-flex items-center gap-1.5 text-[14.5px] font-semibold text-[#D1FAE5] transition-colors hover:text-white"
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
      <div className="relative z-10 border-t border-white/15">
        <div className="mx-auto flex max-w-7xl flex-col items-center gap-5 px-4 py-6 sm:px-6 lg:flex-row lg:justify-between lg:gap-8 lg:px-8">
          <p className="order-3 text-[12.5px] text-white/60 lg:order-1">
            © 2026 Our Unique. All rights reserved.
          </p>

          <div className="order-2 flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
            {legalLinks.map((item) => (
              <Link
                key={item.label}
                to={item.to}
                className="text-[12.5px] text-white/70 transition-colors duration-200 hover:text-[#A7F3D0]"
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
