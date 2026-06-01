import React from 'react'
import { motion } from 'framer-motion'
import { TrendingUp, DollarSign } from 'lucide-react'
import { StatCard } from '@/shared/components/StatCard'

const stagger = { hidden: {}, show: { transition: { staggerChildren: 0.06 } } }

export const CRMWidgets: React.FC = () => {
  return (
    <>
      <h3 className="font-display text-lg font-semibold text-brand-900 mt-6 mb-2">CRM Activity</h3>
      <motion.div variants={stagger} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StatCard title="Active Leads" value="12" change="New this week" changeType="positive" icon={TrendingUp} iconColor="text-brand-mint" iconBg="bg-brand-100" />
        <StatCard title="Pipeline Value" value="$45,200" change="Closing soon" changeType="positive" icon={DollarSign} iconColor="text-peach-500" iconBg="bg-peach-50" />
      </motion.div>
    </>
  )
}
