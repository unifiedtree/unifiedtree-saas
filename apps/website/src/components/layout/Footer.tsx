import { Link } from 'react-router-dom'
import { Linkedin, Twitter, Github, Youtube, Mail, MessageCircle, ArrowRight } from 'lucide-react'

const columns = [
  {
    title: 'Product',
    links: [
      { label: 'Modules', to: '/modules' },
      { label: 'Pricing', to: '/pricing' },
      { label: 'Features', to: '/features' },
      { label: 'Changelog', to: '#' },
      { label: 'Status', to: '#' },
    ],
  },
  {
    title: 'Company',
    links: [
      { label: 'About', to: '/about' },
      { label: 'Industries', to: '/industries' },
      { label: 'Blog', to: '#' },
      { label: 'Careers', to: '#' },
      { label: 'Partners', to: '#' },
    ],
  },
  {
    title: 'Resources',
    links: [
      { label: 'Documentation', to: '#' },
      { label: 'API Reference', to: '#' },
      { label: 'Community', to: '#' },
      { label: 'Help Center', to: '#' },
      { label: 'Security', to: '#' },
    ],
  },
]

export function Footer() {
  return (
    <footer className="border-t border-border bg-[#F4FAED]">
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-12 md:grid-cols-2 lg:grid-cols-5">
          {/* Brand col */}
          <div className="lg:col-span-2">
            <img src="/UnifiedTreeLogo.png" alt="UnifiedTree" className="mb-4 h-8 w-auto" />
            <p className="mb-6 max-w-xs text-sm leading-relaxed text-text-secondary">
              One root. Every branch connected. The offline-first ERP platform built for growing businesses.
            </p>
            <div className="flex items-center gap-2.5">
              {[
                { icon: Linkedin, href: '#', label: 'LinkedIn' },
                { icon: Twitter, href: '#', label: 'Twitter' },
                { icon: Github, href: '#', label: 'GitHub' },
                { icon: Youtube, href: '#', label: 'YouTube' },
              ].map(({ icon: Icon, href, label }) => (
                <a
                  key={label}
                  href={href}
                  aria-label={label}
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface text-text-secondary transition-colors duration-200 hover:border-primary hover:bg-primary-light hover:text-primary"
                >
                  <Icon size={16} />
                </a>
              ))}
            </div>
          </div>

          {/* Link columns */}
          {columns.map((col) => (
            <div key={col.title}>
              <h4 className="mb-4 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
                {col.title}
              </h4>
              <ul className="space-y-3">
                {col.links.map((link) => (
                  <li key={link.label}>
                    <Link
                      to={link.to}
                      className="text-sm text-text-secondary transition-colors duration-150 hover:text-primary"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {/* Contact col */}
          <div>
            <h4 className="mb-4 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">Contact</h4>
            <ul className="space-y-3">
              <li>
                <a href="mailto:support@unifiedtree.com" className="flex items-center gap-2 text-sm text-text-secondary transition-colors hover:text-primary">
                  <Mail size={14} /> support@unifiedtree.com
                </a>
              </li>
              <li>
                <a href="#" className="flex items-center gap-2 text-sm text-text-secondary transition-colors hover:text-primary">
                  <MessageCircle size={14} /> WhatsApp Support
                </a>
              </li>
              <li>
                <Link to="/talk-to-us?intent=demo" className="inline-flex items-center gap-1 text-sm font-semibold text-primary transition-colors hover:text-primary-dark">
                  Book a demo <ArrowRight size={13} />
                </Link>
              </li>
            </ul>
          </div>
        </div>
      </div>

      {/* Bottom bar */}
      <div className="border-t border-border">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-3 px-4 py-5 sm:flex-row sm:px-6 lg:px-8">
          <p className="text-xs text-text-tertiary">© 2026 UnifiedTree Technologies Pvt. Ltd. All rights reserved.</p>
          <div className="flex items-center gap-4">
            {['Privacy Policy', 'Terms of Service', 'Cookie Policy'].map((item) => (
              <a key={item} href="#" className="text-xs text-text-tertiary transition-colors hover:text-text-primary">{item}</a>
            ))}
          </div>
        </div>
      </div>
    </footer>
  )
}
