import React from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { getAccessToken, useAuthStore } from '@unifiedtree/sdk'
import { API_BASE_URL } from '@/core/api/client'

// ── Response shape — mirrors backend BulkImportResult record exactly ──────────

export interface BulkImportResult {
  totalRows: number
  successCount: number
  errorCount: number
  errors: string[]    // flat "Row N: message" strings from backend
  committed: boolean  // false on validate or failed commit; true only on full commit
}

// ── Derived helper types for UI ───────────────────────────────────────────────

export interface ParsedError {
  id: string        // rowNumber + "_" + index (for DataTable keyField)
  rowNumber: number // parsed from "Row N: ..." — actual file row, not array index
  message: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function parseErrors(errors: string[]): ParsedError[] {
  return errors.map((err, idx) => {
    const match = err.match(/^Row (\d+): (.+)$/)
    return {
      id: `${match ? match[1] : '0'}_${idx}`,
      rowNumber: match ? parseInt(match[1], 10) : 0,
      message: match ? match[2] : err,
    }
  })
}

export function countValidRows(result: BulkImportResult): number {
  const errorRowNums = new Set(
    parseErrors(result.errors)
      .filter((e) => e.rowNumber > 0)
      .map((e) => e.rowNumber),
  )
  return result.totalRows - errorRowNums.size
}

// ── XHR upload with progress ──────────────────────────────────────────────────

function uploadFile<T>(
  path: string,
  file: File,
  queryParams: Record<string, string>,
  onProgress?: (pct: number) => void,
): Promise<T> {
  const token = getAccessToken()
  const tenantId = useAuthStore.getState().tenant?.id

  return new Promise((resolve, reject) => {
    const qs = new URLSearchParams(queryParams).toString()
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${API_BASE_URL}${path}?${qs}`)

    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    if (tenantId) xhr.setRequestHeader('X-Tenant-ID', tenantId)

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100))
      }
    })

    xhr.addEventListener('load', () => {
      try {
        const data = xhr.responseText ? JSON.parse(xhr.responseText) : null
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(data as T)
        } else {
          const msg = data?.message || data?.error || `Request failed with status ${xhr.status}`
          reject(new Error(msg))
        }
      } catch {
        reject(new Error('Failed to parse server response'))
      }
    })

    xhr.addEventListener('error', () => reject(new Error('Network error during upload')))
    xhr.addEventListener('abort', () => reject(new Error('Upload cancelled')))

    const fd = new FormData()
    fd.append('file', file)
    xhr.send(fd)
  })
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

// TODO[backend]: GET /v1/bulk-import/employees/template not implemented.
// When available: returns an XLSX Blob pre-filled with tenant's branch/dept/designation codes.
// The endpoint should accept no params (uses current tenant context from JWT/header).
export function useDownloadTemplate() {
  const tenantId = useAuthStore.getState().tenant?.id
  return useMutation({
    mutationFn: async (tenantSlug: string) => {
      const token = getAccessToken()
      const response = await fetch(`${API_BASE_URL}/v1/bulk-import/employees/template`, {
        headers: {
          Accept: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(tenantId ? { 'X-Tenant-ID': tenantId } : {}),
        },
      })
      if (!response.ok) {
        throw new Error(
          `Template download not yet available (${response.status}). ` +
          `Ask your administrator for the column header list.`,
        )
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `employees-template-${tenantSlug || 'tenant'}.xlsx`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    },
  })
}

export function useValidateBulkImport() {
  const [uploadProgress, setUploadProgress] = React.useState(0)

  const mutation = useMutation({
    mutationFn: ({ file, companyId }: { file: File; companyId: string }) => {
      setUploadProgress(0)
      return uploadFile<BulkImportResult>(
        '/v1/bulk-import/employees/validate',
        file,
        { companyId },
        setUploadProgress,
      )
    },
  })

  return { ...mutation, uploadProgress }
}

export function useCommitBulkImport() {
  const queryClient = useQueryClient()
  const [uploadProgress, setUploadProgress] = React.useState(0)

  const mutation = useMutation({
    mutationFn: ({ file, companyId }: { file: File; companyId: string }) => {
      setUploadProgress(0)
      return uploadFile<BulkImportResult>(
        '/v1/bulk-import/employees/commit',
        file,
        { companyId },
        setUploadProgress,
      )
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hrms', 'employees'] })
    },
  })

  return { ...mutation, uploadProgress }
}
