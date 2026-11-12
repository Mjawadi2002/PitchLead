import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron'
import { randomUUID } from 'crypto'
import { writeFileSync } from 'fs'
import { join } from 'path'
import type { Draft, Lead, Project, ResearchInput, Settings } from '@shared/types'
import { ask, claudeStatus, extractJson, openSignIn, AUTH_ERROR, LIMIT_ERROR } from './claude'
import { contactPrompt, draftPrompt, meetingPrompt, sequencePrompt } from './prompts'
import { deepen } from './fast'
import { cancelOutbox, checkReplies, queueSequence, sendTest, startMail, stopMail, testMailbox } from './mail'
import { noteLimit, usageReport } from './usage'
import { cancelAll, cancelRun, startRun } from './research'
import { db, flushNow, loadStore, save } from './store'

let win: BrowserWindow | null = null

function bg(): string {
  return nativeTheme.shouldUseDarkColors ? '#17171A' : '#FBFBFD'
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1320,
    height: 840,
    minWidth: 720,
    minHeight: 540,
    show: false,
    frame: false,
    backgroundColor: bg(),
    title: 'LeadPitch',
    icon: join(app.getAppPath(), 'build', 'icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true
    }
  })
  win.once('ready-to-show', () => win?.show())
  win.on('maximize', () => win?.webContents.send('win:maximized', true))
  win.on('unmaximize', () => win?.webContents.send('win:maximized', false))
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('http://localhost') && !url.startsWith('file://')) {
      e.preventDefault()
      if (/^https?:\/\//.test(url)) shell.openExternal(url)
    }
  })
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

const notify = () => win?.webContents.send('snapshot', db.snapshot())

