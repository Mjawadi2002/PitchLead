import { app } from 'electron'
import type { ChildProcess } from 'child_process'
import { randomUUID } from 'crypto'
import { join } from 'path'
import type { BatchState, Lead, ResearchInput, Run, RunEvent } from '@shared/types'
import { BATCH_SIZE, MAX_LEADS, PHASES } from '@shared/types'
import { AUTH_ERROR, LIMIT_ERROR, extractJson, killTree, readIfExists, resolveClaude, spawnClaude, writeText } from './claude'
import { researchSystemPrompt, researchUserPrompt } from './prompts'
import { db, save } from './store'
import { noteLimit, notePlanLimits, recordModelUsage } from './usage'
import { runFast } from './fast'
import { modelFor } from './models'
import { useFreeNow } from './omniroute'

/** Every Claude Code session a run has open, so Stop can end all of them. */
const children = new Map<string, Set<ChildProcess>>()
const running = new Set<string>()
/** Fast-engine runs are cancelled through an AbortSignal shared by every step. */
const aborts = new Map<string, AbortController>()

/** Different search angles keep parallel batches from finding the same companies. */
const ANGLES = [
  'companies hiring now for roles your product helps with (job boards, careers pages)',
  'companies that recently opened, launched, expanded or raised money (news, press releases)',
  'companies whose customer reviews or forums mention the pain your product solves',
  'industry directories, association member lists and "best of" lists for the location',
  'local and trade news, events and award lists from the last 12 months',
  'competitors and lookalikes of the strongest fits, and companies using adjacent tools',
  'smaller and newer companies that are less visible but growing fast',
  'companies in neighbouring cities or regions within the requested area'
]

interface LeadsFile {
  summary?: string
  assumptions?: string[]
  leads?: Partial<Lead & { why: string[] | string; starters: string[] | string }>[]
}

