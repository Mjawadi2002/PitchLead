import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowRight, Lightning, Stack, CaretRight, Check, FileText, FolderOpen, Globe, MagnifyingGlass, NotePencil, Play, Stop, Trash, WarningCircle, X
} from '@phosphor-icons/react'
import { BATCH_SIZE, DEFAULT_INPUT, MAX_LEADS, PHASES, PROJECT_COLORS, type ResearchInput, type Run, type RunEvent } from '@shared/types'
import { spring, useApp } from '../state'
import { Empty, ShowMore, Switch, mod, timeAgo } from '../components/ui'

const KIND_ICON: Record<RunEvent['kind'], JSX.Element> = {
  phase: <ArrowRight size={13} />,
  search: <MagnifyingGlass size={13} />,
  fetch: <Globe size={13} />,
  read: <FileText size={13} />,
  write: <NotePencil size={13} />,
  note: <CaretRight size={13} />,
  error: <WarningCircle size={13} />
}

/** Rough wall-clock estimate from real runs: about 4 min for 5 leads on Opus. */
function estimate(count: number, model: string, parallel = 1) {
  const perBatch = (n: number) => 2.5 + n * 0.45
  const sizes: number[] = []
  for (let left = count; left > 0; left -= BATCH_SIZE) sizes.push(Math.min(BATCH_SIZE, left))
  // Batches run `parallel` at a time, so time is roughly the longest lane.
  const lanes = Array(Math.max(1, Math.min(parallel, sizes.length))).fill(0)
  for (const n of sizes) { const i = lanes.indexOf(Math.min(...lanes)); lanes[i] += perBatch(n) }
  let mins = Math.max(...lanes) * (sizes.length > 1 ? 1.15 : 1)
  if (model === 'sonnet') mins *= 0.6
  const m = Math.round(mins / 5) * 5 || Math.ceil(mins)
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ''}`.trim() : `${m} min`
}

/** Fast engine: map and web listing, website reading, then bulk scoring. Measured on real runs. */
function fastEstimate(count: number, deepTop: boolean, parallel: number) {
  const pool = Math.max(count + 5, count * 1.6)
  let mins = 1.5 + pool / 40 + Math.ceil(pool / 20 / Math.max(1, parallel)) * 1.2
  if (deepTop) mins += Math.ceil(Math.min(15, count / 3) / Math.max(1, parallel)) * 4
  const m = Math.max(2, Math.round(mins))
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`
}

