import { describe, expect, it } from 'vitest'
import {
  COMPANY_ROOT, METRICS, buildTree, busElbow, defaultExpanded, layoutTree, listRows, pathEdges, pathTo, revealed,
  searchPeople, shownChildren, sideElbow, statusLabel, type OrgTree,
} from './orgTree'
import type { OrgChartData, OrgPerson } from './useOrgChart'

const person = (id: string, parentId: string | null, extra: Partial<OrgPerson> = {}): OrgPerson => ({
  id, name: extra.name ?? id, designation: null, department: null, location: null, photoUrl: null, status: null,
  parentId, directReports: 0, relation: null, note: null, canViewRecord: false, ...extra,
})

const chart = (people: OrgPerson[], viewer: string | null = null, scope: 'COMPANY' | 'TEAM' = 'COMPANY'): OrgChartData => ({
  scope, companyId: 'co', companyName: 'Demo Corp', viewerEmployeeId: viewer, truncated: false, people,
})

/** CEO → (CTO → Mgr → (Reader, Asha); CFO → Accountant) */
const company = () => chart([
  person('CEO', null), person('CTO', 'CEO'), person('CFO', 'CEO'), person('Mgr', 'CTO'),
  person('Reader', 'Mgr', { designation: 'Software Engineer', department: 'Engineering' }),
  person('Asha', 'Mgr', { designation: 'Designer', department: 'Design' }), person('Accountant', 'CFO'),
], 'Reader')

const tree = (d: OrgChartData) => buildTree(d) as OrgTree

describe('buildTree', () => {
  it('puts the one top person at the top, with reports in name order', () => {
    const t = tree(company())
    expect(t.rootId).toBe('CEO')
    expect(t.companyRoot).toBe(false)
    expect(t.nodes.get('CEO')!.children).toEqual(['CFO', 'CTO'])
    expect(t.nodes.get('Mgr')!.children).toEqual(['Asha', 'Reader'])
    expect(t.nodes.get('Reader')!.depth).toBe(3)
    expect(t.you).toBe('Reader')
    expect(t.size).toBe(7)
    // Depth first, top first.
    expect(t.order).toEqual(['CEO', 'CFO', 'Accountant', 'CTO', 'Mgr', 'Asha', 'Reader'])
  })

  it('draws a company card above several top-level people (people without a manager hang under the top)', () => {
    const t = tree(chart([person('Zed', null), person('Amy', null), person('Kid', 'Amy')]))
    expect(t.companyRoot).toBe(true)
    expect(t.rootId).toBe(COMPANY_ROOT)
    expect(t.nodes.get(COMPANY_ROOT)!.children).toEqual(['Amy', 'Zed'])
    expect(t.nodes.get('Amy')!.depth).toBe(1)
    expect(t.nodes.get('Kid')!.depth).toBe(2)
    expect(t.order[0]).toBe(COMPANY_ROOT)
  })

  it('never trusts the data: unknown parents, self parents and loops end at the top level, nobody twice', () => {
    const t = tree(chart([
      person('Top', null), person('Lost', 'Gone'), person('Self', 'Self'),
      person('A', 'B'), person('B', 'A'), person('Dup', 'Top'), person('Dup', 'A'),
    ]))
    expect(t.companyRoot).toBe(true)
    const tops = t.nodes.get(COMPANY_ROOT)!.children
    expect(tops).toEqual(expect.arrayContaining(['Top', 'Lost', 'Self', 'A']))
    expect(t.nodes.get('B')!.parent).toBe('A')          // the loop A ↔ B is cut at A (first by name)
    expect(t.nodes.get('Dup')!.parent).toBe('Top')       // the first row for an id wins
    expect(new Set(t.order).size).toBe(t.order.length)
    expect(t.order).toHaveLength(7)                       // 6 people + the company card
  })

  it('is null when nobody is on the chart, and has no "you" when the viewer is not on it', () => {
    expect(buildTree(chart([]))).toBeNull()
    expect(buildTree(undefined)).toBeNull()
    expect(tree(chart([person('A', null)], 'someone-else')).you).toBeNull()
  })

  it('copes with a very deep line', () => {
    const people = [person('P0', null)]
    for (let i = 1; i < 5000; i++) people.push(person(`P${i}`, `P${i - 1}`))
    const t = tree(chart(people, 'P4999'))
    expect(t.nodes.get('P4999')!.depth).toBe(4999)
    expect(pathTo(t, 'P4999')).toHaveLength(5000)
    const open = defaultExpanded(t)
    const lay = layoutTree(t, open)
    expect(lay.boxes.size).toBe(5000)
  })
})

