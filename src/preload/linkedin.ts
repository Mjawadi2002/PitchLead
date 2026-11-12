import { contextBridge, ipcRenderer } from 'electron'

/** The small bar above LeadPitch's LinkedIn window. It only sends button presses to the main process. */
contextBridge.exposeInMainWorld('lnk', {
  onState: (cb: (s: unknown) => void) => ipcRenderer.on('lnk:state', (_e, s) => cb(s)),
  act: (name: 'copy' | 'insert' | 'sent' | 'unsent' | 'back' | 'target' | 'close') => ipcRenderer.send('lnk:act', name)
})