const norm = (s: string) => s.toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/[^a-z0-9]/g, '')
const str = (v: unknown, max = 600) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const list = (v: unknown) => (Array.isArray(v) ? v.map((x) => str(x, 400)).filter(Boolean).slice(0, 6) : typeof v === 'string' && v ? [v] : [])
const url = (v: unknown) => { const s = str(v, 300); return /^https?:\/\//i.test(s) ? s : '' }
const email = (v: unknown) => { const s = str(v, 120); return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : '' }
const phone = (v: unknown) => { const s = str(v, 40); return /\d{5,}/.test(s.replace(/\D/g, '')) ? s : '' }

function titleFor(input: ResearchInput): string {
  const parts = [input.industry, input.location].map((s) => s.trim()).filter(Boolean)
  return parts.length ? parts.join(' in ') : input.product.trim().split(/[.:\n]/)[0].slice(0, 48) || 'Research'
}

export function cancelRun(id: string): void {
  const run = db.get().runs.find((r) => r.id === id)
  if (run && run.status === 'running') {
    run.status = 'cancelled'
    run.finishedAt = Date.now()
    for (const b of run.batchStates ?? []) if (b.status === 'running' || b.status === 'waiting') b.status = 'failed'
    save()
  }
  for (const c of children.get(id) ?? []) killTree(c)
  aborts.get(id)?.abort()
}

interface BatchResult {
  added: number
  error?: string
  summary?: string
  assumptions?: string[]
}

export async function startRun(input: ResearchInput, notify: () => void): Promise<string> {
  const data = db.get()
  if (running.size) throw new Error('A research run is already in progress.')
  const settings = data.settings
  const path = await resolveClaude(settings)
  if (!path) throw new Error('Claude Code is not installed. Open Settings to set it up.')
  const apiKey = settings.mode === 'apikey' ? db.getApiKey() : null
  if (settings.mode === 'apikey' && !apiKey) throw new Error('Add your Anthropic API key in Settings, or switch to your Claude subscription.')

  const target = Math.max(1, Math.min(MAX_LEADS, Math.round(input.count)))
  // LP_BATCH_SIZE lets tests use tiny batches; normal use keeps BATCH_SIZE.
  const batchSize = Number(process.env.LP_BATCH_SIZE) > 0 ? Number(process.env.LP_BATCH_SIZE) : BATCH_SIZE
  const batches = Math.ceil(target / batchSize)
  const parallel = Math.max(1, Math.min(5, settings.parallel || 3, batches))
  const batchStates: BatchState[] = Array.from({ length: batches }, (_, i) => ({
    n: i + 1,
    status: 'waiting',
    want: Math.min(batchSize, target - i * batchSize),
    found: 0,
    phase: 0,
    angle: batches > 1 ? ANGLES[i % ANGLES.length] : ''
  }))
  // Each run belongs to a project. Leads are de-duplicated within that project only,
  // so the same company can be a lead for two different offers.
  const projectId = input.projectId || (settings.activeProject !== 'all' ? settings.activeProject : data.projects[0]?.id)
  const project = data.projects.find((p) => p.id === projectId)
  if (project) Object.assign(project, { product: input.product, folder: input.folder, industry: input.industry, location: input.location, size: input.size, pains: input.pains, tech: input.tech })
  const inProject = () => data.leads.filter((l) => !projectId || l.projectId === projectId)
  const run: Run = {
    id: randomUUID(),
    projectId,
    title: titleFor(input),
    createdAt: Date.now(),
    status: 'running',
    input: { ...input, count: target },
    leadIds: [],
    events: [],
    phase: 0,
    batch: 0,
    batches,
    batchStates,
    parallel
  }
  data.runs.unshift(run)
  settings.lastInput = run.input
  running.add(run.id)
  children.set(run.id, new Set())
  save()

  const runDir = join(app.getPath('userData'), 'runs', run.id)
  const sysFile = join(runDir, 'system.md')
  writeText(sysFile, researchSystemPrompt())

  let pending = false
  const push = (e: Omit<RunEvent, 't'>) => {
    run.events.push({ t: Date.now(), ...e })
    if (run.events.length > 4000) run.events.splice(0, run.events.length - 4000)
    if (!pending) {
      pending = true
      setTimeout(() => { pending = false; save(); notify() }, 150)
    }
  }
  const stopped = () => run.status === 'cancelled'
  // Overall phase shown in the UI: the furthest phase any batch has reached.
  const syncPhase = () => { run.phase = Math.max(0, ...(run.batchStates ?? []).map((b) => b.phase)) }

  if ((input.engine ?? 'fast') === 'fast') {
    run.batches = 1
    run.batchStates = undefined
    run.stages = [
      { key: 'find', label: 'Find companies', status: 'waiting', detail: 'Map listings, then web search if needed' },
      { key: 'read', label: 'Read their websites', status: 'waiting', detail: 'Emails, phones and details, no Claude needed' },
      { key: 'score', label: 'Score fit', status: 'waiting', detail: '20 companies per Claude call' },
      { key: 'deep', label: 'Deep research on top fits', status: 'waiting', detail: input.deepTop ? 'Leads scoring 8 or more' : 'Off for this run' }
    ]
    const ctrl = new AbortController()
    aborts.set(run.id, ctrl)
    push({ kind: 'note', text: useFreeNow(settings)
      ? 'Using free models until your Claude limit resets. Companies come from the map; steps that need web search are skipped.'
      : `Started with your ${settings.mode === 'apikey' ? 'API key' : 'Claude subscription'}. ${settings.models.smart ? `Lists and lookups use Haiku, scoring uses ${modelFor('score', settings) === 'haiku' ? 'Haiku' : 'Sonnet'}.` : ''}` })
    ;(async () => {
      let res: { error?: string; warning?: string } = {}
      try {
        res = await runFast({
          run, input: run.input, settings, apiKey, existing: inProject(), target, signal: ctrl.signal, push, notify,
          addLead: (l) => { l.projectId = projectId; data.leads.push(l); run.leadIds.push(l.id); save() }
        })
      } catch (e) {
        res = { error: (e as Error).message }
      }
      running.delete(run.id)
      children.delete(run.id)
      aborts.delete(run.id)
      run.finishedAt = Date.now()
      // A step that was cut short by an error or Stop is shown as stopped, not running.
      for (const st of run.stages ?? []) if (st.status === 'running' || (st.status === 'waiting' && (res.error || stopped()))) { st.status = 'skipped'; st.detail = st.status === 'skipped' && res.error ? 'Stopped by an error' : 'Stopped' }
      if (!stopped()) {
        if (res.error && run.leadIds.length === 0) { run.status = 'failed'; run.error = res.error }
        else { run.status = 'done'; run.phase = PHASES.length; if (res.error) run.warning = res.error.replace(/^AUTH:\s*/, ''); else if (res.warning) run.warning = res.warning }
      }
      save(true)
      notify()
    })()
    return run.id
  }

  if (useFreeNow(settings)) {
    running.delete(run.id)
    children.delete(run.id)
    run.status = 'failed'
    run.finishedAt = Date.now()
    run.error = 'The Deep engine needs Claude web search, and LeadPitch is using free models until your Claude limit resets. The Fast engine still works: it finds companies on the map and scores them with free models.'
    save(true)
    notify()
    return run.id
  }

  /** Adds leads from one batch, skipping any company already known. Shared by all batches. */
  const addLeads = (parsed: LeadsFile, state: BatchState): number => {
    const seen = new Set(inProject().flatMap((l) => [norm(l.name), norm(l.website)]).filter(Boolean))
    const now = Date.now()
    let added = 0
    for (const raw of parsed.leads ?? []) {
      if (run.leadIds.length >= target) break
      const name = str(raw.name, 120)
      if (!name) continue
      const website = url(raw.website)
      if (seen.has(norm(name)) || (website && seen.has(norm(website)))) continue
      seen.add(norm(name))
      if (website) seen.add(norm(website))
      const lead: Lead = {
        id: randomUUID(),
        runId: run.id,
        name,
        website,
        industry: str(raw.industry, 80),
        size: str(raw.size, 80),
        location: str(raw.location, 120),
        score: Math.max(1, Math.min(10, Math.round(Number(raw.score) || 5))),
        scoreReason: str(raw.scoreReason),
        decisionMaker: str(raw.decisionMaker, 120),
        linkedin: /^https?:\/\/([a-z]+\.)?linkedin\.com\//i.test(str(raw.linkedin)) ? str(raw.linkedin) : '',
        email: email(raw.email),
        phone: phone(raw.phone),
        contactName: str(raw.contactName, 120),
        contactUrl: url(raw.contactUrl),
        signal: str(raw.signal, 200),
        why: list(raw.why),
        valueProp: str(raw.valueProp),
        strategy: str(raw.strategy),
        starters: list(raw.starters),
        stage: 'researched',
        notes: '',
        starred: false,
        createdAt: now,
        updatedAt: now,
        stageChangedAt: now
      }
      lead.projectId = projectId
      data.leads.push(lead)
      run.leadIds.push(lead.id)
      added++
    }
    state.found += added
    return added
  }

  /** One Claude Code session that looks for `state.want` companies. */
  const runBatch = (state: BatchState): Promise<BatchResult> =>
    new Promise((resolve) => {
      const dir = join(runDir, `batch-${state.n}`)
      writeText(join(dir, '.keep'), '')
      const tools = ['Read', 'Glob', 'Grep', 'Write', ...(settings.webResearch ? ['WebSearch', 'WebFetch'] : [])].join(',')
      const args = [
        '-p', '--output-format', 'stream-json', '--verbose',
        '--model', modelFor('research', settings),
        '--append-system-prompt-file', sysFile,
        '--tools', tools,
        '--allowedTools', tools,
        '--permission-mode', 'dontAsk',
        '--no-session-persistence'
      ]
      if (input.folder) args.push('--add-dir', input.folder)

      const child = spawnClaude(path, args, { cwd: dir, apiKey })
      children.get(run.id)?.add(child)
      state.status = 'running'
      state.phase = 0
      const tag = batches > 1 ? state.n : undefined
      let buf = ''
      let stderr = ''
      let result: { is_error?: boolean; result?: string; subtype?: string } | null = null

      const onLine = (line: string) => {
        let j: any
        try { j = JSON.parse(line) } catch { return }
        if (j.type === 'assistant' && Array.isArray(j.message?.content)) {
          for (const c of j.message.content) {
            if (c.type === 'text' && typeof c.text === 'string') {
              for (const l of c.text.split(/\r?\n/)) {
                const m = l.match(/PHASE\s*(\d)\s*[:\-.]?\s*(.*)/i)
                if (m) {
                  const n = Math.min(PHASES.length, Math.max(1, Number(m[1])))
                  if (n > state.phase) {
                    state.phase = n
                    syncPhase()
                    push({ kind: 'phase', text: PHASES[n - 1], phase: n, batch: tag })
                  }
                }
              }
              const plain = c.text.replace(/PHASE\s*\d[^\n]*\n?/gi, '').trim()
              if (plain && plain.length < 220 && !plain.startsWith('{')) push({ kind: 'note', text: plain.split('\n')[0], batch: tag })
            }
            if (c.type === 'tool_use') {
              const i = c.input ?? {}
              if (c.name === 'WebSearch') push({ kind: 'search', text: str(i.query, 200), batch: tag })
              else if (c.name === 'WebFetch') push({ kind: 'fetch', text: str(i.url, 300), batch: tag })
              else if (c.name === 'Read') push({ kind: 'read', text: str(i.file_path, 300), batch: tag })
              else if (c.name === 'Glob' || c.name === 'Grep') push({ kind: 'read', text: str(i.pattern, 200), batch: tag })
              else if (c.name === 'Write') push({ kind: 'write', text: str(i.file_path, 300).split(/[\\/]/).pop() ?? '', batch: tag })
            }
          }
        }
        if (j.type === 'rate_limit_event') notePlanLimits(j.rate_limit_info)
        if (j.type === 'result') { result = j; recordModelUsage(j.modelUsage, j.usage) }
      }

      child.stdout?.setEncoding('utf8')
      child.stdout?.on('data', (d: string) => {
        buf += d
        let idx
        while ((idx = buf.indexOf('\n')) >= 0) {
          onLine(buf.slice(0, idx).trim())
          buf = buf.slice(idx + 1)
        }
      })
      child.stderr?.on('data', (d) => (stderr += d))
      child.stdin?.end(researchUserPrompt({ ...input, count: state.want }, inProject().map((l) => l.name), state.angle || undefined))

      // A batch that runs past 30 minutes is stopped so it cannot hold up the whole run.
      let timedOut = false
      const limit = setTimeout(() => { timedOut = true; killTree(child) }, 30 * 60_000)
      const done = (res: BatchResult) => {
        clearTimeout(limit)
        children.get(run.id)?.delete(child)
        state.status = res.error ? 'failed' : 'done'
        if (!res.error) state.phase = PHASES.length
        syncPhase()
        resolve(res)
      }
      child.on('error', (e) => done({ added: 0, error: e.message }))
      child.on('close', () => {
        if (buf.trim()) onLine(buf.trim())
        if (stopped()) return done({ added: 0 })
        if (timedOut && !result) return done({ added: 0, error: 'This batch took longer than 30 minutes and was stopped.' })
        const r = result as typeof result
        if (!r) return done({ added: 0, error: (stderr.trim() || 'Claude stopped without an answer.').slice(0, 500) })
        if (r.is_error || r.subtype !== 'success') {
          const msg = String(r.result || stderr || 'Claude returned an error.')
          if (LIMIT_ERROR.test(msg)) noteLimit(msg)
          return done({ added: 0, error: AUTH_ERROR.test(msg) ? `AUTH: ${msg}` : msg.slice(0, 500) })
        }
        const parsed = extractJson<LeadsFile>(readIfExists(join(dir, 'leads.json')) ?? '') ?? extractJson<LeadsFile>(String(r.result ?? ''))
        if (!parsed?.leads?.length) return done({ added: 0 })
        const added = addLeads(parsed, state)
        save()
        notify()
        done({ added, summary: str(parsed.summary, 800), assumptions: list(parsed.assumptions) })
      })
    })

  // Batches run `parallel` at a time in the background; the caller gets the run id at once.
  ;(async () => {
    const errors: string[] = []
    const queue = [...batchStates]
    const worker = async () => {
      while (queue.length && !stopped() && run.leadIds.length < target) {
        const state = queue.shift()!
        state.want = Math.min(state.want, target - run.leadIds.length)
        if (state.want <= 0) { state.status = 'done'; continue }
        run.batch = state.n
        push({ kind: 'note', text: batches > 1 ? `Batch ${state.n} of ${batches} started: ${state.want} companies` : `Looking for ${state.want} companies`, batch: batches > 1 ? state.n : undefined })
        const res = await runBatch(state)
        if (!run.summary && res.summary) { run.summary = res.summary; run.assumptions = res.assumptions }
        if (res.error) {
          errors.push(res.error)
          // A sign-in problem or a usage limit will fail every other batch too.
          if (/^AUTH:/.test(res.error) || LIMIT_ERROR.test(res.error)) { queue.length = 0; for (const c of children.get(run.id) ?? []) killTree(c) }
        }
        save()
        notify()
      }
    }
    await Promise.all(Array.from({ length: parallel }, worker))

    // Parallel batches can overlap. One top-up round fills the gap if any batch was productive.
    const short = target - run.leadIds.length
    const productive = batchStates.some((b) => b.found > 0)
    if (!stopped() && short > 0 && productive && !errors.some((e) => /^AUTH:/.test(e) || LIMIT_ERROR.test(e))) {
      const extra: BatchState[] = []
      for (let left = short, i = 0; left > 0; left -= batchSize, i++) {
        extra.push({ n: batchStates.length + 1, status: 'waiting', want: Math.min(batchSize, left), found: 0, phase: 0, angle: ANGLES[(batchStates.length + i) % ANGLES.length] })
        batchStates.push(extra[extra.length - 1])
      }
      run.batches = batchStates.length
      push({ kind: 'note', text: `Some companies overlapped. Looking for ${short} more.` })
      queue.push(...extra)
      await Promise.all(Array.from({ length: Math.min(parallel, extra.length) }, worker))
    }

    running.delete(run.id)
    children.delete(run.id)
    run.finishedAt = Date.now()
    if (!stopped()) {
      const firstError = errors[0]
      if (run.leadIds.length === 0) {
        run.status = 'failed'
        run.error = firstError ?? 'Claude finished but returned no leads. Try a broader location or industry.'
      } else {
        run.status = 'done'
        run.phase = PHASES.length
        if (firstError) run.warning = `Stopped after ${run.leadIds.length} leads: ${firstError.replace(/^AUTH:\s*/, '')}`
        else if (run.leadIds.length < target) run.warning = `Found ${run.leadIds.length} of the ${target} leads asked for. Try a broader location or industry for more.`
      }
    }
    save(true)
    notify()
  })()

  return run.id
}

export const hasActiveRun = () => running.size > 0
export const cancelAll = () => { for (const id of running) cancelRun(id) }
