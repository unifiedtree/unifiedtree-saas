import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement } from 'react'
import { UploadDrop, UploadFile, checkFile, acceptsFile, describeAccept, formatBytes, fileExtension } from './data'

const html = (el: ReactElement) => renderToStaticMarkup(el)
const noop = () => {}
const MB = 1024 * 1024

describe('file checks', () => {
  it('fileExtension: lower case, no dot, empty when there is none', () => {
    expect(fileExtension('Receipt 24 Sep.JPG')).toBe('jpg')
    expect(fileExtension('joiners.xlsx')).toBe('xlsx')
    expect(fileExtension('README')).toBe('')
    expect(fileExtension('.env')).toBe('')
    expect(fileExtension('trailing.')).toBe('')
    expect(fileExtension(null)).toBe('')
  })
  it('formatBytes: the way the design writes sizes', () => {
    expect(formatBytes(0)).toBe('0 bytes')
    expect(formatBytes(1)).toBe('1 byte')
    expect(formatBytes(900)).toBe('900 bytes')
    expect(formatBytes(820 * 1024)).toBe('820 KB')
    expect(formatBytes(1.2 * MB)).toBe('1.2 MB')
    expect(formatBytes(5 * MB)).toBe('5 MB')
    expect(formatBytes(10 * MB)).toBe('10 MB')
    expect(formatBytes(2.5 * 1024 * MB)).toBe('2.5 GB')
  })
  it('acceptsFile reads accept like the file chooser: extensions, types, image/*, jpg = jpeg', () => {
    const pdf = { name: 'a.pdf', type: 'application/pdf' }
    const jpeg = { name: 'b.jpeg', type: 'image/jpeg' }
    const png = { name: 'c.PNG', type: 'image/png' }
    const doc = { name: 'd.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }
    expect(acceptsFile(pdf, '.pdf,.jpg,.png')).toBe(true)
    expect(acceptsFile(jpeg, '.pdf,.jpg,.png')).toBe(true)
    expect(acceptsFile(png, '.pdf,.jpg,.png')).toBe(true)
    expect(acceptsFile(doc, '.pdf,.jpg,.png')).toBe(false)
    expect(acceptsFile(png, 'image/*')).toBe(true)
    expect(acceptsFile(pdf, 'image/*')).toBe(false)
    expect(acceptsFile(pdf, 'application/pdf,image/png')).toBe(true)
    expect(acceptsFile({ name: 'x.jpg', type: 'image/jpg' }, 'image/jpeg')).toBe(true)
    // A browser that leaves the type empty: the extension decides.
    expect(acceptsFile({ name: 'scan.pdf', type: '' }, 'application/pdf')).toBe(true)
    expect(acceptsFile({ name: 'scan.txt', type: '' }, 'application/pdf')).toBe(false)
    expect(acceptsFile(doc, '')).toBe(true)
    expect(acceptsFile(doc, undefined)).toBe(true)
  })
  it('describeAccept: the types in words', () => {
    expect(describeAccept('.pdf,.jpg,.jpeg,.png')).toBe('PDF, JPG or PNG')
    expect(describeAccept('.csv,.xlsx')).toBe('CSV or XLSX')
    expect(describeAccept('application/pdf')).toBe('PDF')
    expect(describeAccept('image/*,application/pdf')).toBe('image or PDF')
    expect(describeAccept('')).toBe('')
  })
  it('checkFile: a plain sentence for a wrong type or a file that is too big', () => {
    const rules = { accept: '.pdf,.jpg,.png', maxSize: 5 * MB }
    expect(checkFile({ name: 'ok.pdf', size: MB, type: 'application/pdf' }, rules)).toBeNull()
    expect(checkFile({ name: 'notes.docx', size: MB, type: '' }, rules)).toEqual({ reason: 'type', message: 'notes.docx isn’t a PDF, JPG or PNG file.' })
    expect(checkFile({ name: 'big.pdf', size: 7.2 * MB, type: 'application/pdf' }, rules)).toEqual({ reason: 'size', message: 'big.pdf is 7.2 MB. The limit is 5 MB.' })
    expect(checkFile({ name: 'exact.pdf', size: 5 * MB, type: 'application/pdf' }, rules)).toBeNull()
    expect(checkFile({ name: 'any.bin', size: 99 * MB, type: '' }, {})).toBeNull()
  })
})

describe('UploadDrop: markup', () => {
  it('a real button that opens the chooser, with the limits as its description', () => {
    const s = html(<UploadDrop onFiles={noop} accept=".pdf,.jpg,.png" maxSize={5 * MB} title="Add a receipt" />)
    expect(s).toMatch(/<button type="button" class="uk-drop uk-drop--box" aria-labelledby="([^"]+)-title" aria-describedby="\1-hint">/)
    expect(s).toMatch(/<span id="[^"]+-title" class="uk-drop__title">Add a receipt<\/span>/)
    expect(s).toMatch(/<span id="[^"]+-hint" class="uk-drop__hint">PDF, JPG or PNG · up to 5 MB<\/span>/)
    expect(s).toContain('type="file" class="uk-drop__input" tabindex="-1" aria-hidden="true" accept=".pdf,.jpg,.png"')
    expect(s).not.toContain('role="alert"')
  })
  it('the three looks: bar (one line), box, zone (raised tile, the design’s default line)', () => {
    expect(html(<UploadDrop onFiles={noop} variant="bar" title="Add another document" hint={false} />)).toContain('class="uk-drop uk-drop--bar"')
    const zone = html(<UploadDrop onFiles={noop} variant="zone" accept=".csv,.xlsx" maxSize={10 * MB} hint="Accepts .csv or .xlsx · Max 10 MB" />)
    expect(zone).toContain('uk-drop uk-drop--zone ufx-spot')
    expect(zone).toContain('<span class="uk-drop__tile" aria-hidden="true">')
    expect(zone).toContain('Drag &amp; drop your file here, or click to browse')
    expect(zone).toContain('Accepts .csv or .xlsx · Max 10 MB')
    expect(html(<UploadDrop onFiles={noop} variant="zone" multiple />)).toContain('Drag &amp; drop your files here, or click to browse')
    expect(html(<UploadDrop onFiles={noop} multiple accept=".pdf" maxSize={5 * MB} />)).toContain('PDF · up to 5 MB each')
  })
  it('the page’s error shows under the area as an alert, tied to the button', () => {
    const s = html(<UploadDrop onFiles={noop} error="The upload failed. Try again." hint={false} />)
    expect(s).toMatch(/aria-describedby="[^"]+-err"/)
    expect(s).toMatch(/<div id="[^"]+-err" class="uk-drop__error" role="alert">/)
    expect(s).toContain('The upload failed. Try again.')
  })
  it('while uploading: busy, the progress with its value, no new files', () => {
    const s = html(<UploadDrop onFiles={noop} progress={42} />)
    expect(s).toContain('uk-drop uk-drop--box is-busy')
    expect(s).toContain('aria-disabled="true" aria-busy="true"')
    expect(s).toContain('role="progressbar" aria-label="Upload progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="42" aria-valuetext="42%"')
    expect(s).toContain('Uploading… 42%')
    expect(s).toMatch(/type="file"[^>]*disabled=""/)
  })
  it('disabled is a disabled button', () => {
    expect(html(<UploadDrop onFiles={noop} disabled />)).toMatch(/<button type="button" class="uk-drop uk-drop--box" disabled=""/)
  })
  it('a page’s own accessible name replaces the title as the name', () => {
    const s = html(<UploadDrop onFiles={noop} ariaLabel="Upload the address proof" />)
    expect(s).toContain('aria-label="Upload the address proof"')
    expect(s).not.toContain('aria-labelledby')
  })
})

