import { motion } from 'framer-motion'
import { Clock } from 'lucide-react'

type Integration = {
  name: string
  color: string
  bg: string
  slug?: string
}

const integrations: Integration[] = [
  { name: 'Razorpay', color: '#3395FF', bg: '#E8F2FF', slug: 'razorpay' },
  { name: 'Stripe', color: '#635BFF', bg: '#EFEEFD', slug: 'stripe' },
  { name: 'Tally', color: '#003399', bg: '#E6EBF7' },
  { name: 'QuickBooks', color: '#2CA01C', bg: '#E8F5E6', slug: 'quickbooks' },
  { name: 'Google Workspace', color: '#EA4335', bg: '#FDECEA', slug: 'googleworkspace' },
  { name: 'Slack', color: '#4A154B', bg: '#F0E8F0', slug: 'slack' },
  { name: 'WhatsApp', color: '#25D366', bg: '#E6FAF0', slug: 'whatsapp' },
  { name: 'AWS S3', color: '#FF9900', bg: '#FFF4E5', slug: 'amazons3' },
  { name: 'Shopify', color: '#96BF48', bg: '#EFF5E5', slug: 'shopify' },
  // India-specific presets — tagged so international prospects don't assume
  // these are the only options. The generic Payments / Email / SMS providers
  // above cover other regions.
  { name: 'GST Portal (India)', color: '#004E9A', bg: '#E5EEF7' },
  { name: 'MSG91 (India SMS)', color: '#FF6B35', bg: '#FFEEE8' },
  { name: 'Leaflet Maps', color: '#199900', bg: '#E5F5E5', slug: 'leaflet' },
]

export function IntegrationsSection() {
  return (
    <section className="py-24 bg-bg">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.6 }}
          className="text-center mb-14"
        >
          {/* Eyebrow row with a "Launching soon" pill — the integrations
              themselves ship as fixtures; the live in-product wiring lands
              in a later release. Setting the expectation up front so a
              prospect doesn't sign up expecting the "Connect Slack" button
              to work today. */}
          <div className="mb-3 flex items-center justify-center gap-2">
            <span className="text-primary font-body font-semibold text-sm uppercase tracking-widest">
              Integrations
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700 whitespace-nowrap">
              <Clock size={9} /> Launching soon
            </span>
          </div>
          <h2 className="font-heading font-bold text-text-primary" style={{ fontSize: 'clamp(2rem, 3.5vw, 3rem)' }}>
            Connects with tools you already use
          </h2>
          <p className="text-text-secondary font-body mt-3 text-lg max-w-xl mx-auto">
            UnifiedTree plays well with your existing ecosystem — payments, communication, accounting, and more.
          </p>
        </motion.div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {integrations.map((integration, i) => (
            <motion.div
              key={integration.name}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.2 }}
              transition={{ duration: 0.4, delay: i * 0.05, ease: 'easeOut' }}
              whileHover={{ scale: 1.06, y: -3 }}
              className="group bg-surface rounded-xl p-5 border border-border shadow-card hover:shadow-card-hover transition-all duration-300 flex flex-col items-center gap-2 cursor-pointer"
            >
              <div
                className="w-12 h-12 rounded-xl flex items-center justify-center mb-1 transition-all duration-300"
                style={{ backgroundColor: integration.bg }}
              >
                {integration.slug ? (
                  <img
                    src={`https://cdn.simpleicons.org/${integration.slug}`}
                    alt={`${integration.name} logo`}
                    loading="lazy"
                    className="w-7 h-7 object-contain"
                  />
                ) : (
                  <span
                    className="font-heading font-extrabold"
                    style={{ color: integration.color, fontSize: '10px', textAlign: 'center', lineHeight: '1.2' }}
                  >
                    {integration.name.split(' ')[0].slice(0, 3).toUpperCase()}
                  </span>
                )}
              </div>
              <span className="text-xs font-body font-medium text-text-secondary group-hover:text-primary transition-colors text-center leading-tight">
                {integration.name}
              </span>
            </motion.div>
          ))}
        </div>

        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.4 }}
          className="text-center text-sm text-text-secondary mt-10 font-body"
        >
          + REST API for custom integrations · Webhooks · Zapier — full integrations suite launching soon
        </motion.p>
      </div>
    </section>
  )
}