function elapsed(from: number, to = Date.now()) {
  const s = Math.max(0, Math.round((to - from) / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
}

function useTick(on: boolean) {
  const [, set] = useState(0)
  useEffect(() => {
    if (!on) return
    const t = setInterval(() => set((x) => x + 1), 1000)
    return () => clearInterval(t)
  }, [on])
}

export function Research() {
  const { data, allData, project, editProject, claude, go, toast } = useApp()
  // The form starts from the project: what it sells and who buys it. Edits are saved back on start.
  const [forProject, setForProject] = useState<string>(project?.id ?? allData.projects[0]?.id ?? '')
  const target = allData.projects.find((p) => p.id === (project?.id ?? forProject)) ?? null
  const fromProject = (p: typeof target): ResearchInput => ({
    ...DEFAULT_INPUT, ...(data.settings.lastInput ?? {}),
    ...(p ? { product: p.product, folder: p.folder, industry: p.industry, location: p.location, size: p.size, pains: p.pains, tech: p.tech, projectId: p.id } : {})
  })
  const [input, setInput] = useState<ResearchInput>(() => fromProject(target))
  useEffect(() => { setInput((i) => ({ ...fromProject(target), engine: i.engine, deepTop: i.deepTop, count: i.count, extra: i.extra })) }, [target?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const [more, setMore] = useState(!!(input.pains || input.tech || input.extra))
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [historyShown, setHistoryShown] = useState(8)
  const running = data.runs.find((r) => r.status === 'running')
  const [selectedId, setSelectedId] = useState<string | null>(running?.id ?? data.runs[0]?.id ?? null)
  const selected = data.runs.find((r) => r.id === selectedId) ?? running ?? data.runs[0]
  const set = (patch: Partial<ResearchInput>) => setInput((i) => ({ ...i, ...patch }))
  const fast = (input.engine ?? 'fast') === 'fast'

  useEffect(() => { if (running) setSelectedId(running.id) }, [running?.id])

  const ready = input.product.trim().length > 8 || !!input.folder
  const blocked = !claude?.found ? 'Claude Code is not installed.' : !claude.loggedIn ? (data.settings.mode === 'apikey' ? 'Add your API key in Settings.' : 'Sign in to Claude first.') : null

  const start = async () => {
    if (!ready || running || starting) return
    setStarting(true)
    setError(null)
    try {
      const id = await window.lp.research.start({ ...input, projectId: target?.id })
      setSelectedId(id)
    } catch (e) {
      setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    } finally {
      setStarting(false)
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); start() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className="view">
      <div className="vh">
        <div>
          <h1>Research</h1>
          <p>Describe what you sell and who buys it. LeadPitch finds companies on the map and the web, reads their websites, and Claude scores how well each one fits.</p>
        </div>
      </div>

      {!allData.projects.length ? (
        <div className="card">
          <Empty icon={<Stack size={22} />} title="Create your first project" action={<button className="btn btn-primary" onClick={() => editProject('new')}>New project</button>}>
            A project holds what you sell and who buys it. Each one has its own leads, pipeline and outreach.
          </Empty>
        </div>
      ) : (
      <div className="research">
        <form className="card form" onSubmit={(e) => { e.preventDefault(); start() }}>
          <div className="project-banner">
            <span className="proj-sq sm" style={{ background: PROJECT_COLORS[(target?.color ?? 0) % PROJECT_COLORS.length] }}>{(target?.name ?? 'P').slice(0, 1).toUpperCase()}</span>
            {project ? (
              <span className="grow">Leads go to <b>{project.name}</b>. Changes below are saved to the project when you start.</span>
            ) : (
              <span className="grow">
                Leads go to{' '}
                <select className="input" style={{ width: 'auto', minHeight: 28, padding: '2px 26px 2px 8px', display: 'inline-block' }} value={forProject} onChange={(e) => setForProject(e.target.value)} aria-label="Project for this run">
                  {allData.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </span>
            )}
            {target && <button type="button" className="btn btn-plain" onClick={() => editProject(target.id)}>Edit project</button>}
          </div>
          <div className="field" data-tour="research-product">
            <label htmlFor="r-product">What you sell</label>
            <textarea id="r-product" className="input" rows={4} value={input.product} onChange={(e) => set({ product: e.target.value })}
              placeholder="What it is, who it is for and the problem it solves. Two or three sentences is enough." />
          </div>
          <div className="field">
            <span className="label">Product folder <span className="muted">(optional)</span></span>
            {input.folder ? (
              <div className="folder" title={input.folder}>
                <FolderOpen size={15} />
                <span>{input.folder}</span>
                <button type="button" className="icon-btn sm" aria-label="Remove folder" onClick={() => set({ folder: '' })}><X size={13} /></button>
              </div>
            ) : (
              <button type="button" className="btn btn-ghost" style={{ alignSelf: 'flex-start' }} onClick={async () => { const p = await window.lp.dialog.folder(); if (p) set({ folder: p }) }}>
                <FolderOpen size={14} />Choose folder
              </button>
            )}
            <span className="help">Claude reads the code or docs in this folder to understand the product. Nothing is changed.</span>
          </div>
          <div className="two" data-tour="research-icp">
            <div className="field"><label htmlFor="r-ind">Industry</label><input id="r-ind" className="input" value={input.industry} onChange={(e) => set({ industry: e.target.value })} placeholder="Cafés and restaurants" /></div>
            <div className="field"><label htmlFor="r-loc">Location</label><input id="r-loc" className="input" value={input.location} onChange={(e) => set({ location: e.target.value })} placeholder="Tunis, Tunisia" /></div>
          </div>
          <div className="field"><label htmlFor="r-size">Company size</label><input id="r-size" className="input" value={input.size} onChange={(e) => set({ size: e.target.value })} placeholder="10 to 50 employees, or 20 to 80 seats" /></div>
          <button type="button" className="disclose" aria-expanded={more} onClick={() => setMore((m) => !m)}><CaretRight size={12} weight="bold" />More detail</button>
          <AnimatePresence initial={false}>
            {more && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={spring} style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div className="field"><label htmlFor="r-pain">Pain points you solve</label><input id="r-pain" className="input" value={input.pains} onChange={(e) => set({ pains: e.target.value })} placeholder="Slow service at peak hours" /></div>
                <div className="field"><label htmlFor="r-tech">Tools they use</label><input id="r-tech" className="input" value={input.tech} onChange={(e) => set({ tech: e.target.value })} placeholder="Shopify, HubSpot, a POS system" /></div>
                <div className="field"><label htmlFor="r-extra">Anything else</label><textarea id="r-extra" className="input" rows={2} value={input.extra} onChange={(e) => set({ extra: e.target.value })} placeholder="Skip chains. Prefer places that opened in the last year." /></div>
              </motion.div>
            )}
          </AnimatePresence>
          <div className="field" data-tour="research-engine">
            <span className="label">How to research</span>
            <div className="engine-pick" role="radiogroup" aria-label="How to research">
              <button type="button" role="radio" aria-checked={fast} className={`engine ${fast ? 'on' : ''}`} onClick={() => set({ engine: 'fast' })}>
                <Lightning size={16} weight={fast ? 'fill' : 'regular'} />
                <div><b>Fast</b><span>Map listings and web lists, websites read by code, Claude scores in bulk. Best for many leads.</span></div>
              </button>
              <button type="button" role="radio" aria-checked={!fast} className={`engine ${!fast ? 'on' : ''}`} onClick={() => set({ engine: 'deep' })}>
                <MagnifyingGlass size={16} weight={!fast ? 'bold' : 'regular'} />
                <div><b>Deep</b><span>Claude researches every company on the web. Strongest signals, slower, uses more of your plan.</span></div>
              </button>
            </div>
            {fast && (
              <label className="check-line">
                <Switch label="Deep research on top fits" checked={!!input.deepTop} onChange={(v) => set({ deepTop: v })} />
                <span>Afterwards, research leads that score 8 or more in depth (up to 15).</span>
              </label>
            )}
          </div>
          <div className="field">
            <label htmlFor="r-count">Number of leads</label>
            <div className="range-row"><input id="r-count" type="range" min={5} max={MAX_LEADS} step={5} value={input.count} onChange={(e) => set({ count: Number(e.target.value) })} /><b className="num">{input.count}</b></div>
            <span className="help">
              {fast
                ? `Expect about ${fastEstimate(input.count, !!input.deepTop, data.settings.parallel ?? 3)}. Uses far less of your Claude plan than Deep.`
                : input.count > BATCH_SIZE
                ? `Runs as ${Math.ceil(input.count / BATCH_SIZE)} batches of up to ${BATCH_SIZE}, ${Math.min(data.settings.parallel ?? 3, Math.ceil(input.count / BATCH_SIZE))} at a time. Expect about ${estimate(input.count, data.settings.model, data.settings.parallel ?? 3)}. Leads are saved as each batch finishes, and parallel batches use your plan limit faster.`
                : `Expect about ${estimate(input.count, data.settings.model, data.settings.parallel ?? 3)}.`}
            </span>
          </div>
          {(error || blocked) && (
            <div className={`alert ${error ? '' : 'warn'}`}>
              <WarningCircle size={16} weight="fill" style={{ flex: 'none', marginTop: 1 }} />
              <div className="grow">{error || blocked}</div>
              <button type="button" className="btn btn-ghost" onClick={() => go('settings')}>Settings</button>
            </div>
          )}
          <div className="form-foot">
            <button type="submit" data-tour="research-start" className="btn btn-primary lg" disabled={!ready || !!running || starting}>
              <Play size={14} weight="fill" />{running ? 'Research running' : starting ? 'Starting' : 'Start research'}
            </button>
            <span className="help">{ready ? `${mod()} Enter` : 'Describe the product or choose its folder'}</span>
          </div>
        </form>

        <RunPanel run={selected} onViewLeads={() => go('leads', { filter: 'all' })} onToast={toast} />
      </div>
      )}

      {data.runs.length > 0 && (
        <section className="history">
          <h2 className="section-title">History</h2>
          <div className="card">
            {data.runs.slice(0, historyShown).map((r) => (
              <div className="list-row" key={r.id} style={{ cursor: 'default', background: r.id === selected?.id ? 'var(--hover)' : undefined }} onClick={() => setSelectedId(r.id)}>
                <span className={`dot ${r.status === 'running' ? 'live' : r.status === 'done' ? '' : r.status === 'failed' ? 'warn' : 'idle'}`} />
                <div className="co"><div><b>{r.title}</b><span>{timeAgo(r.createdAt)} · {r.status === 'done' ? `${r.leadIds.length} leads` : r.status === 'running' ? 'Running' : r.status === 'cancelled' ? 'Stopped' : 'Failed'}</span></div></div>
                <button className="btn btn-plain" onClick={(e) => { e.stopPropagation(); setInput({ ...DEFAULT_INPUT, ...r.input }); toast('Loaded these settings into the form') }}>Use settings</button>
                <button className="icon-btn" aria-label="Delete run" disabled={r.status === 'running'} onClick={(e) => { e.stopPropagation(); window.lp.research.remove(r.id) }}><Trash size={15} /></button>
              </div>
            ))}
            <ShowMore shown={historyShown} total={data.runs.length} step={8} noun="runs" onMore={() => setHistoryShown((n) => n + 8)} />
          </div>
        </section>
      )}
    </div>
  )
}

function RunPanel({ run, onViewLeads, onToast }: { run?: Run; onViewLeads: () => void; onToast: (t: string) => void }) {
  const { go } = useApp()
  const feedRef = useRef<HTMLDivElement>(null)
  const isRunning = run?.status === 'running'
  useTick(isRunning)
  const feed = useMemo(() => (run?.events ?? []).filter((e) => e.kind !== 'phase'), [run?.events])
  const phaseTimes = useMemo(() => {
    const m = new Map<number, number>()
    // Only the current batch: each batch goes through the steps again.
    const ev = run?.events ?? []
    let start = 0
    ev.forEach((e, i) => { if (e.kind === 'note' && /^Batch d+ of d+/.test(e.text)) start = i })
    for (const e of ev.slice(start)) if (e.kind === 'phase' && e.phase) m.set(e.phase, e.t)
    return m
  }, [run?.events])

  useEffect(() => {
    const el = feedRef.current
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 80) el.scrollTop = el.scrollHeight
  }, [feed.length])

  if (!run) {
    return (
      <div className="card run" data-tour="run-panel">
        <div className="run-head"><b>Live run</b></div>
        <ol className="phases" style={{ borderBottom: 0 }}>
          {PHASES.map((p) => (
            <li className="phase" key={p}><span className="st" /><b>{p}</b><time /></li>
          ))}
        </ol>
        <div className="run-foot"><span className="grow">Each step appears here as Claude works: searches, pages read and companies scored.</span></div>
      </div>
    )
  }

  const auth = run.error?.startsWith('AUTH:')
  const multi = (run.batches ?? 1) > 1
  const state = isRunning ? 'Running' : run.status === 'done' ? 'Finished' : run.status === 'cancelled' ? 'Stopped' : 'Failed'

  return (
    <div className="card run" data-tour="run-panel">
      <div className="run-head">
        <div style={{ minWidth: 0 }}><b>{run.title}</b><div className="muted" style={{ fontSize: 12 }}>{timeAgo(run.createdAt)} · {elapsed(run.createdAt, run.finishedAt)} · <span className="num">{run.leadIds.length} of {run.input.count} leads</span>{multi && isRunning ? ` · batch ${run.batch} of ${run.batches}` : ''}</div></div>
        <span className="chip"><span className={`dot ${isRunning ? 'live' : run.status === 'done' ? '' : run.status === 'failed' ? 'warn' : 'idle'}`} />{state}</span>
      </div>
      {(multi || run.stages) && (
        <div className="run-progress" aria-label="Leads found" title={`${run.leadIds.length} of ${run.input.count} leads`}>
          <i style={{ width: `${Math.min(100, (run.leadIds.length / Math.max(1, run.input.count)) * 100)}%` }} />
        </div>
      )}
      {run.stages ? (
        <ol className="phases stages">
          {run.stages.map((st) => (
            <li className={`phase ${st.status === 'done' ? 'done' : st.status === 'running' ? 'on' : st.status === 'skipped' ? 'skipped' : ''}`} key={st.key}>
              <span className="st">{st.status === 'done' && <Check size={11} weight="bold" />}</span>
              <div className="b-text"><b>{st.label}</b><span>{st.detail}</span></div>
              <time className="num" />
            </li>
          ))}
        </ol>
      ) : multi ? (
        <ol className="phases batches">
          {(run.batchStates ?? []).map((b) => (
            <li className={`phase ${b.status === 'done' ? 'done' : b.status === 'running' ? 'on' : b.status === 'failed' ? 'failed' : ''}`} key={b.n}>
              <span className="st">{b.status === 'done' && <Check size={11} weight="bold" />}</span>
              <div className="b-text"><b>Batch {b.n}</b><span>{b.angle}</span></div>
              <time className="num">{b.status === 'waiting' ? 'waiting' : b.status === 'running' ? `${b.phase ? PHASES[b.phase - 1].toLowerCase() : 'starting'}` : b.status === 'failed' ? 'stopped' : `${b.found} found`}</time>
            </li>
          ))}
        </ol>
      ) : (
      <ol className="phases">
        {PHASES.map((p, i) => {
          const n = i + 1
          const done = run.status === 'done' || n < run.phase
          const on = isRunning && n === Math.max(1, run.phase)
          const t = phaseTimes.get(n)
          return (
            <li className={`phase ${done ? 'done' : on ? 'on' : ''}`} key={p}>
              <span className="st">{done && <Check size={11} weight="bold" />}</span>
              <b>{p}</b>
              <time className="num">{t ? elapsed(run.createdAt, t) : ''}</time>
            </li>
          )
        })}
      </ol>
      )}
      <div className="feed" ref={feedRef} aria-live="polite">
        {feed.length === 0 && isRunning && <div className="feed-row"><span /><span className="t">Starting Claude Code</span><span /></div>}
        {feed.map((e, i) => (
          <div className={`feed-row k-${e.kind}`} key={i}>
            {KIND_ICON[e.kind]}
            <span className="t selectable" title={e.text}>{e.batch ? <span className="b-tag">B{e.batch}</span> : null}{e.text}</span>
            <time className="num">{elapsed(run.createdAt, e.t)}</time>
          </div>
        ))}
      </div>
      {run.warning && run.status === 'done' && (
        <div style={{ padding: '12px 16px 0' }}>
          <div className="alert warn"><WarningCircle size={16} weight="fill" style={{ flex: 'none', marginTop: 1 }} /><div className="grow">{run.warning.replace(/^AUTH:s*/, '')}</div></div>
        </div>
      )}
      {run.status === 'done' && (
        <div className="result-box" style={{ borderTop: '1px solid var(--line)' }}>
          {run.summary && <p>{run.summary}</p>}
          {!!run.assumptions?.length && (<><span className="label">Assumptions Claude made</span><ul>{run.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul></>)}
        </div>
      )}
      {(run.status === 'failed' || run.status === 'cancelled') && run.error && (
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--line)' }}>
          <div className="alert">
            <WarningCircle size={16} weight="fill" style={{ flex: 'none', marginTop: 1 }} />
            <div className="grow">
              <b>{auth ? 'Claude needs you to sign in again' : 'The run stopped'}</b>
              {run.error.replace(/^AUTH:\s*/, '')}
            </div>
            {auth && <button className="btn btn-ghost" onClick={() => { window.lp.claude.signIn(); onToast('Finish signing in in the terminal window') }}>Sign in</button>}
          </div>
        </div>
      )}
      <div className="run-foot">
        <span className="grow">{isRunning
          ? multi ? `${run.leadIds.length} leads saved so far. You can keep working while the next batches run.` : 'You can keep working. The run continues in the background.'
          : run.status === 'done' ? `${run.leadIds.length} new leads added to Researched.`
          : run.status === 'cancelled' && run.leadIds.length ? `Stopped. The ${run.leadIds.length} leads found before stopping were kept.`
          : 'Uses your Claude account through Claude Code.'}</span>
        {isRunning && <button className="btn btn-ghost" onClick={() => window.lp.research.cancel(run.id)}><Stop size={13} weight="fill" />Stop</button>}
        {(run.status === 'done' || run.status === 'cancelled') && run.leadIds.length > 0 && <button className="btn btn-primary" onClick={onViewLeads}>View leads<ArrowRight size={13} /></button>}
        {run.status === 'failed' && !auth && <button className="btn btn-ghost" onClick={() => go('settings')}>Check connection</button>}
      </div>
    </div>
  )
}
