import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiJson } from '@/core/api/client'

/**
 * Admin geofencing-zones data layer.
 *
 * Backend (LegacyAttendanceExtrasController, profile !canonical|canonical-prod):
 *   GET    /v1/attendance/geofence/zones        @PreAuthorize attendance.team.read
 *   POST   /v1/attendance/geofence/zones        @PreAuthorize org.geofence.write
 *   PUT    /v1/attendance/geofence/zones/{id}   @PreAuthorize org.geofence.write
 *   DELETE /v1/attendance/geofence/zones/{id}   @PreAuthorize org.geofence.write  (soft-delete)
 *
 * Shapes mirror GeoFenceZoneRequest / GeoFenceZoneResponse records.
 */

export interface GeoFenceZone {
  id: string
  companyId?: string
  branchId?: string
  departmentId?: string
  name: string
  latitude: number
  longitude: number
  radiusMeters: number
  punchMethod?: string
  colorHex?: string
  iconKey?: string
  active: boolean
}

export interface GeoFenceZonePayload {
  name: string
  latitude: number
  longitude: number
  radiusMeters: number
  departmentId?: string
  punchMethod?: string
  colorHex?: string
  iconKey?: string
  active?: boolean
}

const ZONES_KEY = ['hrms', 'attendance', 'geofence-zones'] as const

export function useGeofenceZones() {
  return useQuery({
    queryKey: ZONES_KEY,
    queryFn: () => apiJson<GeoFenceZone[]>('/v1/attendance/geofence/zones'),
    staleTime: 30_000,
  })
}

export function useCreateGeofenceZone() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: GeoFenceZonePayload) =>
      apiJson<GeoFenceZone>('/v1/attendance/geofence/zones', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ZONES_KEY }),
  })
}

export function useUpdateGeofenceZone() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...data }: GeoFenceZonePayload & { id: string }) =>
      apiJson<GeoFenceZone>(`/v1/attendance/geofence/zones/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ZONES_KEY }),
  })
}

export function useDeleteGeofenceZone() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiJson<void>(`/v1/attendance/geofence/zones/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ZONES_KEY }),
  })
}
