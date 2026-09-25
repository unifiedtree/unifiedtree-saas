import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiJson } from '@/core/api/client'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface OnboardingTemplate {
  id: string
  tenantId: string
  companyId: string
  name: string
  description: string
  designationId: string | null
  departmentId: string | null
  active: boolean
  tasks: OnboardingTask[]
  createdAt: string
  updatedAt: string
}

export interface OnboardingTask {
  id: string
  templateId: string
  sequenceNo: number
  title: string
  description: string
  ownerRole: string | null
  dueOffsetDays: number
  required: boolean
}

export type OnboardingInstanceStatus = 'IN_PROGRESS' | 'COMPLETED' | 'ON_HOLD'

export interface OnboardingInstance {
  id: string
  employeeId: string
  templateId: string
  /** IN_PROGRESS and COMPLETED are driven by task progress; ON_HOLD is set by
   *  hand through PATCH /instances/{id}/status. The column is a plain VARCHAR
   *  server-side, so `string` stays in the union to keep an unknown value from
   *  breaking the type — the UI renders it verbatim rather than mislabelling. */
  status: OnboardingInstanceStatus | string
  startedAt: string
  completedAt: string | null
  instanceTasks: OnboardingInstanceTask[]
  createdAt: string
}

export interface OnboardingInstanceTask {
  id: string
  instanceId: string
  taskId: string
  sequenceNo: number
  title: string | null
  ownerRole: string | null
  dueDate: string | null
  status: 'PENDING' | 'COMPLETED' | 'SKIPPED' | string
  completedBy: string | null
  completedAt: string | null
  notes: string | null
  required: boolean
}

export interface CreateInstanceRequest {
  employeeId: string
  templateId: string
  joiningDate?: string
}

export interface CompleteTaskRequest {
  notes?: string
}

// ── Keys ───────────────────────────────────────────────────────────────────────

const templatesKey = () => ['hrms', 'onboarding', 'templates'] as const
const templateKey = (id: string) => ['hrms', 'onboarding', 'templates', id] as const
const instancesKey = (status?: string) => ['hrms', 'onboarding', 'instances', 'list', status ?? 'all'] as const
const instanceKey = (employeeId: string) => ['hrms', 'onboarding', 'instances', 'employee', employeeId] as const
const instanceTasksKey = (instanceId: string) => ['hrms', 'onboarding', 'instances', instanceId, 'tasks'] as const

// ── Template hooks ─────────────────────────────────────────────────────────────

export function useTemplates(companyId?: string, opts?: { enabled?: boolean }) {
  const params = companyId ? `?companyId=${companyId}` : ''
  return useQuery({
    // Include companyId in the key or a filter change won't refetch.
    queryKey: [...templatesKey(), companyId ?? 'all'],
    queryFn: () => apiJson<OnboardingTemplate[]>(`/v1/onboarding/templates${params}`),
    // GET /v1/onboarding/templates is @perm.check('hrms.onboarding.template.read')
    // — which DEPT_MANAGER and EMPLOYEE do NOT hold, even though they can
    // reach pages that reference this hook. Firing it anyway produced a
    // silent 403 that the SPA rendered as "template = —" on every row of
    // the Instances table, indistinguishable from real data. Callers must
    // pass `enabled: usePermission('hrms.onboarding.template.read')`.
    enabled: opts?.enabled ?? true,
  })
}

export function useTemplate(id: string) {
  return useQuery({
    queryKey: templateKey(id),
    queryFn: () => apiJson<OnboardingTemplate>(`/v1/onboarding/templates/${id}`),
    enabled: !!id,
  })
}

export function useCreateTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: Partial<OnboardingTemplate>) =>
      apiJson<OnboardingTemplate>('/v1/onboarding/templates', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: templatesKey() }),
  })
}

