// The display half of the redesign kit: everything that shows data.
//   import { PageHeader, StatCard, Section, StatusPill, … } from '@/design/kit/display'
// The overlay/form half (SidePanel, Dialog, Popover/Menu, Dropdown, Toast,
// FormField, ApprovalRow) lives next to it. Motion hooks: '@/design/theme/motion'.
//
// Components only render what they're given — pass real values from the API.
// Styles: ./display.css (tokens var(--u-*, light fallback), dark-safe);
// motion: ../theme/motion.css. Both load with the components.

export { PageHeader, PageFrame } from './PageHeader'
export type { PageHeaderProps, PageFrameProps } from './PageHeader'

export { PillTabs, PagePill } from './PillTabs'
export type { PillTab, PillTabsProps, PillTabsSemantics, PagePillProps } from './PillTabs'

export { SearchPill } from './SearchPill'
export type { SearchPillProps } from './SearchPill'

export { StatCard, StatGrid, CountUp, accentColor } from './StatCard'
export type { StatCardProps, StatCardVariant, StatAccent, StatTone, StatMood, StatTrend, StatGridProps, CountUpProps } from './StatCard'

export { QuickActionTile, QuickActionGrid } from './QuickActionTile'
export type { QuickActionTileProps, QuickActionGridProps } from './QuickActionTile'

export { QuickIcon, AniIcon, QUICK_ICON_KINDS, ANI_ICON_KINDS } from './AnimatedIcons'
export type { QuickIconKind, QuickIconProps, AniIconKind, AniIconProps } from './AnimatedIcons'

export { Card } from './Card'
export type { CardProps } from './Card'

export { Section, SectionHeading, SectionLink, SectionAction, MiniStat, MiniStatGrid, KeyValueGrid } from './Section'
export type { SectionProps, SectionEmpty, SectionSkeleton, SectionHeadingProps, SectionLinkProps, SectionActionProps, MiniStatProps, KeyValueItem } from './Section'

export { ListRow, ListRows, IconTile, DateTile } from './ListRow'
export type { ListRowProps, ListRowVariant, ListRowsProps, IconTileProps, DateTileProps } from './ListRow'

export { StatusPill, CountBadge, Chip, StatusDot, STATUS_TONES } from './StatusPill'
export type { StatusPillProps, StatusTone, CountBadgeProps, ChipProps, StatusDotProps } from './StatusPill'

export { Avatar, initialsOf } from './Avatar'
export type { AvatarProps, AvatarTone } from './Avatar'

export { EmptyState, ErrorState, errorText } from './EmptyState'
export type { EmptyStateProps, EmptyVariant, ErrorStateProps } from './EmptyState'

export { Skeleton, SkeletonBlock, SkeletonText, SkeletonList, SkeletonStats, SkeletonTable, SkeletonChart } from './Skeleton'
export type { SkeletonProps, SkeletonBlockProps } from './Skeleton'

export { ProgressBar, StackedBar, Legend, segmentColor } from './ProgressBar'
export type { ProgressBarProps, BarTone, StackedBarProps, StackedSegment, LegendItem } from './ProgressBar'

export { Meter, BarList } from './Meter'
export type { MeterProps, BarListProps, BarListItem } from './Meter'

export { ProgressRing, DonutRing, GeofenceRing, geofenceRadius, donutArcs } from './Ring'
export type { ProgressRingProps, DonutRingProps, GeofenceRingProps } from './Ring'

export { MonthCalendar, CalendarLegend, monthWeeks, calendarKeyTarget } from './MonthCalendar'
export type { MonthCalendarProps, CalendarDay, CalendarTone, CalendarVariant, CalendarLegendItem } from './MonthCalendar'

export { SegmentedControl } from './SegmentedControl'
export type { SegmentedControlProps, SegmentOption } from './SegmentedControl'

export { FilterPills } from './FilterPills'
export type { FilterPillsProps, FilterPillOption } from './FilterPills'

export { Sparkline, sparkShape, smoothPath } from './Sparkline'
export type { SparklineProps, SparklineVariant, SparkShape } from './Sparkline'
