import { motion } from 'framer-motion'
import { ReactNode } from 'react'

interface ButtonProps {
  children: ReactNode
  variant?: 'filled' | 'ghost' | 'outline'
  size?: 'sm' | 'md' | 'lg'
  onClick?: () => void
  type?: 'button' | 'submit' | 'reset'
  disabled?: boolean
  className?: string
  fullWidth?: boolean
}

export function Button({
  children,
  variant = 'filled',
  size = 'md',
  onClick,
  type = 'button',
  disabled = false,
  className = '',
  fullWidth = false,
}: ButtonProps) {
  const base =
    'inline-flex items-center justify-center gap-2 font-semibold rounded-lg transition-all duration-200 cursor-pointer select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2'

  const sizes = {
    sm: 'h-10 px-4 text-sm',
    md: 'h-11 px-5 text-[15px]',
    lg: 'h-[52px] px-7 text-base',
  }

  const variants = {
    filled: 'bg-primary text-lime shadow-sm hover:shadow-teal-lg btn-shimmer',
    ghost: 'bg-white text-primary border border-primary/25 hover:bg-primary-light hover:border-primary',
    outline: 'bg-white text-text-secondary border border-border hover:border-primary hover:text-primary',
  }

  return (
    <motion.button
      type={type}
      onClick={onClick}
      disabled={disabled}
      whileHover={{ scale: disabled ? 1 : 1.02 }}
      whileTap={{ scale: disabled ? 1 : 0.98 }}
      className={`${base} ${sizes[size]} ${variants[variant]} ${fullWidth ? 'w-full' : ''} ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${className}`}
    >
      {children}
    </motion.button>
  )
}
