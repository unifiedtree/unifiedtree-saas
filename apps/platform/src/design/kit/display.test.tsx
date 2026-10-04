import { afterEach, describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement } from 'react'
import {
  PageHeader, PageFrame, PillTabs, PagePill, SearchPill, StatCard, StatGrid, CountUp, accentColor, QuickActionTile, QuickActionGrid,
  QuickIcon, AniIcon, QUICK_ICON_KINDS, ANI_ICON_KINDS, Card, Section, SectionHeading, SectionLink, SectionAction, MiniStat, KeyValueGrid,
  ListRow, ListRows, IconTile, DateTile, StatusPill, CountBadge, Chip, StatusDot, STATUS_TONES, Avatar, initialsOf, EmptyState, ErrorState,
  errorText, Skeleton, SkeletonList, SkeletonStats, SkeletonTable, ProgressBar, StackedBar, Legend, Meter, BarList, ProgressRing, DonutRing,
  GeofenceRing, geofenceRadius, donutArcs, SegmentedControl, FilterPills, Sparkline, sparkShape, smoothPath,
} from './display'

const html = (el: ReactElement) => renderToStaticMarkup(el)
const count = (s: string, needle: string) => s.split(needle).length - 1
const noop = () => {}

type Globals = { window?: unknown; document?: unknown }
const g = globalThis as unknown as Globals
const reduceMotion = () => { g.window = { matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }) } }
afterEach(() => { delete g.window; delete g.document })

describe('PageHeader / PageFrame', () => {
  it('renders context line, h1, summary and actions', () => {
    const s = html(<PageHeader eyebrow="Company" title="Companies & branches" sub="3 companies" actions={<button>Add</button>} id="t1" />)
    expect(s).toContain('<header class="uk-ph">')
    expect(s).toContain('<div class="uk-ph__eyebrow">Company</div>')
    expect(s).toContain('<h1 id="t1" class="uk-ph__title">Companies &amp; branches</h1>')
    expect(s).toContain('<p class="uk-ph__sub">3 companies</p>')
    expect(s).toContain('<div class="uk-ph__actions"><button>Add</button></div>')
  })
  it('greeting: 30/38 variant and a decorative waving hand', () => {
    const s = html(<PageHeader size="greeting" wave title="Good afternoon, Priya" />)
    expect(s).toContain('uk-ph--greet')
    expect(s).toContain('<span class="uk-ph__wave" aria-hidden="true">👋</span>')
    expect(html(<PageHeader size="greeting" align="end" title="x" />)).toContain('uk-ph--end')
  })
  it('omits empty parts', () => {
    const s = html(<PageHeader title="Leave" sub="" />)
    expect(s).not.toContain('uk-ph__sub')
    expect(s).not.toContain('uk-ph__eyebrow')
    expect(s).not.toContain('uk-ph__actions')
  })
  it('frame: wide by default, narrow for self-service, custom gap', () => {
    expect(html(<PageFrame>x</PageFrame>)).toContain('class="uk-page"')
    const s = html(<PageFrame width="narrow" gap={40} top={22}>x</PageFrame>)
    expect(s).toContain('uk-page--narrow')
    expect(s).toContain('--uk-gap:40px')
    expect(s).toContain('padding-top:22px')
  })
  // The hero card (the Master "Organization Setup" look): on when tabs are given or forced; the header
  // stays plain otherwise, and a greeting never becomes a card.
  it('hero: `tabs` draw inside the card under the title row; `hero` forces the card on or off', () => {
    const bar = <PillTabs items={[{ key: 'a', label: 'Branches' }]} activeKey="a" onSelect={noop} label="Setup views" semantics="toggle" />
    const s = html(<PageHeader eyebrow="Master" title="Branches" sub="Offices" actions={<button>Add</button>} tabs={bar} />)
    expect(s).toContain('<header class="uk-ph uk-ph--hero">')
    expect(s).toMatch(/<div class="uk-ph__actions"><button>Add<\/button><\/div><div class="uk-ph__tabs"><div role="group" aria-label="Setup views" class="uk-ptabs">/)
    expect(html(<PageHeader title="Branches" hero />)).toContain('<header class="uk-ph uk-ph--hero">')
    expect(html(<PageHeader title="Branches" hero={false} tabs={bar} />)).toContain('<header class="uk-ph">')
    expect(html(<PageHeader size="greeting" title="Hello" hero />)).not.toContain('uk-ph--hero')
  })
  it('hero: inside a frame the header offers its tab slot to the page’s bars; outside one it does not', () => {
    const inFrame = html(<PageFrame><PageHeader title="Leave" /></PageFrame>)
    expect(inFrame).toContain('<header class="uk-ph"><div class="uk-ph__main"><h1 class="uk-ph__title">Leave</h1></div><div class="uk-ph__tabs"></div></header>')
    const alone = html(<PageHeader title="Leave" />)
    expect(alone).not.toContain('uk-ph__tabs')
    const greet = html(<PageFrame><PageHeader size="greeting" title="Hi" /></PageFrame>)
    expect(greet).not.toContain('uk-ph__tabs')
  })
})

