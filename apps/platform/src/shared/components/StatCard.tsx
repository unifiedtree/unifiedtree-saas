import React from 'react'
import { motion } from 'framer-motion'
import { clsx } from 'clsx'
import type { LucideIcon } from 'lucide-react'

interface StatCardProps {
  title: string
  value: string | number
  change?: string
  changeType?: 'positive' | 'negative' | 'neutral'
  icon: LucideIcon
  iconColor?: string
  iconBg?: string
  subtitle?: string
}

export const StatCard: React.FC<StatCardProps> = ({
  title,
  value,
  change,
  changeType = 'neutral',
  icon: Icon,
  iconColor = 'text-brand-600',
  iconBg = 'bg-brand-soft',
  subtitle,
}) => (
  <motion.div
    initial={{ opacity: 0, y: 14 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
    className="ut-card ut-card-sm ut-card-hover group p-5 transition-all duration-300"
  >
    <div className="mb-4 flex items-start justify-between">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--text-tertiary)]">{title}</p>
        <p className="mt-2 font-display text-3xl font-bold tracking-tight text-[var(--text-primary)]">{value}</p>
        {subtitle && <p className="mt-1 text-xs font-medium text-[var(--text-tertiary)]">{subtitle}</p>}
      </div>
      <div className={clsx('flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl shadow-2xs transition-transform duration-200 group-hover:scale-105', iconBg)}>
        <Icon size={20} className={iconColor} />
      </div>
    </div>
    {change && (
      <div className={clsx(
        'flex items-center gap-1.5 text-xs font-bold',
        changeType === 'positive' && 'text-emerald-600 dark:text-emerald-400',
        changeType === 'negative' && 'text-rose-600 dark:text-rose-400',
        changeType === 'neutral'  && 'text-[var(--text-tertiary)]',
      )}>
        <span>{change}</span>
        <span className="font-medium text-[var(--text-disabled)]">vs last month</span>
      </div>
    )}
  </motion.div>
)
