// Settings → Branding → Letterhead (audit H-55): the banner's rules and the section as markup
// (the repo has no DOM test environment; uploading and the payslip dialog run in the live test).
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { letterheadProblem, letterheadSaveSize, letterheadSizeText } from './letterheadModel'

vi.mock('@unifiedtree/sdk', async () => ({
  ...(await vi.importActual<object>('@unifiedtree/sdk')),
  usePermission: () => false,
  getAccessToken: () => null,
}))
const { LetterheadSection, PagePreview } = await import('./LetterheadSection')

describe('letterhead rules (same as the server)', () => {
  it('wants a wide banner, at least 128 px tall', () => {
    expect(letterheadProblem(1600, 200)).toBeNull()
    expect(letterheadProblem(512, 256)).toBeNull()
    expect(letterheadProblem(400, 300)).toMatch(/twice as wide/)
    expect(letterheadProblem(1000, 100)).toMatch(/128 px tall/)
    expect(letterheadProblem(0, 0)).toMatch(/no size/)
  })
  it('is saved no wider than A4 at 300 dpi', () => {
    expect(letterheadSaveSize(1600, 200)).toEqual({ w: 1600, h: 200 })
    expect(letterheadSaveSize(4960, 620)).toEqual({ w: 2480, h: 310 })
    // Scaling would make it too short: keep the minimum height.
    expect(letterheadSaveSize(4000, 150)).toEqual({ w: 3413, h: 128 })
    expect(letterheadSizeText(1600, 200)).toBe('1600 × 200 px · about 8 : 1')
  })
})

const dto = { workspaceName: 'Acme', logoUrl: null, markUrl: null }
describe('LetterheadSection', () => {
  it('without a letterhead: says documents use the logo and name, offers an upload and the payslip preview', () => {
    const html = renderToStaticMarkup(<LetterheadSection dto={{ ...dto, letterheadUrl: null }} name="Acme" logo={null} canEdit show={() => {}} onSaved={() => {}} />)
    expect(html).toContain('No letterhead · documents use your wide logo and the company name')
    expect(html).toContain('Upload a letterhead')
    expect(html).toContain('Preview a payslip')
    expect(html).toContain('Your letters now (no letterhead)')
    expect(html).toContain('<b>Acme</b>')
  })
  it('with one: shows its size and the banner on the page previews, and Remove', () => {
    const html = renderToStaticMarkup(<LetterheadSection dto={{ ...dto, letterheadUrl: 'https://cdn.test/lh.png', letterheadWidth: 1600, letterheadHeight: 200 }} name="Acme" logo={null} canEdit show={() => {}} onSaved={() => {}} />)
    expect(html).toContain('Letterhead set · 1600 × 200 px · about 8 : 1')
    expect(html.match(/class="lh-banner"/g)).toHaveLength(2)
    expect(html).toContain('Replace the letterhead')
    expect(html).toContain('>Remove<')
  })
  it('read-only without branding or payroll access, and quiet on an older server', () => {
    const html = renderToStaticMarkup(<LetterheadSection dto={dto} name="Acme" logo={null} canEdit={false} show={() => {}} onSaved={() => {}} />)
    expect(html).toContain('Letters and payslips use your wide logo and the company name')
    expect(html).not.toContain('Upload a letterhead')
    expect(html).not.toContain('Preview a payslip')
  })
  it('a payslip page draws the slip, a letter page the lines', () => {
    expect(renderToStaticMarkup(<PagePreview banner={null} logo={null} name="Acme" kind="payslip" label="x" />)).toContain('lh-body--slip')
    expect(renderToStaticMarkup(<PagePreview banner={null} logo={null} name="Acme" kind="letter" label="x" />)).not.toContain('lh-body--slip')
  })
})
