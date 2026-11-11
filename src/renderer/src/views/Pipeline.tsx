import { motion, LayoutGroup } from 'motion/react'
import { useState } from 'react'
import { Kanban } from '@phosphor-icons/react'
import { STAGES, type Stage } from '@shared/types'
import { spring, useApp } from '../state'
import { Empty, Score, ShowMore, timeAgo } from '../components/ui'

export function Pipeline() {
  const { data, openLead, go, toast, leadId } = useApp()
  const [over, setOver] = useState<Stage | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [limits, setLimits] = useState<Record<string, number>>({})
  const STEP = 20

  if (!data.leads.length) {
    return (
      <div className="view">
        <div className="vh"><div><h1>Pipeline</h1></div></div>
        <div className="card">
          <Empty icon={<Kanban size={22} />} title="Your pipeline is empty" action={<button className="btn btn-primary" onClick={() => go('research')}>Start research</button>}>
            New leads land in Researched. Drag them across as conversations move forward.
          </Empty>
        </div>
      </div>
    )
  }

  const drop = (stage: Stage, id: string) => {
    setOver(null)
    setDragId(null)
    const l = data.leads.find((x) => x.id === id)
    if (!l || l.stage === stage) return
    const prev = l.stage
    window.lp.leads.update(id, { stage })
    toast(`${l.name} moved to ${STAGES.find((s) => s.id === stage)?.label}`, {
      action: { label: 'Undo', run: () => window.lp.leads.update(id, { stage: prev }) }
    })
  }

  return (
    <div className={`view wide board-view${leadId ? ' with-drawer' : ''}`}>
      <div className="vh">
        <div>
          <h1>Pipeline</h1>
          <p>Drag a company to another stage. Click a card to see its details.</p>
        </div>
      </div>
      <LayoutGroup>
        <div className="board">
          {STAGES.map((s) => {
            const items = data.leads.filter((l) => l.stage === s.id).sort((a, b) => b.score - a.score)
            return (
              <div
                key={s.id}
                className={`col ${over === s.id ? 'over' : ''}`}
                onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (over !== s.id) setOver(s.id) }}
                onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null) }}
                onDrop={(e) => { e.preventDefault(); drop(s.id, e.dataTransfer.getData('text/plain')) }}
              >
                <div className="col-head">{s.label}<span className="num">{items.length}</span></div>
                {items.slice(0, limits[s.id] ?? STEP).map((l) => (
                  <motion.div key={l.id} layout layoutId={l.id} transition={spring}>
                    <div
                      className={`kcard ${dragId === l.id ? 'dragging' : ''}`}
                      draggable
                      role="button"
                      tabIndex={0}
                      onDragStart={(e) => { e.dataTransfer.setData('text/plain', l.id); e.dataTransfer.effectAllowed = 'move'; setDragId(l.id) }}
                      onDragEnd={() => { setDragId(null); setOver(null) }}
                      onClick={() => openLead(l.id)}
                      onKeyDown={(e) => e.key === 'Enter' && openLead(l.id)}
                    >
                      <b>{l.name}</b>
                      {l.signal && <div className="sig">{l.signal}</div>}
                      <div className="meta"><span>{s.id === 'researched' ? l.location : `${timeAgo(l.stageChangedAt)}`}</span><Score value={l.score} /></div>
                    </div>
                  </motion.div>
                ))}
                <ShowMore shown={limits[s.id] ?? STEP} total={items.length} step={STEP} noun="cards" onMore={() => setLimits((m) => ({ ...m, [s.id]: (m[s.id] ?? STEP) + STEP }))} />
                {items.length === 0 && <div className="col-empty">Drop here</div>}
              </div>
            )
          })}
        </div>
      </LayoutGroup>
    </div>
  )
}
