import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron'
import { randomUUID } from 'crypto'
import { writeFileSync } from 'fs'
import { join } from 'path'
import type { Draft, Lead, ResearchInput, Settings } from '@shared/types'
import { ask, claudeStatus, extractJson, openSignIn, AUTH_ERROR } from './claude'
import { draftPrompt } from './prompts'
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
    minWidth: 940,
    minHeight: 620,
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
      score: 5, scoreReason: 'Added by hand', decisionMaker: '', linkedin: '', signal: '', why: [], valueProp: '',
      strategy: '', starters: [], stage: 'researched', notes: '', starred: false, createdAt: now, updatedAt: now,
      stageChangedAt: now, ...partial
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

  ipcMain.handle('draft:generate', async (_e, o: { leadId: string; channel: Draft['channel']; lang: Draft['lang']; instruction?: string }) => {
    const d = db.get()
    const lead = d.leads.find((l) => l.id === o.leadId)
    if (!lead) throw new Error('This lead no longer exists.')
    const existing = d.drafts.find((x) => x.leadId === o.leadId && x.channel === o.channel && x.lang === o.lang)
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
        subject: String(j?.subject ?? '').trim(),
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
      throw new Error(AUTH_ERROR.test(msg) ? `AUTH: ${msg}` : msg)
    }
  })

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
    Object.assign(s, patch)
    if (patch.titlebar) s.titlebar = { ...s.titlebar, ...patch.titlebar }
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
  ipcMain.handle('export:csv', async (_e, ids: string[]) => {
    const leads = db.get().leads.filter((l) => ids.includes(l.id))
    const r = await dialog.showSaveDialog(win!, {
      title: 'Export leads',
      defaultPath: `leadpitch-leads-${new Date().toISOString().slice(0, 10)}.csv`,
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    })
    if (r.canceled || !r.filePath) return null
    const cols: (keyof Lead)[] = ['name', 'website', 'industry', 'size', 'location', 'score', 'scoreReason', 'decisionMaker', 'linkedin', 'signal', 'why', 'valueProp', 'strategy', 'starters', 'stage', 'notes']
    const cell = (v: unknown) => {
      const s = Array.isArray(v) ? v.join(' | ') : String(v ?? '')
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const csv = [cols.join(','), ...leads.map((l) => cols.map((c) => cell(l[c])).join(','))].join('\r\n')
    writeFileSync(r.filePath, '﻿' + csv, 'utf8')
    return r.filePath
  })
  ipcMain.handle('shell:open', (_e, url: string) => {
    if (/^https?:\/\//.test(url)) return shell.openExternal(url)
  })
  ipcMain.handle('shell:reveal', (_e, path: string) => shell.showItemInFolder(path))
}

app.whenReady().then(() => {
  loadStore()
  nativeTheme.themeSource = db.get().settings.theme
  registerIpc()
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('before-quit', () => { cancelAll(); flushNow() })
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
