import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useState } from 'react'
import { CaretDown, CaretUp, Export, MagnifyingGlass, Plus, Star, Trash, UsersThree, X } from '@phosphor-icons/react'
import { STAGES, type Lead, type Stage } from '@shared/types'
import { spring, useApp, type LeadFilter } from '../state'
import { Checkbox, Empty, PAGE_SIZES, Pager, Score, StagePill, initials } from '../components/ui'

type SortKey = 'score' | 'name' | 'createdAt' | 'stage'

const FILTERS: { id: LeadFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'high', label: 'Fit 8 to 10' },
  { id: 'mid', label: 'Fit 5 to 7' },
  { id: 'new', label: 'Not contacted' },
  { id: 'starred', label: 'Starred' }
]

export function Leads() {
  const { data, filter, setFilter, leadId, openLead, go, toast, removeLeads } = useApp()
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'score', dir: -1 })
  const [checked, setChecked] = useState<Set<string>>(new Set())

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase()
    const order = (st: Stage) => STAGES.findIndex((x) => x.id === st)
    return data.leads
      .filter((l) =>
        filter === 'all' ? true
          : filter === 'high' ? l.score >= 8
          : filter === 'mid' ? l.score >= 5 && l.score < 8
          : filter === 'starred' ? l.starred
          : l.stage === 'researched' || l.stage === 'qualified'
      )
      .filter((l) => !s || `${l.name} ${l.location} ${l.industry} ${l.decisionMaker} ${l.signal} ${l.notes}`.toLowerCase().includes(s))
      .sort((a, b) => {
        const k = sort.key
        const v = k === 'name' ? a.name.localeCompare(b.name) : k === 'stage' ? order(a.stage) - order(b.stage) : (a[k] as number) - (b[k] as number)
        return v * sort.dir || b.score - a.score
      })
  }, [data.leads, filter, q, sort])

  useEffect(() => setChecked(new Set()), [filter])

  // Pagination: page size is remembered on this computer; the page resets when the list changes shape.
  const [size, setSizeState] = useState<number>(() => {
    try { const v = Number(localStorage.getItem('lp.pageSize')); return PAGE_SIZES.includes(v) ? v : 25 } catch { return 25 }
  })
  const setSize = (s: number) => {
    setSizeState(s)
    setPage(0)
    try { localStorage.setItem('lp.pageSize', String(s)) } catch { /* ignore */ }
  }
  const [page, setPage] = useState(0)
  const pages = Math.max(1, Math.ceil(rows.length / size))
  useEffect(() => setPage(0), [filter, q, sort])
  useEffect(() => { if (page > pages - 1) setPage(pages - 1) }, [page, pages])
  // Keep the open lead's page in view (J/K can move across pages).
  useEffect(() => {
    const idx = rows.findIndex((r) => r.id === leadId)
    if (idx >= 0) setPage(Math.floor(idx / size))
  }, [leadId]) // eslint-disable-line react-hooks/exhaustive-deps
  const pageRows = rows.slice(page * size, (page + 1) * size)
  const goPage = (p: number) => {
    setPage(p)
    document.getElementById('content')?.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // Keyboard: J/K or arrows move, Enter opens, X checks, S stars
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input,textarea,select') || e.ctrlKey || e.metaKey) return
      const idx = rows.findIndex((r) => r.id === leadId)
      if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); const n = rows[Math.min(rows.length - 1, idx + 1)]; if (n) openLead(n.id) }
      else if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); const n = rows[Math.max(0, idx - 1)]; if (n) openLead(n.id) }
      else if (e.key === 'x' && leadId) { toggle(leadId) }
      else if (e.key === 's' && leadId) { const l = rows[idx]; if (l) window.lp.leads.update(l.id, { starred: !l.starred }) }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && leadId) { const l = rows[idx]; if (l) removeLeads([l]) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const compact = !!leadId
  const toggle = (id: string) => setChecked((c) => { const n = new Set(c); n.has(id) ? n.delete(id) : n.add(id); return n })
  const allChecked = pageRows.length > 0 && pageRows.every((r) => checked.has(r.id))
  const selected = data.leads.filter((l) => checked.has(l.id))
  const head = (key: SortKey, label: string) => (
    <button onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : key === 'name' || key === 'stage' ? 1 : -1 }))}>
      {label}{sort.key === key && (sort.dir === 1 ? <CaretUp size={10} weight="bold" /> : <CaretDown size={10} weight="bold" />)}
    </button>
  )
  const exportCsv = async (ids: string[]) => {
    const p = await window.lp.leads.exportCsv(ids)
    if (p) toast(`Exported ${ids.length} leads`)
  }
  const addLead = async () => {
    const id = await window.lp.leads.add({ name: 'New company' })
    openLead(id)
  }

  if (!data.leads.length) {
    return (
      <div className="view">
        <div className="vh"><div><h1>Leads</h1></div></div>
        <div className="card">
          <Empty icon={<UsersThree size={22} />} title="No leads yet" action={
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary" onClick={() => go('research')}>Start research</button>
              <button className="btn btn-ghost" onClick={addLead}>Add by hand</button>
            </div>}>
            Run a research to fill this list with scored companies, or add one you already know.
          </Empty>
        </div>
      </div>
    )
  }

  return (
    <div className={`view${leadId ? ' with-drawer' : ''}`}>
      <div className="vh">
        <div>
          <h1>Leads</h1>
          <p>Ranked by fit. Select a company to see why it fits and how to start the conversation.</p>
        </div>
        <div className="actions">
          <button className="btn btn-ghost" onClick={addLead}><Plus size={14} />Add</button>
          <button className="btn btn-ghost" onClick={() => exportCsv(rows.map((r) => r.id))}><Export size={14} />Export CSV</button>
        </div>
      </div>

      <div className="toolbar">
        <label className="search-box">
          <MagnifyingGlass size={14} />
          <input placeholder="Filter by name, place, role or note" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter leads" />
          {q && <button className="icon-btn sm" aria-label="Clear" onClick={() => setQ('')}><X size={12} /></button>}
        </label>
        {FILTERS.map((f) => (
          <button key={f.id} className="filter" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>{f.label}</button>
        ))}
        <span className="spacer" />
        <span className="muted num">{rows.length} of {data.leads.length}</span>
      </div>

      <div className="table-wrap">
        <table>
          <colgroup>
            <col style={{ width: 44 }} /><col style={{ width: 36 }} /><col />
            {!compact && <col style={{ width: '15%' }} />}
            <col style={{ width: 70 }} />
            {!compact && <col style={{ width: '16%' }} />}
            {!compact && <col style={{ width: '24%' }} />}
            <col style={{ width: 118 }} />
          </colgroup>
          <thead>
            <tr>
              <th><Checkbox label="Select this page" checked={allChecked} onChange={(v) => setChecked((c) => {
                const n = new Set(c)
                pageRows.forEach((r) => (v ? n.add(r.id) : n.delete(r.id)))
                return n
              })} /></th>
              <th />
              <th>{head('name', 'Company')}</th>
              {!compact && <th>Location</th>}
              <th>{head('score', 'Fit')}</th>
              {!compact && <th>Decision maker</th>}
              {!compact && <th>Signal</th>}
              <th>{head('stage', 'Stage')}</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((l, i) => (
              <Row key={l.id} lead={l} i={i} compact={compact} active={l.id === leadId} checked={checked.has(l.id)} onCheck={() => toggle(l.id)} onOpen={() => openLead(l.id === leadId ? null : l.id)} />
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <Empty icon={<MagnifyingGlass size={20} />} title="Nothing matches">Try a different filter or clear the search.</Empty>}
        {rows.length > PAGE_SIZES[0] && <Pager page={page} size={size} total={rows.length} onPage={goPage} onSize={setSize} />}
      </div>

      <AnimatePresence>
        {selected.length > 0 && (
          <motion.div className="bulk" initial={{ opacity: 0, y: 16, x: '-50%' }} animate={{ opacity: 1, y: 0, x: '-50%' }} exit={{ opacity: 0, y: 12, x: '-50%' }} transition={spring}>
            <b className="num">{selected.length} selected</b>
            <select className="input" style={{ width: 150, minHeight: 30 }} value="" aria-label="Move selected to stage" onChange={(e) => {
              const st = e.target.value as Stage
              selected.forEach((l) => window.lp.leads.update(l.id, { stage: st }))
              toast(`Moved ${selected.length} to ${STAGES.find((s) => s.id === st)?.label}`)
              setChecked(new Set())
            }}>
              <option value="" disabled>Move to stage</option>
              {STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
            <button className="btn btn-plain" onClick={() => exportCsv(selected.map((l) => l.id))}><Export size={14} />Export</button>
            <button className="btn btn-danger" onClick={() => { removeLeads(selected); setChecked(new Set()) }}><Trash size={14} />Delete</button>
            <button className="icon-btn" aria-label="Clear selection" onClick={() => setChecked(new Set())}><X size={14} /></button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function Row({ lead: l, i, compact, active, checked, onCheck, onOpen }: { lead: Lead; i: number; compact: boolean; active: boolean; checked: boolean; onCheck: () => void; onOpen: () => void }) {
  return (
    <motion.tr
      initial={{ opacity: 0.4 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.14, delay: Math.min(i, 6) * 0.012 }}
      data-active={active}
      data-checked={checked}
      onClick={onOpen}
    >
      <td><Checkbox label={`Select ${l.name}`} checked={checked} onChange={onCheck} /></td>
      <td>
        <button className="icon-btn sm star" aria-pressed={l.starred} aria-label={l.starred ? 'Unstar' : 'Star'} onClick={(e) => { e.stopPropagation(); window.lp.leads.update(l.id, { starred: !l.starred }) }}>
          <Star size={14} weight={l.starred ? 'fill' : 'regular'} />
        </button>
      </td>
      <td title={l.name}><div className="co"><span className="co-badge">{initials(l.name)}</span><div><b>{l.name}</b><span>{compact ? l.location : l.industry}</span></div></div></td>
      {!compact && <td title={l.location}>{l.location}</td>}
      <td><Score value={l.score} /></td>
      {!compact && <td title={l.decisionMaker}>{l.decisionMaker}</td>}
      {!compact && <td className="muted" title={l.signal}>{l.signal}</td>}
      <td><StagePill stage={l.stage} /></td>
    </motion.tr>
  )
}
