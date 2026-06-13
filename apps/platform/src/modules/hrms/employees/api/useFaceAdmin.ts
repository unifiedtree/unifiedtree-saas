import { apiJson } from '@/core/api/client'

/**
 * Admin-side face reset. Wipes the employee's face enrollment + templates and
 * resets the failure/lockout counter so they can enroll again from the mobile
 * app. Permission: {@code attendance.face.admin.reset}.
 *
 * <p>Server-side endpoint:
 * {@code POST /v1/attendance/face/admin/{employeeId}/reset}.
 */
export async function resetFaceEnrollment(employeeId: string): Promise<{ status: string }> {
  return apiJson(`/v1/attendance/face/admin/${employeeId}/reset`, { method: 'POST', body: '{}' })
}
