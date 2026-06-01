export interface QueryParams {
  page: number
  size: number
  sort: string
  order: 'asc' | 'desc'
  filters: Record<string, string | string[] | boolean | number>
}

export interface QueryResult<T> {
  content: T[]
  totalElements: number
  totalPages: number
  currentPage: number
  pageSize: number
  hasNext: boolean
  hasPrevious: boolean
}

export function buildQueryString(params: Partial<QueryParams>): string {
  const searchParams = new URLSearchParams()
  const entries = Object.entries(params).filter(([, v]) => v != null && v !== '')

  entries.forEach(([k, v]) => {
    if (k === 'filters' && typeof v === 'object' && !Array.isArray(v)) {
      Object.entries(v as Record<string, unknown>).forEach(([fk, fv]) => {
        if (fv != null && fv !== '') {
          if (Array.isArray(fv)) {
            fv.forEach((item) => searchParams.append(`filter.${fk}`, String(item)))
          } else {
            searchParams.set(`filter.${fk}`, String(fv))
          }
        }
      })
    } else if (Array.isArray(v)) {
      v.forEach((item) => searchParams.append(k, String(item)))
    } else {
      searchParams.set(k, String(v))
    }
  })

  return searchParams.toString()
}

export function toQueryResult<T>(
  content: T[],
  total: number,
  page: number,
  size: number
): QueryResult<T> {
  const totalPages = Math.max(1, Math.ceil(total / size))
  return {
    content,
    totalElements: total,
    totalPages,
    currentPage: page,
    pageSize: size,
    hasNext: page < totalPages,
    hasPrevious: page > 1,
  }
}
