// A letter template (/hrms/letters/templates/:id, and /new), on the kit (P-DOCS;
// prototype PgTalent `ltpl`): name, letter type, subject and the body (rich text
// with merge fields like {{employee.fullName}}), the merge-field list to insert
// from, and the live preview the client asked for: the letter as it will come
// out, with the letterhead, the fields filled for someone the viewer may see, on
// its A4 page, while it is being written and before it is saved.
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import { P, usePermission } from '@unifiedtree/sdk'
import { Button, EmptyState, ErrorState, PageFrame, PageHeader, Section, SkeletonBlock } from '@/design/kit/display'
import { FieldGrid, Input, Select, useToast } from '@/design/kit/overlays'
import { useCompanies } from '@/modules/hrms/api/useOrg'
import {
  useLetterTemplate,
  useCreateTemplate,
  useUpdateTemplate,
  useMergeFieldsCatalogue,
  type LetterType,
  type MergeFieldEntry,
} from './api/useLetters'
import { LETTER_TYPE_LABEL } from './lettersModel'
import { LetterPreviewPane } from './components/LetterPreviewPane'
import './components/letters.css'

const LETTER_TYPES = (Object.keys(LETTER_TYPE_LABEL) as LetterType[]).map((value) => ({ value, label: LETTER_TYPE_LABEL[value] }))

/**
 * Re-render the toolbar on every editor change, so Bold / Italic / headings show
 * their real state (TipTap's isActive() otherwise reads the first render only).
 */
function useEditorTick(editor: ReturnType<typeof useEditor>) {
  const [, forceRender] = React.useReducer((x: number) => x + 1, 0)
  useEffect(() => {
    if (!editor) return
    editor.on('selectionUpdate', forceRender)
    editor.on('transaction', forceRender)
    return () => {
      editor.off('selectionUpdate', forceRender)
      editor.off('transaction', forceRender)
    }
  }, [editor])
}

function Tool({ onClick, active, label, children }: { onClick: () => void; active?: boolean; label: string; children: React.ReactNode }) {
  return (
    <button type="button" className="lt-tool" aria-pressed={!!active} aria-label={label} title={label}
      onMouseDown={(e) => e.preventDefault()} onClick={onClick}>{children}</button>
  )
}

function Toolbar({ editor }: { editor: ReturnType<typeof useEditor> }) {
  useEditorTick(editor) // before any early return (rules of hooks)
  if (!editor) return null
  const c = () => editor.chain().focus()
  return (
    <div className="lt-toolbar" role="toolbar" aria-label="Formatting">
      <Tool label="Bold" active={editor.isActive('bold')} onClick={() => c().toggleBold().run()}><b>B</b></Tool>
      <Tool label="Italic" active={editor.isActive('italic')} onClick={() => c().toggleItalic().run()}><i>I</i></Tool>
      <span className="lt-toolbar__sep" aria-hidden="true" />
      <Tool label="Heading 1" active={editor.isActive('heading', { level: 1 })} onClick={() => c().toggleHeading({ level: 1 }).run()}>H1</Tool>
      <Tool label="Heading 2" active={editor.isActive('heading', { level: 2 })} onClick={() => c().toggleHeading({ level: 2 }).run()}>H2</Tool>
      <Tool label="Heading 3" active={editor.isActive('heading', { level: 3 })} onClick={() => c().toggleHeading({ level: 3 }).run()}>H3</Tool>
      <span className="lt-toolbar__sep" aria-hidden="true" />
      <Tool label="Bulleted list" active={editor.isActive('bulletList')} onClick={() => c().toggleBulletList().run()}>•</Tool>
      <Tool label="Numbered list" active={editor.isActive('orderedList')} onClick={() => c().toggleOrderedList().run()}>1.</Tool>
      <Tool label="Horizontal rule" onClick={() => c().setHorizontalRule().run()}>—</Tool>
    </div>
  )
}

