// Reports to, picked by name (it was a box asking for the manager's UUID). Rendered as markup
// (the repo has no DOM test environment), with the directory answering as the server does.
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const ok = <T,>(data: T) => ({ data, isLoading: false, isFetching: false, error: null, isError: false, refetch: () => Promise.resolve() })
const answers: { people: unknown[]; current: unknown } = { people: [], current: undefined }

vi.mock('../api/useWorkforce', async () => ({
  ...(await vi.importActual<object>('../api/useWorkforce')),
  useEmployeeDirectory: () => ok({ content: answers.people }),
  useWorkforceEmployee: (id?: string) => ok(id ? answers.current : undefined),
}))

import { ManagerPicker } from './ManagerPicker'

const person = (id: string, firstName: string, employeeCode: string, employmentStatus = 'ACTIVE') =>
  ({ id, companyId: 'c1', firstName, lastName: null, employeeCode, employmentStatus })
const varsha = person('varsha', 'Varsha', 'DEMO-006')
const kavitha = person('kavitha', 'Kavitha Srinivasan', 'DEMO-003')
const ravi = person('ravi', 'Ravi Kumar', 'DEMO-010')
const gone = person('gone', 'Old Boss', 'DEMO-001', 'EXITED')

function render(value: string, people: unknown[], current?: unknown) {
  Object.assign(answers, { people, current })
  return renderToStaticMarkup(<ManagerPicker companyId="c1" value={value} onChange={() => {}} excludeId="varsha" />)
}

describe('ManagerPicker', () => {
  it('offers colleagues by name and code, never the person themself or people who have left', () => {
    const html = render('kavitha', [varsha, kavitha, ravi, gone], kavitha)
    expect(html).toContain('Kavitha Srinivasan (DEMO-003)')
    expect(html).toContain('Ravi Kumar (DEMO-010)')
    expect(html).not.toContain('DEMO-006')
    expect(html).not.toContain('Old Boss')
    expect(html).not.toContain('UUID')
  })

  it('says what no manager means instead of a blank', () => {
    expect(render('', [kavitha])).toContain('No manager: the department head approves')
  })

  it('keeps showing a current manager who has since left, so the choice is visible', () => {
    const html = render('gone', [kavitha], gone)
    expect(html).toContain('Old Boss (DEMO-001) · has left')
  })
})
