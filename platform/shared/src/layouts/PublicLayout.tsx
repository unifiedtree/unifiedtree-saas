import React from 'react'
import { useScrollPosition } from '../hooks/useScrollPosition'

interface PublicLayoutProps {
  children: React.ReactNode
  navbar?: React.ReactNode
  footer?: React.ReactNode
}

function DefaultNavbar({ isScrolled }: { isScrolled: boolean }) {
  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        isScrolled
          ? 'bg-[#070B14]/95 backdrop-blur-md border-b border-white/10 shadow-lg'
          : 'bg-transparent'
      }`}
    >
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-cyan-500 flex items-center justify-center">
            <span className="text-white font-bold text-sm">N</span>
          </div>
          <span className="text-white font-semibold text-lg">UnifiedTree</span>
        </div>
        <div className="hidden md:flex items-center gap-8">
          {['Features', 'Pricing', 'About', 'Blog'].map((item) => (
            <a
              key={item}
              href={`#${item.toLowerCase()}`}
              className="text-slate-400 hover:text-white text-sm transition-colors"
            >
              {item}
            </a>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <a href="/login" className="text-slate-400 hover:text-white text-sm transition-colors">
            Log in
          </a>
          <a
            href="/register"
            className="px-4 py-2 bg-indigo-500 hover:bg-indigo-600 text-white text-sm font-medium rounded-lg transition-colors"
          >
            Get started
          </a>
        </div>
      </div>
    </nav>
  )
}

function DefaultFooter() {
  return (
    <footer className="bg-[#0D1117] border-t border-white/10 py-12">
      <div className="max-w-7xl mx-auto px-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-8">
          {[
            { title: 'Product', links: ['Features', 'Pricing', 'Changelog', 'Roadmap'] },
            { title: 'Company', links: ['About', 'Blog', 'Careers', 'Press'] },
            { title: 'Legal', links: ['Privacy', 'Terms', 'Security', 'Cookie Policy'] },
            { title: 'Support', links: ['Help Center', 'Documentation', 'Status', 'Contact'] },
          ].map((col) => (
            <div key={col.title}>
              <h4 className="text-white text-sm font-semibold mb-4">{col.title}</h4>
              <ul className="space-y-2">
                {col.links.map((link) => (
                  <li key={link}>
                    <a href="#" className="text-slate-500 hover:text-slate-300 text-sm transition-colors">
                      {link}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="border-t border-white/10 pt-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <span className="text-slate-500 text-sm">© 2025 UnifiedTree. All rights reserved.</span>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-gradient-to-br from-indigo-500 to-cyan-500 flex items-center justify-center">
              <span className="text-white font-bold text-xs">N</span>
            </div>
            <span className="text-slate-400 text-sm font-medium">UnifiedTree</span>
          </div>
        </div>
      </div>
    </footer>
  )
}

export function PublicLayout({ children, navbar, footer }: PublicLayoutProps) {
  const { isScrolled } = useScrollPosition()

  return (
    <div className="min-h-screen bg-[#070B14] text-white">
      {navbar ? navbar : <DefaultNavbar isScrolled={isScrolled} />}
      <main className="pt-16">{children}</main>
      {footer ? footer : <DefaultFooter />}
    </div>
  )
}
