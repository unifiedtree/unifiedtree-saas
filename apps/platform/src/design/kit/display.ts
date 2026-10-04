// The display half of the redesign kit: everything that shows data, plus the
// page-level Button and the Table.
//   import { PageHeader, StatCard, Section, StatusPill, Button, Table, … } from '@/design/kit/display'
// The overlay/form half (SidePanel, Dialog, Popover/Menu, Dropdown, Toast,
// FormField, ApprovalRow) lives next to it. Motion hooks: '@/design/theme/motion'.
//
// Components only render what they're given — pass real values from the API.
// Styles: ./display.css (tokens var(--u-*, light fallback), dark-safe);
// motion: ../theme/motion.css. Both load with the components.

export { PageHeader, PageFrame } from './PageHeader'
export type { PageHeaderProps, PageFrameProps } from './PageHeader'

export { PillTabs, PagePill } from './PillTabs'
export type { PillTab, PillTabsProps, PillTabsSemantics, PillTabsPlacement, PagePillProps } from './PillTabs'

export { PageTabsHost, PageTabsInline, usePageTabsSlot } from './pageTabs'
export type { PageTabsSlot } from './pageTabs'

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
export type { MonthCalendarProps, CalendarDay, CalendarTag, CalendarTone, CalendarVariant, CalendarLegendItem } from './MonthCalendar'

export { SegmentedControl } from './SegmentedControl'
export type { SegmentedControlProps, SegmentOption } from './SegmentedControl'

export { FilterPills } from './FilterPills'
export type { FilterPillsProps, FilterPillOption } from './FilterPills'

export { Sparkline, sparkShape, smoothPath } from './Sparkline'
export type { SparklineProps, SparklineVariant, SparkShape } from './Sparkline'

export { Button } from './Button'
export type { ButtonProps, ButtonVariant, ButtonSize } from './Button'

export { Table, CellPerson, CellStack, CellActions } from './Table'
export type { TableProps, TableColumn, TableSort, RowKey, CellPersonProps } from './Table'

export { ColumnChart, columnHeight } from './ColumnChart'
export type { ColumnChartProps, ColumnBar, ColumnTone } from './ColumnChart'

export { Ledger, LedgerNet } from './Ledger'
export type { LedgerProps, LedgerGroup, LedgerLine, LedgerNetProps } from './Ledger'

export { StepTrack } from './StepTrack'
export type { StepTrackProps, StepItem, StepState } from './StepTrack'

export { Callout } from './Callout'
export type { CalloutProps } from './Callout'
