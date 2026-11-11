import { createReadStream, existsSync, readdirSync, statSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { createInterface } from 'readline'
import type { UsageReport, UsageWindow } from '@shared/types'

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

export function noteLimit(message: string): void {
  limitHit = { at: Date.now(), message: message.slice(0, 300) }
}

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
    checkedAt: now
  }
}