describe('PillTabs', () => {
  const items = [{ key: 'a', label: 'Overview', icon: 'dashboard' }, { key: 'b', label: 'People', href: '/people' }]
  it('tabs mode (default): tablist, tab roles, aria-selected and one tab stop', () => {
    const s = html(<PillTabs items={items} activeKey="a" onSelect={noop} label="Sections" />)
    expect(s).toContain('role="tablist"')
    expect(count(s, 'role="tab"')).toBe(2)
    expect(s).toContain('aria-selected="true"')
    expect(s).toContain('aria-selected="false"')
    expect(count(s, 'tabindex="0"')).toBe(1)
    expect(s).toContain('href="/people"')
  })
  it('toggle mode: group + aria-pressed (ModuleKit Views markup)', () => {
    const s = html(<PillTabs items={items} activeKey="b" onSelect={noop} label="Views" semantics="toggle" />)
    expect(s).toContain('role="group"')
    expect(s).toContain('aria-pressed="true"')
    expect(s).not.toContain('role="tab"')
  })
  it('nav mode: <nav> with aria-current', () => {
    const s = html(<PillTabs items={items} activeKey="a" onSelect={noop} label="Dashboard sections" semantics="nav" current="location" />)
    expect(s).toContain('<nav aria-label="Dashboard sections"')
    expect(s).toContain('aria-current="location"')
  })
  it('active pill is solid; the rest get the hover fx class', () => {
    const s = html(<PillTabs items={items} activeKey="a" onSelect={noop} label="x" />)
    expect(s).toMatch(/class="uk-ptab is-on has-icon"/)
    expect(s).toMatch(/class="uk-ptab ufx-spot"/)
  })
  it('tip goes on the pill as the shell tooltip; server markup never joins a header (no layout effects)', () => {
    const s = html(<PageFrame><PageHeader title="Shifts" /><PillTabs items={[{ key: 'a', label: 'Roster', tip: 'Who works when' }]} activeKey="a" onSelect={noop} label="Shift views" /></PageFrame>)
    expect(s).toMatch(/class="uk-ptab is-on"[^>]*data-tip="Who works when"/)
    expect(s).toContain('<div class="uk-ph__tabs"></div></header><div role="tablist" aria-label="Shift views" class="uk-ptabs">')
    expect(html(<PillTabs items={items} activeKey="a" onSelect={noop} label="x" placement="inline" />)).toContain('class="uk-ptabs"')
  })
  it('PagePill shows icon and page name', () => {
    const s = html(<PagePill icon="home" label="Home" />)
    expect(s).toContain('uk-ppill')
    expect(s).toContain('<span class="uk-ppill__label">Home</span>')
    expect(s).toContain('<svg')
  })
})

describe('SearchPill', () => {
  it('is a labelled button that opens a dialog, with shortcut keys', () => {
    const s = html(<SearchPill onOpen={noop} hints={['people', 'payslips']} keys={['⌘', 'K']} />)
    expect(s).toContain('aria-label="Search everything"')
    expect(s).toContain('aria-haspopup="dialog"')
    expect(s).toContain('aria-keyshortcuts="Meta+K"')
    expect(s).toContain('<kbd class="uk-kbd">⌘</kbd>')
    // the rolling hint repeats the first word at the end for a seamless loop
    expect(count(s, '>people<')).toBe(2)
  })
  it('works with no hints', () => {
    const s = html(<SearchPill onOpen={noop} keys={['Ctrl', 'K']} />)
    expect(s).toContain('aria-keyshortcuts="Control+K"')
    expect(s).not.toContain('uk-search__win')
  })
})

