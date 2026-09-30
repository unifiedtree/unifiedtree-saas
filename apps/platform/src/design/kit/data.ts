// The data and layout half of the redesign kit: section layout, the week grid, item cards with
// actions, file drop, check lists, hidden amounts, the header date chip, step timelines, the
// pager and the table's selection bar.
//   import { SectionGrid, WeekGrid, ActionCard, UploadDrop, Pager, BulkBar, … } from '@/design/kit/data'
// The table itself is the display half's Table ('@/design/kit/display'); BulkBar and Pager work
// with it. Pop-ups and form fields: '@/design/kit/overlays'.
//
// Components only render what they're given — pass real values from the API.
// Styles: ./data.css (tokens var(--u-*, light fallback), dark-safe), on top of ./display.css.

export { SectionGrid, SectionCell } from './SectionGrid'
export type { SectionGridProps, SectionCellProps, SectionWidth } from './SectionGrid'

export { WeekGrid, WeekLegend, weekDays, shiftWeek, dayHead, weekLabel, weekCoverage, weekGridKeyTarget } from './WeekGrid'
export type {
  WeekGridProps, WeekRow, WeekCell, WeekTone, WeekDayCoverage, WeekCoverageCount, WeekGridMove, WeekLegendItem,
} from './WeekGrid'

export { ActionCard, ActionCardGrid } from './ActionCard'
export type { ActionCardProps, ActionCardAction, ActionCardTone, ActionCardGridProps } from './ActionCard'

export { UploadDrop, UploadFile, checkFile, acceptsFile, describeAccept, formatBytes, fileExtension } from './UploadDrop'
export type { UploadDropProps, UploadDropVariant, UploadFileProps, FileRejection, FileProblem } from './UploadDrop'

export { CheckList } from './CheckList'
export type { CheckListProps, CheckItem, CheckState } from './CheckList'

export { AmountMask, AmountToggle, maskAmount, maskAmountsIn, maskDots, currencyOf } from './AmountMask'
export type { AmountMaskProps, AmountToggleProps, MaskOptions } from './AmountMask'

export { DateChip } from './DateChip'
export type { DateChipProps } from './DateChip'

export { Timeline } from './Timeline'
export type { TimelineProps, TimelineItem, TimelineState } from './Timeline'

export { Pager, pageCount, pageRange, pageList, clampPage } from './Pager'
export type { PagerProps, PageItem } from './Pager'

export { BulkBar } from './BulkBar'
export type { BulkBarProps, BulkAction } from './BulkBar'
