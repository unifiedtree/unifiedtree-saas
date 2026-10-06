// Employee photos, branch logos and agency logos (V143.102, w43): what the browser accepts, how it
// shrinks the picture, where it uploads, and the picker's states. Rendered as markup (the repo has
// no DOM test environment).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const calls: { path: string; init?: RequestInit }[] = []
vi.mock('@/core/api/client', async () => ({
  ...(await vi.importActual<object>('@/core/api/client')),
  apiJson: async (path: string, init?: RequestInit) => { calls.push({ path, init }); return { url: '/v1/public/images/t/new' } },
}))

import { drawBox, pickProblem, removeRecordImage, uploadRecordImage } from './useRecordImages'
import { ImagePicker } from '../workforce/ImagePicker'

beforeEach(() => { calls.length = 0 })

const file = (type: string, size: number) => ({ type, size, name: 'x' }) as unknown as File

describe('picking a picture', () => {
  it('takes pictures up to 10 MB, nothing else', () => {
    expect(pickProblem(file('image/jpeg', 3_000_000))).toBeNull()
    expect(pickProblem(file('image/heic', 9_000_000))).toBeNull()
    expect(pickProblem(file('application/pdf', 1000))).toBe('Choose a picture (JPG or PNG)')
    expect(pickProblem(file('', 1000))).toBe('Choose a picture (JPG or PNG)')
    expect(pickProblem(file('image/png', 11 * 1024 * 1024))).toBe('Choose a picture of 10 MB or smaller')
  })
  it('a photo becomes the centred square, at most 512 px; never enlarged', () => {
    expect(drawBox(1200, 800, 'photo')).toEqual({ sx: 200, sy: 0, sw: 800, sh: 800, dw: 512, dh: 512 })
    expect(drawBox(300, 400, 'photo')).toEqual({ sx: 0, sy: 50, sw: 300, sh: 300, dw: 300, dh: 300 })
  })
  it('a logo keeps its shape, at most 512 px on the long side', () => {
    expect(drawBox(2048, 512, 'logo')).toEqual({ sx: 0, sy: 0, sw: 2048, sh: 512, dw: 512, dh: 128 })
    expect(drawBox(200, 100, 'logo')).toMatchObject({ dw: 200, dh: 100 })
  })
})

describe('uploading', () => {
  it('posts the file to the record’s own address and returns where it is served', async () => {
    const blob = new Blob(['x'], { type: 'image/jpeg' })
    expect(await uploadRecordImage('employee', 'e1', blob)).toBe('/v1/public/images/t/new')
    await uploadRecordImage('branch', 'b1', blob)
    await uploadRecordImage('agency', 'a1', blob)
    expect(calls.map((c) => `${c.init?.method} ${c.path}`)).toEqual([
      'POST /v1/hrms/employees/e1/photo', 'POST /v1/hrms/branches/b1/logo', 'POST /v1/hrms/contractors/a1/logo',
    ])
    expect(calls[0].init?.body).toBeInstanceOf(FormData)
    expect((calls[0].init?.body as FormData).get('file')).toBeInstanceOf(Blob)
  })
  it('removes with DELETE', async () => {
    await removeRecordImage('agency', 'a1')
    expect(calls[0]).toMatchObject({ path: '/v1/hrms/contractors/a1/logo', init: { method: 'DELETE' } })
  })
})

describe('ImagePicker', () => {
  const render = (props: Parameters<typeof ImagePicker>[0]) =>
    renderToStaticMarkup(<QueryClientProvider client={new QueryClient()}><ImagePicker {...props} /></QueryClientProvider>)
  it('without a picture: initials and "Upload …"', () => {
    const html = render({ kind: 'branch', id: 'b1', name: 'Pune Office' })
    expect(html).toContain('>PO<')
    expect(html).toContain('Upload logo')
    expect(html).not.toContain('Remove')
    expect(html).toContain('accept="image/png,image/jpeg')
  })
  it('with a picture: it shows (from the API) with Change and Remove', () => {
    const html = render({ kind: 'employee', id: 'e1', name: 'Asha Rao', current: '/v1/public/images/t/old' })
    expect(html).toContain('src="/api/v1/public/images/t/old"')
    expect(html).toContain('Change photo')
    expect(html).toContain('Remove')
    expect(html).toContain('cropped to a square')
  })
})
