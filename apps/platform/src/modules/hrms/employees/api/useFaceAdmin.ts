import { apiJson } from '@/core/api/client'

/**
 * Admin-side face reset. Revokes the employee's face enrollment, deactivates the
 * stored templates and clears the failure/lockout counter, so they must enroll
 * again before they can face-punch. Permission: {@code attendance.face.admin.reset}.
 *
 * <p>Server-side endpoint:
 * {@code POST /v1/attendance/face/admin/employees/{employeeId}/reset}.
 *
 * <p>Takes the HR employee record id. It used to POST to
 * {@code /v1/attendance/face/admin/{employeeId}/reset}, which keys on the LOGIN
 * id instead: for anyone whose login id isn't their employee id (i.e. every
 * invited employee — only the signup admin gets the two equal) that matched no
 * row, reset nothing and still answered 204, so the UI showed a success toast
 * while the templates stayed live. The `/employees/` route maps the employee id
 * to the login server-side, and answers 409 `FACE_NO_LOGIN:…` when the person
 * has no login to reset.
 */
export async function resetFaceEnrollment(employeeId: string): Promise<void> {
  await apiJson<void>(`/v1/attendance/face/admin/employees/${employeeId}/reset`, { method: 'POST', body: '{}' })
}
