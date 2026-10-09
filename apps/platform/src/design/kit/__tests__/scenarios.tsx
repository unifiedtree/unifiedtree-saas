// Scenarios the overlay-kit tests drive in a real browser (see overlays.test.ts). Each one
// renders a component the way a page would and writes what its callbacks received to
// window.__log, so the test can check behaviour without reaching into React.
import { useRef, useState, type ComponentType, type ReactNode } from 'react'
import { SidePanel, type SidePanelStep } from '../SidePanel'
import { Dialog } from '../Dialog'
import { Menu } from '../Menu'
import { Dropdown, type DropdownOption } from '../Dropdown'
import { DateRangeButton, DateRangeDialog, type RangeEnd } from '../DateRangePicker'
import { ToastProvider, useToast } from '../Toast'
import { Checkbox, DateInput, FieldGrid, Input, Select, Slider, Textarea, Toggle } from '../FormField'
import { ApprovalRow, type ApprovalStatus } from '../ApprovalRow'
import { PanelButton } from '../PanelButton'
import { HrDrawer, HrSelect } from '@/shared/components/hr'
import { ConfirmDialogProvider, useConfirmDialog } from '@/shared/components/ConfirmDialog'
import { useDesignToast } from '@/design/module/ModuleKit'
import { Modal, Drawer } from '@unifiedtree/ui-kit'

declare global { interface Window { __log: string[] } }
export const log = (entry: string) => { (window.__log ||= []).push(entry) }

function Frame({ children }: { children: ReactNode }) {
  return <div style={{ padding: 24, display: 'grid', gap: 16, justifyItems: 'start', fontFamily: "var(--u-font,'Inter',system-ui,sans-serif)" }}>{children}</div>
}

// ── Stepped side panel ──
function SidePanelCase() {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [city, setCity] = useState('')
  const [state, setState] = useState('Karnataka')
  const [geo, setGeo] = useState(true)
  const [radius, setRadius] = useState(150)
  const [hq, setHq] = useState(false)
  const steps: SidePanelStep[] = [
    {
      label: 'Branch details', sub: 'Basic details about this branch', icon: 'building', blocker: !name.trim() && 'Add the branch name',
      content: (
        <FieldGrid>
          <Input label="Branch name" required placeholder="e.g. Mumbai Office" value={name} onChange={(e) => setName(e.target.value)} />
          <Input label="Code" placeholder="MUM" defaultValue="" name="code" />
        </FieldGrid>
      ),
    },
    {
      label: 'Location', sub: 'Where the office is', icon: 'mapPin', blocker: !city.trim() && 'Add the city',
      content: (
        <FieldGrid>
          <Input label="City" required placeholder="Mumbai" value={city} onChange={(e) => setCity(e.target.value)} />
          <Select label="State" required value={state} onChange={(e) => setState(e.target.value)} options={[{ value: 'Karnataka', label: 'Karnataka' }, { value: 'Maharashtra', label: 'Maharashtra' }]} />
          <Checkbox full card checked={hq} onChange={setHq} label="Mark as headquarters" description="The headquarters is the company’s main address on letters and payslips." />
        </FieldGrid>
      ),
    },
    {
      label: 'Check-in area', sub: 'Where people can punch in', icon: 'crosshair',
      content: (
        <div style={{ display: 'grid', gap: 12 }}>
          <Toggle checked={geo} onChange={setGeo} label="Only allow check-in inside this area" description="Mobile and web punches outside it are flagged" />
          {geo && <Slider label="Radius" value={radius} onChange={setRadius} min={50} max={500} step={10} format={(v) => `${v} m`} minLabel="50 m · one building" maxLabel="500 m · a campus" />}
        </div>
      ),
    },
    { label: 'Review', sub: 'Check everything before you save', icon: 'checkCircle', content: <div data-testid="review">{name} · {city}, {state}</div> },
  ]
  return (
    <Frame>
      <button type="button" id="open" onClick={() => setOpen(true)}>Add branch</button>
      <SidePanel
        open={open}
        onClose={() => { log('close'); setOpen(false) }}
        title="Create branch"
        sub="A workplace location for Demo Technologies Pvt Ltd."
        steps={steps}
        onStepChange={(i) => log(`step:${i}`)}
        onBlocked={(i, reason) => log(`blocked:${i}:${reason}`)}
        finishLabel="Create branch"
        onFinish={() => { log(`finish:${name}|${city}|${state}|${geo}|${radius}|${hq}`); setOpen(false) }}
      />
    </Frame>
  )
}