describe('StatCard', () => {
  it('live (default): accent colour, moving icon, figure, note, sparkline; carries .ut-card', () => {
    const s = html(<StatCard label="Present" value={142} note="59% of 241 scheduled" aniIcon="present" accent="present" spark={[1, 3, 2]} onClick={noop} />)
    expect(s).toMatch(/^<button type="button" class="ut-card uk-stat uk-stat--live uk-stat--link ufx-tilt ufx-rise"/)
    expect(s).toContain('--k:var(--u-k-present,#12805F)')
    expect(s).toContain('uk-aniicon')
    expect(s).toContain('<span class="uk-stat__label">Present</span>')
    expect(s).toContain('<span class="uk-stat__note">59% of 241 scheduled</span>')
    expect(s).toContain('class="uk-spark')
  })
  it('counts up: visible figure starts at 0, screen readers get the real value', () => {
    const s = html(<StatCard label="Total employees" value={249} />)
    expect(s).toContain('<span aria-hidden="true">0</span><span class="uk-sr">249</span>')
  })
  it('respects reduced motion: the final figure, no duplicate', () => {
    reduceMotion()
    const s = html(<StatCard label="Total employees" value={249} />)
    expect(s).toContain('<span class="uk-stat__value">249</span>')
    expect(s).not.toContain('uk-sr')
  })
  it('countUp={false} and missing values', () => {
    expect(html(<StatCard label="Next ID" value="EMP-0031" countUp={false} />)).toContain('<span class="uk-stat__value">EMP-0031</span>')
    expect(html(<StatCard label="Absent" value={null} />)).toContain('<span class="uk-stat__value">—</span>')
    expect(html(<StatCard label="Count" value={12345} countUp={false} />)).toContain('12,345')
  })
  it('stat variant: tone circle, delta with direction for screen readers, active ring, aria-pressed', () => {
    const s = html(<StatCard variant="stat" label="Late" value={1} icon="timer" tone="gold" delta="5" trend="up" mood="warn" note="since this morning" active onClick={noop} />)
    expect(s).toContain('uk-stat__circle--gold')
    expect(s).toContain('uk-stat__delta--warn')
    expect(s).toContain('<span class="uk-sr">up </span>5')
    expect(s).toContain('aria-pressed="true"')
    expect(s).toContain('uk-stat__ring')
    const off = html(<StatCard variant="stat" label="Late" value={1} active={false} onClick={noop} />)
    expect(off).toContain('aria-pressed="false"')
    expect(html(<StatCard variant="stat" label="Late" value={1} onClick={noop} />)).not.toContain('aria-pressed')
  })
  it('a bad mood draws the line in red', () => {
    expect(html(<StatCard variant="stat" label="x" value={2} mood="bad" spark={[1, 2]} />)).toContain('uk-stat__spark--bad')
  })
  it('link, static and loading forms', () => {
    const link = html(<StatCard label="Present" value={1} href="/attendance" />)
    expect(link).toMatch(/^<a href="\/attendance"/)
    const stat = html(<StatCard label="Present" value={1} />)
    expect(stat).toMatch(/^<div class="ut-card uk-stat uk-stat--live ufx-rise"/)
    expect(stat).not.toContain('ufx-tilt')
    const load = html(<StatCard label="Present" value={null} loading />)
    expect(load).toContain('role="status"')
    expect(load).toContain('aria-busy="true"')
    expect(load).toContain('aria-label="Loading Present"')
    expect(load).not.toContain('uk-stat__value')
  })
  it('accent names map to the theme tokens; any CSS colour passes through', () => {
    expect(accentColor('half')).toBe('var(--u-k-halfday,#8B4FE0)')
    expect(accentColor('none')).toBe('var(--u-k-notmarked,#C27A0E)')
    expect(accentColor('#123456')).toBe('#123456')
    expect(accentColor(undefined)).toBe('var(--u-br,#0F6E56)')
  })
  it('StatGrid is a responsive auto-fit grid', () => {
    const s = html(<StatGrid min={140} gap={12} label="Filter by status"><span /></StatGrid>)
    expect(s).toContain('role="group"')
    expect(s).toContain('aria-label="Filter by status"')
    expect(s).toContain('--uk-min:140px')
    expect(s).toContain('--uk-gap:12px')
  })
  it('CountUp formats plain numbers Indian-style', () => {
    reduceMotion()
    expect(html(<CountUp value={1234567} />)).toBe('12,34,567')
    expect(html(<CountUp value="" />)).toBe('—')
  })
})

