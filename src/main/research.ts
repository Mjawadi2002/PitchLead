import { app } from 'electron'
import type { ChildProcess } from 'child_process'
import { randomUUID } from 'crypto'
import { join } from 'path'
import type { Lead, ResearchInput, Run, RunEvent } from '@shared/types'
import { PHASES } from '@shared/types'
import { AUTH_ERROR, extractJson, killTree, readIfExists, resolveClaude, spawnClaude, writeText } from './claude'
import { researchSystemPrompt, researchUserPrompt } from './prompts'
import { db, save } from './store'

const active = new Map<string, ChildProcess>()

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
  const child = active.get(id)
  if (child) killTree(child)
  const run = db.get().runs.find((r) => r.id === id)
  if (run && run.status === 'running') {
    run.status = 'cancelled'
    run.finishedAt = Date.now()
    save()
  }
}

export async function startRun(input: ResearchInput, notify: () => void): Promise<string> {
  const data = db.get()
  if ([...active.keys()].length) throw new Error('A research run is already in progress.')
  const settings = data.settings
  const path = await resolveClaude(settings)
  if (!path) throw new Error('Claude Code is not installed. Open Settings to set it up.')
  const apiKey = settings.mode === 'apikey' ? db.getApiKey() : null
  if (settings.mode === 'apikey' && !apiKey) throw new Error('Add your Anthropic API key in Settings, or switch to your Claude subscription.')

  const run: Run = {
    id: randomUUID(),
    title: titleFor(input),
    createdAt: Date.now(),
    status: 'running',
    input,
    leadIds: [],
    events: [],
    phase: 0
  }
  data.runs.unshift(run)
  settings.lastInput = input
  save()

  const dir = join(app.getPath('userData'), 'runs', run.id)
  const sysFile = join(dir, 'system.md')
  writeText(sysFile, researchSystemPrompt())

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

  let pending = false
  const push = (e: Omit<RunEvent, 't'>) => {
    run.events.push({ t: Date.now(), ...e })
    if (run.events.length > 1500) run.events.splice(0, run.events.length - 1500)
    if (!pending) {
      pending = true
      setTimeout(() => { pending = false; save(); notify() }, 120)
    }
  }
  push({ kind: 'note', text: settings.mode === 'apikey' ? 'Started with your API key' : 'Started with your Claude subscription' })

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
  child.stdin?.end(researchUserPrompt(input, data.leads.map((l) => l.name)))

  const finish = (status: Run['status'], error?: string) => {
    active.delete(run.id)
    if (run.status === 'cancelled') { save(true); notify(); return }
    run.status = status
    run.error = error
    run.finishedAt = Date.now()
    save(true)
    notify()
  }

  child.on('error', (e) => finish('failed', e.message))
  child.on('close', () => {
    if (buf.trim()) onLine(buf.trim())
    if (run.status === 'cancelled') return finish('cancelled')
    const r = result as typeof result
    if (!r) return finish('failed', (stderr.trim() || 'Claude stopped without an answer.').slice(0, 500))
    if (r.is_error || r.subtype !== 'success') {
      const msg = String(r.result || stderr || 'Claude returned an error.')
      return finish('failed', AUTH_ERROR.test(msg) ? `AUTH: ${msg}` : msg.slice(0, 500))
    }
    const fileText = readIfExists(join(dir, 'leads.json'))
    const parsed = extractJson<LeadsFile>(fileText ?? '') ?? extractJson<LeadsFile>(String(r.result ?? ''))
    if (!parsed?.leads?.length) return finish('failed', 'Claude finished but returned no leads. Try a broader location or industry.')

    const seen = new Set(data.leads.flatMap((l) => [norm(l.name), norm(l.website)]).filter(Boolean))
    const now = Date.now()
    for (const raw of parsed.leads) {
      const name = str(raw.name, 120)
      if (!name) continue
      const website = str(raw.website, 300)
      if (seen.has(norm(name)) || (website && seen.has(norm(website)))) continue
      seen.add(norm(name))
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
    }
    run.summary = str(parsed.summary, 800)
    run.assumptions = list(parsed.assumptions)
    run.costUsd = typeof r.total_cost_usd === 'number' ? r.total_cost_usd : undefined
    run.phase = PHASES.length
    finish('done')
  })

  return run.id
}

export const hasActiveRun = () => active.size > 0
export const cancelAll = () => { for (const id of active.keys()) cancelRun(id) }