// ── Plain panel with a nested dropdown and a confirm dialog on top ──
const COMPANIES: DropdownOption[] = [
  { value: 'dt', label: 'Demo Technologies Pvt Ltd', sub: 'IT Services · 3 branches · 30 people', monogram: 'DT' },
  { value: 'dr', label: 'Demo Retail Pvt Ltd', sub: 'Retail · 9 branches · 139 people', monogram: 'DR', tone: '#2585C7' },
  { value: 'df', label: 'Demo Foundation', sub: 'Non-profit · 1 branch · 6 people', monogram: 'DF', tone: '#8B4FE0' },
]

function NestedCase() {
  const [open, setOpen] = useState(false)
  const [ask, setAsk] = useState(false)
  const [co, setCo] = useState<string>('dt')
  return (
    <Frame>
      <button type="button" id="open" onClick={() => setOpen(true)}>Open panel</button>
      <SidePanel
        open={open}
        onClose={() => { log('panel-close'); setOpen(false) }}
        title="Edit branch"
        sub="Change the details and save."
        footer={<><PanelButton id="cancel" onClick={() => setOpen(false)}>Cancel</PanelButton><PanelButton id="delete" variant="danger" onClick={() => setAsk(true)}>Delete</PanelButton></>}
      >
        <div style={{ display: 'grid', gap: 14 }}>
          <Input label="Name" defaultValue="Pune office" id="nested-name" />
          <Dropdown label="Company" options={COMPANIES} value={co} onChange={(v) => { log(`co:${v}`); setCo(v) }} />
        </div>
      </SidePanel>
      <Dialog
        open={ask}
        onClose={() => { log('dialog-close'); setAsk(false) }}
        title="Delete Pune office?"
        sub="People in it stay in the company."
        icon="trash"
        tone="danger"
        footer={<><PanelButton onClick={() => setAsk(false)}>Keep</PanelButton><PanelButton variant="danger" onClick={() => { log('deleted'); setAsk(false) }}>Delete</PanelButton></>}
      />
    </Frame>
  )
}

// ── Menu ──
function MenuCase() {
  return (
    <Frame>
      <Menu
        label="Account"
        header={{ title: 'Demo Owner', sub: 'Owner · Demo Technologies' }}
        items={[
          { key: 'profile', label: 'My profile', icon: 'users', onSelect: () => log('menu:profile') },
          { key: 'prefs', label: 'Preferences', icon: 'settings', onSelect: () => log('menu:prefs') },
          { key: 'sep', separator: true },
          { key: 'off', label: 'Archived items', disabled: true, onSelect: () => log('menu:off') },
          { key: 'out', label: 'Sign out', icon: 'logOut', danger: true, onSelect: () => log('menu:out') },
        ]}
        trigger={({ props }) => <button type="button" id="trigger" {...props}>Account</button>}
      />
      <button type="button" id="after">After</button>
    </Frame>
  )
}

// ── Dropdown ──
function DropdownCase() {
  const [co, setCo] = useState<string>('dt')
  return (
    <Frame>
      <div style={{ width: 'min(480px, 100%)' }}>
        <Dropdown
          label="Company"
          variant="rich"
          options={COMPANIES}
          value={co}
          onChange={(v) => { log(`pick:${v}`); setCo(v) }}
          eyebrow={(i, n) => `Company ${i} of ${n}`}
          hint="Switch"
          searchPlaceholder="Search companies…"
          emptyText="No company matches that search."
          footerAction={{ label: 'Add company', onClick: () => log('add-company') }}
        />
      </div>
      <button type="button" id="after">After</button>
    </Frame>
  )
}

// ── Dropdown that searches on the server (onSearch): the rows are the "server's" answer, shown as given ──
const PEOPLE: DropdownOption[] = [
  { value: 'p1', label: 'Asha Rao', sub: 'EMP-001' },
  { value: 'p2', label: 'Ravi Kumar', sub: 'EMP-002' },
]
function DropdownServerCase() {
  const [who, setWho] = useState<string | null>(null)
  const [q, setQ] = useState('')
  // The "server" matches EMP-002 by a field the rows don't show (a client-side filter would hide it).
  const rows = q === 'zz-hidden' ? [PEOPLE[1]] : q ? [] : PEOPLE
  return (
    <Frame>
      <div style={{ width: 'min(480px, 100%)' }}>
        <Dropdown label="Employee" options={rows} value={who} searchable emptyText="No one matches."
          onSearch={(s) => { log(`search:${s}`); setQ(s) }} onChange={(v) => { log(`pick:${v}`); setWho(v) }} />
      </div>
    </Frame>
  )
}

