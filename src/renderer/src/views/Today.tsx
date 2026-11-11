import { useEffect, useRef, useState } from 'react'
import { Kanban, Plus } from '@phosphor-icons/react'
import { STAGES } from '@shared/types'
import { useApp } from '../state'
import { Logo, Score, initials, timeAgo, mod } from '../components/ui'

function CountUp({ to }: { to: number }) {
  const [v, setV] = useState(0)
  const from = useRef(0)
  useEffect(() => {
    const start = from.current
    const t0 = performance.now()
    let raf = 0
    const f = (t: number) => {
      const p = Math.min(1, (t - t0) / 700)
      const val = Math.round(start + (to - start) * (1 - Math.pow(1 - p, 3)))
      setV(val)
      if (p < 1) raf = requestAnimationFrame(f)
      else from.current = to
    }
    raf = requestAnimationFrame(f)
    return () => cancelAnimationFrame(raf)
  }, [to])
  return <>{v}</>
}

function greeting() {
  const h = new Date().getHours()
  return h < 5 ? 'Good evening' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

export function Today() {
  const { data, go } = useApp()
  const { leads, runs } = data
  const name = data.settings.senderName.split(' ')[0]

  if (!leads.length) {
    return (
      <div className="view">
        <div className="card hero-empty">
          <div>
            <Logo size={44} />
            <h2 style={{ marginTop: 16 }}>Find the companies most likely to buy</h2>
            <p>Describe what you sell. Claude researches the web, scores each company from 1 to 10 and writes how to approach them.</p>
            <button className="btn btn-primary lg" onClick={() => go('research')}><Plus size={15} weight="bold" />Start your first research</button>
            <p className="help" style={{ marginTop: 12 }}>Shortcut: {mod()} N</p>
          </div>
          <ol className="how">
            {[
              ['Describe your product', 'Or point LeadPitch at its folder and Claude reads it.'],
              ['Claude researches', 'Web searches, company pages and buying signals, live as it works.'],
              ['Review scored leads', 'Why each one fits, who to contact and what to say first.'],
              ['Work the pipeline', 'Draft messages, move companies forward, export to CSV.']
            ].map(([t, s], i) => (
              <li key={t}><span className="n num">{i + 1}</span><div><b>{t}</b><span>{s}</span></div></li>
            ))}
          </ol>
        </div>
      </div>
    )
  }

  const contacted = leads.filter((l) => ['contacted', 'replied', 'meeting', 'won'].includes(l.stage)).length
  const meetings = leads.filter((l) => l.stage === 'meeting' || l.stage === 'won').length
  const high = leads.filter((l) => l.score >= 8).length
  const next = leads.filter((l) => l.stage === 'researched' || l.stage === 'qualified').sort((a, b) => (b.starred ? 1 : 0) - (a.starred ? 1 : 0) || b.score - a.score).slice(0, 5)
  const followUps = leads.filter((l) => l.stage === 'contacted' && Date.now() - l.stageChangedAt > 4 * 864e5).slice(0, 4)
  const order = STAGES.filter((s) => s.id !== 'lost')
  const funnel = order.map((s, i) => ({ ...s, n: leads.filter((l) => order.findIndex((x) => x.id === l.stage) >= i).length }))

  const sub = next.length
    ? `${next.length} ${next.length === 1 ? 'company is' : 'companies are'} ready for a first message.${followUps.length ? ` ${followUps.length} need a follow-up.` : ''}`
    : 'Everyone in your list has been contacted. Start a new research run to find more.'

  return (
    <div className="view">
      <div className="vh">
        <div>
          <h1>{greeting()}{name ? `, ${name}` : ''}</h1>
          <p>{sub}</p>
        </div>
        <div className="actions">
          <button className="btn btn-ghost" onClick={() => go('pipeline')}><Kanban size={14} />Open pipeline</button>
        </div>
      </div>

      <div className="kpis">
        <div className="kpi"><span>Leads</span><b className="num"><CountUp to={leads.length} /></b><small>from {runs.filter((r) => r.status === 'done').length} research runs</small></div>
        <div className="kpi"><span>Fit 8 and above</span><b className="num"><CountUp to={high} /></b><small>contact these first</small></div>
        <div className="kpi"><span>Contacted</span><b className="num"><CountUp to={contacted} /></b><small>{leads.length ? Math.round((contacted / leads.length) * 100) : 0}% of your list</small></div>
        <div className="kpi"><span>Meetings and wins</span><b className="num"><CountUp to={meetings} /></b><small>{leads.filter((l) => l.stage === 'won').length} won</small></div>
      </div>

      <div className="today-grid">
        <div className="stack">
          <section>
            <h2 className="section-title">Contact next<button className="more" onClick={() => go('leads', { filter: 'new' })}>All not contacted</button></h2>
            <div className="card">
              {next.length ? next.map((l) => (
                <button className="list-row" key={l.id} onClick={() => go('leads', { filter: 'all', leadId: l.id })}>
                  <div className="co"><span className="co-badge">{initials(l.name)}</span><div><b>{l.name}</b><span>{l.signal || l.industry}</span></div></div>
                  <Score value={l.score} />
                </button>
              )) : <div className="empty" style={{ padding: 28 }}><p>No one is waiting for a first message.</p></div>}
            </div>
          </section>
          {followUps.length > 0 && (
            <section>
              <h2 className="section-title">Follow up</h2>
              <div className="card">
                {followUps.map((l) => (
                  <button className="list-row" key={l.id} onClick={() => go('leads', { filter: 'all', leadId: l.id })}>
                    <div className="co"><span className="co-badge">{initials(l.name)}</span><div><b>{l.name}</b><span>Contacted {timeAgo(l.stageChangedAt)}, no reply yet</span></div></div>
                    <Score value={l.score} />
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>
        <div className="stack">
          <section>
            <h2 className="section-title">Pipeline</h2>
            <div className="card funnel">
              {funnel.map((s, i) => (
                <div className="fm-row" key={s.id}>
                  <span>{s.label}</span>
                  <span className="fm-bar"><i style={{ width: `${(s.n / Math.max(1, funnel[0].n)) * 100}%`, animationDelay: `${i * 60}ms` }} /></span>
                  <span className="num">{s.n}</span>
                </div>
              ))}
            </div>
          </section>
          <section>
            <h2 className="section-title">Recent research<button className="more" onClick={() => go('research')}>New research</button></h2>
            <div className="card">
              {runs.slice(0, 4).map((r) => (
                <button className="list-row" key={r.id} onClick={() => go('research')}>
                  <div className="co"><div><b>{r.title}</b><span>{timeAgo(r.createdAt)} · {r.status === 'done' ? `${r.leadIds.length} leads` : r.status === 'running' ? 'Running' : r.status === 'cancelled' ? 'Stopped' : 'Failed'}</span></div></div>
                  <span className={`dot ${r.status === 'running' ? 'live' : r.status === 'done' ? '' : 'idle'}`} />
                </button>
              ))}
              {!runs.length && <div className="empty" style={{ padding: 28 }}><p>No research runs yet.</p></div>}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