describe('QuickActionTile', () => {
  it('button with scene icon, label, hint and hover arrow', () => {
    const s = html(<QuickActionTile kind="coins" label="Run payroll" hint="September is in review" onClick={noop} />)
    expect(s).toMatch(/^<button type="button" class="uk-qa ufx-tilt ufx-rise"/)
    expect(s).toContain('uk-qicon')
    expect(s).toContain('<span class="uk-qa__label">Run payroll</span>')
    expect(s).toContain('<span class="uk-qa__hint">September is in review</span>')
    expect(s).toContain('uk-qa__arrow')
  })
  it('badge only when there is a count, with a spoken label', () => {
    expect(html(<QuickActionTile kind="calendar" label="Approve leave" badge={0} />)).not.toContain('uk-qa__badge')
    const s = html(<QuickActionTile kind="calendar" label="Approve leave" badge={9} badgeLabel="9 waiting" />)
    expect(s).toContain('<span aria-hidden="true">9</span><span class="uk-sr">9 waiting</span>')
  })
  it('link and disabled forms', () => {
    expect(html(<QuickActionTile label="Reports" icon="chart" href="/reports" />)).toMatch(/^<a href="\/reports"/)
    const d = html(<QuickActionTile label="Run payroll" kind="coins" disabled />)
    expect(d).toContain('disabled=""')
    expect(d).toContain('uk-qa--disabled')
    expect(d).not.toContain('ufx-tilt')
  })
  it('grid', () => {
    expect(html(<QuickActionGrid><span /></QuickActionGrid>)).toContain('aria-label="Quick actions"')
  })
  it('every scene and every stat icon renders a decorative svg', () => {
    for (const k of QUICK_ICON_KINDS) expect(html(<QuickIcon kind={k} />)).toMatch(/^<svg class="uk-qicon"[^>]*aria-hidden="true"/)
    for (const k of ANI_ICON_KINDS) expect(html(<AniIcon kind={k} />)).toMatch(/^<svg class="uk-aniicon"[^>]*aria-hidden="true"/)
  })
})

describe('Card', () => {
  it('white card with the legacy .ut-card class', () => {
    const s = html(<Card>x</Card>)
    expect(s).toBe('<div class="ut-card uk-card uk-card--r18 uk-card--p-md ufx-rise">x</div>')
  })
  it('soft tiles and nested cards leave .ut-card off; spot adds the spotlight layer', () => {
    expect(html(<Card tone="soft">x</Card>)).not.toContain('ut-card ')
    expect(html(<Card cardClass={false}>x</Card>)).not.toContain('ut-card')
    const s = html(<Card spot as="section" label="Branches">x</Card>)
    expect(s).toMatch(/^<section aria-label="Branches"/)
    expect(s).toContain('uk-card--spot ufx-spot')
    expect(s).toContain('<span aria-hidden="true" class="uk-fx-spot"></span>')
  })
})

