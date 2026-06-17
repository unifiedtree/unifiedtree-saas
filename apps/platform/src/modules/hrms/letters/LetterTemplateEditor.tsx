import React, { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Bold, Italic, List, ListOrdered, Minus, ChevronDown, Loader2, Eye } from 'lucide-react'
import { clsx } from 'clsx'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import { useToast } from '@/shared/hooks/useToast'
import { useCompanies } from '@/modules/hrms/api/useOrg'
import { useEmployeeDirectory } from '@/modules/hrms/api/useWorkforce'
import { CardSkeleton, EmptyState } from '@unifiedtree/ui-kit'
import {
  useLetterTemplate,
  useCreateTemplate,
  useUpdateTemplate,
  useMergeFieldsCatalogue,
  usePreviewTemplate,
} from './api/useLetters'
import type { LetterType } from './api/useLetters'

const LETTER_TYPES: { value: LetterType; label: string }[] = [
  { value: 'OFFER',           label: 'Offer Letter' },
  { value: 'APPOINTMENT',     label: 'Appointment Letter' },
  { value: 'RELIEVING',       label: 'Relieving Letter' },
  { value: 'EXPERIENCE',      label: 'Experience Letter' },
  { value: 'SALARY_REVISION', label: 'Salary Revision Letter' },
  { value: 'CUSTOM',          label: 'Custom' },
]

function ToolbarButton({
  onClick,
  active,
  children,
  title,
}: {
  onClick: () => void
  active?: boolean
  children: React.ReactNode
  title: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={clsx(
        'flex items-center justify-center w-7 h-7 rounded-lg text-xs font-medium transition-colors',
        active
          ? 'bg-indigo-500/20 text-[#0F6E56]'
          : 'text-[#64748B] hover:bg-[#F1F5F9]/60 hover:text-[#0F172A]',
      )}
    >
      {children}
    </button>
  )
}