// ── "Select dates" opened from the form's From / To box ──
function DateRangeCase() {
  const [r, setR] = useState({ from: '2026-11-06', to: '2026-11-10' })
  const [box, setBox] = useState<RangeEnd>('from')
  const [openBox, setOpenBox] = useState(false)
  return (
    <Frame>
      <DateRangeButton from={r.from} to={r.to} startLabel="From *" endLabel="To *" onOpen={(b) => { log(`open:${b}`); setBox(b); setOpenBox(true) }} />
      <DateRangeDialog open={openBox} onClose={() => setOpenBox(false)} from={r.from} to={r.to} openedFrom={box} today="2026-11-02" min="2026-11-02"
        calendar={{ off: new Set([0, 6]), holidays: new Map() }} onDone={(p) => { log(`done:${p.from}..${p.to}`); setR({ from: p.from, to: p.to }); setOpenBox(false) }} />
    </Frame>
  )
}

// ── Toasts ──
function ToastButtons() {
  const toast = useToast()
  const design = useDesignToast()
  return (
    <>
      <button type="button" id="ok" onClick={() => toast.success('Saved Pune office', { onExpire: () => log('ok-expired') })}>Success</button>
      <button type="button" id="err" onClick={() => toast.error('Could not save', { detail: 'The server said no.' })}>Error</button>
      <button type="button" id="undo" onClick={() => toast.success('Approved · Priya has been told', { undo: { onUndo: () => log('undone'), seconds: 5 }, onExpire: () => log('undo-expired') })}>Undo</button>
      <button type="button" id="design-ok" onClick={() => design.show('Leave approved')}>Design success</button>
      <button type="button" id="design-err" onClick={() => design.show('Could not approve', true, 'Try again in a minute.')}>Design error</button>
      {design.node}
    </>
  )
}
function ToastCase() {
  return <ToastProvider><Frame><ToastButtons /></Frame></ToastProvider>
}

// ── Form fields ──
function FormCase() {
  const [name, setName] = useState('')
  const [on, setOn] = useState(false)
  const [r, setR] = useState(150)
  const [check, setCheck] = useState(false)
  const [day, setDay] = useState('')
  return (
    <Frame>
      <div style={{ width: 'min(560px, 100%)' }}>
        <FieldGrid>
          <Input id="f-name" label="Branch name" required hint="As people will see it" value={name} onChange={(e) => setName(e.target.value)} error={name ? undefined : 'Add the branch name'} />
          <Select id="f-state" label="State" placeholder="Choose a state" options={[{ value: 'ka', label: 'Karnataka' }]} defaultValue="" />
          <Textarea id="f-notes" label="Notes" full rows={3} />
          <Toggle id="f-geo" full checked={on} onChange={(v) => { log(`toggle:${v}`); setOn(v) }} label="Only allow check-in inside this area" description="Mobile and web punches outside it are flagged" />
          <Slider id="f-radius" full label="Radius" value={r} onChange={setR} min={50} max={500} step={10} format={(v) => `${v} m`} minLabel="50 m" maxLabel="500 m" />
          <Checkbox id="f-hq" full card checked={check} onChange={(v) => { log(`check:${v}`); setCheck(v) }} label="Mark as headquarters" description="Main address on letters and payslips." />
          <DateInput id="f-day" label="Joining date" value={day} onChange={(e) => { log(`day:${e.target.value}`); setDay(e.target.value) }} />
          <Input id="f-native-date" type="date" label="Native date asked for" />
        </FieldGrid>
      </div>
    </Frame>
  )
}