describe('Section', () => {
  it('ready: labelled section with heading, count, sub, action and body', () => {
    const s = html(<Section title="Branches" count={3} sub="Offices" action={{ label: 'Export', onClick: noop }}><p>body</p></Section>)
    const id = /aria-labelledby="([^"]+)"/.exec(s)![1]
    expect(s).toContain(`<h2 id="${id}" class="uk-sec__title">Branches</h2>`)
    expect(s).toContain('uk-count--brand')
    expect(s).toContain('<p class="uk-sec__sub">Offices</p>')
    expect(s).toContain('<button type="button" class="uk-sact">Export</button>')
    expect(s).toContain('<p>body</p>')
    expect(s).toContain('data-state="ready"')
    expect(s).toMatch(/class="ut-card uk-sec uk-sec--section ufx-rise"/)
  })
  it('loading: skeleton, busy, no footer', () => {
    const s = html(<Section title="Leave" loading footerLink={{ label: 'View all' }}><p>body</p></Section>)
    expect(s).toContain('aria-busy="true"')
    expect(s).toContain('data-state="loading"')
    expect(s).toContain('role="status"')
    expect(s).toContain('aria-label="Loading Leave"')
    expect(s).not.toContain('<p>body</p>')
    expect(s).not.toContain('View all')
  })
  it('error: role=alert, the server message and "Try again"', () => {
    const s = html(<Section title="Leave" error={new Error('Leave service is down')} onRetry={noop}><p>body</p></Section>)
    expect(s).toContain('role="alert"')
    expect(s).toContain('Leave service is down')
    expect(s).toContain('Try again')
    expect(s).not.toContain('<p>body</p>')
  })
  it('empty: default line, or your own with the next action', () => {
    expect(html(<Section title="Runs" empty />)).toContain('Nothing here yet')
    const s = html(<Section title="Runs" empty={{ title: 'No payroll runs', hint: 'Run payroll to see it here.', action: <button>Run payroll</button> }} />)
    expect(s).toContain('uk-empty--dashed')
    expect(s).toContain('No payroll runs')
    expect(s).toContain('<button>Run payroll</button>')
    expect(html(<Section variant="dashboard" title="x" empty={{ title: 'None' }} />)).toContain('uk-empty__icon')
  })
  it('state precedence: loading > error > empty', () => {
    expect(html(<Section title="x" loading error="boom" empty />)).toContain('data-state="loading"')
    expect(html(<Section title="x" error="boom" empty />)).toContain('data-state="error"')
  })
  it('footer link, variants and legacy class opt-out', () => {
    const s = html(<Section variant="dashboard" title="x" footerLink={{ label: 'View all 19 items', onClick: noop }}>b</Section>)
    expect(s).toContain('uk-sec--dashboard')
    expect(s).toContain('ufx-spot uk-sec--spot')
    expect(s).toContain('uk-slink--block')
    expect(s).toContain('View all 19 items')
    expect(html(<Section variant="panel" title="x" level={3} cardClass={false}>b</Section>)).toMatch(/^<section[^>]*class="uk-sec uk-sec--panel ufx-rise"[^>]*>.*<h3/)
  })
  it('heading, links, actions, mini stats and key/values', () => {
    const h = html(<SectionHeading icon="clock" title="Attendance" sub="How the week went" actions={<SectionLink size="md" label="View attendance" onClick={noop} />} />)
    expect(h).toContain('uk-shead--group')
    expect(h).toContain('<h2 class="uk-shead__title">Attendance</h2>')
    expect(h).toContain('uk-slink--md')
    expect(html(<SectionHeading title="Quick actions" sub="Most used first" />)).toContain('uk-shead--inline')
    expect(html(<SectionLink label="Open" href="/att" />)).toMatch(/^<a class="uk-slink uk-slink--sm" href="\/att">Open<\/a>$/)
    expect(html(<SectionAction label="Customise" tone="neutral" />)).toContain('uk-sact uk-sact--neutral')
    reduceMotion()
    const m = html(<MiniStat label="Processed" value={231} note="of 239" tone="success" />)
    expect(m).toContain('uk-mstat__dot--success')
    expect(m).toContain('<div class="uk-mstat__value">231</div>')
    const kv = html(<KeyValueGrid items={[{ label: 'PAN', value: 'ABCDE1234F' }, { label: 'GSTIN', value: '' }]} />)
    expect(kv).toContain('<dt class="uk-kv__k">PAN</dt><dd class="uk-kv__v">ABCDE1234F</dd>')
    expect(kv).toContain('<dd class="uk-kv__v">—</dd>')
  })
})

describe('ListRow', () => {
  it('static row inside a list', () => {
    const s = html(<ListRows label="Today"><ListRow title="Priya Sharma" sub="Engineering" end="09:24" /></ListRows>)
    expect(s).toMatch(/^<div role="list" aria-label="Today" class="uk-rows">/)
    expect(s).toContain('role="listitem"')
    expect(s).toContain('<span class="uk-row__title">Priya Sharma</span>')
    expect(s).toContain('<span class="uk-row__sub">Engineering</span>')
    expect(s).toContain('<span class="uk-row__end">09:24</span>')
  })
  it('a clickable row keeps its buttons outside the click area', () => {
    const s = html(<ListRow title="Priya" onClick={noop} actions={<button>Approve</button>} chevron />)
    expect(s).toMatch(/<button type="button" class="uk-row__main">.*<\/button><span class="uk-row__actions"><button>Approve<\/button><\/span>/)
    expect(s).toContain('uk-row__chev')
  })
  it('link rows, variants, densities and selection', () => {
    expect(html(<ListRow title="x" href="/p/1" />)).toContain('<a class="uk-row__main" href="/p/1">')
    const s = html(<ListRow title="x" variant="table" density="comfy" selected onClick={noop} />)
    expect(s).toContain('uk-row--table uk-row--comfy uk-row--link uk-row--selected')
    expect(s).toContain('aria-pressed="true"')
    expect(html(<ListRows bleed><span /></ListRows>)).toContain('uk-rows--bleed')
  })
  it('icon tile and date tile', () => {
    expect(html(<IconTile icon="clock" tone="danger" />)).toContain('uk-itile uk-tone--danger')
    const d = html(<DateTile day="28" month="Sep" label="Monday 28 September" />)
    expect(d).toContain('role="img"')
    expect(d).toContain('aria-label="Monday 28 September"')
  })
})

