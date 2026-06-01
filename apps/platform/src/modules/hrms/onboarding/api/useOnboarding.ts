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

export interface OnboardingInstance {
  id: string
  employeeId: string
  templateId: string
  status: 'IN_PROGRESS' | 'COMPLETED' | string
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
const instanceKey = (employeeId: string) => ['hrms', 'onboarding', 'instances', 'employee', employeeId] as const
const instanceTasksKey = (instanceId: string) => ['hrms', 'onboarding', 'instances', instanceId, 'tasks'] as const

// ── Template hooks ─────────────────────────────────────────────────────────────

export function useTemplates(companyId?: string) {
  const params = companyId ? `?companyId=${companyId}` : ''
  return useQuery({
    queryKey: templatesKey(),
    queryFn: () => apiJson<OnboardingTemplate[]>(`/v1/onboarding/templates${params}`),
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

export function useCreateInstance() {
  return useMutation({
    mutationFn: (body: CreateInstanceRequest) =>
      apiJson<OnboardingInstance>('/v1/onboarding/instances', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
  })
}

export function useEmployeeInstance(employeeId: string) {
  return useQuery({
    queryKey: instanceKey(employeeId),
    queryFn: () => apiJson<OnboardingInstance>(`/v1/onboarding/instances/employee/${employeeId}`),
    enabled: !!employeeId,
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
    onSuccess: () => qc.invalidateQueries({ queryKey: instanceTasksKey(instanceId) }),
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
    onSuccess: () => qc.invalidateQueries({ queryKey: instanceTasksKey(instanceId) }),
  })
}
