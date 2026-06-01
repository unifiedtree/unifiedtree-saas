import { useState } from 'react'

export function usePagination(totalItems: number, pageSize = 10) {
  const [page, setPage] = useState(0)
  const totalPages = Math.ceil(totalItems / pageSize)

  return {
    page,
    pageSize,
    totalPages,
    canPrev: page > 0,
    canNext: page < totalPages - 1,
    next: () => setPage((p) => Math.min(p + 1, totalPages - 1)),
    prev: () => setPage((p) => Math.max(p - 1, 0)),
    goTo: (p: number) => setPage(Math.max(0, Math.min(p, totalPages - 1))),
    slice: <T>(arr: T[]): T[] => arr.slice(page * pageSize, (page + 1) * pageSize),
  }
}
