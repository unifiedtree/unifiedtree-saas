import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement } from 'react'
import { Pager, pageCount, pageRange, pageList, clampPage } from './data'

const html = (el: ReactElement) => renderToStaticMarkup(el)
const count = (s: string, needle: string) => s.split(needle).length - 1
const noop = () => {}

describe('paging maths', () => {
  it('pageCount: at least one page; partial pages count', () => {
    expect(pageCount(249, 20)).toBe(13)
    expect(pageCount(240, 20)).toBe(12)
    expect(pageCount(1, 20)).toBe(1)
    expect(pageCount(0, 20)).toBe(1)
    expect(pageCount(-5, 20)).toBe(1)
    expect(pageCount(10, 0)).toBe(1)
    expect(pageCount(Number.NaN, 10)).toBe(1)
  })
  it('pageRange: "1–20", the short last page, nothing for no rows', () => {
    expect(pageRange(0, 20, 249)).toEqual({ from: 1, to: 20 })
    expect(pageRange(1, 20, 249)).toEqual({ from: 21, to: 40 })
    expect(pageRange(12, 20, 249)).toEqual({ from: 241, to: 249 })
    expect(pageRange(0, 20, 7)).toEqual({ from: 1, to: 7 })
    expect(pageRange(0, 20, 0)).toEqual({ from: 0, to: 0 })
  })
  it('pageRange and clampPage pull a page that no longer exists back into range', () => {
    expect(clampPage(20, 249, 20)).toBe(12)
    expect(clampPage(-3, 249, 20)).toBe(0)
    expect(clampPage(2, 0, 20)).toBe(0)
    expect(pageRange(99, 20, 249)).toEqual({ from: 241, to: 249 })
  })
  it('pageList: first, last, one either side of the current, gaps for the rest', () => {
    expect(pageList(0, 13)).toEqual([1, 2, 'gap', 13])
    expect(pageList(5, 13)).toEqual([1, 'gap', 5, 6, 7, 'gap', 13])
    expect(pageList(12, 13)).toEqual([1, 'gap', 12, 13])
    expect(pageList(0, 1)).toEqual([1])
    expect(pageList(2, 5)).toEqual([1, 2, 3, 4, 5])
  })
  it('pageList shows a page instead of a gap that would hide only that page', () => {
    expect(pageList(3, 13)).toEqual([1, 2, 3, 4, 5, 'gap', 13]) // page 4: "1 … 3" would hide just 2
    expect(pageList(9, 13)).toEqual([1, 'gap', 9, 10, 11, 12, 13])
    expect(pageList(99, 4)).toEqual([1, 2, 3, 4])
  })
})

describe('Pager: markup', () => {
  it('no rows: nothing at all (the table shows its own empty line)', () => {
    expect(html(<Pager page={0} pageSize={20} total={0} onPageChange={noop} />)).toBe('')
  })
  it('the count, a polite live region, with the noun and figures in Indian grouping', () => {
    const s = html(<Pager page={0} pageSize={20} total={1249} onPageChange={noop} noun="people" />)
    expect(s).toContain('<p class="uk-pager__range" aria-live="polite">Showing <b>1–20</b> of <b>1,249</b> people</p>')
  })
  it('one page: the count and no page buttons', () => {
    const s = html(<Pager page={0} pageSize={20} total={7} onPageChange={noop} />)
    expect(s).toContain('Showing <b>1–7</b> of <b>7</b>')
    expect(s).not.toContain('<nav')
    expect(s).not.toContain('Previous page')
  })
  it('several pages: a named nav, numbered buttons, the current one marked, ends disabled', () => {
    const first = html(<Pager page={0} pageSize={20} total={249} onPageChange={noop} />)
    expect(first).toContain('<nav class="uk-pager__nav" aria-label="Pages">')
    expect(first).toContain('<button type="button" class="uk-pager__btn" aria-label="Previous page" disabled="">')
    expect(first).toContain('aria-label="Page 1" aria-current="page"')
    expect(count(first, 'aria-current="page"')).toBe(1)
    expect(count(first, 'class="uk-pager__btn uk-pager__num')).toBe(3) // 1, 2, 13
    expect(count(first, 'class="uk-pager__gap" aria-hidden="true">…</span>')).toBe(1)
    expect(first).toContain('<span class="uk-sr">Page 1 of 13</span>')
    expect(first).not.toContain('aria-label="Next page" disabled')
    const last = html(<Pager page={12} pageSize={20} total={249} onPageChange={noop} />)
    expect(last).toContain('aria-label="Next page" disabled=""')
    expect(last).toContain('Showing <b>241–249</b> of <b>249</b>')
  })
  it('a page past the end shows the last page', () => {
    const s = html(<Pager page={40} pageSize={20} total={249} onPageChange={noop} />)
    expect(s).toContain('aria-label="Page 13" aria-current="page"')
  })
  it('rows per page: labelled, keeps today’s test hook, always offers the current size', () => {
    const s = html(<Pager page={0} pageSize={20} total={249} onPageChange={noop} onPageSizeChange={noop} />)
    expect(s).toContain('aria-label="Rows per page" data-testid="rows-per-page"')
    expect(s).toMatch(/<label for="[^"]+">Rows<\/label>/)
    expect(s).toContain('<option value="10">10</option><option value="20" selected="">20</option><option value="25">25</option>')
    // A single page keeps the size choice, so a reader can go back from 100 to 10.
    expect(html(<Pager page={0} pageSize={100} total={7} onPageChange={noop} onPageSizeChange={noop} />)).toContain('rows-per-page')
  })
  it('numbers={false}: previous / next and "3 / 13"; a filter shows what it hides', () => {
    const s = html(<Pager page={2} pageSize={20} total={249} onPageChange={noop} numbers={false} filteredFrom={312} />)
    expect(s).toContain('uk-pager--nonum')
    expect(s).not.toContain('uk-pager__num')
    expect(s).toContain('<span aria-hidden="true">3 / 13</span>')
    expect(s).toContain('· filtered from 312')
    expect(html(<Pager page={0} pageSize={20} total={249} onPageChange={noop} filteredFrom={249} />)).not.toContain('filtered')
  })
})
