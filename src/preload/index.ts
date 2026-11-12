import { contextBridge, ipcRenderer } from 'electron'
import type { ClaudeStatus, Draft, FallbackDetails, FreeProvider, Lang, Lead, MemoryStats, Project, ResearchInput, Settings, Snapshot, UsageReport } from '@shared/types'

const api = {
  platform: process.platform,
  win: {
    minimize: () => ipcRenderer.send('win:min'),
    toggleMaximize: () => ipcRenderer.send('win:max'),
    close: () => ipcRenderer.send('win:close'),
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke('win:isMax'),
    onMaximized: (cb: (v: boolean) => void) => {
      const h = (_: unknown, v: boolean) => cb(v)
      ipcRenderer.on('win:maximized', h)
      return () => { ipcRenderer.removeListener('win:maximized', h) }
    }
  },
  data: {
    get: (): Promise<Snapshot> => ipcRenderer.invoke('snapshot:get'),
    onChange: (cb: (s: Snapshot) => void) => {
      const h = (_: unknown, s: Snapshot) => cb(s)
      ipcRenderer.on('snapshot', h)
      return () => { ipcRenderer.removeListener('snapshot', h) }
    }
  },
  leads: {
    update: (id: string, patch: Partial<Lead>): Promise<void> => ipcRenderer.invoke('lead:update', id, patch),
    add: (partial: Partial<Lead>): Promise<string> => ipcRenderer.invoke('lead:add', partial),
    remove: (ids: string[]): Promise<void> => ipcRenderer.invoke('lead:delete', ids),
    exportCsv: (ids: string[], format: 'full' | 'outreach' = 'full'): Promise<string | null> => ipcRenderer.invoke('export:csv', ids, format),
    deepen: (id: string): Promise<void> => ipcRenderer.invoke('lead:deepen', id),
    meeting: (id: string): Promise<void> => ipcRenderer.invoke('lead:meeting', id),
    findContact: (ids: string[]): Promise<{ found: number; failed: string }> => ipcRenderer.invoke('lead:findContact', ids)
  },
  drafts: {
    sequence: (o: { leadId: string; lang: Lang }): Promise<void> => ipcRenderer.invoke('draft:sequence', o),
    save: (d: Draft): Promise<void> => ipcRenderer.invoke('draft:save', d),
    generate: (o: { leadId: string; channel: Draft['channel']; lang: Draft['lang']; instruction?: string; step?: number }): Promise<Draft> =>
      ipcRenderer.invoke('draft:generate', o)
  },
  research: {
    start: (input: ResearchInput): Promise<string> => ipcRenderer.invoke('run:start', input),
    cancel: (id: string): Promise<void> => ipcRenderer.invoke('run:cancel', id),
    remove: (id: string): Promise<void> => ipcRenderer.invoke('run:delete', id)
  },
  settings: {
    update: (patch: Partial<Settings>): Promise<Settings> => ipcRenderer.invoke('settings:update', patch),
    setApiKey: (key: string | null): Promise<void> => ipcRenderer.invoke('apikey:set', key)
  },
  projects: {
    create: (p: Omit<Project, 'id' | 'createdAt' | 'color'>): Promise<string> => ipcRenderer.invoke('project:create', p),
    update: (id: string, patch: Partial<Project>): Promise<void> => ipcRenderer.invoke('project:update', id, patch),
    remove: (id: string): Promise<void> => ipcRenderer.invoke('project:delete', id)
  },
  mail: {
    setPassword: (pw: string | null): Promise<void> => ipcRenderer.invoke('mail:setPassword', pw),
    test: (): Promise<{ ok: boolean; message: string }> => ipcRenderer.invoke('mail:test'),
    sendTest: (): Promise<{ ok: boolean; message: string }> => ipcRenderer.invoke('mail:sendTest'),
    queue: (o: { leadId: string; lang: Lang; steps: { subject: string; body: string }[]; sendNow?: boolean }): Promise<{ queued: number }> => ipcRenderer.invoke('mail:queue', o),
    cancel: (ids: string[]): Promise<void> => ipcRenderer.invoke('mail:cancel', ids),
    checkReplies: (): Promise<{ replies: number; bounces: number }> => ipcRenderer.invoke('mail:checkReplies')
  },
  onToast: (cb: (text: string) => void) => {
    const h = (_: unknown, t: string) => cb(t)
    ipcRenderer.on('toast', h)
    return () => { ipcRenderer.removeListener('toast', h) }
  },
  usage: {
    get: (): Promise<UsageReport> => ipcRenderer.invoke('usage:get')
  },
  memory: {
    stats: (): Promise<MemoryStats> => ipcRenderer.invoke('memory:stats'),
    clear: (): Promise<MemoryStats> => ipcRenderer.invoke('memory:clear')
  },
  free: {
    status: (): Promise<FallbackDetails> => ipcRenderer.invoke('fallback:status'),
    providers: (): Promise<FreeProvider[]> => ipcRenderer.invoke('fallback:providers'),
    install: (): Promise<FallbackDetails> => ipcRenderer.invoke('fallback:install'),
    uninstall: (): Promise<FallbackDetails> => ipcRenderer.invoke('fallback:uninstall'),
    addProvider: (id: string, key: string): Promise<FallbackDetails> => ipcRenderer.invoke('fallback:addProvider', id, key),
    removeProvider: (id: string): Promise<FallbackDetails> => ipcRenderer.invoke('fallback:removeProvider', id),
    test: (): Promise<{ ok: boolean; message: string }> => ipcRenderer.invoke('fallback:test'),
    dashboard: (): Promise<void> => ipcRenderer.invoke('fallback:dashboard'),
    onChange: (cb: () => void) => {
      const h = () => cb()
      ipcRenderer.on('fallback:changed', h)
      return () => { ipcRenderer.removeListener('fallback:changed', h) }
    }
  },
  linkedin: {
    open: (leadId?: string): Promise<void> => ipcRenderer.invoke('linkedin:open', leadId),
    disconnect: (): Promise<void> => ipcRenderer.invoke('linkedin:disconnect')
  },
  claude: {
    status: (): Promise<ClaudeStatus> => ipcRenderer.invoke('claude:status'),
    signIn: (): Promise<void> => ipcRenderer.invoke('claude:signin'),
    test: (): Promise<{ ok: boolean; auth?: boolean; message: string }> => ipcRenderer.invoke('claude:test')
  },
  dialog: {
    folder: (): Promise<string | null> => ipcRenderer.invoke('dialog:folder'),
    claudePath: (): Promise<string | null> => ipcRenderer.invoke('dialog:claude')
  },
  shell: {
    open: (url: string): Promise<void> => ipcRenderer.invoke('shell:open', url),
    reveal: (path: string): Promise<void> => ipcRenderer.invoke('shell:reveal', path)
  }
}

contextBridge.exposeInMainWorld('lp', api)
export type LeadPitchApi = typeof api
