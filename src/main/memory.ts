import { app } from 'electron'
import { createHash } from 'crypto'
import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { MemoryStats, ResearchInput } from '@shared/types'
import type { SiteFacts } from './sources/website'

/**
 * What LeadPitch has already paid for, kept so it is not paid for twice.
 * Stored next to the main data in memory.json, separate so it can be cleared on its own.
 *   sites    website reads by domain (plain HTTP, but slow)          14 days
 *   lookups  a company's website and phone from Claude search         60 days
 *   scores   Claude's score for a company under one project's brief   30 days
 *   lists    companies Claude listed for an industry and location      7 days
 *   briefs   product summaries read from a product folder             until the folder changes
 */

interface Entry<T> { v: T; t: number }
export interface Lookup { website: string; phone: string; social: string; note: string }

interface Mem {
  sites: Record<string, Entry<SiteFacts>>
  lookups: Record<string, Entry<Lookup>>
  scores: Record<string, Entry<any>>
  lists: Record<string, Entry<any[]>>
  briefs: Record<string, Entry<string>>
  savedCalls: number
}

const DAY = 86400000
const TTL = { sites: 14 * DAY, lookups: 60 * DAY, scores: 30 * DAY, lists: 7 * DAY, briefs: 365 * DAY }
const FAILED_SITE_TTL = 2 * DAY

const file = () => join(app.getPath('userData'), 'memory.json')
const empty = (): Mem => ({ sites: {}, lookups: {}, scores: {}, lists: {}, briefs: {}, savedCalls: 0 })

let mem: Mem | null = null
let timer: NodeJS.Timeout | null = null

function load(): Mem {
  if (mem) return mem
  try {
    mem = existsSync(file()) ? { ...empty(), ...JSON.parse(readFileSync(file(), 'utf8')) } : empty()
  } catch {
    mem = empty()
  }
  prune(mem!)
  return mem!
}

function prune(m: Mem): void {
  const now = Date.now()
  for (const k of Object.keys(TTL) as (keyof typeof TTL)[]) {
    const bucket = m[k] as Record<string, Entry<unknown>>
    for (const [key, e] of Object.entries(bucket)) if (now - e.t > TTL[k]) delete bucket[key]
  }
  for (const [key, e] of Object.entries(m.sites)) if (!e.v.ok && now - e.t > FAILED_SITE_TTL) delete m.sites[key]
}

function persist(): void {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    if (!mem) return
    const tmp = file() + '.tmp'
    try {
      writeFileSync(tmp, JSON.stringify(mem))
      renameSync(tmp, file())
    } catch {
      try { writeFileSync(file(), JSON.stringify(mem)) } catch { /* memory is optional */ }
    }
  }, 500)
}

export const key = (...parts: string[]) => parts.map((p) => (p ?? '').toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/[^a-z0-9؀-ۿ]/g, '')).join('|')
const hash = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 12)

/** Scores depend on what is sold and to whom. Editing those starts fresh scores. */
export const briefKey = (input: ResearchInput) =>
  hash([input.product, input.folder, input.industry, input.size, input.pains, input.tech].map((s) => (s ?? '').trim().toLowerCase()).join('\n'))

export const memory = {
  get<K extends 'sites' | 'lookups' | 'scores' | 'lists' | 'briefs'>(bucket: K, k: string): Mem[K][string]['v'] | undefined {
    return load()[bucket][k]?.v as Mem[K][string]['v'] | undefined
  },
  set<K extends 'sites' | 'lookups' | 'scores' | 'lists' | 'briefs'>(bucket: K, k: string, v: Mem[K][string]['v']): void {
    ;(load()[bucket] as Record<string, Entry<unknown>>)[k] = { v, t: Date.now() }
    persist()
  },
  /** Counts Claude calls the memory made unnecessary. */
  saved(n: number): void {
    if (n <= 0) return
    load().savedCalls += n
    persist()
  },
  stats(): MemoryStats {
    const m = load()
    let bytes = 0
    try { bytes = existsSync(file()) ? statSync(file()).size : 0 } catch { /* ignore */ }
    return {
      sites: Object.keys(m.sites).length,
      lookups: Object.keys(m.lookups).length,
      scores: Object.keys(m.scores).length,
      lists: Object.keys(m.lists).length,
      briefs: Object.keys(m.briefs).length,
      savedCalls: m.savedCalls,
      bytes
    }
  },
  clear(): void {
    mem = empty()
    persist()
  },
  flush(): void {
    if (timer && mem) {
      clearTimeout(timer)
      timer = null
      try { writeFileSync(file(), JSON.stringify(mem)) } catch { /* ignore */ }
    }
  }
}
