// Add employee → "Create" beside Branch, Department, Designation, Employment
// type, Shift and Staffing agency. The panel shows the Master page's own add
// form for that list (MasterDesign CREATE_FORMS: the same fields and checks),
// framed by the shared Create panel instead of its drawer. Its save is caught
// (masterCreate catchSave) and sent for the company chosen in the employee
// form; once the list has refreshed, the new item is selected in the field
// Create sits beside. The employee form stays open underneath the whole time,
// so nothing typed there is lost.
import { createContext, useContext, useMemo, useRef, type ComponentType, type Context, type ReactNode } from 'react'
import * as Design from '@/design/master/MasterDesign'
import { useToast } from '@/design/kit/overlays'
import { CreateButton, CreatePanel, useCreatePanel } from '@/shared/components/inlineCreate/InlineCreate'
import { CREATE_KINDS, catchSave, createBlockedReason, scopeDb, selectionAfterCreate, type CaughtSave, type CreateKind } from './masterCreate'
import { TYPE_LABEL, type Rec } from './masterData'

interface FrameProps { title: ReactNode; sub?: ReactNode; cta: ReactNode; onClose: () => void; onSubmit: () => void; children: ReactNode }
// The generated design module is untyped JavaScript; these are the pieces used here.
const AppCtx = Design.AppCtx as unknown as Context<any>
const FormFrame = Design.FormFrame as unknown as Context<ComponentType<FrameProps> | null>
const CREATE_FORMS = Design.CREATE_FORMS as unknown as Record<CreateKind, (values: Rec, onClose: () => void) => ReactNode>

/** The hosting field's save state, read by the frame the hosted form draws. */
const HostCtx = createContext<{ busy: boolean; error: string | null }>({ busy: false, error: null })

/** A Master add form's frame while it is hosted here: the shared Create panel around the form's own fields. */
function HostedFrame({ title, sub, cta, onClose, onSubmit, children }: FrameProps) {
  const host = useContext(HostCtx)
  return (
    <CreatePanel open title={title} sub={sub} cta={cta} busy={host.busy} error={host.error} onCancel={onClose} onSubmit={onSubmit}>
      {/* The Master design's styles live under .utm; the gap is its drawer's spacing between sections. */}
      <div className="utm" style={{ display: 'flex', flexDirection: 'column', gap: 26, minWidth: 0 }}>{children}</div>
    </CreatePanel>
  )
}

/** The control of the field a Create button sits beside: its list, its chosen option, or its input. */
function fieldControl(button: HTMLElement | null): HTMLElement | null {
  const field = button?.closest('.field')
  if (!field) return null
  for (const sel of ['.ddb', '.seg button.on', '.seg button', 'input']) {
    const el = field.querySelector<HTMLElement>(sel)
    if (el) return el
  }
  return null
}

export interface MasterCreateFieldProps {
  kind: CreateKind
  /** The employee form's values now; its company decides where the new item goes. */
  values: Rec
  /** The employee form's setter: the new item is selected with it. */
  set: (k: string, value: unknown) => void
  /** May create this kind of record (the permission its POST checks). */
  allowed: boolean
  /** Saves one new record in a company and refreshes its list; resolves to the new id (null when the server didn't say). */
  create: (k: CreateKind, rec: Rec, co: string) => Promise<string | null>
}

export function MasterCreateField({ kind, values, set, allowed, create }: MasterCreateFieldProps) {
  const outer = useContext(AppCtx)
  const panel = useCreatePanel()
  const toast = useToast()
  const co = String(values.co || '')
  const latest = useRef({ values, set })
  latest.current = { values, set }
  const box = useRef<CaughtSave | null>(null)

  // The hosted form sees only this company's records, starts from this company, and saves into `box`.
  const inner = useMemo(() => {
    const db = scopeDb(outer.db, co)
    return { ...outer, db, act: { ...outer.act, defaultCo: co }, ...catchSave(db, box) }
  }, [outer, co])

  // The hosted form calls onClose on Cancel, and right after its save (which catchSave caught).
  const formClosed = () => {
    const caught = box.current
    box.current = null
    if (!caught) { panel.cancel(); return }
    void panel.save(async () => ({ caught, id: await create(kind, caught.rec, co) }), {
      then: ({ caught: c, id }) => {
        const pick = selectionAfterCreate(kind, c.rec, id, latest.current.values, TYPE_LABEL)
        for (const [k, x] of pick.set) latest.current.set(k, x)
        if (pick.note) toast.info(pick.note, { duration: 7000 })
        else toast.success(c.msg || `${String(c.rec.name || 'It')} added`, { detail: 'Selected in the form.' })
      },
      focus: () => fieldControl(panel.trigger.current),
    })
  }

  return (
    <>
      <CreateButton ref={panel.trigger} noun={CREATE_KINDS[kind].noun} blockedReason={createBlockedReason(kind, allowed, co)} onClick={panel.start} />
      {panel.open && (
        <AppCtx.Provider value={inner}>
          <FormFrame.Provider value={HostedFrame}>
            <HostCtx.Provider value={{ busy: panel.busy, error: panel.error }}>
              {CREATE_FORMS[kind](values, formClosed)}
            </HostCtx.Provider>
          </FormFrame.Provider>
        </AppCtx.Provider>
      )}
    </>
  )
}
