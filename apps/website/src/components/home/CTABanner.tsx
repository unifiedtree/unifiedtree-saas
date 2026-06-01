import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowRight } from 'lucide-react'
import { Button } from '../ui/Button'

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

  return (
    <section className="relative py-24 overflow-hidden" style={{ background: 'linear-gradient(135deg, #E6F4F1 0%, #F8FAFC 60%, #E6F4F1 100%)' }}>
      {/* Animated leaf particles */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        {leaves.map((leaf, i) => (
          <div
            key={i}
            className="leaf-particle absolute bottom-0 text-primary select-none"
            style={{
              left: leaf.left,
              animationDuration: leaf.duration,
              animationDelay: leaf.delay,
              fontSize: leaf.size,
              opacity: 0,
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
          {/* Decorative top element */}
          <div className="flex justify-center mb-6">
            <div className="w-16 h-1 rounded-full bg-primary opacity-40" />
          </div>

          <h2 className="font-heading font-bold text-text-primary mb-4" style={{ fontSize: 'clamp(2rem, 3.5vw, 3rem)' }}>
            Ready to grow your business like a tree?
          </h2>
          <p className="text-lg text-text-secondary font-body mb-10 max-w-xl mx-auto">
            Join 2,400+ companies. Start free. No credit card required.
          </p>

          <div className="flex flex-wrap gap-4 justify-center">
            <Button size="lg" onClick={() => navigate('/pricing')}>
              Start Free Trial <ArrowRight size={18} />
            </Button>
            <Button size="lg" variant="ghost" onClick={() => navigate('/pricing')}>
              Book a Demo
            </Button>
          </div>

          <p className="mt-6 text-sm text-text-secondary font-body">
            14-day free trial · No credit card · Cancel anytime
          </p>
        </motion.div>
      </div>
    </section>
  )
}