describe('UploadFile: markup', () => {
  it('type badge, name, size and note, and a Remove that names the file', () => {
    const s = html(<UploadFile name="receipt-24-sep.jpg" size={1.2 * MB} note="Attached just now" onRemove={noop} />)
    expect(s).toContain('<span class="uk-file__badge" aria-hidden="true">jpg</span>')
    expect(s).toContain('<span class="uk-file__name">receipt-24-sep.jpg</span>')
    expect(s).toContain('<span>1.2 MB</span><span> · <!-- -->Attached just now</span>'.replace('<!-- -->', ''))
    expect(s).toContain('<button type="button" class="uk-file__act" aria-label="Remove receipt-24-sep.jpg">Remove</button>')
  })
  it('uploading: the progress bar and words; failed: the reason as an alert and Try again', () => {
    const up = html(<UploadFile name="a.pdf" size={MB} progress={60} />)
    expect(up).toContain('Uploading… 60%')
    expect(up).toContain('aria-label="Uploading a.pdf"')
    const bad = html(<UploadFile name="a.pdf" error="The server refused this file." onRetry={noop} onRemove={noop} />)
    expect(bad).toContain('class="uk-file is-error"')
    expect(bad).toContain('<span class="uk-file__error" role="alert">The server refused this file.</span>')
    expect(bad).toContain('>Try again</button>')
    expect(bad).not.toContain('progressbar')
  })
  it('a link to open the file when there is one; "file" when the name has no extension', () => {
    expect(html(<UploadFile name="Offer letter.pdf" href="/files/1" />)).toContain('<a class="uk-file__name" href="/files/1" target="_blank" rel="noopener noreferrer">Offer letter.pdf</a>')
    expect(html(<UploadFile name="scan" />)).toContain('>file</span>')
  })
})
