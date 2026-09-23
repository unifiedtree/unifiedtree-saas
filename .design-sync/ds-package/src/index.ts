/**
 * design-sync entry — the component namespace claude.ai/design builds with.
 *
 * ONE namespace, deliberately. The platform is built from two layers that
 * both export `DataTable`, `EmptyState` and `StatCard`: the generic
 * @unifiedtree/ui-kit, and the HRMS-styled versions under
 * apps/platform/src/shared/components that every HRMS screen actually uses.
 * A design agent handed both would pick at random. So the ui-kit layer is
 * re-exported WITHOUT those three names and the HRMS versions take them —
 * the design agent then builds with exactly the parts the screens use, under
 * the names the code uses.
 *
 * This file is sync input only. The app never imports it.
 */

// ── Generic layer (@unifiedtree/ui-kit) ─────────────────────────────────────
export {
  Avatar, Badge, Button, buttonVariants,
  Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle,
  Drawer, Modal,
  Field, Input, Label,
  PageHeader, Separator,
  Skeleton, CardSkeleton, StatsSkeleton, TableSkeleton,
  Tabs, TabsContent, TabsList, TabsTrigger,
  Toaster, toast, cn,
} from '@unifiedtree/ui-kit'
export type { ButtonProps, InputProps, TabsProps, TabsTriggerProps, TabsContentProps } from '@unifiedtree/ui-kit'

// ── HRMS primitives (apps/platform/src/shared/components) ───────────────────
export {
  HrStatCard, HrStatusPill, HrPageHeader, HrButton, TableCard, FilterBar,
  HrAvatar, HrTabs, HrTabPanel, HrSelect, HrDrawer,
} from '../../../apps/platform/src/shared/components/hr'
export type { PillTone, HrTab, HrSelectOption, FilterDef, FilterOption } from '../../../apps/platform/src/shared/components/hr'

export { DataTable } from '../../../apps/platform/src/shared/components/DataTable'
export type { Column } from '../../../apps/platform/src/shared/components/DataTable'
export { EmptyState } from '../../../apps/platform/src/shared/components/EmptyState'
export { StatCard } from '../../../apps/platform/src/shared/components/StatCard'
export { HrPagination, hrPaginationFooter, useClampedPage } from '../../../apps/platform/src/shared/components/HrPagination'
export type { HrPaginationProps } from '../../../apps/platform/src/shared/components/HrPagination'
export { SkeletonCard, SkeletonCardGrid, SkeletonRow, SkeletonBlock } from '../../../apps/platform/src/shared/components/SkeletonCard'
export { ConfirmDialogProvider, useConfirmDialog } from '../../../apps/platform/src/shared/components/ConfirmDialog'
export type { ConfirmOptions } from '../../../apps/platform/src/shared/components/ConfirmDialog'
