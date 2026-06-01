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
    transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
    whileHover={{ y: -3 }}
    className="rounded-2xl border border-[#E2E8F0] bg-white p-5 shadow-md transition-all hover:border-[#0F6E56]/20 hover:shadow-lg"
  >
    <div className="mb-4 flex items-start justify-between">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-[#64748B]">{title}</p>
        <p className="mt-1.5 font-display text-3xl font-bold tracking-tight text-[#0F172A]">{value}</p>
        {subtitle && <p className="mt-0.5 text-xs text-[#64748B]">{subtitle}</p>}
      </div>
      <div className={clsx('flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl', iconBg)}>
        <Icon size={19} className={iconColor} />
      </div>
    </div>
    {change && (
      <div className={clsx(
        'flex items-center gap-1.5 text-xs font-semibold',
        changeType === 'positive' && 'text-brand-600',
        changeType === 'negative' && 'text-rose-500',
        changeType === 'neutral'  && 'text-brand-900/55',
      )}>
        <span>{change}</span>
        <span className="font-normal text-brand-900/40">vs last month</span>
      </div>
    )}
  </motion.div>
)
