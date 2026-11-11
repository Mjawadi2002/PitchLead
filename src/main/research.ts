import { app } from 'electron'
import type { ChildProcess } from 'child_process'
import { randomUUID } from 'crypto'
import { join } from 'path'
import type { Lead, ResearchInput, Run, RunEvent } from '@shared/types'
import { BATCH_SIZE, MAX_LEADS, PHASES } from '@shared/types'
import { AUTH_ERROR, extractJson, killTree, readIfExists, resolveClaude, spawnClaude, writeText } from './claude'
import { researchSystemPrompt, researchUserPrompt } from './prompts'
import { db, save } from './store'

const active = new Map<string, ChildProcess>()
const running = new Set<string>()

interface LeadsFile {
  summary?: string
  assumptions?: string[]
  leads?: Partial<Lead & { why: string[] | string; starters: string[] | string }>[]
}

const norm = (s: string) => s.toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/[^a-z0-9]/g, '')
const str = (v: unknown, max = 600) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const list = (v: unknown) => (Array.isArray(v) ? v.map((x) => str(x, 400)).filter(Boolean).slice(0, 6) : typeof v === 'string' && v ? [v] : [])

function titleFor(input: ResearchInput): string {
  const parts = [input.industry, input.location].map((s) => s.trim()).filter(Boolean)
  return parts.length ? parts.join(' in ') : input.product.trim().split(/[.:\n]/)[0].slice(0, 48) || 'Research'
}

export function cancelRun(id: string): void {
  const run = db.get().runs.find((r) => r.id === id)
  if (run && run.status === 'running') {
    run.status = 'cancelled'
    run.finishedAt = Date.now()
    save()
  }
  const child = active.get(id)
  if (child) killTree(child)
}

interface BatchResult {
  added: number
  error?: string
  summary?: string
  assumptions?: string[]
  costUsd?: number
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
  const run: Run = {
    id: randomUUID(),
    title: titleFor(input),
    createdAt: Date.now(),
    status: 'running',
    input: { ...input, count: target },
    leadIds: [],
    events: [],
    phase: 0,
    batch: 0,
    batches
  }
  data.runs.unshift(run)
  settings.lastInput = run.input
  running.add(run.id)
  save()

  const runDir = join(app.getPath('userData'), 'runs', run.id)
  const sysFile = join(runDir, 'system.md')
  writeText(sysFile, researchSystemPrompt())

  let pending = false
  const push = (e: Omit<RunEvent, 't'>) => {
    run.events.push({ t: Date.now(), ...e })
    if (run.events.length > 3000) run.events.splice(0, run.events.length - 3000)
    if (!pending) {
      pending = true
      setTimeout(() => { pending = false; save(); notify() }, 120)
    }
  }

