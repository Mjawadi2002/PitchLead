import { motion } from 'motion/react'
import { useState } from 'react'
import { FolderOpen, Trash, X } from '@phosphor-icons/react'
import { PROJECT_COLORS, type Project } from '@shared/types'
import { spring, useApp } from '../state'
import { Seg } from './ui'

type Draft = Omit<Project, 'id' | 'createdAt' | 'color'>

const EMPTY: Draft = { name: '', offerType: 'product', product: '', folder: '', industry: '', location: '', size: '', pains: '', tech: '' }

/** Create or edit a project: the business, what it sells, and who buys it. */
export function ProjectModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { allData, toast } = useApp()
  const existing = id === 'new' ? null : allData.projects.find((p) => p.id === id) ?? null
  const [f, setF] = useState<Draft>(() => (existing ? { ...EMPTY, ...existing } : { ...EMPTY }))
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [saving, setSaving] = useState(false)
  const set = (patch: Partial<Draft>) => setF((x) => ({ ...x, ...patch }))
  const leadCount = existing ? allData.leads.filter((l) => l.projectId === existing.id).length : 0
  const ready = f.name.trim().length > 1 && (f.product.trim().length > 8 || !!f.folder)

  const save = async () => {
    if (!ready) return
    setSaving(true)
    const clean = { ...f, name: f.name.trim(), product: f.product.trim() }
    if (existing) {
      await window.lp.projects.update(existing.id, clean)
      toast(`${clean.name} saved`)
    } else {
      await window.lp.projects.create(clean)
      toast(`${clean.name} created. Start your first research when you are ready.`)
    }
    setSaving(false)
    onClose()
  }
  const remove = async () => {
    if (!existing) return
    await window.lp.projects.remove(existing.id)
    toast(`${existing.name} deleted`)
    onClose()
  }

  return (
    <motion.div className="scrim" style={{ alignItems: 'center', paddingTop: 0 }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={onClose}>
      <motion.form
        className="modal project-modal"
        role="dialog"
        aria-label={existing ? 'Edit project' : 'New project'}
        initial={{ opacity: 0, scale: 0.97, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.98 }}
        transition={spring}
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); save() }}
      >
        <div className="pm-head">
          <span className="pm-swatch" style={{ background: PROJECT_COLORS[existing?.color ?? allData.projects.length % PROJECT_COLORS.length] }} />
          <div style={{ flex: 1 }}>
            <h2>{existing ? 'Edit project' : 'New project'}</h2>
            <p>{existing ? 'Changes apply to the next research run.' : 'One project per thing you sell. Each has its own leads, pipeline and outreach.'}</p>
          </div>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}><X size={15} /></button>
        </div>

        <div className="pm-body">
          <div className="field">
            <label htmlFor="pm-name">Project name</label>
            <input id="pm-name" className="input" autoFocus value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="Tawelti for cafés" />
          </div>
          <div className="field">
            <span className="label">What you sell</span>
            <Seg label="Offer type" value={f.offerType} onChange={(v) => set({ offerType: v })} options={[{ value: 'product', label: 'A product' }, { value: 'service', label: 'A service' }]} style={{ maxWidth: 260 }} />
          </div>
          <div className="field">
            <label htmlFor="pm-product">{f.offerType === 'service' ? 'Describe the service' : 'Describe the product'}</label>
            <textarea id="pm-product" className="input" rows={4} value={f.product} onChange={(e) => set({ product: e.target.value })}
              placeholder={f.offerType === 'service' ? 'What you do, for whom, and the result they get. Two or three sentences.' : 'What it is, who it is for, and the problem it solves. Two or three sentences.'} />
          </div>
          <div className="field">
            <span className="label">Product folder <span className="muted">(optional)</span></span>
            {f.folder ? (
              <div className="folder" title={f.folder}><FolderOpen size={15} /><span>{f.folder}</span><button type="button" className="icon-btn sm" aria-label="Remove folder" onClick={() => set({ folder: '' })}><X size={13} /></button></div>
            ) : (
              <button type="button" className="btn btn-ghost" style={{ alignSelf: 'flex-start' }} onClick={async () => { const p = await window.lp.dialog.folder(); if (p) set({ folder: p }) }}><FolderOpen size={14} />Choose folder</button>
            )}
          </div>

          <div className="pm-section">Who buys it</div>
          <div className="two">
            <div className="field"><label htmlFor="pm-ind">Industry</label><input id="pm-ind" className="input" value={f.industry} onChange={(e) => set({ industry: e.target.value })} placeholder="Cafés and restaurants" /></div>
            <div className="field"><label htmlFor="pm-loc">Location</label><input id="pm-loc" className="input" value={f.location} onChange={(e) => set({ location: e.target.value })} placeholder="Tunis, Tunisia" /></div>
          </div>
          <div className="two">
            <div className="field"><label htmlFor="pm-size">Company size</label><input id="pm-size" className="input" value={f.size} onChange={(e) => set({ size: e.target.value })} placeholder="20 to 150 seats" /></div>
            <div className="field"><label htmlFor="pm-tech">Tools they use</label><input id="pm-tech" className="input" value={f.tech} onChange={(e) => set({ tech: e.target.value })} placeholder="A POS system" /></div>
          </div>
          <div className="field"><label htmlFor="pm-pain">Problem you solve for them</label><input id="pm-pain" className="input" value={f.pains} onChange={(e) => set({ pains: e.target.value })} placeholder="Slow service at peak hours" /></div>
        </div>

        <div className="modal-foot">
          {existing && !confirmDelete && <button type="button" className="btn btn-danger" onClick={() => setConfirmDelete(true)}><Trash size={14} />Delete</button>}
          {existing && confirmDelete && (
            <div className="pm-confirm">
              <span>Delete {existing.name} and its {leadCount} {leadCount === 1 ? 'lead' : 'leads'}? This cannot be undone.</span>
              <button type="button" className="btn btn-plain" onClick={() => setConfirmDelete(false)}>Keep</button>
              <button type="button" className="btn btn-danger" onClick={remove}>Delete project</button>
            </div>
          )}
          <span style={{ flex: 1 }} />
          {!confirmDelete && <button type="button" className="btn btn-plain" onClick={onClose}>Cancel</button>}
          {!confirmDelete && <button type="submit" className="btn btn-primary" disabled={!ready || saving}>{existing ? 'Save' : 'Create project'}</button>}
        </div>
      </motion.form>
    </motion.div>
  )
}
