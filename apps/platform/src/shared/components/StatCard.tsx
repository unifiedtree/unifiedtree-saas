// The design's stat card (prototype UtStat = the kit StatCard "stat" variant):
// round tone icon, label, figure (counts up), then the change and a note.
// Same props as before; the icon colour classes pick the nearest design tone.
import React from 'react'
import type { LucideIcon } from 'lucide-react'
import { StatCard as KitStatCard, type StatTone } from '@/design/kit/StatCard'

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

/** The icon's old colour classes → the design's four stat tones (brand, gold, red, gray). */
function toneOf(...classes: (string | undefined)[]): StatTone {
  const c = classes.filter(Boolean).join(' ')
  if (/\b(?:text|bg)-(?:red|rose)-/.test(c)) return 'red'
  if (/\b(?:text|bg)-(?:amber|orange|yellow|peach)-/.test(c)) return 'gold'
  if (/\b(?:text|bg)-(?:gray|slate|zinc|neutral)-/.test(c)) return 'gray'
  return 'brand'
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
  <KitStatCard
    variant="stat"
    label={title}
    // Shown at once and exactly as given, as before (no count-up, no regrouping).
    value={String(value)}
    countUp={false}
    icon={<Icon size={20} aria-hidden="true" />}
    tone={toneOf(iconColor, iconBg)}
    delta={change}
    trend={changeType === 'negative' ? 'down' : changeType === 'positive' ? 'up' : 'flat'}
    mood={changeType === 'positive' ? 'good' : changeType === 'negative' ? 'bad' : 'flat'}
    note={subtitle ?? (change ? 'vs last month' : undefined)}
  />
)
