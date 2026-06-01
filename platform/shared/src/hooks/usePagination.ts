import { useState, useMemo } from 'react'

interface PaginationResult {
  currentPage: number
  totalPages: number
  pageSize: number
  hasNext: boolean
  hasPrevious: boolean
  goToPage: (page: number) => void
  nextPage: () => void
  previousPage: () => void
  firstPage: () => void
  lastPage: () => void
  pages: number[]
  startItem: number
  endItem: number
}

export function usePagination(
  totalItems: number,
  pageSize: number,
  initialPage: number = 1
): PaginationResult {
  const [currentPage, setCurrentPage] = useState(initialPage)

  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))

  const hasNext = currentPage < totalPages
  const hasPrevious = currentPage > 1

  const goToPage = (page: number) => {
    const clamped = Math.min(Math.max(1, page), totalPages)
    setCurrentPage(clamped)
  }

  const nextPage = () => goToPage(currentPage + 1)
  const previousPage = () => goToPage(currentPage - 1)
  const firstPage = () => goToPage(1)
  const lastPage = () => goToPage(totalPages)

  const pages = useMemo(() => {
    const range: number[] = []
    const delta = 2
    const left = Math.max(2, currentPage - delta)
    const right = Math.min(totalPages - 1, currentPage + delta)

    range.push(1)
    if (left > 2) range.push(-1) // ellipsis marker
    for (let i = left; i <= right; i++) range.push(i)
    if (right < totalPages - 1) range.push(-2) // ellipsis marker
    if (totalPages > 1) range.push(totalPages)

    return range
  }, [currentPage, totalPages])

  const startItem = totalItems === 0 ? 0 : (currentPage - 1) * pageSize + 1
  const endItem = Math.min(currentPage * pageSize, totalItems)

  return {
    currentPage,
    totalPages,
    pageSize,
    hasNext,
    hasPrevious,
    goToPage,
    nextPage,
    previousPage,
    firstPage,
    lastPage,
    pages,
    startItem,
    endItem,
  }
}