/** The merge fields to insert, grouped as the catalogue groups them; a click puts {{key}} at the cursor. */
function InsertFields({ onInsert }: { onInsert: (key: string) => void }) {
  const q = useMergeFieldsCatalogue()
  const groups = useMemo(() => {
    const m = new Map<string, MergeFieldEntry[]>()
    for (const f of q.data ?? []) { const k = f.category || 'General'; m.set(k, [...(m.get(k) ?? []), f]) }
    return [...m.entries()]
  }, [q.data])
  return (
    <Section title="Insert field" sub="Click one to put it where the cursor is. Each letter fills it with the person’s details." cardClass={false}
      loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} empty={!q.isLoading && !groups.length ? { title: 'No merge fields' } : undefined}>
      <div className="lt-fields">
        {groups.map(([cat, fields]) => (
          <div key={cat} className="lt-fields__group">
            <p className="lt-fields__cat">{cat}</p>
            {fields.map((f) => (
              <button type="button" key={f.key} className="lt-fields__row" onMouseDown={(e) => e.preventDefault()} onClick={() => onInsert(f.key)}
                aria-label={`Insert ${f.label}`}>
                <code className="lt-fields__key">{`{{${f.key}}}`}</code>
                <span className="lt-fields__label">{f.label}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </Section>
  )
}

export const LetterTemplateEditor: React.FC = () => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const toast = useToast()
  const isNew = id === 'new'
  const canSave = usePermission(isNew ? P.HRMS_LETTERS_TEMPLATE_CREATE : P.HRMS_LETTERS_TEMPLATE_UPDATE)

  const { data: existing, isLoading, error, refetch } = useLetterTemplate(isNew ? '' : (id ?? ''))
  const { data: companies = [] } = useCompanies()
  const createMut = useCreateTemplate()
  const updateMut = useUpdateTemplate(isNew ? '' : (id ?? ''))
  const saving = createMut.isPending || updateMut.isPending

  const [name, setName] = useState('')
  const [type, setType] = useState<LetterType>('OFFER')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [tried, setTried] = useState(false)
  const previewRef = useRef<HTMLDivElement>(null)

  const editor = useEditor({
    extensions: [
      // StarterKit ships its own Link; turn it off so the configured one below isn't a duplicate.
      StarterKit.configure({ link: false }),
      Link.configure({ openOnClick: false }),
      Placeholder.configure({ placeholder: 'Start writing the letter body…' }),
    ],
    content: '',
    editorProps: { attributes: { class: 'lt-editor__body', 'aria-label': 'Letter body', role: 'textbox', 'aria-multiline': 'true' } },
    onUpdate: ({ editor: e }) => setBody(e.isEmpty ? '' : e.getHTML()),
  })

  useEffect(() => {
    if (!existing || isNew) return
    setName(existing.name)
    setType(existing.type)
    setSubject(existing.subject ?? '')
    setBody(existing.bodyHtml ?? '')
    editor?.commands.setContent(existing.bodyHtml ?? '')
  }, [existing, isNew, editor])

  const companyId = existing?.companyId ?? companies[0]?.id
  const nameError = tried && !name.trim() ? 'Template name is required' : undefined

  const handleSave = async () => {
    setTried(true)
    if (!name.trim()) { toast.error('Template name is required'); return }
    const bodyHtml = editor?.getHTML() ?? ''
    try {
      if (isNew) {
        if (!companyId) { toast.error('Create a company first (Organization → Companies)'); return }
        await createMut.mutateAsync({ companyId, name: name.trim(), type, subject: subject.trim(), bodyHtml, active: true })
        toast.success('Template created')
      } else {
        await updateMut.mutateAsync({ name: name.trim(), type, subject: subject.trim(), bodyHtml })
        toast.success('Template saved')
      }
      navigate('/hrms/letters/templates', { replace: true })
    } catch (e) {
      toast.error('Failed to save template', { detail: (e as Error)?.message })
    }
  }

  const showPreview = () => {
    previewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    previewRef.current?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true })
  }

  const back = <Button variant="secondary" icon="chevronLeft" onClick={() => navigate('/hrms/letters/templates')}>Templates</Button>
  if (!isNew && (isLoading || error)) {
    return (
      <PageFrame label="Letter template">
        <PageHeader eyebrow="Letters · Template" title="Letter template" actions={back} />
        {isLoading ? <SkeletonBlock style={{ height: 320 }} /> : <ErrorState title="Couldn’t load the template" error={error} onRetry={() => refetch()} />}
      </PageFrame>
    )
  }
  if (!isNew && !existing) {
    return (
      <PageFrame label="Letter template">
        <PageHeader eyebrow="Letters · Template" title="Letter template" actions={back} />
        <EmptyState icon="fileText" title="Template not found" hint="It may have been deleted." />
      </PageFrame>
    )
  }

  return (
    <PageFrame label="Letter template" className="lt-page">
      <PageHeader eyebrow="Letters · Template" title={isNew ? 'New letter template' : name || 'Edit template'}
        sub="Write the letter once; merge fields fill in each person’s details when a letter is generated."
        actions={<>
          {back}
          <Button variant="secondary" icon="eye" onClick={showPreview}>Preview as employee</Button>
          {canSave && <Button variant="primary" icon="check" loading={saving} onClick={handleSave}>Save template</Button>}
        </>} />

      <div className="lt-editor-grid">
        <div className="lt-editor-grid__main">
          <Section title="Letter template" cardClass={false}>
            <FieldGrid columns={2}>
              <Input label="Template name" required full value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Standard offer letter" error={nameError} />
              <Select label="Letter type" value={type} onChange={(e) => setType(e.target.value as LetterType)} options={LETTER_TYPES} />
              <Input label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Offer of employment – {{employee.fullName}}" />
            </FieldGrid>
            <div className="lt-editor">
              <p className="lt-editor__label">Body</p>
              <Toolbar editor={editor} />
              <EditorContent editor={editor} />
            </div>
          </Section>
          <InsertFields onInsert={(key) => editor?.chain().focus().insertContent(`{{${key}}}`).run()} />
        </div>
        <div className="lt-editor-grid__side" ref={previewRef}>
          <LetterPreviewPane id="letter-preview" title="Preview"
            sub="The letter as it will come out: your letterhead, the fields filled, on the page it prints on. It follows what you type; nothing is saved."
            request={{ companyId, subject, bodyHtml: body }}
            ready={!!body.trim() || !!subject.trim()}
            emptyHint="Start writing the body to see the letter here." />
        </div>
      </div>
    </PageFrame>
  )
}
