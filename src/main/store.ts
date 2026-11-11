import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import { DEFAULT_SETTINGS, type Draft, type Lead, type Run, type Settings, type Snapshot } from '@shared/types'

interface Data {
  version: 1
  leads: Lead[]
  runs: Run[]
  drafts: Draft[]
  settings: Settings
  apiKey?: string // encrypted with safeStorage, base64
}

const dir = () => app.getPath('userData')
const file = () => join(dir(), 'leadpitch.json')

let data: Data
let timer: NodeJS.Timeout | null = null

export function loadStore(): void {
  mkdirSync(dir(), { recursive: true })
  const empty: Data = { version: 1, leads: [], runs: [], drafts: [], settings: structuredClone(DEFAULT_SETTINGS) }
  if (!existsSync(file())) {
    data = empty
    return
  }
  try {
    const raw = JSON.parse(readFileSync(file(), 'utf8')) as Partial<Data>
    data = {
      ...empty,
      ...raw,
      settings: {
        ...DEFAULT_SETTINGS,
        ...(raw.settings ?? {}),
        titlebar: { ...DEFAULT_SETTINGS.titlebar, ...(raw.settings?.titlebar ?? {}) }
      }
    }
    // A run cannot still be running after a restart.
    for (const r of data.runs) {
      if (r.status === 'running') {
        r.status = 'failed'
        r.error = 'LeadPitch was closed while this run was in progress.'
      }
    }
  } catch {
    // Keep the unreadable file for recovery and start clean.
    try { renameSync(file(), file() + '.broken-' + Date.now()) } catch { /* ignore */ }
    data = empty
  }
}

/** Atomic write: write a temp file, then rename over the real one. */
function flush(): void {
  timer = null
  const tmp = file() + '.tmp'
  writeFileSync(tmp, JSON.stringify(data))
  try {
    renameSync(tmp, file())
  } catch {
    // Windows can refuse rename over a locked file; fall back to direct write.
    writeFileSync(file(), JSON.stringify(data))
    try { unlinkSync(tmp) } catch { /* ignore */ }
  }
}

export function save(now = false): void {
  if (timer) clearTimeout(timer)
  if (now) flush()
  else timer = setTimeout(flush, 250)
}

export function flushNow(): void {
  if (timer) { clearTimeout(timer); flush() }
}

export const db = {
  get: () => data,
  snapshot(): Snapshot {
    return {
      leads: data.leads,
      runs: data.runs.map((r) => ({ ...r, events: r.events.slice(-400) })),
      drafts: data.drafts,
      settings: data.settings,
      hasApiKey: !!data.apiKey
    }
  },
  setApiKey(key: string | null): void {
    if (!key) delete data.apiKey
    else if (safeStorage.isEncryptionAvailable()) data.apiKey = safeStorage.encryptString(key).toString('base64')
    else throw new Error('This computer cannot encrypt the key. It was not saved.')
    save(true)
  },
  getApiKey(): string | null {
    if (!data.apiKey) return null
    try { return safeStorage.decryptString(Buffer.from(data.apiKey, 'base64')) } catch { return null }
  }
}