// ── Approval rows ──
function ApprovalCase() {
  const [a, setA] = useState<ApprovalStatus>('pending')
  const [b, setB] = useState<ApprovalStatus>('pending')
  const [until] = useState(() => Date.now() + 3000)
  return (
    <Frame>
      <div style={{ width: 'min(600px, 100%)' }} id="compact">
        <ApprovalRow
          name="Priya Sharma" title="Casual leave · Mon 28 – Tue 29 Sep · 2 days" meta="12 min ago" status={a}
          onApprove={() => { log('approve:a'); setA('approved') }} onReject={() => { log('reject:a'); setA('rejected') }}
          onUndo={() => { log('undo:a'); setA('pending') }} undoUntil={until}
        />
      </div>
      <div style={{ width: 'min(760px, 100%)' }} id="card">
        <ApprovalRow
          variant="card" name="Kavya Menon" kind="Leave" meta="3 hr ago" title="Earned leave · Mon 5 – Fri 9 Oct · 5 days" reason="Family trip to Kerala"
          facts={[{ label: 'Balance after', value: '6 earned days' }, { label: 'Others out', value: 'Arjun Nair · 7–8 Oct' }]}
          flag="Two of eight people out on 7–8 Oct" withNote status={b}
          onApprove={(note) => { log(`approve:b:${note}`); setB('approved') }} onReject={(note) => { log(`reject:b:${note}`); setB('rejected') }}
          onUndo={() => { log('undo:b'); setB('pending') }}
        />
      </div>
      <div style={{ width: 'min(600px, 100%)' }} id="readonly">
        <ApprovalRow name="Aditya Bose" title="Casual leave · Thu 1 Oct" status="pending" />
      </div>
    </Frame>
  )
}

// ── The restyled existing primitives ──
function HrDrawerCase() {
  const [open, setOpen] = useState(false)
  const [sel, setSel] = useState('a')
  const [day, setDay] = useState('')
  return (
    <Frame>
      <button type="button" id="open" onClick={() => setOpen(true)}>Open drawer</button>
      {open && (
        <HrDrawer title="Reject advance" width="max-w-md" onClose={() => { log('hr-close'); setOpen(false) }}
          footer={<><button type="button" id="hr-cancel" onClick={() => setOpen(false)}>Cancel</button><button type="button" id="hr-save" onClick={() => log('hr-save')}>Confirm rejection</button></>}>
          <p style={{ margin: '0 0 12px' }}>Priya Sharma · ₹20,000</p>
          <label style={{ display: 'grid', gap: 6 }}>Reason<textarea id="hr-reason" className="ut-input" rows={3} /></label>
          <div style={{ marginTop: 12 }}><HrSelect value={sel} onChange={setSel} options={[{ value: 'a', label: 'First' }, { value: 'b', label: 'Second' }]} /></div>
          <div style={{ marginTop: 12 }}><DateInput label="Pay back from" value={day} onChange={(e) => setDay(e.target.value)} /></div>
        </HrDrawer>
      )}
    </Frame>
  )
}

function UiKitCase() {
  const [modal, setModal] = useState(false)
  const [drawer, setDrawer] = useState(false)
  return (
    <Frame>
      <button type="button" id="open-modal" onClick={() => setModal(true)}>Open modal</button>
      <button type="button" id="open-drawer" onClick={() => setDrawer(true)}>Open drawer</button>
      <Modal open={modal} onOpenChange={(o) => { log(`modal:${o}`); setModal(o) }} title="Cancel this leave?" description="The days go back to your balance." size="sm">
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <PanelButton onClick={() => setModal(false)}>Keep it</PanelButton>
          <PanelButton variant="danger" onClick={() => { log('modal-confirm'); setModal(false) }}>Cancel leave</PanelButton>
        </div>
      </Modal>
      <Drawer open={drawer} onOpenChange={(o) => { log(`drawer:${o}`); setDrawer(o) }} title="Manage access">
        <p style={{ margin: 0 }}>Roles for Priya Sharma.</p>
      </Drawer>
    </Frame>
  )
}

function ConfirmButtons() {
  const confirm = useConfirmDialog()
  const trigger = useRef<HTMLButtonElement>(null)
  return (
    <>
      <button type="button" id="ask" ref={trigger} onClick={async () => log(`confirm:${await confirm({ title: 'Delete template?', body: 'This cannot be undone.', tone: 'danger', confirmLabel: 'Delete' })}`)}>Delete template</button>
      <button type="button" id="ask-plain" onClick={async () => log(`plain:${await confirm({ title: 'Send reminders?' })}`)}>Send reminders</button>
    </>
  )
}
function ConfirmCase() {
  return <ConfirmDialogProvider><Frame><ConfirmButtons /></Frame></ConfirmDialogProvider>
}

export const SCENARIOS: Record<string, ComponentType> = {
  sidepanel: SidePanelCase,
  nested: NestedCase,
  menu: MenuCase,
  dropdown: DropdownCase,
  'dropdown-server': DropdownServerCase,
  daterange: DateRangeCase,
  toast: ToastCase,
  form: FormCase,
  approval: ApprovalCase,
  hrdrawer: HrDrawerCase,
  uikit: UiKitCase,
  confirm: ConfirmCase,
}
