import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { ArrowRight, CaretDown, CaretUp, CheckCircle, Stop, WarningCircle, X } from '@phosphor-icons/react'
import { spring, useApp } from '../state'
import { tourHidesDock } from './Tour'

/**
 * Floating research panel, bottom right. Shows while a run is going (and after it ends,
 * until dismissed) on every screen except Research, which has the full panel.
 */
export function ResearchDock() {
  const { data, view, go } = useApp()
  const [min, setMin] = useState(false)
  const [dismissed, setDismissed] = useState<string | null>(null)
  const [, tick] = useState(0)

  const run = data.runs.find((r) => r.status === 'running') ?? data.runs[0]
  const live = run?.status === 'running'
  useEffect(() => {
    if (!live) return
    const t = setInterval(() => tick((x) => x + 1), 1000)
    return () => clearInterval(t)
  }, [live])
  // A new run always shows the panel again.
  useEffect(() => { if (live) setDismissed(null) }, [run?.id, live])

  const recentlyEnded = run && !live && run.finishedAt && Date.now() - run.finishedAt < 10 * 60_000
  const show = run && view !== 'research' && dismissed !== run.id && (live || recentlyEnded) && !tourHidesDock(data.settings.tour)

  const total = run?.input.count ?? 0
  const found = run?.leadIds.length ?? 0
  const pct = total ? Math.min(100, (found / total) * 100) : 0
  const batches = run?.batchStates ?? []
  const active = batches.filter((b) => b.status === 'running').length
  const doneB = batches.filter((b) => b.status === 'done' || b.status === 'failed').length
  const last = [...(run?.events ?? [])].reverse().find((e) => e.kind !== 'phase')
  const secs = run ? Math.round(((run.finishedAt ?? Date.now()) - run.createdAt) / 1000) : 0
  const time = secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${String(secs % 60).padStart(2, '0')}s`

  return (
    <AnimatePresence>
      {show && run && (
        <motion.aside
          key="dock"
          className={`dock ${min ? 'min' : ''}`}
          aria-label="Research progress"
          initial={{ opacity: 0, y: 16, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, transition: { duration: 0.15 } }}
          transition={spring}
          layout
        >
          <div className="dock-head">
            {live ? <span className="dot live" /> : run.status === 'done' ? <CheckCircle size={15} weight="fill" color="var(--pos)" /> : <WarningCircle size={15} weight="fill" color="var(--warn)" />}
            <button className="dock-title" onClick={() => go('research')} title="Open research">
              <b>{live ? 'Researching' : run.status === 'done' ? 'Research finished' : run.status === 'cancelled' ? 'Research stopped' : 'Research failed'}</b>
              <span className="num">{found} of {total} leads · {time}</span>
            </button>
            <button className="icon-btn sm" aria-label={min ? 'Expand' : 'Minimize'} onClick={() => setMin((m) => !m)}>
              {min ? <CaretUp size={13} weight="bold" /> : <CaretDown size={13} weight="bold" />}
            </button>
            {!live && <button className="icon-btn sm" aria-label="Dismiss" onClick={() => setDismissed(run.id)}><X size={13} /></button>}
          </div>
          <div className="dock-bar" aria-hidden><i style={{ width: `${live && pct < 3 ? 3 : pct}%` }} /></div>
          {!min && (
            <div className="dock-body">
              <div className="dock-run">{run.title}</div>
              {run.stages && (
                <div className="dock-batches" aria-label="Steps">
                  {run.stages.map((st) => <i key={st.key} className={`b-${st.status === 'done' ? 'done' : st.status === 'running' ? 'running' : 'waiting'}`} style={{ width: 40 }} title={`${st.label}: ${st.status}`} />)}
                </div>
              )}
              {!run.stages && batches.length > 1 && (
                <div className="dock-batches" aria-label="Batches">
                  {batches.map((b) => <i key={b.n} className={`b-${b.status}`} title={`Batch ${b.n}: ${b.status}, ${b.found} found`} />)}
                </div>
              )}
              <div className="dock-meta muted">
                {run.stages
                  ? (() => { const cur = run.stages.find((x) => x.status === 'running') ?? [...run.stages].reverse().find((x) => x.status === 'done'); return cur ? `${cur.label}: ${cur.detail}` : '' })()
                  : batches.length > 1 ? `${doneB} of ${batches.length} batches done${active ? `, ${active} running` : ''}` : live ? 'One Claude session' : ''}
              </div>
              {live && last && <div className="dock-last" title={last.text}>{last.batch ? `B${last.batch} · ` : ''}{last.text}</div>}
              {!live && run.warning && <div className="dock-last">{run.warning}</div>}
              {!live && run.error && <div className="dock-last" style={{ color: 'var(--neg)' }}>{run.error.replace(/^AUTH:\s*/, '')}</div>}
              <div className="dock-actions">
                {live ? (
                  <button className="btn btn-ghost" onClick={() => window.lp.research.cancel(run.id)}><Stop size={12} weight="fill" />Stop</button>
                ) : null}
                <button className="btn btn-plain" onClick={() => go('research')}>Open</button>
                {found > 0 && <button className="btn btn-primary" onClick={() => go('leads', { filter: 'all' })}>View leads<ArrowRight size={12} /></button>}
              </div>
            </div>
          )}
        </motion.aside>
      )}
    </AnimatePresence>
  )
}
