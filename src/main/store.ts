import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { DEFAULT_MAIL, DEFAULT_SETTINGS, type Draft, type Lead, type Project, type MailStatus, type OutboxItem, type Run, type Settings, type Snapshot } from '@shared/types'

interface Data {
  version: 1
  projects: Project[]
  leads: Lead[]
  runs: Run[]
  drafts: Draft[]
  outbox: OutboxItem[]
  /** Tokens per Claude reply that LeadPitch made, for the usage meter. Claude Code keeps no log for these. */
  usageLog: { t: number; tokens: number; m?: string; c?: number }[]
  settings: Settings
  apiKey?: string // encrypted with safeStorage, base64
  mailPassword?: string // encrypted with safeStorage, base64
}

/** A short project name from a product description: "Saleside is an AI coach..." gives "Saleside". */
export function shortName(product: string): string {
  const first = product.trim().split('\n')[0]
  const head = first.split(/:|\s[-–—]\s|\s(?:is|are|helps|lets|makes|est|aide)\s|,|\./i)[0].trim()
  const words = head.split(/\s+/).filter(Boolean).slice(0, 3).join(' ')
  return words.slice(0, 28).trim() || 'My first project'
}

/** Live mailbox state, kept in memory and sent with every snapshot. */
export const mailStatus: MailStatus = { connected: false, sentToday: 0 }

/** Whether LeadPitch's own LinkedIn window is signed in. Set by linkedin.ts. */
export const linkedinState = { connected: false }

const startOfDay = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime() }
export const linkedinSentToday = () => data.leads.filter((l) => (l.linkedinSentAt ?? 0) >= startOfDay()).length

const dir = () => app.getPath('userData')
const file = () => join(dir(), 'leadpitch.json')

let data: Data
let timer: NodeJS.Timeout | null = null

export function loadStore(): void {
  mkdirSync(dir(), { recursive: true })
  const empty: Data = { version: 1, projects: [], leads: [], runs: [], drafts: [], outbox: [], usageLog: [], settings: structuredClone(DEFAULT_SETTINGS) }
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
        titlebar: { ...DEFAULT_SETTINGS.titlebar, ...(raw.settings?.titlebar ?? {}) },
        mail: { ...DEFAULT_MAIL, ...(raw.settings?.mail ?? {}) },
        tour: { ...DEFAULT_SETTINGS.tour, ...(raw.settings?.tour ?? {}) },
        models: { ...DEFAULT_SETTINGS.models, ...(raw.settings?.models ?? {}) },
        fallback: { ...DEFAULT_SETTINGS.fallback, ...(raw.settings?.fallback ?? {}) },
        linkedin: { ...DEFAULT_SETTINGS.linkedin, ...(raw.settings?.linkedin ?? {}) }
      }
    }
    data.projects ??= []
    // Leads from before projects existed go into a first project built from the last search.
    if (!data.projects.length && (data.leads.length || data.runs.length)) {
      const li = data.settings.lastInput
      const p: Project = {
        id: randomUUID(), name: li?.product ? shortName(li.product) : 'My first project',
        offerType: 'product', product: li?.product ?? '', folder: li?.folder ?? '', industry: li?.industry ?? '', location: li?.location ?? '',
        size: li?.size ?? '', pains: li?.pains ?? '', tech: li?.tech ?? '', color: 0, createdAt: Date.now()
      }
      data.projects.push(p)
      for (const l of data.leads) l.projectId ??= p.id
      for (const r of data.runs) r.projectId ??= p.id
    }
    // Projects named by the first version of the migration got the whole first sentence; shorten those.
    for (const p of data.projects) {
      const legacy = p.product.split(/[:.\n]/)[0].trim().slice(0, 40)
      if (p.product && p.name === legacy && p.name.length > 24) p.name = shortName(p.product)
    }
    data.outbox ??= []
    data.usageLog ??= []
    // Mail that was mid-send when the app closed is retried.
    for (const o of data.outbox) if (o.status === 'sending') o.status = 'scheduled'
    // Leads saved before contact details existed get empty fields.
    for (const l of data.leads) {
      l.email ??= ''
      l.phone ??= ''
      l.contactName ??= ''
      l.contactUrl ??= ''
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
      projects: data.projects,
      leads: data.leads,
      runs: data.runs.map((r) => ({ ...r, events: r.events.slice(-400) })),
      drafts: data.drafts,
      outbox: data.outbox.slice(-1000),
      settings: data.settings,
      hasApiKey: !!data.apiKey,
      hasMailPassword: !!data.mailPassword,
      mailStatus: { ...mailStatus },
      linkedinStatus: { connected: linkedinState.connected, sentToday: linkedinSentToday() }
    }
  },
  setApiKey(key: string | null): void {
    if (!key) delete data.apiKey
    else if (safeStorage.isEncryptionAvailable()) data.apiKey = safeStorage.encryptString(key).toString('base64')
    else throw new Error('This computer cannot encrypt the key. It was not saved.')
    save(true)
  },
  setMailPassword(pw: string | null): void {
    if (!pw) delete data.mailPassword
    else if (safeStorage.isEncryptionAvailable()) data.mailPassword = safeStorage.encryptString(pw).toString('base64')
    else throw new Error('This computer cannot encrypt the password. It was not saved.')
    save(true)
  },
  getMailPassword(): string | null {
    if (!data.mailPassword) return null
    try { return safeStorage.decryptString(Buffer.from(data.mailPassword, 'base64')) } catch { return null }
  },
  getApiKey(): string | null {
    if (!data.apiKey) return null
    try { return safeStorage.decryptString(Buffer.from(data.apiKey, 'base64')) } catch { return null }
  }
}
