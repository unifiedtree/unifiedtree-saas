import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Button } from '../ui/Button'
import { CtaButton } from '../common/CtaButton'
import { useCtaMode } from '../../hooks/useCtaMode'

const leaves = [
  { left: '5%', delay: '0s', duration: '8s', size: 18 },
  { left: '12%', delay: '1.5s', duration: '10s', size: 14 },
  { left: '25%', delay: '0.8s', duration: '7s', size: 20 },
  { left: '42%', delay: '2.2s', duration: '9s', size: 12 },
  { left: '58%', delay: '0.4s', duration: '11s', size: 16 },
  { left: '70%', delay: '3s', duration: '8s', size: 14 },
  { left: '83%', delay: '1.2s', duration: '9.5s', size: 18 },
  { left: '92%', delay: '2.5s', duration: '7.5s', size: 13 },
]

export function CTABanner() {
  const navigate = useNavigate()
  const { mode } = useCtaMode()

  return (
    <section className="relative py-24 overflow-hidden" style={{ background: 'linear-gradient(135deg, #F5F5F3 0%, #F8FAFC 60%, #F5F5F3 100%)' }}>
      {/* Animated leaf particles */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        {leaves.map((leaf, i) => (
          <div
            key={i}
            className="leaf-particle absolute bottom-0 select-none"
            style={{
              left: leaf.left,
              animationDuration: leaf.duration,
              animationDelay: leaf.delay,
              fontSize: leaf.size,
              opacity: 0,
              filter: 'grayscale(1)',
            }}
          >
            🍃
          </div>
        ))}
      </div>

      <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.4 }}
          transition={{ duration: 0.7, ease: 'easeOut' }}
        >
          <div className="flex justify-center mb-6">
            <div className="w-16 h-1 rounded-full bg-primary opacity-40" />
          </div>

          <h2 className="font-heading font-bold text-text-primary mb-4" style={{ fontSize: 'clamp(2rem, 3.5vw, 3rem)' }}>
            {mode === 'trial'
              ? 'Ready to grow your business like a tree?'
              : 'Ready to add another workspace?'}
          </h2>
          <p className="text-lg text-text-secondary font-body mb-10 max-w-xl mx-auto">
            {mode === 'trial'
              ? 'Join 2,400+ companies. Start free. No credit card required.'
              : 'Spin up a workspace for a new team or entity in minutes.'}
          </p>

          <div className="flex flex-wrap gap-4 justify-center">
            <CtaButton
              trialLabel="Start Free Trial"
              paidLabel="Create Workspace"
            />
            <Button size="lg" variant="ghost" onClick={() => navigate('/talk-to-us?intent=demo')}>
              Book a Demo
            </Button>
          </div>

          {mode === 'trial' && (
            <p className="mt-6 text-sm text-text-secondary font-body">
              7-day free trial · Autopay activates on day 8 · Cancel anytime
            </p>
          )}
        </motion.div>
      </div>
    </section>
  )
}