describe('what starts opened', () => {
  it('opens the top and the line down to the viewer, and the viewer (so their team shows)', () => {
    const t = tree(company())
    expect([...defaultExpanded(t)].sort()).toEqual(['CEO', 'CTO', 'Mgr', 'Reader'])
  })

  it('also opens the line to a person asked for (a "View in org chart" link)', () => {
    const t = tree(company())
    expect(defaultExpanded(t, 'Accountant')).toEqual(new Set(['CEO', 'CTO', 'Mgr', 'Reader', 'CFO', 'Accountant']))
  })

  it('reveals someone found by search by opening everyone above them', () => {
    const t = tree(company())
    const open = revealed(t, new Set([t.rootId]), 'Asha')
    expect([...open].sort()).toEqual(['CEO', 'CTO', 'Mgr'])
    expect(shownChildren(t, open, 'Mgr')).toEqual(['Asha', 'Reader'])
    expect(shownChildren(t, open, 'CFO')).toEqual([])
  })

  it('gives the path from the top', () => {
    const t = tree(company())
    expect(pathTo(t, 'Reader')).toEqual(['CEO', 'CTO', 'Mgr', 'Reader'])
    expect(pathTo(t, 'nobody')).toEqual([])
    expect([...pathEdges(t, ['Reader'])]).toEqual(['CEO>CTO', 'CTO>Mgr', 'Mgr>Reader'])
  })
})

describe('layoutTree', () => {
  const m = METRICS

  it('centres each manager over their reports, one row per level', () => {
    const t = tree(company())
    const lay = layoutTree(t, new Set(['CEO', 'CTO', 'CFO', 'Mgr']))
    const b = (id: string) => lay.boxes.get(id)!
    expect(b('CEO').y).toBe(0)
    expect(b('CTO').y).toBe(m.cardH + m.gapY)
    expect(b('Mgr').y).toBe(2 * (m.cardH + m.gapY))
    // Reports side by side, never overlapping.
    expect(b('Asha').y).toBe(b('Reader').y)
    expect(b('Reader').x - b('Asha').x).toBeGreaterThanOrEqual(m.cardW + m.gapX)
    // A manager sits centred over their row of reports.
    const mid = (b('Asha').x + b('Reader').x + m.cardW) / 2
    expect(b('Mgr').x + m.cardW / 2).toBeCloseTo(mid)
    // The top is centred over the whole chart.
    expect(b('CEO').x + m.cardW / 2).toBeCloseTo(lay.width / 2)
    expect(lay.connectors.map((c) => `${c.from}>${c.to}`).sort()).toEqual(['CEO>CFO', 'CEO>CTO', 'CFO>Accountant', 'CTO>Mgr', 'Mgr>Asha', 'Mgr>Reader'])
  })

  it('draws only opened people\'s reports', () => {
    const t = tree(company())
    const lay = layoutTree(t, new Set(['CEO']))
    expect([...lay.boxes.keys()].sort()).toEqual(['CEO', 'CFO', 'CTO'])
    expect(lay.height).toBe(2 * m.cardH + m.gapY)
  })

  it('stacks a big team of people with no reports in two columns either side of a line', () => {
    const people = [person('Boss', null)]
    for (let i = 0; i < 7; i++) people.push(person(`R${i}`, 'Boss'))
    const t = tree(chart(people))
    const lay = layoutTree(t, new Set(['Boss']))
    const boss = lay.boxes.get('Boss')!
    const spine = boss.x + m.cardW / 2
    const left = [0, 2, 4, 6].map((i) => lay.boxes.get(`R${i}`)!)
    const right = [1, 3, 5].map((i) => lay.boxes.get(`R${i}`)!)
    expect(new Set(left.map((x) => x.x)).size).toBe(1)
    expect(new Set(right.map((x) => x.x)).size).toBe(1)
    expect(left[0].x + m.cardW).toBeLessThan(spine)
    expect(right[0].x).toBeGreaterThan(spine)
    expect(lay.width).toBe(2 * m.cardW + m.stackGap)
    expect(lay.height).toBe(m.cardH + m.gapY + 4 * m.cardH + 3 * m.stackRowGap)
  })

  it('keeps a row when any report has a team of their own', () => {
    const people = [person('Boss', null)]
    for (let i = 0; i < 6; i++) people.push(person(`R${i}`, 'Boss'))
    people.push(person('Kid', 'R0'))
    const t = tree(chart(people))
    const lay = layoutTree(t, new Set(['Boss']))
    expect(new Set([0, 1, 2, 3, 4, 5].map((i) => lay.boxes.get(`R${i}`)!.y)).size).toBe(1)
  })

  it('never puts two cards on top of each other', () => {
    const people = [person('A', null)]
    for (let i = 0; i < 4; i++) {
      people.push(person(`B${i}`, 'A'))
      for (let j = 0; j < 3; j++) {
        people.push(person(`C${i}${j}`, `B${i}`))
        for (let k = 0; k < 6; k++) people.push(person(`D${i}${j}${k}`, `C${i}${j}`))
      }
    }
    const t = tree(chart(people))
    const open = new Set(t.order)
    const boxes = [...layoutTree(t, open).boxes.values()]
    expect(boxes).toHaveLength(people.length)
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j]
        const overlap = a.x < b.x + m.cardW && b.x < a.x + m.cardW && a.y < b.y + m.cardH && b.y < a.y + m.cardH
        expect(overlap, `${a.id} and ${b.id} overlap`).toBe(false)
      }
    }
  })

  it('draws rounded elbows, and a straight line straight down', () => {
    expect(busElbow(100, 96, 100, 128, 160, 10)).toBe('M100,96V160')
    expect(busElbow(100, 96, 300, 128, 160, 10)).toBe('M100,96V118Q100,128 110,128H290Q300,128 300,138V160')
    expect(busElbow(300, 96, 100, 128, 160, 10)).toBe('M300,96V118Q300,128 290,128H110Q100,128 100,138V160')
    expect(sideElbow(100, 96, 72, 208, 10)).toBe('M100,96V198Q100,208 90,208H72')
  })
})

