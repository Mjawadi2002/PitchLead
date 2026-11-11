import { motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { ArrowSquareOut, Copy, Globe, LinkedinLogo, PaperPlaneTilt, Star, Trash, X } from '@phosphor-icons/react'
import { STAGES, type Lead, type Stage } from '@shared/types'
import { spring, useApp } from '../state'
import { hostOf, initials } from './ui'

const C = 2 * Math.PI * 22

export function LeadDrawer({ lead }: { lead: Lead }) {
  const { openLead, go, setOutreachLeadId, toast, removeLeads, data } = useApp()
  const [notes, setNotes] = useState(lead.notes)
  const saveTimer = useRef<number>()
  const [ring, setRing] = useState(C)
  const [editing, setEditing] = useState(false)
  useEffect(() => setEditing(false), [lead.id])

  useEffect(() => setNotes(lead.notes), [lead.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setRing(C)
    const t = requestAnimationFrame(() => requestAnimationFrame(() => setRing(C * (1 - lead.score / 10))))
    return () => cancelAnimationFrame(t)
  }, [lead.id, lead.score])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !(e.target as HTMLElement).closest('input,textarea')) openLead(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openLead])

  const update = (patch: Partial<Lead>) => window.lp.leads.update(lead.id, patch)
  const onNotes = (v: string) => {
    setNotes(v)
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => update({ notes: v }), 400)
  }
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast('Copied')
    } catch {
      toast('Could not copy')
    }
  }
  const run = data.runs.find((r) => r.id === lead.runId)
  const verdict = lead.score >= 8 ? 'High priority. Contact this week.' : lead.score >= 5 ? 'Medium priority. Contact after the top leads.' : 'Low priority.'

  return (
    <motion.aside
      className="drawer"
      aria-label={`${lead.name} details`}
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%', transition: { type: 'spring', bounce: 0, duration: 0.3 } }}
      transition={spring}
    >
      <div className="d-head">
        <span className="co-badge">{initials(lead.name)}</span>
        <div style={{ minWidth: 0 }}>
          {editing ? (
            <textarea
              className="input d-title-input"
              autoFocus
              rows={2}
              defaultValue={lead.name}
              aria-label="Company name"
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLTextAreaElement).blur() }
                if (e.key === 'Escape') { e.stopPropagation(); setEditing(false) }
              }}
              onBlur={(e) => {
                const v = e.target.value.trim()
                if (v && v !== lead.name) update({ name: v })
                setEditing(false)
              }}
            />
          ) : (
            <h2 className="d-title selectable" title="Double-click to rename" onDoubleClick={() => setEditing(true)}>{lead.name}</h2>
          )}
          <div className="d-links">
            {lead.website && <button className="link" onClick={() => window.lp.shell.open(lead.website)}><Globe size={13} />{hostOf(lead.website)}</button>}
            {lead.linkedin && <button className="link" onClick={() => window.lp.shell.open(lead.linkedin)}><LinkedinLogo size={13} />LinkedIn</button>}
          </div>
        </div>
        <div className="acts">
          <button className="icon-btn star" aria-pressed={lead.starred} aria-label={lead.starred ? 'Unstar' : 'Star'} onClick={() => update({ starred: !lead.starred })}>
            <Star size={17} weight={lead.starred ? 'fill' : 'regular'} />
          </button>
          <button className="icon-btn" aria-label="Delete lead" onClick={() => removeLeads([lead])}><Trash size={17} /></button>
          <button className="icon-btn" aria-label="Close" onClick={() => openLead(null)}><X size={17} /></button>
        </div>
      </div>

      <div className="d-body">
        <div className="d-score">
          <svg className="ring" viewBox="0 0 54 54" aria-hidden>
            <circle className="bg" cx="27" cy="27" r="22" />
            <circle className="fg" cx="27" cy="27" r="22" strokeDasharray={C} strokeDashoffset={ring} style={{ transition: 'stroke-dashoffset .9s cubic-bezier(.32,.72,0,1)' }} />
            <text x="27" y="27">{lead.score}</text>
          </svg>
          <div>
            <b>Fit {lead.score} of 10</b>
            <span>{lead.scoreReason || verdict}</span>
          </div>
        </div>

        <div className="meta-grid">
          <div><span>Industry</span><b>{lead.industry || 'Unknown'}</b></div>
          <div><span>Size</span><b>{lead.size || 'Unknown'}</b></div>
          <div><span>Location</span><b>{lead.location || 'Unknown'}</b></div>
          <div><span>Decision maker</span><b>{lead.decisionMaker || 'Unknown'}</b></div>
        </div>

        {lead.signal && <div className="d-sec"><h3>Signal</h3><p>{lead.signal}</p></div>}
        {lead.why.length > 0 && <div className="d-sec"><h3>Why they fit</h3><ul>{lead.why.map((w, i) => <li key={i}>{w}</li>)}</ul></div>}
        {lead.valueProp && <div className="d-sec"><h3>Value for them</h3><p>{lead.valueProp}</p></div>}
        {lead.strategy && <div className="d-sec"><h3>How to approach</h3><p>{lead.strategy}</p></div>}
        {lead.starters.length > 0 && (
          <div className="d-sec">
            <h3>Conversation starters</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {lead.starters.map((s, i) => (
                <div className="starter" key={i}>
                  <span>{s}</span>
                  <button className="icon-btn sm" aria-label="Copy starter" onClick={() => copy(s)}><Copy size={14} /></button>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="d-sec">
          <h3>Notes</h3>
          <textarea className="input" placeholder="Calls, replies, anything to remember" value={notes} onChange={(e) => onNotes(e.target.value)} />
        </div>
        {run && (
          <button className="link" style={{ alignSelf: 'flex-start' }} onClick={() => go('research')}>
            <ArrowSquareOut size={13} />
            Found in research: {run.title}
          </button>
        )}
      </div>

      <div className="d-foot">
        <select className="input" aria-label="Stage" value={lead.stage} onChange={(e) => {
          update({ stage: e.target.value as Stage })
          toast(`Moved to ${STAGES.find((s) => s.id === e.target.value)?.label}`)
        }}>
          {STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <button className="btn btn-primary" onClick={() => { setOutreachLeadId(lead.id); go('outreach') }}>
          <PaperPlaneTilt size={14} />
          Write message
        </button>
      </div>
    </motion.aside>
  )
}
