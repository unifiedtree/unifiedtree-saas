import React from 'react'
import { motion } from 'framer-motion'
import { MessageCircle, Send } from 'lucide-react'
import { StatCard } from '@/shared/components/StatCard'

const stagger = { hidden: {}, show: { transition: { staggerChildren: 0.06 } } }

export const WhatsAppWidgets: React.FC = () => {
  return (
    <>
      <h3 className="font-display text-lg font-semibold text-brand-900 mt-6 mb-2">WhatsApp Automation</h3>
      <motion.div variants={stagger} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StatCard title="Active Campaigns" value="3" change="Running" changeType="neutral" icon={Send} iconColor="text-sky-500" iconBg="bg-sky-50" />
        <StatCard title="Open Conversations" value="28" change="Require attention" changeType="negative" icon={MessageCircle} iconColor="text-brand-600" iconBg="bg-brand-soft" />
      </motion.div>
    </>
  )
}