describe('listRows (phone view)', () => {
  it('lists opened people\'s reports under them, indented by depth', () => {
    const t = tree(company())
    const rows = listRows(t, new Set(['CEO', 'CTO']))
    expect(rows.map((r) => [r.id, r.depth, r.hasChildren, r.open])).toEqual([
      ['CEO', 0, true, true], ['CFO', 1, true, false], ['CTO', 1, true, true], ['Mgr', 2, true, false],
    ])
  })
})

describe('searchPeople', () => {
  it('finds names first, then designation or department; every word must match', () => {
    const t = tree(company())
    expect(searchPeople(t, 'rea').map((p) => p.id)).toEqual(['Reader'])
    expect(searchPeople(t, 'design').map((p) => p.id)).toEqual(['Asha'])
    expect(searchPeople(t, 'asha design').map((p) => p.id)).toEqual(['Asha'])
    expect(searchPeople(t, 'asha engineering')).toEqual([])
    expect(searchPeople(t, '   ')).toEqual([])
    // A name word starting with it, then a name containing it, then designation or department.
    const t2 = tree(chart([
      person('Top', null), person('Sanandan K', 'Top'), person('Prasad Anand', 'Top'), person('Anand Rao', 'Top'),
      person('Vinay', 'Top', { department: 'Anand team' }),
    ]))
    expect(searchPeople(t2, 'anand').map((p) => p.name)).toEqual(['Anand Rao', 'Prasad Anand', 'Sanandan K', 'Vinay'])
    expect(searchPeople(t2, 'ánand').map((p) => p.name)).toContain('Anand Rao')
  })

  it('never offers the company card', () => {
    const t = tree(chart([person('Demo', null), person('Corp', null)]))
    expect(searchPeople(t, 'demo corp')).toEqual([])
  })
})

describe('statusLabel', () => {
  it('labels only the statuses worth a pill', () => {
    expect(statusLabel('ACTIVE')).toBeNull()
    expect(statusLabel(null)).toBeNull()
    expect(statusLabel('PROBATION')).toEqual({ label: 'Probation', tone: 'info' })
    expect(statusLabel('NOTICE_PERIOD')).toEqual({ label: 'On notice', tone: 'warning' })
    expect(statusLabel('SUSPENDED')).toEqual({ label: 'Suspended', tone: 'danger' })
  })
})