  /** One Claude Code session that looks for `want` more companies. */
  const runBatch = (batchNo: number, want: number): Promise<BatchResult> =>
    new Promise((resolve) => {
      const dir = join(runDir, `batch-${batchNo}`)
      writeText(join(dir, '.keep'), '')
      const tools = ['Read', 'Glob', 'Grep', 'Write', ...(settings.webResearch ? ['WebSearch', 'WebFetch'] : [])].join(',')
      const args = [
        '-p', '--output-format', 'stream-json', '--verbose',
        '--model', settings.model,
        '--append-system-prompt-file', sysFile,
        '--tools', tools,
        '--allowedTools', tools,
        '--permission-mode', 'dontAsk',
        '--no-session-persistence'
      ]
      if (input.folder) args.push('--add-dir', input.folder)

      const child = spawnClaude(path, args, { cwd: dir, apiKey })
      active.set(run.id, child)
      let buf = ''
      let stderr = ''
      let result: { is_error?: boolean; result?: string; total_cost_usd?: number; subtype?: string } | null = null

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
                  if (n > run.phase) {
                    run.phase = n
                    push({ kind: 'phase', text: PHASES[n - 1], phase: n })
                  }
                }
              }
              const plain = c.text.replace(/PHASE\s*\d[^\n]*\n?/gi, '').trim()
              if (plain && plain.length < 220 && !plain.startsWith('{')) push({ kind: 'note', text: plain.split('\n')[0] })
            }
            if (c.type === 'tool_use') {
              const i = c.input ?? {}
              if (c.name === 'WebSearch') push({ kind: 'search', text: str(i.query, 200) })
              else if (c.name === 'WebFetch') push({ kind: 'fetch', text: str(i.url, 300) })
              else if (c.name === 'Read') push({ kind: 'read', text: str(i.file_path, 300) })
              else if (c.name === 'Glob' || c.name === 'Grep') push({ kind: 'read', text: str(i.pattern, 200) })
              else if (c.name === 'Write') push({ kind: 'write', text: str(i.file_path, 300).split(/[\\/]/).pop() ?? '' })
            }
          }
        }
        if (j.type === 'result') result = j
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
      child.stdin?.end(researchUserPrompt({ ...input, count: want }, data.leads.map((l) => l.name)))

      child.on('error', (e) => { active.delete(run.id); resolve({ added: 0, error: e.message }) })
      child.on('close', () => {
        active.delete(run.id)
        if (buf.trim()) onLine(buf.trim())
        if (run.status === 'cancelled') return resolve({ added: 0 })
        const r = result as typeof result
        if (!r) return resolve({ added: 0, error: (stderr.trim() || 'Claude stopped without an answer.').slice(0, 500) })
        if (r.is_error || r.subtype !== 'success') {
          const msg = String(r.result || stderr || 'Claude returned an error.')
          return resolve({ added: 0, error: AUTH_ERROR.test(msg) ? `AUTH: ${msg}` : msg.slice(0, 500) })
        }
        const parsed = extractJson<LeadsFile>(readIfExists(join(dir, 'leads.json')) ?? '') ?? extractJson<LeadsFile>(String(r.result ?? ''))
        if (!parsed?.leads?.length) return resolve({ added: 0, costUsd: r.total_cost_usd })

        // Add as we go, so a stopped or failed later batch keeps these leads.
        const seen = new Set(data.leads.flatMap((l) => [norm(l.name), norm(l.website)]).filter(Boolean))
        const now = Date.now()
        let added = 0
        for (const raw of parsed.leads) {
          const name = str(raw.name, 120)
          if (!name) continue
          const website = str(raw.website, 300)
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
          data.leads.push(lead)
          run.leadIds.push(lead.id)
          added++
        }
        resolve({ added, summary: str(parsed.summary, 800), assumptions: list(parsed.assumptions), costUsd: r.total_cost_usd })
      })
    })

  // Batches run one after another in the background; the caller gets the run id at once.
  // Read through a function: cancelRun changes status from outside this loop.
  const stopped = () => run.status === 'cancelled'
  ;(async () => {
    let error: string | undefined
    let cost = 0
    for (let b = 1; b <= batches; b++) {
      if (stopped()) break
      const want = Math.min(batchSize, target - run.leadIds.length)
      if (want <= 0) break
      run.batch = b
      run.phase = 0
      if (batches > 1) push({ kind: 'note', text: `Batch ${b} of ${batches}: looking for ${want} more companies` })
      const res = await runBatch(b, want)
      if (typeof res.costUsd === 'number') cost += res.costUsd
      if (b === 1 || !run.summary) { run.summary = res.summary || run.summary; run.assumptions = res.assumptions?.length ? res.assumptions : run.assumptions }
      save()
      notify()
      if (res.error) { error = res.error; break }
      if (res.added === 0 && !stopped()) {
        if (run.leadIds.length === 0) error = 'Claude finished but returned no leads. Try a broader location or industry.'
        else run.warning = `Claude found no more new companies after ${run.leadIds.length}. Try a broader location or industry for more.`
        break
      }
    }
    running.delete(run.id)
    run.costUsd = cost || undefined
    run.finishedAt = Date.now()
    if (!stopped()) {
      if (error && run.leadIds.length === 0) { run.status = 'failed'; run.error = error }
      else {
        run.status = 'done'
        run.phase = PHASES.length
        if (error) run.warning = `Stopped after ${run.leadIds.length} leads: ${error.replace(/^AUTH:\s*/, '')}`
        if (run.leadIds.length < target && !run.warning) run.warning = `Found ${run.leadIds.length} of the ${target} leads asked for.`
      }
    }
    save(true)
    notify()
  })()

  return run.id
}

export const hasActiveRun = () => running.size > 0
export const cancelAll = () => { for (const id of running) cancelRun(id) }