describe('StatusPill, CountBadge, Chip, StatusDot', () => {
  it('every README tone renders its tone class', () => {
    for (const t of STATUS_TONES) expect(html(<StatusPill tone={t}>x</StatusPill>)).toContain(`uk-tone--${t}`)
    expect(STATUS_TONES).toEqual(expect.arrayContaining(['success', 'warning', 'danger', 'info', 'leave', 'holiday', 'amber', 'neutral']))
  })
  it('sizes, dot and a fixed width for aligned columns', () => {
    const s = html(<StatusPill tone="brand" size="md" dot minWidth={96}>Present</StatusPill>)
    expect(s).toBe('<span class="uk-pill uk-pill--md uk-tone--brand uk-pill--fixed" style="min-width:96px"><span class="uk-pill__dot" aria-hidden="true"></span>Present</span>')
    expect(html(<StatusPill size="tag">On leave</StatusPill>)).toContain('uk-pill--tag')
    expect(html(<StatusPill size="xs">Due Wed</StatusPill>)).toContain('uk-pill--xs')
  })
  it('count badge with a spoken label', () => {
    const s = html(<CountBadge tone="gold" size="md" label="19 need you">19</CountBadge>)
    expect(s).toContain('uk-count--gold uk-count--md')
    expect(s).toContain('<span class="uk-sr">19 need you</span>')
  })
  it('chips and status dots', () => {
    expect(html(<Chip variant="outline" value="3">companies</Chip>)).toBe('<span class="uk-chip uk-chip--outline"><b class="uk-chip__value">3</b>companies</span>')
    expect(html(<Chip variant="code">BLR-HQ</Chip>)).toContain('uk-chip--code')
    expect(html(<StatusDot tone="muted">Inactive</StatusDot>)).toContain('uk-sdot--muted')
  })
})

describe('Avatar', () => {
  it('initials from the name, never throws on missing names', () => {
    expect(initialsOf('Priya Sharma')).toBe('PS')
    expect(initialsOf('priya')).toBe('P')
    expect(initialsOf('S. Kumar Rao')).toBe('SR')
    expect(initialsOf('')).toBe('?')
    expect(initialsOf(null)).toBe('?')
    expect(initialsOf('  ')).toBe('?')
    expect(initialsOf('Élodie Ñúñez')).toBe('ÉÑ')
    expect(initialsOf('राहुल कुमार')).toBe('रक')
  })
  it('decorative by default; labelled when it stands alone', () => {
    const s = html(<Avatar name="Priya Sharma" />)
    expect(s).toContain('aria-hidden="true"')
    expect(s).toContain('>PS<')
    const l = html(<Avatar name="Priya Sharma" decorative={false} status="online" statusLabel="Online" />)
    expect(l).toContain('role="img"')
    expect(l).toContain('aria-label="Priya Sharma, Online"')
    expect(l).toContain('uk-av__dot--online')
  })
  it('photo, tones, square monograms and the company shadow', () => {
    expect(html(<Avatar name="A B" src="/a.png" />)).toContain('<img class="uk-av__img" src="/a.png" alt=""')
    const s = html(<Avatar initials="DT" size={64} tone="solid" shape="square" raised float />)
    expect(s).toContain('uk-av--solid uk-av--square uk-av--raised ufx-float')
    expect(s).toContain('border-radius:18px')
    expect(s).toContain('font-size:21px')
    expect(s).toContain('>DT<')
  })
})

describe('EmptyState / ErrorState / Skeleton', () => {
  it('plain empty: icon badge, title, hint, next action, polite status', () => {
    const s = html(<EmptyState title="No completed ratings yet." hint="Ratings show up once managers submit reviews." action={<button>Start a cycle</button>} />)
    expect(s).toContain('role="status"')
    expect(s).toContain('uk-empty__icon')
    expect(s).toContain('<button>Start a cycle</button>')
  })
  it('dashed and success variants', () => {
    expect(html(<EmptyState variant="dashed" title="Nothing here yet" />)).toContain('uk-empty--dashed')
    expect(html(<EmptyState variant="success" title="You’re all caught up" />)).toContain('uk-empty__check')
  })
  it('error: alert with the server message and Try again', () => {
    const s = html(<ErrorState error={new Error('Server said no')} onRetry={noop} />)
    expect(s).toContain('role="alert"')
    expect(s).toContain('Couldn’t load this')
    expect(s).toContain('Server said no')
    expect(s).toContain('Try again')
    expect(html(<ErrorState error={null} retrying onRetry={noop} />)).toContain('Retrying…')
    expect(html(<ErrorState message="Custom" />)).not.toContain('<button')
  })
  it('errorText picks the best message', () => {
    expect(errorText(new Error('boom'))).toBe('boom')
    expect(errorText('plain')).toBe('plain')
    expect(errorText({ message: 'from object' })).toBe('from object')
    expect(errorText(undefined)).toMatch(/Something went wrong/)
  })
  it('skeleton shapes are hidden from assistive tech; blocks announce once', () => {
    expect(html(<Skeleton width={42} height={42} circle />)).toContain('aria-hidden="true"')
    const l = html(<SkeletonList rows={3} label="Loading requests" />)
    expect(l).toContain('role="status"')
    expect(l).toContain('aria-label="Loading requests"')
    expect(count(l, 'uk-skel-row"')).toBe(3)
    expect(count(html(<SkeletonStats count={4} />), 'uk-skel-stat"')).toBe(4)
    expect(count(html(<SkeletonTable rows={2} cols={4} />), 'uk-skel-table__row"')).toBe(2)
  })
})

