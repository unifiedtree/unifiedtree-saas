import { useEffect, useRef, useState } from 'react'
import { motion, useInView } from 'framer-motion'

interface StatItem {
  value: number
  suffix: string
  label: string
}

const stats: StatItem[] = [
  { value: 2400, suffix: '+', label: 'Businesses' },
  { value: 40, suffix: '+', label: 'Countries' },
  { value: 12, suffix: '', label: 'Core Modules' },
  { value: 99.9, suffix: '%', label: 'Uptime SLA' },
]

function useCountUp(target: number, duration: number, triggered: boolean) {
  const [count, setCount] = useState(0)

  useEffect(() => {
    if (!triggered) return
    let start = 0
    const step = target / (duration / 16)
    const timer = setInterval(() => {
      start += step
      if (start >= target) {
        setCount(target)
        clearInterval(timer)
      } else {
        setCount(Math.floor(start * 10) / 10)
      }
    }, 16)
    return () => clearInterval(timer)
  }, [triggered, target, duration])

  return count
}

function StatCounter({ value, suffix, label, triggered }: StatItem & { triggered: boolean }) {
  const count = useCountUp(value, 2000, triggered)
  const display = value % 1 !== 0 ? count.toFixed(1) : Math.floor(count).toLocaleString('en-IN')

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={triggered ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.6, ease: 'easeOut' }}
      className="text-center px-8"
    >
      <p className="font-heading font-extrabold text-white mb-1" style={{ fontSize: 'clamp(2.5rem, 4vw, 3.5rem)' }}>
        {display}{suffix}
      </p>
      <p className="text-white/70 font-body text-lg">{label}</p>
    </motion.div>
  )
}

export function StatsSection() {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, amount: 0.4 })

  return (
    <section className="bg-primary py-20" ref={ref}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-8 divide-x divide-white/20">
          {stats.map((stat) => (
            <StatCounter key={stat.label} {...stat} triggered={inView} />
          ))}
        </div>
      </div>
    </section>
  )
}
