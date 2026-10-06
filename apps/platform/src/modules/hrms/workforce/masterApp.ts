// The Master data context the Workforce directory runs on (built by master/MasterContainer:
// the directory, org lists and settings from the API, and `update`, which diffs a list and
// saves the change through master/masterSync). The kit page reads the same context the
// design's Employee Master read, so every save, check and message stays the same.
import { useContext, useMemo, type Context, type ReactNode } from 'react'
import * as Design from '@/design/master/MasterDesign'
import { NONE } from '@/design/master/masterRuntime'
import type { AccessDraft } from '@/modules/rbac/api/newPersonAccess'
import type { CreateKind } from '../master/masterCreate'
import type { Rec } from '../master/masterData'
import type { Lookups } from './directoryModel'

export interface MasterRoute { p: string; q: string; status: string; co: string; dept: string; branch: string; archived: boolean }
export interface MasterNavGroup { id: string; l: string; items: { id: string; l: string }[] }

export interface MasterAct {
  /** The top bar's company when there are two or more ('' with one): the directory lists its people. */
  globalCo: string
  defaultCo: string
  canAssignShift: boolean
  canBands: boolean
  showAgency: boolean
  canAgency: boolean
  /** Add employee → Access (null when the viewer can't give access). */
  accessStep: ((value: AccessDraft | undefined, onChange: (next: AccessDraft) => void) => ReactNode) | null
  /** Add employee → "Create" beside a field. */
  inlineCreate: (kind: CreateKind, values: Rec, set: (k: string, x: unknown) => void) => ReactNode
  importEmployees: () => void
  openRecord: (id: string) => void
  milestone: { value: string; options: { v: string; l: string }[]; set: (v: string) => void; ids: Set<string> | null }
  exportEmployees: (rows: Rec[]) => void
  typeOptions: (cur?: string) => string[]
}

export interface MasterApp {
  db: Record<string, Rec[]>
  update: (k: string, fn: Rec[] | ((list: Rec[]) => Rec[])) => void
  toast: (msg: string, kind?: string) => void
  go: (page: string, extra?: Record<string, string>) => void
  route: MasterRoute
  nav: MasterNavGroup[]
  group: MasterNavGroup | null
  act: MasterAct
}

const AppCtx = Design.AppCtx as unknown as Context<MasterApp>

export function useMasterApp(): MasterApp {
  return useContext(AppCtx)
}

type Maps = {
  dept: Record<string, Rec>; desig: Record<string, Rec>; branch: Record<string, Rec>; co: Record<string, Rec>
  grade: Record<string, Rec>; shift: Record<string, Rec>; emp: Record<string, Rec>
}

/** Records by id; a missing department, designation or branch reads as the design's "—" stand-in. */
export function useMaps(db: Record<string, Rec[]>): Maps & { look: Lookups } {
  return useMemo(() => {
    const by = (list: Rec[]) => Object.fromEntries((list || []).map((x) => [x.id as string, x])) as Record<string, Rec>
    const dept = by(db.depts), desig = by(db.desigs), branch = by(db.branches)
    const or = (m: Record<string, Rec>, none: Rec) => (id: string) => (id && m[id]) || none
    const deptOf = or(dept, NONE.dept as Rec), desigOf = or(desig, NONE.desig as Rec), branchOf = or(branch, NONE.branch as Rec)
    const look: Lookups = { depts: db.depts || [], deptName: (id) => deptOf(id).name, desigName: (id) => desigOf(id).name }
    return {
      dept: new Proxy(dept, { get: (_t, k) => deptOf(String(k)) }),
      desig: new Proxy(desig, { get: (_t, k) => desigOf(String(k)) }),
      branch: new Proxy(branch, { get: (_t, k) => branchOf(String(k)) }),
      co: by(db.companies), grade: by(db.grades), shift: by(db.shifts), emp: by(db.employees), look,
    }
  }, [db])
}