describe('bars, meters and rings', () => {
  it('progress bar is decorative without a label and a progressbar with one', () => {
    expect(html(<ProgressBar value={40} />)).toContain('aria-hidden="true"')
    const s = html(<ProgressBar value={6.5} max={12} label="Casual leave" valueText="6.5 of 12 days" />)
    expect(s).toContain('role="progressbar"')
    expect(s).toContain('aria-valuenow="6.5"')
    expect(s).toContain('aria-valuemax="12"')
    expect(s).toContain('width:54.16')
  })
  it('clamps, and minVisible keeps a sliver for tiny values', () => {
    expect(html(<ProgressBar value={140} />)).toContain('width:100%')
    expect(html(<ProgressBar value={-5} />)).toContain('width:0%')
    expect(html(<ProgressBar value={0.5} minVisible={2} />)).toContain('width:2%')
    expect(html(<ProgressBar value={0} minVisible={2} />)).toContain('width:0%')
    expect(html(<ProgressBar value={5} max={0} />)).toContain('width:0%')
  })
  it('meter writes "6.5 / 12" and says "6.5 of 12"', () => {
    const s = html(<Meter label="Casual leave" value={6.5} max={12} />)
    expect(s).toContain('<b>6.5</b>')
    expect(s).toContain('/ 12')
    expect(s).toContain('<span class="uk-sr">6.5 of 12</span>')
    expect(s).toContain('uk-bar--tint')
  })
  it('bar list scales amounts to the largest and makes rows buttons when clickable', () => {
    const s = html(<BarList items={[{ label: 'Eng', value: 72, amount: 72, onClick: noop }, { label: 'HR', value: 13, amount: 13 }]} />)
    expect(s).toContain('uk-barlist--btns')
    expect(s).toContain('width:100%')
    expect(s).toContain('width:18.05')
    expect(count(s, '<button')).toBe(1)
  })
  it('stacked bar: segments add up and the legend matches', () => {
    const s = html(<StackedBar label="30 people" segments={[{ label: 'BLR', value: 18 }, { label: 'HYD', value: 6 }, { label: 'PUN', value: 6 }]} />)
    expect(s).toContain('left:0%;width:60%')
    expect(s).toContain('left:60%;width:20%')
    expect(s).toContain('left:80%;width:20%')
    expect(count(s, 'uk-legend__item')).toBe(3)
    expect(html(<Legend items={[{ label: 'To fix', shape: 'outline', tone: 'danger' }]} />)).toContain('uk-legend__sw--outline')
  })
  it('progress ring draws its arc from the value', () => {
    const s = html(<ProgressRing value={6.5} max={10} label="Casual leave">6.5</ProgressRing>)
    expect(s).toContain('stroke-dasharray="65.00 35.00"')
    expect(s).toContain('ufx-ring')
    expect(s).toContain('aria-label="Casual leave: 65%"')
    expect(html(<ProgressRing value={0} />)).not.toContain('ufx-ring')
  })
  it('donut arcs leave the design’s 0.9% gaps and skip empty parts', () => {
    const a = donutArcs([50, 50, 0])
    expect(a[0]).toEqual({ dash: '49.10 50.90', offset: '0.00' })
    expect(a[1]).toEqual({ dash: '49.10 50.90', offset: '-50.00' })
    expect(a[2]).toBeNull()
    expect(donutArcs([0, 0])).toEqual([null, null])
    expect(count(html(<DonutRing segments={[{ label: 'a', value: 1 }, { label: 'b', value: 3 }]} />), 'ufx-ring')).toBe(2)
  })
  it('geofence ring: radius scales with the boundary; dashed amber when unset', () => {
    expect(geofenceRadius(0)).toBe(12)
    expect(geofenceRadius(500)).toBe(38)
    expect(geofenceRadius(9000)).toBe(38)
    expect(geofenceRadius(150, 'preview')).toBe(31)
    const set = html(<GeofenceRing radius={150} />)
    expect(set).toContain('aria-label="Check-in boundary: 150 m"')
    expect(set).toContain('r="20"')
    expect(set).toContain('uk-geo__area ufx-ring')
    const unset = html(<GeofenceRing radius={null} />)
    expect(unset).toContain('aria-label="No check-in boundary set"')
    expect(unset).toContain('uk-geo__unset')
    expect(unset).toContain('stroke-dasharray="4 4"')
    expect(html(<GeofenceRing size="preview" radius={0} />)).not.toContain('uk-geo__area')
  })
})

