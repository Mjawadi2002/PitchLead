import { contextBridge, ipcRenderer } from 'electron'
import type { ClaudeStatus, Draft, Lead, ResearchInput, Settings, Snapshot } from '@shared/types'

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
    exportCsv: (ids: string[]): Promise<string | null> => ipcRenderer.invoke('export:csv', ids)
  },
  drafts: {
    save: (d: Draft): Promise<void> => ipcRenderer.invoke('draft:save', d),
    generate: (o: { leadId: string; channel: Draft['channel']; lang: Draft['lang']; instruction?: string }): Promise<Draft> =>
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
export type LeadpitchApi = typeof api
