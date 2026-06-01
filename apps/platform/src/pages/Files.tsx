import React, { useState } from 'react'
import { Folder, File, FileText, Image, Upload, Grid, List, ChevronRight, Download, Trash2, MoreVertical } from 'lucide-react'
import { clsx } from 'clsx'
import { formatDistanceToNow } from 'date-fns'

interface FileItem {
  id: string
  name: string
  type: 'folder' | 'pdf' | 'image' | 'doc' | 'spreadsheet' | 'other'
  size?: string
  modifiedAt: string
  path: string[]
}

const ALL_FILES: FileItem[] = [
  { id: 'f1', name: 'HR Documents', type: 'folder', modifiedAt: new Date(Date.now() - 2 * 3600000).toISOString(), path: [] },
  { id: 'f2', name: 'Finance Reports', type: 'folder', modifiedAt: new Date(Date.now() - 5 * 3600000).toISOString(), path: [] },
  { id: 'f3', name: 'Marketing Assets', type: 'folder', modifiedAt: new Date(Date.now() - 86400000).toISOString(), path: [] },
  { id: 'f4', name: 'Legal Contracts', type: 'folder', modifiedAt: new Date(Date.now() - 2 * 86400000).toISOString(), path: [] },
  { id: 'f5', name: 'Q4-Financial-Report.pdf', type: 'pdf', size: '2.4 MB', modifiedAt: new Date(Date.now() - 3600000).toISOString(), path: [] },
  { id: 'f6', name: 'Employee-Handbook-2024.pdf', type: 'pdf', size: '5.1 MB', modifiedAt: new Date(Date.now() - 6 * 3600000).toISOString(), path: [] },
  { id: 'f7', name: 'Company-Logo-Full.png', type: 'image', size: '842 KB', modifiedAt: new Date(Date.now() - 3 * 86400000).toISOString(), path: [] },
  { id: 'f8', name: 'Product-Roadmap-2025.pdf', type: 'pdf', size: '1.8 MB', modifiedAt: new Date(Date.now() - 86400000).toISOString(), path: [] },
  { id: 'f9', name: 'Sales-Data-Dec.xlsx', type: 'spreadsheet', size: '320 KB', modifiedAt: new Date(Date.now() - 12 * 3600000).toISOString(), path: [] },
  { id: 'f10', name: 'Team-Photo.jpg', type: 'image', size: '3.2 MB', modifiedAt: new Date(Date.now() - 5 * 86400000).toISOString(), path: [] },
  { id: 'f11', name: 'NDA-Template.docx', type: 'doc', size: '48 KB', modifiedAt: new Date(Date.now() - 7 * 86400000).toISOString(), path: [] },
  { id: 'f12', name: 'Meeting-Notes-Dec-2024.docx', type: 'doc', size: '128 KB', modifiedAt: new Date(Date.now() - 2 * 3600000).toISOString(), path: [] },
]

const FOLDERS = ['Home', 'HR Documents', 'Finance Reports', 'Marketing Assets', 'Legal Contracts']

const typeIcon = (type: FileItem['type']) => {
  switch (type) {
    case 'folder': return <Folder size={28} className="text-[#0F6E56]" />
    case 'pdf': return <FileText size={28} className="text-red-400" />
    case 'image': return <Image size={28} className="text-emerald-400" />
    case 'doc': return <FileText size={28} className="text-blue-400" />
    case 'spreadsheet': return <FileText size={28} className="text-green-400" />
    default: return <File size={28} className="text-[#64748B]" />
  }
}

const typeBg = (type: FileItem['type']) => {
  switch (type) {
    case 'folder': return 'bg-[#0F6E56]/10'
    case 'pdf': return 'bg-red-500/10'
    case 'image': return 'bg-emerald-500/10'
    case 'doc': return 'bg-blue-500/10'
    case 'spreadsheet': return 'bg-green-500/10'
    default: return 'bg-[#F1F5F9]/40'
  }
}

