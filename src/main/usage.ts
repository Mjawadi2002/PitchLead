import { createReadStream, existsSync, readdirSync, statSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { createInterface } from 'readline'
import type { UsageReport, UsageWindow } from '@shared/types'
import { db, save } from './store'

/**
 * Claude usage from Claude Code's own session logs (~/.claude/projects/**.jsonl).
 * Claude subscriptions meter use in 5-hour windows that start with the first message.
 * Anthropic does not publish exact plan limits, so the meter compares the current window
 * with the person's busiest window in the last 30 days, and shows a real limit message
 * when Claude returns one.
 */

interface Entry { t: number; tokens: number; lp: boolean }

const WINDOW = 5 * 3600_000
const DAY = 24 * 3600_000
const cache = new Map<string, { mtime: number; size: number; entries: Entry[] }>()
let limitHit: { at: number; message: string } | undefined

/** Records the tokens of one Claude reply that LeadPitch made (from the result's usage block). */
export function recordUsage(u: any, model?: string, cost?: number): void {
  if (!u) return
  const tokens = (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_creation_input_tokens || 0)
  if (!tokens) return
  const log = db.get().usageLog
  log.push(model ? { t: Date.now(), tokens, m: model, ...(cost ? { c: Math.round(cost * 10000) / 10000 } : {}) } : { t: Date.now(), tokens })
  const cutoff = Date.now() - 31 * DAY
  while (log.length && log[0].t < cutoff) log.shift()
  save()
}

/** Records one Claude reply per model it used (Claude Code reports each model separately). */
export function recordModelUsage(modelUsage: Record<string, any> | undefined, fallback: any): void {
  const entries = Object.entries(modelUsage ?? {})
  if (!entries.length) return recordUsage(fallback)
  for (const [model, u] of entries) {
    recordUsage({ input_tokens: u?.inputTokens, output_tokens: u?.outputTokens, cache_creation_input_tokens: u?.cacheCreationInputTokens }, model, u?.costUSD)
  }
}

export function noteLimit(message: string): void {
  limitHit = { at: Date.now(), message: message.slice(0, 300) }
}

/** Your real plan usage, as Claude reports it with every reply (the same numbers as /usage in Claude Code). */
let plan: UsageReport['plan'] | undefined

export function notePlanLimits(info: any): void {
  if (!info || typeof info !== 'object') return
  const win = (w: any) => (w && Number.isFinite(Number(w.utilization)) ? { pct: Math.round(Number(w.utilization) * 100), resetsAt: Number(w.resetsAt) * 1000 || 0 } : undefined)
  const fiveHour = win(info.unifiedWindows?.five_hour) ?? (info.rateLimitType === 'five_hour' ? win({ utilization: info.utilization, resetsAt: info.resetsAt }) : undefined)
  const sevenDay = win(info.unifiedWindows?.seven_day)
  if (!fiveHour && !sevenDay) return
  plan = { fiveHour: fiveHour ?? plan?.fiveHour, sevenDay: sevenDay ?? plan?.sevenDay, at: Date.now() }
  // Kept, so the meter shows the last real figure as soon as LeadPitch opens.
  db.get().planUsage = plan
  save()
  if (info.status === 'rejected') noteLimit(`Claude usage limit reached. It resets at ${new Date((Number(info.resetsAt) || 0) * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`)
}

export const planCheckedAt = () => plan?.at ?? 0

function projectsDir(): string {
  const base = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
  return join(base, 'projects')
}

async function readFile(file: string, lp: boolean): Promise<Entry[]> {
  const out: Entry[] = []
  const seen = new Set<string>()
  const rl = createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity })
  for await (const line of rl) {
    if (!line.includes('"usage"')) continue
    try {
      const j = JSON.parse(line)
      const u = j.message?.usage
      if (j.type !== 'assistant' || !u) continue
      const id = j.message?.id ? `${j.message.id}:${j.requestId ?? ''}` : ''
      if (id) { if (seen.has(id)) continue; seen.add(id) }
      const tokens = (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_creation_input_tokens || 0)
      const t = Date.parse(j.timestamp)
      if (tokens > 0 && Number.isFinite(t)) out.push({ t, tokens, lp })
    } catch { /* skip partial lines */ }
  }
  return out
}