export function useUpdateTemplate(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: Partial<OnboardingTemplate>) =>
      apiJson<OnboardingTemplate>(`/v1/onboarding/templates/${id}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: templateKey(id) })
      qc.invalidateQueries({ queryKey: templatesKey() })
    },
  })
}

export function useDeleteTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiJson<void>(`/v1/onboarding/templates/${id}`, {
        method: 'DELETE',
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: templatesKey() }),
  })
}

export function useCreateTemplateTask(templateId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: Partial<OnboardingTask>) =>
      apiJson<OnboardingTask>(`/v1/onboarding/templates/${templateId}/tasks`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: templateKey(templateId) }),
  })
}

export function useDeleteTemplateTask(templateId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (taskId: string) =>
      apiJson<void>(`/v1/onboarding/templates/${templateId}/tasks/${taskId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: templateKey(templateId) }),
  })
}

// ── Instance hooks ─────────────────────────────────────────────────────────────

export function useInstances(status?: string, enabled = true) {
  const params = status ? `?status=${status}` : ''
  return useQuery({
    queryKey: instancesKey(status),
    enabled,
    queryFn: () => apiJson<OnboardingInstance[]>(`/v1/onboarding/instances${params}`),
  })
}

/**
 * Start an onboarding run for a new hire.
 *
 * 2026-09-09: this hook existed but no component imported it, so there was no
 * way anywhere in the product to start onboarding — the Instances page even
 * told the user instances appear "when a new hire is assigned an onboarding
 * template" while offering no control to assign one. Now wired to the "Start
 * Onboarding" button on that page, and invalidating the list so the new run
 * shows up immediately instead of after a manual refresh.
 */
export function useCreateInstance() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateInstanceRequest) =>
      apiJson<OnboardingInstance>('/v1/onboarding/instances', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'onboarding', 'instances'] }),
  })
}

/**
 * Pause / resume / close out an onboarding run.
 *
 * Backs the On Hold state on the onboarding dashboard. Task completion moves a
 * run IN_PROGRESS -> COMPLETED on its own; this is the only way to reach
 * ON_HOLD, or to reopen a run that was closed early. Requires
 * hrms.onboarding.instance.write (HR/admin) — a new hire holds
 * onboarding.task.complete only and cannot park their own onboarding.
 */