function MergeFieldDropdown({ onInsert }: { onInsert: (key: string) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const { data: fields = [] } = useMergeFieldsCatalogue()

  const grouped = fields.reduce<Record<string, typeof fields>>((acc, f) => {
    const cat = f.category ?? 'General'
    if (!acc[cat]) acc[cat] = []
    acc[cat].push(f)
    return acc
  }, {})

  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium text-[#64748B] hover:bg-[#F1F5F9]/60 hover:text-[#0F172A] border border-[#E2E8F0]/60 transition-colors"
      >
        Insert field
        <ChevronDown size={11} className={clsx('transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 w-64 bg-white border border-[#E2E8F0]/60 rounded-xl shadow-2xl overflow-hidden">
          <div className="max-h-72 overflow-y-auto p-1">
            {Object.entries(grouped).map(([category, entries]) => (
              <div key={category}>
                <p className="px-2 py-1.5 text-xs font-semibold text-[#64748B] uppercase tracking-wider">
                  {category}
                </p>
                {entries.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => {
                      onInsert(f.key)
                      setOpen(false)
                    }}
                    className="w-full flex items-start gap-2 px-2 py-1.5 rounded-lg text-left hover:bg-white transition-colors group"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-[#334155] group-hover:text-[#0F172A] truncate">
                        {f.label}
                      </p>
                      <p className="text-xs text-slate-600 font-mono truncate">{`{{${f.key}}}`}</p>
                    </div>
                  </button>
                ))}
              </div>
            ))}
            {fields.length === 0 && (
              <p className="px-3 py-4 text-xs text-[#64748B] text-center">No merge fields available</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function EditorToolbar({
  editor,
}: {
  editor: ReturnType<typeof useEditor>
}) {
  if (!editor) return null

  const insertMergeField = (key: string) => {
    editor.chain().focus().insertContent(`{{${key}}}`).run()
  }

  return (
    <div className="flex items-center gap-1 flex-wrap px-3 py-2 border-b border-[#E2E8F0]/60 bg-white">
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBold().run()}
        active={editor.isActive('bold')}
        title="Bold"
      >
        <Bold size={13} />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleItalic().run()}
        active={editor.isActive('italic')}
        title="Italic"
      >
        <Italic size={13} />
      </ToolbarButton>

      <div className="w-px h-4 bg-[#F1F5F9]/60 mx-0.5" />

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        active={editor.isActive('heading', { level: 1 })}
        title="Heading 1"
      >
        H1
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        active={editor.isActive('heading', { level: 2 })}
        title="Heading 2"
      >
        H2
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        active={editor.isActive('heading', { level: 3 })}
        title="Heading 3"
      >
        H3
      </ToolbarButton>

      <div className="w-px h-4 bg-[#F1F5F9]/60 mx-0.5" />

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        active={editor.isActive('bulletList')}
        title="Bulleted list"
      >
        <List size={13} />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        active={editor.isActive('orderedList')}
        title="Ordered list"
      >
        <ListOrdered size={13} />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
        active={false}
        title="Horizontal rule"
      >
        <Minus size={13} />
      </ToolbarButton>

      <div className="w-px h-4 bg-[#F1F5F9]/60 mx-0.5" />

      <MergeFieldDropdown onInsert={insertMergeField} />
    </div>
  )
}

function PreviewPane({ templateId }: { templateId: string | undefined }) {
  const { toast } = useToast()
  const previewMut = usePreviewTemplate()
  const [employeeId, setEmployeeId] = useState('')
  const [previewHtml, setPreviewHtml] = useState<string | null>(null)
  const { data: empPage } = useEmployeeDirectory({ pageSize: 200 })
  const employees = empPage?.content ?? []

  const handlePreview = async () => {
    if (!templateId || !employeeId.trim()) {
      toast('Select an employee to preview', 'error')
      return
    }
    try {
      const html = await previewMut.mutateAsync({
        templateId,
        employeeId: employeeId.trim(),
        overrides: undefined,
      })
      setPreviewHtml(html)
    } catch {
      toast('Failed to generate preview', 'error')
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-white border border-[#E2E8F0] rounded-2xl p-4 space-y-3">
        <h3 className="text-xs font-semibold text-[#64748B] uppercase tracking-wider">
          Preview as employee
        </h3>
        <div className="flex gap-2">
          <select
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
            className="flex-1 bg-white border border-[#E2E8F0]/60 rounded-xl px-3 py-2 text-sm text-[#0F172A] focus:outline-none focus:border-indigo-500 transition-colors"
          >
            <option value="">{employees.length === 0 ? 'No employees yet' : 'Select an employee…'}</option>
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {[emp.firstName, emp.lastName].filter(Boolean).join(' ')}{emp.employeeCode ? ` (${emp.employeeCode})` : ''}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={handlePreview}
            disabled={previewMut.isPending || !templateId}
            className="flex items-center gap-1.5 px-3 py-2 bg-[#F1F5F9] hover:bg-slate-600 disabled:opacity-50 text-[#0F172A] text-sm font-medium rounded-xl transition-colors"
          >
            {previewMut.isPending ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Eye size={13} />
            )}
            Preview
          </button>
        </div>
        {!templateId && (
          <p className="text-xs text-slate-600">Save the template first to enable preview</p>
        )}
      </div>

      {previewMut.isPending ? (
        <CardSkeleton />
      ) : previewHtml ? (
        <div className="bg-white border border-[#E2E8F0] rounded-2xl overflow-hidden">
          <div className="px-4 py-2.5 border-b border-[#E2E8F0]">
            <p className="text-xs font-semibold text-[#64748B] uppercase tracking-wider">Rendered output</p>
          </div>
          <iframe
            srcDoc={previewHtml}
            className="w-full h-96 border-0 bg-white"
            title="Letter preview"
            sandbox="allow-same-origin"
          />
        </div>
      ) : null}
    </div>
  )
}

export const LetterTemplateEditor: React.FC = () => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { toast } = useToast()

  const isNew = id === 'new'

  const { data: existing, isLoading, error } = useLetterTemplate(isNew ? '' : (id ?? ''))
  const { data: companies = [] } = useCompanies()
  const createMut = useCreateTemplate()
  const updateMut = useUpdateTemplate(isNew ? '' : (id ?? ''))

  const [name, setName] = useState('')
  const [type, setType] = useState<LetterType>('OFFER')
  const [subject, setSubject] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedId, setSavedId] = useState<string | undefined>(isNew ? undefined : id)

  const editor = useEditor({
    extensions: [
      // StarterKit ships its own Link; disable it so our configured Link below
      // isn't a duplicate (TipTap warns on duplicate extension names).
      StarterKit.configure({ link: false }),
      Link.configure({ openOnClick: false }),
      Placeholder.configure({ placeholder: 'Start writing the letter body…' }),
    ],
    content: '',
    editorProps: {
      attributes: {
        class: 'prose prose-invert prose-sm max-w-none min-h-[320px] px-4 py-3 focus:outline-none text-slate-200',
      },
    },
  })

  useEffect(() => {
    if (!existing || isNew) return
    setName(existing.name)
    setType(existing.type)
    setSubject(existing.subject ?? '')
    editor?.commands.setContent(existing.bodyHtml ?? '')
  }, [existing, isNew, editor])

  const handleSave = async () => {
    if (!name.trim()) {
      toast('Template name is required', 'error')
      return
    }
    setSaving(true)
    const bodyHtml = editor?.getHTML() ?? ''
    try {
      if (isNew) {
        const companyId = companies[0]?.id
        if (!companyId) {
          toast('Create a company first (Organization → Companies)', 'error')
          setSaving(false)
          return
        }
        const created = await createMut.mutateAsync({ companyId, name: name.trim(), type, subject: subject.trim(), bodyHtml, active: true })
        toast('Template created', 'success')
        setSavedId(created.id)
        navigate('/hrms/letters/templates', { replace: true })
      } else {
        await updateMut.mutateAsync({ name: name.trim(), type, subject: subject.trim(), bodyHtml })
        toast('Template saved', 'success')
        navigate('/hrms/letters/templates', { replace: true })
      }
    } catch {
      toast('Failed to save template', 'error')
    } finally {
      setSaving(false)
    }
  }

  if (!isNew && isLoading) {
    return (
      <div className="p-6 space-y-4">
        <CardSkeleton />
      </div>
    )
  }

  if (!isNew && error) {
    return (
      <div className="p-6">
        <EmptyState
          variant="error"
          title="Failed to load template"
          description={(error as Error).message}
          primaryAction={{ label: 'Back', onClick: () => navigate('/hrms/letters/templates') }}
        />
      </div>
    )
  }

  return (
    <div className="p-6 animate-fade-in space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <button
          onClick={() => navigate('/hrms/letters/templates')}
          className="flex items-center gap-1.5 text-sm text-[#64748B] hover:text-[#0F172A] transition-colors"
        >
          <ArrowLeft size={16} />
          Templates
        </button>
        <h1 className="text-lg font-bold text-[#0F172A]">
          {isNew ? 'New template' : 'Edit template'}
        </h1>
        <div className="flex-1" />
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-[#0F172A] text-sm font-medium rounded-xl transition-colors"
        >
          {saving && <Loader2 size={13} className="animate-spin" />}
          {saving ? 'Saving…' : 'Save template'}
        </button>
      </div>

      <div className="flex flex-col md:flex-row gap-6 items-start">
        <div className="flex-1 min-w-0 space-y-4">
          <div className="bg-white border border-[#E2E8F0] rounded-2xl p-4 space-y-4">
            <div>
              <label className="block text-xs font-medium text-[#64748B] mb-1.5">
                Template name *
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Standard Offer Letter"
                className="w-full bg-white border border-[#E2E8F0]/60 rounded-xl px-3 py-2 text-sm text-[#0F172A] placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-[#64748B] mb-1.5">
                  Letter type
                </label>
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value as LetterType)}
                  className="w-full bg-white border border-[#E2E8F0]/60 rounded-xl px-3 py-2 text-sm text-[#0F172A] focus:outline-none focus:border-indigo-500 transition-colors"
                >
                  {LETTER_TYPES.map((lt) => (
                    <option key={lt.value} value={lt.value}>{lt.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-[#64748B] mb-1.5">
                  Subject
                </label>
                <input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="e.g. Offer of Employment – {{employee.fullName}}"
                  className="w-full bg-white border border-[#E2E8F0]/60 rounded-xl px-3 py-2 text-sm text-[#0F172A] placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors"
                />
              </div>
            </div>
          </div>

          <div className="bg-white border border-[#E2E8F0] rounded-2xl overflow-hidden">
            <div className="px-4 py-2.5 border-b border-[#E2E8F0]">
              <p className="text-xs font-semibold text-[#64748B] uppercase tracking-wider">Body</p>
            </div>
            <EditorToolbar editor={editor} />
            <EditorContent editor={editor} />
          </div>
        </div>

        <div className="w-full md:w-80 flex-shrink-0 space-y-4">
          <PreviewPane templateId={savedId} />
        </div>
      </div>
    </div>
  )
}