export async function usageReport(): Promise<UsageReport> {
  const now = Date.now()
  plan ??= db.get().planUsage
  const dir = projectsDir()
  const entries: Entry[] = []
  if (existsSync(dir)) {
    for (const project of readdirSync(dir)) {
      // LeadPitch runs and drafts live under its own app data folder.
      const lp = /lead-?pitch|-runs-[0-9a-f]{8}-/i.test(project)
      let files: string[] = []
      try { files = readdirSync(join(dir, project)).filter((f) => f.endsWith('.jsonl')).map((f) => join(dir, project, f)) } catch { continue }
      for (const file of files) {
        let st
        try { st = statSync(file) } catch { continue }
        if (now - st.mtimeMs > 31 * DAY) continue
        const hit = cache.get(file)
        if (hit && hit.mtime === st.mtimeMs && hit.size === st.size) { entries.push(...hit.entries); continue }
        const parsed = await readFile(file, lp)
        cache.set(file, { mtime: st.mtimeMs, size: st.size, entries: parsed })
        entries.push(...parsed)
      }
    }
  }
  for (const e of db.get().usageLog ?? []) if (now - e.t < 31 * DAY) entries.push({ t: e.t, tokens: e.tokens, lp: true })
  entries.sort((a, b) => a.t - b.t)

  // Group into 5-hour windows, each starting at the hour of its first message.
  const windows: UsageWindow[] = []
  for (const e of entries) {
    const w = windows[windows.length - 1]
    if (!w || e.t >= w.end) {
      const start = Math.floor(e.t / 3600_000) * 3600_000
      windows.push({ start, end: start + WINDOW, tokens: 0, messages: 0, leadpitchTokens: 0 })
    }
    const cur = windows[windows.length - 1]
    cur.tokens += e.tokens
    cur.messages++
    if (e.lp) cur.leadpitchTokens += e.tokens
  }
  const last = windows[windows.length - 1]
  const current = last && now < last.end ? last : null
  const recent = windows.filter((w) => now - w.start < 30 * DAY)
  const peakTokens = Math.max(0, ...recent.map((w) => w.tokens))
  const week = entries.filter((e) => now - e.t < 7 * DAY)
  if (limitHit && now - limitHit.at > WINDOW) limitHit = undefined

  return {
    current,
    peakTokens,
    weekTokens: week.reduce((s, e) => s + e.tokens, 0),
    weekMessages: week.length,
    limitHit,
    // A window that has reset since the last reply starts again at 0.
    plan: plan && {
      fiveHour: plan.fiveHour && (plan.fiveHour.resetsAt && plan.fiveHour.resetsAt < now ? { pct: 0, resetsAt: 0 } : plan.fiveHour),
      sevenDay: plan.sevenDay && (plan.sevenDay.resetsAt && plan.sevenDay.resetsAt < now ? { pct: 0, resetsAt: 0 } : plan.sevenDay),
      at: plan.at
    },
    checkedAt: now
  }
}


/** The plan figures and limit notice as of now, without reading any logs. Fast enough for every refresh. */
export function planNow(): Pick<UsageReport, 'plan' | 'limitHit'> {
  const now = Date.now()
  plan ??= db.get().planUsage
  if (limitHit && now - limitHit.at > WINDOW) limitHit = undefined
  const fresh = (w?: { pct: number; resetsAt: number }) => w && (w.resetsAt && w.resetsAt < now ? { pct: 0, resetsAt: 0 } : w)
  return { limitHit, plan: plan && { fiveHour: fresh(plan.fiveHour), sevenDay: fresh(plan.sevenDay), at: plan.at } }
}