function registerIpc(): void {
  // Window
  ipcMain.on('win:min', () => win?.minimize())
  ipcMain.on('win:max', () => (win?.isMaximized() ? win.unmaximize() : win?.maximize()))
  ipcMain.on('win:close', () => win?.close())
  ipcMain.handle('win:isMax', () => !!win?.isMaximized())

  // Data
  ipcMain.handle('snapshot:get', () => db.snapshot())

  ipcMain.handle('lead:update', (_e, id: string, patch: Partial<Lead>) => {
    const lead = db.get().leads.find((l) => l.id === id)
    if (!lead) return
    const { id: _ignore, ...rest } = patch
    if (rest.stage && rest.stage !== lead.stage) lead.stageChangedAt = Date.now()
    Object.assign(lead, rest, { updatedAt: Date.now() })
    save()
    notify()
  })

  ipcMain.handle('lead:add', (_e, partial: Partial<Lead>) => {
    const now = Date.now()
    const lead: Lead = {
      id: randomUUID(), runId: '', name: 'New company', website: '', industry: '', size: '', location: '',
      score: 5, scoreReason: 'Added by hand', decisionMaker: '', linkedin: '', email: '', phone: '', contactName: '', contactUrl: '', signal: '', why: [], valueProp: '',
      strategy: '', starters: [], stage: 'researched', notes: '', starred: false, createdAt: now, updatedAt: now,
      stageChangedAt: now,
      projectId: db.get().settings.activeProject !== 'all' ? db.get().settings.activeProject : db.get().projects[0]?.id,
      ...partial
    }
    db.get().leads.push(lead)
    save()
    notify()
    return lead.id
  })

  ipcMain.handle('lead:delete', (_e, ids: string[]) => {
    const d = db.get()
    const set = new Set(ids)
    d.leads = d.leads.filter((l) => !set.has(l.id))
    d.drafts = d.drafts.filter((x) => !set.has(x.leadId))
    save()
    notify()
  })

  ipcMain.handle('draft:save', (_e, draft: Draft) => {
    const d = db.get()
    const i = d.drafts.findIndex((x) => x.id === draft.id)
    const next = { ...draft, updatedAt: Date.now() }
    if (i >= 0) d.drafts[i] = next
    else d.drafts.push(next)
    save()
    notify()
  })

  ipcMain.handle('draft:generate', async (_e, o: { leadId: string; channel: Draft['channel']; lang: Draft['lang']; instruction?: string; step?: number }) => {
    const d = db.get()
    const lead = d.leads.find((l) => l.id === o.leadId)
    if (!lead) throw new Error('This lead no longer exists.')
    const step = o.step ?? 0
    const existing = d.drafts.find((x) => x.leadId === o.leadId && x.channel === o.channel && x.lang === o.lang && (x.step ?? 0) === step)
    const product = d.runs.find((r) => r.id === lead.runId)?.input.product ?? d.settings.lastInput?.product ?? ''
    try {
      const text = await ask({
        settings: d.settings,
        apiKey: db.getApiKey(),
        prompt: draftPrompt({ lead, product, sender: d.settings.senderName, channel: o.channel, lang: o.lang, previous: existing?.body, instruction: o.instruction }),
        model: 'sonnet'
      })
      const j = extractJson<{ subject?: string; body?: string }>(text)
      const draft: Draft = {
        id: existing?.id ?? randomUUID(),
        leadId: lead.id,
        channel: o.channel,
        lang: o.lang,
        step,
        subject: String(j?.subject ?? '').trim() || existing?.subject || '',
        body: String(j?.body ?? text).trim(),
        updatedAt: Date.now()
      }
      const i = d.drafts.findIndex((x) => x.id === draft.id)
      if (i >= 0) d.drafts[i] = draft
      else d.drafts.push(draft)
      save()
      notify()
      return draft
    } catch (e) {
      const msg = (e as Error).message
      if (LIMIT_ERROR.test(msg)) noteLimit(msg)
      throw new Error(AUTH_ERROR.test(msg) ? `AUTH: ${msg}` : msg)
    }
  })

  // Contact details for leads that have none: one web lookup per company, three at a time.
  ipcMain.handle('lead:findContact', async (_e, ids: string[]) => {
    const d = db.get()
    const queue = d.leads.filter((l) => ids.includes(l.id))
    let found = 0
    let failed = ''
    const clean = (v: unknown, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
    const worker = async () => {
      while (queue.length) {
        const lead = queue.shift()!
        try {
          const text = await ask({ settings: d.settings, apiKey: db.getApiKey(), prompt: contactPrompt(lead), model: 'sonnet', tools: ['WebSearch', 'WebFetch'], timeoutMs: 240000 })
          const j = extractJson<Record<string, string>>(text) ?? {}
          const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(j.email)) ? clean(j.email) : ''
          const phone = /\d{5,}/.test(clean(j.phone).replace(/\D/g, '')) ? clean(j.phone, 40) : ''
          const patch: Partial<Lead> = {
            email: lead.email || email,
            phone: lead.phone || phone,
            contactName: lead.contactName || clean(j.contactName, 120),
            contactUrl: lead.contactUrl || (/^https?:\/\//.test(clean(j.contactUrl)) ? clean(j.contactUrl) : ''),
            linkedin: lead.linkedin || (/linkedin\.com\//i.test(clean(j.linkedin)) ? clean(j.linkedin) : ''),
            website: lead.website || (/^https?:\/\//.test(clean(j.website)) ? clean(j.website) : ''),
            updatedAt: Date.now()
          }
          if (patch.email || patch.phone || patch.contactUrl) found++
          Object.assign(lead, patch)
          save()
          notify()
        } catch (e) {
          const msg = (e as Error).message
          if (LIMIT_ERROR.test(msg)) noteLimit(msg)
          failed = AUTH_ERROR.test(msg) ? `AUTH: ${msg}` : msg
          if (AUTH_ERROR.test(msg) || LIMIT_ERROR.test(msg)) queue.length = 0
        }
      }
    }
    await Promise.all([worker(), worker(), worker()])
    return { found, failed }
  })

  ipcMain.handle('usage:get', () => usageReport())

  // Research
  ipcMain.handle('run:start', (_e, input: ResearchInput) => startRun(input, notify).then((id) => { notify(); return id }))
  ipcMain.handle('run:cancel', (_e, id: string) => { cancelRun(id); notify() })
  ipcMain.handle('run:delete', (_e, id: string) => {
    const d = db.get()
    d.runs = d.runs.filter((r) => r.id !== id || r.status === 'running')
    save()
    notify()
  })

  // Settings
  ipcMain.handle('settings:update', (_e, patch: Partial<Settings>) => {
    const s = db.get().settings
    const prevMail = s.mail
    const prevTour = s.tour
    Object.assign(s, patch)
    if (patch.titlebar) s.titlebar = { ...s.titlebar, ...patch.titlebar }
    if (patch.mail) s.mail = { ...prevMail, ...patch.mail }
    if (patch.tour) s.tour = { ...prevTour, ...patch.tour }
    if (patch.theme) nativeTheme.themeSource = patch.theme
    save()
    notify()
    return s
  })
  ipcMain.handle('apikey:set', (_e, key: string | null) => {
    const k = key?.trim() || null
    if (k && !/^sk-ant-/.test(k)) throw new Error('That does not look like an Anthropic API key. Keys start with sk-ant-.')
    db.setApiKey(k)
    notify()
  })

  // Claude
  ipcMain.handle('claude:status', () => claudeStatus(db.get().settings, !!db.getApiKey()))
  ipcMain.handle('claude:signin', () => openSignIn(db.get().settings))
  ipcMain.handle('claude:test', async () => {
    try {
      const t0 = Date.now()
      const out = await ask({ settings: db.get().settings, apiKey: db.getApiKey(), prompt: 'Reply with the single word: ready', model: 'haiku', timeoutMs: 60000 })
      return { ok: true, message: `Claude answered in ${((Date.now() - t0) / 1000).toFixed(1)} s: ${out.trim().slice(0, 40)}` }
    } catch (e) {
      const msg = (e as Error).message
      return { ok: false, auth: AUTH_ERROR.test(msg), message: msg.slice(0, 300) }
    }
  })

  // Files
  ipcMain.handle('dialog:folder', async () => {
    const r = await dialog.showOpenDialog(win!, { title: 'Choose your product folder', properties: ['openDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  })
  ipcMain.handle('dialog:claude', async () => {
    const r = await dialog.showOpenDialog(win!, {
      title: 'Locate Claude Code',
      properties: ['openFile'],
      filters: process.platform === 'win32' ? [{ name: 'Programs', extensions: ['exe', 'cmd'] }] : []
    })
    return r.canceled ? null : r.filePaths[0]
  })
  ipcMain.handle('export:csv', async (_e, ids: string[], format: 'full' | 'outreach' = 'full') => {
    const leads = db.get().leads.filter((l) => ids.includes(l.id))
    const r = await dialog.showSaveDialog(win!, {
      title: format === 'outreach' ? 'Export for Instantly or Smartlead' : 'Export leads',
      defaultPath: `leadpitch-${format === 'outreach' ? 'outreach' : 'leads'}-${new Date().toISOString().slice(0, 10)}.csv`,
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    })
    if (r.canceled || !r.filePath) return null
    const cell = (v: unknown) => {
      const s = Array.isArray(v) ? v.join(' | ') : String(v ?? '')
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    let csv: string
    if (format === 'outreach') {
      // Column names Instantly and Smartlead recognise without mapping; the rest arrive as custom variables.
      const cols = ['email', 'first_name', 'last_name', 'company', 'title', 'website', 'linkedin_url', 'phone', 'location', 'signal', 'reason', 'opener', 'score']
      const rows = leads.map((l) => {
        const [first = '', ...rest] = (l.contactName || '').split(/\s+/)
        return [l.email, first, rest.join(' '), l.name, l.decisionMaker, l.website, l.linkedin, l.phone, l.location, l.signal, l.scoreReason, l.starters[0] ?? '', l.score]
      })
      csv = [cols.join(','), ...rows.map((row) => row.map(cell).join(','))].join('\r\n')
    } else {
      const cols: (keyof Lead)[] = ['name', 'website', 'industry', 'size', 'location', 'address', 'score', 'scoreReason', 'decisionMaker', 'contactName', 'email', 'phone', 'contactUrl', 'linkedin', 'socials', 'tech', 'source', 'signal', 'why', 'valueProp', 'strategy', 'starters', 'stage', 'notes']
      csv = [cols.join(','), ...leads.map((l) => cols.map((c) => cell(l[c])).join(','))].join('\r\n')
    }
    writeFileSync(r.filePath, '﻿' + csv, 'utf8')
    return r.filePath
  })

  // ---------- Projects ----------
  ipcMain.handle('project:create', (_e, p: Omit<Project, 'id' | 'createdAt' | 'color'>) => {
    const d = db.get()
    const project: Project = { ...p, id: randomUUID(), color: d.projects.length % 7, createdAt: Date.now() }
    d.projects.push(project)
    d.settings.activeProject = project.id
    save()
    notify()
    return project.id
  })
  ipcMain.handle('project:update', (_e, id: string, patch: Partial<Project>) => {
    const p = db.get().projects.find((x) => x.id === id)
    if (!p) return
    Object.assign(p, patch, { id: p.id })
    save()
    notify()
  })
  // Deleting a project removes its leads, runs and drafts, and cancels its scheduled mail.
  ipcMain.handle('project:delete', (_e, id: string) => {
    const d = db.get()
    const leadIds = new Set(d.leads.filter((l) => l.projectId === id).map((l) => l.id))
    d.projects = d.projects.filter((p) => p.id !== id)
    d.leads = d.leads.filter((l) => !leadIds.has(l.id))
    d.runs = d.runs.filter((r) => r.projectId !== id || r.status === 'running')
    d.drafts = d.drafts.filter((x) => !leadIds.has(x.leadId))
    for (const o of d.outbox) if (leadIds.has(o.leadId) && o.status === 'scheduled') o.status = 'cancelled'
    if (d.settings.activeProject === id) d.settings.activeProject = d.projects[0]?.id ?? 'all'
    save()
    notify()
  })

  // ---------- Mail ----------
  ipcMain.handle('mail:setPassword', (_e, pw: string | null) => {
    db.setMailPassword(pw?.replace(/\s+/g, '') || null)
    notify()
  })
  ipcMain.handle('mail:test', () => testMailbox())
  ipcMain.handle('mail:sendTest', () => sendTest())
  ipcMain.handle('mail:queue', (_e, o: Parameters<typeof queueSequence>[0]) => queueSequence(o).then((r) => { notify(); return r }))
  ipcMain.handle('mail:cancel', (_e, ids: string[]) => { cancelOutbox(ids); notify() })
  ipcMain.handle('mail:checkReplies', () => checkReplies().then((r) => { notify(); return r }))

  // ---------- Sequences, deep research, meeting briefs ----------
  const leadProduct = (lead: Lead) => db.get().runs.find((r) => r.id === lead.runId)?.input.product ?? db.get().settings.lastInput?.product ?? ''
  const claudeError = (e: unknown) => {
    const msg = (e as Error).message
    if (LIMIT_ERROR.test(msg)) noteLimit(msg)
    return new Error(AUTH_ERROR.test(msg) ? `AUTH: ${msg}` : msg)
  }
  ipcMain.handle('draft:sequence', async (_e, o: { leadId: string; lang: Draft['lang'] }) => {
    const d = db.get()
    const lead = d.leads.find((l) => l.id === o.leadId)
    if (!lead) throw new Error('This lead no longer exists.')
    let text: string
    try {
      text = await ask({ settings: d.settings, apiKey: db.getApiKey(), prompt: sequencePrompt({ lead, product: leadProduct(lead), sender: d.settings.mail.fromName || d.settings.senderName, lang: o.lang, days: d.settings.mail.followUpDays, optOut: d.settings.mail.optOutLine }), model: 'sonnet', timeoutMs: 180000 })
    } catch (e) {
      throw claudeError(e)
    }
    const j = extractJson<{ emails?: { subject?: string; body?: string }[]; linkedin?: string }>(text)
    if (!j?.emails?.length) throw new Error('Claude returned no sequence. Try again.')
    const put = (channel: Draft['channel'], step: number, subject: string, body: string) => {
      const existing = d.drafts.find((x) => x.leadId === lead.id && x.channel === channel && x.lang === o.lang && (x.step ?? 0) === step)
      const draft: Draft = { id: existing?.id ?? randomUUID(), leadId: lead.id, channel, lang: o.lang, step, subject, body, updatedAt: Date.now() }
      if (existing) Object.assign(existing, draft)
      else d.drafts.push(draft)
    }
    j.emails.slice(0, 3).forEach((m, i) => put('email', i, String(m.subject ?? '').trim(), String(m.body ?? '').trim()))
    if (j.linkedin) put('linkedin', 0, '', String(j.linkedin).trim())
    save()
    notify()
  })
  ipcMain.handle('lead:deepen', async (_e, id: string) => {
    const d = db.get()
    const lead = d.leads.find((l) => l.id === id)
    if (!lead) throw new Error('This lead no longer exists.')
    try {
      await deepen(lead, d.runs.find((r) => r.id === lead.runId)?.input ?? d.settings.lastInput, d.settings, db.getApiKey())
    } catch (e) {
      throw claudeError(e)
    }
    save()
    notify()
  })
  ipcMain.handle('lead:meeting', async (_e, id: string) => {
    const d = db.get()
    const lead = d.leads.find((l) => l.id === id)
    if (!lead) throw new Error('This lead no longer exists.')
    try {
      lead.meetingBrief = (await ask({ settings: d.settings, apiKey: db.getApiKey(), prompt: meetingPrompt(lead, leadProduct(lead), d.settings.senderName), model: 'sonnet', timeoutMs: 180000 })).trim()
    } catch (e) {
      throw claudeError(e)
    }
    lead.updatedAt = Date.now()
    save()
    notify()
  })
  ipcMain.handle('shell:open', (_e, url: string) => {
    if (/^(https?:\/\/|mailto:|tel:)/.test(url)) return shell.openExternal(url)
  })
  ipcMain.handle('shell:reveal', (_e, path: string) => shell.showItemInFolder(path))
}

app.whenReady().then(() => {
  loadStore()
  nativeTheme.themeSource = db.get().settings.theme
  registerIpc()
  createWindow()
  startMail({ notify, toast: (text) => win?.webContents.send('toast', text) })
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('before-quit', () => { cancelAll(); stopMail(); flushNow() })
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