describe('SegmentedControl / FilterPills', () => {
  const opts = [{ value: 'all', label: 'All' }, { value: 'late', label: 'Late', count: 8 }, { value: 'none', label: 'Not marked', disabled: true }]
  it('tabs mode (default, as the design): tablist, aria-selected, one tab stop, counts', () => {
    const s = html(<SegmentedControl options={opts} value="late" onChange={noop} label="Filter check-ins" />)
    expect(s).toContain('role="tablist"')
    expect(count(s, 'role="tab"')).toBe(3)
    expect(count(s, 'tabindex="0"')).toBe(1)
    expect(s).toMatch(/aria-selected="true"[^>]*class="uk-seg__opt is-on">Late<span class="uk-seg__n">8<\/span>/)
    expect(s).toContain('disabled=""')
  })
  it('radio and toggle modes', () => {
    const r = html(<SegmentedControl options={opts} value="all" onChange={noop} label="x" semantics="radio" />)
    expect(r).toContain('role="radiogroup"')
    expect(r).toContain('aria-checked="true"')
    const t = html(<SegmentedControl options={opts} value="all" onChange={noop} label="x" semantics="toggle" size="xl" />)
    expect(t).toContain('role="group"')
    expect(t).toContain('aria-pressed="true"')
    expect(t).toContain('uk-seg--xl')
  })
  it('falls back to the first enabled option when the value is unknown', () => {
    const s = html(<SegmentedControl options={opts} value={'zzz' as string} onChange={noop} label="x" />)
    expect(s).toMatch(/aria-selected="true"[^>]*class="uk-seg__opt is-on">All/)
  })
  it('filter pills: toggle buttons by default, tabs when asked', () => {
    const s = html(<FilterPills options={[{ value: 'a', label: 'All statuses' }, { value: 'b', label: 'Active', count: 11 }]} value="a" onChange={noop} label="Status" />)
    expect(s).toContain('role="group"')
    expect(s).toContain('aria-pressed="true"')
    expect(s).toContain('<span class="uk-fpill__n">11</span>')
    const t = html(<FilterPills options={[{ value: 'a', label: 'A' }]} value="a" onChange={noop} label="Status" semantics="tabs" />)
    expect(t).toContain('role="tablist"')
    expect(t).toContain('aria-selected="true"')
  })
})

describe('Sparkline', () => {
  it('needs two points; live cards show a dashed baseline for a flat series', () => {
    expect(sparkShape([5]).flat).toBe(true)
    expect(sparkShape([4, 4, 4], 'live').flat).toBe(true)
    expect(sparkShape([4, 4, 4], 'stat').flat).toBe(false)
    expect(html(<Sparkline values={[1]} />)).toBe('')
    const live = html(<Sparkline values={[3, 3]} variant="live" />)
    expect(live).toContain('stroke-dasharray="2 5"')
    expect(live).toContain('uk-spark__dot--still')
  })
  it('maps the series into the box (min at the bottom, max at the top) and puts the dot on the chosen point', () => {
    const s = sparkShape([0, 10], 'stat')
    expect(s.line).toBe('M0.0 30.0 C14.7 25.7 73.3 8.3 88.0 4.0')
    expect(s.area.endsWith(' L88 34 L0 34 Z')).toBe(true)
    expect(s.dot).toEqual([88, 4])
    expect(sparkShape([0, 10, 5], 'live', 1).dot).toEqual([42, 4])
    expect(sparkShape([1, Number.NaN, 3], 'live').flat).toBe(false)
  })
  it('draws in and can be described for screen readers', () => {
    const s = html(<Sparkline values={[1, 2, 3]} label="Rising over 3 days" />)
    expect(s).toContain('role="img"')
    expect(s).toContain('aria-label="Rising over 3 days"')
    expect(s).toContain('class="ufx-draw" data-ufx-draw=""')
    expect(html(<Sparkline values={[1, 2, 3]} />)).toContain('aria-hidden="true"')
  })
  it('smoothPath is stable for a single point', () => {
    expect(smoothPath([[1, 2]])).toBe('M1.0 2.0')
  })
})