export const Files: React.FC = () => {
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [activeFolder, setActiveFolder] = useState('Home')

  const storageUsed = 73
  const storageTotal = '100 GB'

  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-[#0F172A]">Files</h1>
          <p className="text-[#64748B] text-sm mt-0.5">Shared workspace documents and assets</p>
        </div>
        <div className="flex items-center gap-2">
          <button className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-[#0F172A] text-sm font-medium rounded-xl transition-colors">
            <Upload size={15} /> Upload Files
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
        {/* Folder tree */}
        <div className="xl:col-span-1">
          <div className="bg-white border border-[#E2E8F0] rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-[#E2E8F0]">
              <h3 className="text-[#0F172A] font-semibold text-sm">Folders</h3>
            </div>
            <div className="p-2">
              {FOLDERS.map((folder) => (
                <button
                  key={folder}
                  onClick={() => setActiveFolder(folder)}
                  className={clsx(
                    'w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-colors',
                    activeFolder === folder ? 'bg-indigo-600/20 text-[#0F6E56] border border-indigo-500/20' : 'text-[#64748B] hover:text-[#0F172A] hover:bg-white/5'
                  )}
                >
                  <Folder size={15} className={activeFolder === folder ? 'text-[#0F6E56]' : 'text-[#64748B]'} />
                  {folder}
                </button>
              ))}
            </div>

            {/* Storage */}
            <div className="px-4 py-3 border-t border-[#E2E8F0] mt-2">
              <p className="text-xs text-[#64748B] mb-2">Storage Used</p>
              <div className="w-full bg-white rounded-full h-1.5 mb-1">
                <div className="bg-indigo-500 h-1.5 rounded-full" style={{ width: `${storageUsed}%` }} />
              </div>
              <p className="text-xs text-[#64748B]">{storageUsed}% of {storageTotal}</p>
            </div>
          </div>
        </div>

        {/* File browser */}
        <div className="xl:col-span-4">
          <div className="bg-white border border-[#E2E8F0] rounded-2xl overflow-hidden">
            {/* Toolbar */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-[#E2E8F0]">
              <div className="flex items-center gap-2 text-sm text-[#64748B]">
                <span className="text-[#64748B]">Files</span>
                <ChevronRight size={14} className="text-slate-700" />
                <span className="text-[#0F172A]">{activeFolder}</span>
              </div>
              <div className="flex items-center gap-1 bg-white border border-[#E2E8F0]/40 rounded-lg p-0.5">
                <button onClick={() => setViewMode('grid')} className={clsx('p-1.5 rounded-md transition-colors', viewMode === 'grid' ? 'bg-[#F1F5F9] text-[#0F172A]' : 'text-[#64748B] hover:text-[#334155]')}>
                  <Grid size={14} />
                </button>
                <button onClick={() => setViewMode('list')} className={clsx('p-1.5 rounded-md transition-colors', viewMode === 'list' ? 'bg-[#F1F5F9] text-[#0F172A]' : 'text-[#64748B] hover:text-[#334155]')}>
                  <List size={14} />
                </button>
              </div>
            </div>

            {/* Files */}
            <div className="p-4">
              {viewMode === 'grid' ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                  {ALL_FILES.map((file) => (
                    <div
                      key={file.id}
                      className="group relative flex flex-col items-center gap-2 p-4 rounded-xl border border-[#E2E8F0] hover:border-[#E2E8F0]/60 bg-white/20 hover:bg-white cursor-pointer transition-all"
                    >
                      <div className={clsx('w-12 h-12 rounded-xl flex items-center justify-center', typeBg(file.type))}>
                        {typeIcon(file.type)}
                      </div>
                      <p className="text-xs text-[#334155] text-center leading-tight truncate w-full">{file.name}</p>
                      {file.size && <p className="text-[10px] text-slate-600">{file.size}</p>}
                      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 flex gap-1">
                        <button className="p-1 bg-white rounded-lg text-[#64748B] hover:text-[#0F172A]"><Download size={11} /></button>
                        <button className="p-1 bg-white rounded-lg text-[#64748B] hover:text-red-400"><Trash2 size={11} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#E2E8F0]">
                      {['Name', 'Type', 'Size', 'Modified', ''].map((h) => (
                        <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-[#64748B] uppercase tracking-wider">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {ALL_FILES.map((file) => (
                      <tr key={file.id} className="border-b border-[#E2E8F0]/40 last:border-0 hover:bg-[#F8FAFC] transition-colors cursor-pointer group">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className={clsx('w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0', typeBg(file.type))}>
                              {React.cloneElement(typeIcon(file.type) as React.ReactElement<{ size?: number }>, { size: 15 })}
                            </div>
                            <span className="text-[#334155] text-sm">{file.name}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-[#64748B] text-xs capitalize">{file.type}</td>
                        <td className="px-4 py-3 text-[#64748B] text-xs">{file.size ?? '—'}</td>
                        <td className="px-4 py-3 text-[#64748B] text-xs">
                          {formatDistanceToNow(new Date(file.modifiedAt), { addSuffix: true })}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-1 opacity-0 group-hover:opacity-100">
                            <button className="p-1.5 text-[#64748B] hover:text-[#0F172A] rounded-lg hover:bg-white/5"><Download size={13} /></button>
                            <button className="p-1.5 text-[#64748B] hover:text-red-400 rounded-lg hover:bg-red-500/10"><Trash2 size={13} /></button>
                            <button className="p-1.5 text-[#64748B] hover:text-[#0F172A] rounded-lg hover:bg-white/5"><MoreVertical size={13} /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
