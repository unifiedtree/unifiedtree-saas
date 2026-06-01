import { useState, useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'

const taglines = [
  'Like a Tree. Deeply Rooted.',
  'Branches Across Every Department.',
  'One Root. Infinite Growth.',
  'Finance, HR, Sales — All Connected.',
  'Offline Today. Synced Tomorrow.',
  'Growing Businesses Choose UnifiedTree.',
]

const variants = {
  enter: { y: 30, opacity: 0 },
  center: { y: 0, opacity: 1 },
  exit: { y: -30, opacity: 0 },
}

export function AnimatedTagline() {
  const [index, setIndex] = useState(0)
  const prefersReduced =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches

  useEffect(() => {
    if (prefersReduced) return
    const timer = setInterval(() => {
      setIndex((i) => (i + 1) % taglines.length)
    }, 2500)
    return () => clearInterval(timer)
  }, [prefersReduced])

  if (prefersReduced) {
    return (
      <span
        className="block text-primary font-heading font-bold"
        style={{ fontSize: 'clamp(1.25rem, 2vw, 1.75rem)', lineHeight: 1.3 }}
      >
        {taglines[0]}
      </span>
    )
  }

  return (
    /* Fixed height container sized to ONE line of the tagline font */
    <div className="relative overflow-hidden" style={{ height: 'clamp(1.7rem, 2.6vw, 2.3rem)' }}>
      <AnimatePresence mode="wait">
        <motion.span
          key={index}
          variants={variants}
          initial="enter"
          animate="center"
          exit="exit"
          transition={{ type: 'spring', stiffness: 320, damping: 32 }}
          className="absolute inset-0 flex items-center text-primary font-heading font-bold whitespace-nowrap"
          style={{ fontSize: 'clamp(1.25rem, 2vw, 1.75rem)', lineHeight: 1.3 }}
        >
          {taglines[index]}
        </motion.span>
      </AnimatePresence>
    </div>
  )
}