export function useUpdateInstanceStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ instanceId, status }: { instanceId: string; status: OnboardingInstanceStatus }) =>
      apiJson<OnboardingInstance>(`/v1/onboarding/instances/${instanceId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      }),
    // Same wide prefix as useCompleteTask: the list, the single instance and
    // the employee-keyed lookup all show the status, and a stale pill after a
    // hold/resume reads as the action having failed.
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'onboarding'] }),
  })
}

export function useEmployeeInstance(employeeId: string) {
  return useQuery({
    queryKey: instanceKey(employeeId),
    queryFn: () => apiJson<OnboardingInstance>(`/v1/onboarding/instances/employee/${employeeId}`),
    enabled: !!employeeId,
  })
}

/**
 * Fetch one instance by its own id. The Instances list used to navigate by
 * employeeId into the employee-keyed endpoint, which only matched IN_PROGRESS —
 * so every COMPLETED row dead-ended on "No onboarding instance"
 * (2026-09-08 audit).
 */
export function useInstance(instanceId: string) {
  return useQuery({
    queryKey: ['onboarding', 'instance-by-id', instanceId] as const,
    queryFn: () => apiJson<OnboardingInstance>(`/v1/onboarding/instances/${instanceId}`),
    enabled: !!instanceId,
  })
}

export function useInstanceTasks(instanceId: string) {
  return useQuery({
    queryKey: instanceTasksKey(instanceId),
    queryFn: () => apiJson<OnboardingInstanceTask[]>(`/v1/onboarding/instances/${instanceId}/tasks`),
    enabled: !!instanceId,
  })
}

export function useCompleteTask(instanceId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ taskId, notes }: { taskId: string; notes?: string }) =>
      apiJson<OnboardingInstanceTask>(`/v1/onboarding/instance-tasks/${taskId}/complete`, {
        method: 'POST',
        body: JSON.stringify({ notes } satisfies CompleteTaskRequest),
      }),
    // 2026-09-10: was invalidating only the task list, so the header status
    // pill + progress bar stayed stale after each click, and — worse — when
    // the LAST task completed the backend flipped the instance to COMPLETED
    // and the header still read "In progress" until a manual refresh.
    // Widen the prefix so the instance query and the instance list refetch too.
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'onboarding'] }),
  })
}

export function useSkipTask(instanceId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ taskId, notes }: { taskId: string; notes?: string }) =>
      apiJson<OnboardingInstanceTask>(`/v1/onboarding/instance-tasks/${taskId}/skip`, {
        method: 'POST',
        body: JSON.stringify({ notes } satisfies CompleteTaskRequest),
      }),
    // 2026-09-10: was invalidating only the task list, so the header status
    // pill + progress bar stayed stale after each click, and — worse — when
    // the LAST task completed the backend flipped the instance to COMPLETED
    // and the header still read "In progress" until a manual refresh.
    // Widen the prefix so the instance query and the instance list refetch too.
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'onboarding'] }),
  })
}

// ── Task order, owner roles, hire details (V143.20) ─────────────────────────────

/** New order for a template's tasks (every task id exactly once). Onboardings already started keep theirs. */
export function useReorderTemplateTasks(templateId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (taskIds: string[]) =>
      apiJson<OnboardingTemplate>(`/v1/onboarding/templates/${templateId}/tasks/order`, { method: 'PUT', body: JSON.stringify({ taskIds }) }),
    onSuccess: (template) => {
      qc.setQueryData(templateKey(templateId), template)
      qc.invalidateQueries({ queryKey: templatesKey() })
    },
  })
}

/** The workspace's roles a checklist task can be owned by. */
export function useOwnerRoles(enabled = true) {
  return useQuery({
    queryKey: ['hrms', 'onboarding', 'owner-roles'],
    queryFn: () => apiJson<{ code: string; name: string }[]>('/v1/onboarding/owner-roles'),
    enabled,
    staleTime: 5 * 60_000,
  })
}

export interface HirePerson { id: string; name: string }
export interface HireDetails {
  instanceId: string | null
  employeeId: string
  candidateId: string | null
  offerAcceptedOn: string | null
  hiringManager: HirePerson | null
  recruiter: HirePerson | null
  buddy: HirePerson | null
  source: string | null
  /** Read from the hiring record because no onboarding holds them yet. */
  fromHiring: boolean
}
export interface HireDetailsInput { offerAcceptedOn?: string | null; hiringManagerId?: string | null; recruiterId?: string | null; buddyId?: string | null; source?: string | null }

export function useHireDetails(instanceId: string, enabled = true) {
  return useQuery({
    queryKey: ['hrms', 'onboarding', 'instances', instanceId, 'hire-details'],
    queryFn: () => apiJson<HireDetails>(`/v1/onboarding/instances/${instanceId}/hire-details`),
    enabled: !!instanceId && enabled,
  })
}

export function useUpdateHireDetails(instanceId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: HireDetailsInput) =>
      apiJson<HireDetails>(`/v1/onboarding/instances/${instanceId}/hire-details`, { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: (data) => {
      qc.setQueryData(['hrms', 'onboarding', 'instances', instanceId, 'hire-details'], data)
      qc.invalidateQueries({ queryKey: ['hrms', 'onboarding-record'] })
    },
  })
}

export interface MyAsset {
  assetId: string; assetTag: string; assetType: string; assetName: string; serialNo?: string | null
  assignedAt?: string | null; returnedAt?: string | null; returnNotes?: string | null; withMe: boolean
}
export function useMyAssets(enabled = true) {
  return useQuery({ queryKey: ['hrms', 'me', 'assets'], queryFn: () => apiJson<MyAsset[]>('/v1/me/assets'), enabled })
}
