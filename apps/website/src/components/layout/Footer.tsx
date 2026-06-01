import { Link } from 'react-router-dom'
import { Linkedin, Twitter, Github, Youtube, Mail, MessageCircle } from 'lucide-react'

function TreeLogoSmall() {
  return (
    <img
      src="/UnifiedTreeLogoWhite.png"
      alt="UnifiedTree logo"
      style={{ height: 40, width: 'auto' }}
      className="object-contain"
    />
  )
}

const columns = [
  {
    title: 'Product',
    links: [
      { label: 'Modules', to: '/modules' },
      { label: 'Pricing', to: '/pricing' },
      { label: 'Changelog', to: '#' },
      { label: 'Roadmap', to: '#' },
      { label: 'Status Page', to: '#' },
    ],
  },
  {
    title: 'Company',
    links: [
      { label: 'About', to: '#' },
      { label: 'Blog', to: '#' },
      { label: 'Careers', to: '#' },
      { label: 'Press', to: '#' },
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
    <footer className="bg-[#0F6E56] text-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-12">
          {/* Brand col */}
          <div className="lg:col-span-2">
            <div className="flex items-center gap-2 mb-4">
              <TreeLogoSmall />
            </div>
            <p className="text-white text-sm leading-relaxed max-w-xs mb-6">
              One Root. Every Branch Connected.
              <br />
              India's first offline-first ERP platform built for growing businesses.
            </p>
            <div className="flex items-center gap-3">
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
                  className="w-9 h-9 rounded-lg bg-white/10 flex items-center justify-center hover:bg-primary transition-colors duration-200"
                >
                  <Icon size={16} />
                </a>
              ))}
            </div>
          </div>

          {/* Link columns */}
          {columns.map((col) => (
            <div key={col.title}>
              <h4 className="text-base font-heading font-bold text-white mb-4 uppercase tracking-wider">
                {col.title}
              </h4>
              <ul className="space-y-3">
                {col.links.map((link) => (
                  <li key={link.label}>
                    <Link
                      to={link.to}
                      className="text-sm text-white hover:text-green-200 transition-colors duration-150"
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
            <h4 className="text-base font-heading font-bold text-white mb-4 uppercase tracking-wider">
              Contact
            </h4>
            <ul className="space-y-3">
              <li>
                <a
                  href="mailto:support@unifiedtree.com"
                  className="flex items-center gap-2 text-sm text-white hover:text-green-200 transition-colors"
                >
                  <Mail size={14} />
                  support@unifiedtree.com
                </a>
              </li>
              <li>
                <a
                  href="#"
                  className="flex items-center gap-2 text-sm text-white hover:text-green-200 transition-colors"
                >
                  <MessageCircle size={14} />
                  WhatsApp Support
                </a>
              </li>
              <li>
                <Link
                  to="/pricing"
                  className="inline-flex items-center gap-1 text-sm text-green-200 hover:text-white font-medium transition-colors"
                >
                  Book a Demo →
                </Link>
              </li>
            </ul>
          </div>
        </div>
      </div>

      {/* Bottom bar */}
      <div className="border-t border-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-xs text-white/70">
            © 2026 UnifiedTree Technologies Pvt. Ltd. All rights reserved.
          </p>
          <div className="flex items-center gap-4">
            {['Privacy Policy', 'Terms of Service', 'Cookie Policy'].map((item) => (
              <a key={item} href="#" className="text-xs text-white/70 hover:text-white transition-colors">
                {item}
              </a>
            ))}
          </div>
        </div>
      </div>
    </footer>
  )
}
