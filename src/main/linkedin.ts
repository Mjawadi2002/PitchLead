import { BrowserWindow, WebContentsView, app, clipboard, ipcMain, nativeTheme, session, shell } from 'electron'
import { join } from 'path'
import type { Lead } from '@shared/types'
import { db, linkedinSentToday, linkedinState, save } from './store'

/**
 * LinkedIn from your own profile, in a LeadPitch window.
 *
 * You sign in to LinkedIn yourself, inside this window. The sign-in is stored only in LeadPitch's
 * own browser profile (partition below), not in your browser and not anywhere else on the computer.
 *
 * LeadPitch opens the right profile, puts the note on the clipboard or into the message box you
 * clicked, and you press Send. It never clicks Connect or Send for you: LinkedIn restricts accounts
 * that are driven by software, and a person pressing Send keeps your account safe.
 */

const PARTITION = 'persist:leadpitch-linkedin'
const BAR = 58
const HOME = 'https://www.linkedin.com/feed/'
const LOGIN = 'https://www.linkedin.com/login'

interface Target { leadId?: string; url: string; note: string }

let win: BrowserWindow | null = null
let view: WebContentsView | null = null
let target: Target | null = null
let notify: () => void = () => {}
let toast: (t: string) => void = () => {}
let lastAction = ''
/** Stage before "I sent it", so Undo can put it back. */
const stageBefore = new Map<string, Lead['stage']>()

const ses = () => session.fromPartition(PARTITION)

/** Electron's own user agent names Electron and LeadPitch; LinkedIn gets a plain Chrome one. */
function chromeUA(): string {
  return app.userAgentFallback.replace(/\s(Electron|leadpitch|LeadPitch)\/\S+/gi, '')
}

async function checkSignedIn(): Promise<boolean> {
  try {
    const c = await ses().cookies.get({ url: 'https://www.linkedin.com', name: 'li_at' })
    const now = Date.now() / 1000
    linkedinState.connected = c.some((x) => !x.expirationDate || x.expirationDate > now)
  } catch {
    linkedinState.connected = false
  }
  return linkedinState.connected
}

export function initLinkedin(opts: { notify: () => void; toast: (t: string) => void }): void {
  notify = opts.notify
  toast = opts.toast
  // Your system languages, so LinkedIn opens in your language before you sign in.
  ses().setUserAgent(chromeUA(), app.getPreferredSystemLanguages().join(',') || 'en-US')
  checkSignedIn().then(() => notify())
  ses().cookies.on('changed', (_e, cookie) => {
    if (cookie.name !== 'li_at') return
    const was = linkedinState.connected
    checkSignedIn().then((now) => {
      if (now === was) return
      notify()
      pushState()
      // Just signed in: go to the lead's profile, or the feed.
      if (now && view) view.webContents.loadURL(target?.url ?? HOME)
    })
  })
  ipcMain.on('lnk:act', (_e, name: string) => act(name))
}

/** Profile URL for a lead, or a people search for the decision maker at the company. */
export function linkedinUrlFor(lead: Lead): string {
  if (/linkedin\.com\/in\//i.test(lead.linkedin)) return lead.linkedin
  // A named person is the best search; otherwise the first role named ("Owner or manager" gives "Owner").
  const who = lead.contactName || (lead.decisionMaker || '').split(/[;(,/]|\s(?:or|and|ou|et)\s/i)[0].trim()
  const q = [who, lead.name].filter(Boolean).join(' ')
  return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(q)}`
}

export function linkedinNoteFor(lead: Lead): string {
  const d = db.get()
  const draft = d.drafts.filter((x) => x.leadId === lead.id && x.channel === 'linkedin').sort((a, b) => b.updatedAt - a.updatedAt)[0]
  return draft?.body?.trim() ?? ''
}

/** Opens LeadPitch's LinkedIn window, on a lead's profile or (without a lead) on the sign-in page or feed. */
export async function openLinkedin(leadId?: string): Promise<void> {
  const d = db.get()
  const lead = leadId ? d.leads.find((l) => l.id === leadId) : undefined
  if (leadId && !lead) throw new Error('This lead no longer exists.')
  if (lead && !lead.linkedinSentAt) {
    const sent = linkedinSentToday()
    if (sent >= d.settings.linkedin.dailyLimit) {
      throw new Error(`You have sent ${sent} LinkedIn notes today, your daily limit. LinkedIn restricts accounts that send many invitations in a day. Continue tomorrow, or raise the limit in Settings.`)
    }
  }
  target = lead ? { leadId: lead.id, url: linkedinUrlFor(lead), note: linkedinNoteFor(lead) } : null
  lastAction = ''
  const signedIn = await checkSignedIn()
  const url = signedIn ? (target?.url ?? HOME) : LOGIN

  if (win && !win.isDestroyed()) {
    view?.webContents.loadURL(url)
    pushState()
    if (win.isMinimized()) win.restore()
    win.focus()
    return
  }

  win = new BrowserWindow({
    width: 1180,
    height: 860,
    minWidth: 760,
    minHeight: 560,
    title: 'LinkedIn in LeadPitch',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#151619' : '#f6f6f8',
    autoHideMenuBar: true,
    show: false,
    webPreferences: { preload: join(__dirname, '../preload/linkedin.js'), contextIsolation: true, sandbox: false, nodeIntegration: false }
  })
  win.setMenuBarVisibility(false)
  view = new WebContentsView({ webPreferences: { partition: PARTITION, contextIsolation: true, sandbox: true, nodeIntegration: false } })
  win.contentView.addChildView(view)
  const layout = () => {
    if (!win || !view) return
    const [w, h] = win.getContentSize()
    view.setBounds({ x: 0, y: BAR, width: w, height: Math.max(0, h - BAR) })
  }
  win.on('resize', layout)
  win.on('closed', () => { win = null; view = null; target = null })
  // Links that leave LinkedIn open in the normal browser; LinkedIn pop-ups stay in this window.
  view.webContents.setWindowOpenHandler(({ url: u }) => {
    if (/^https:\/\/([a-z0-9-]+\.)*linkedin\.com\//i.test(u)) view?.webContents.loadURL(u)
    else if (/^https?:\/\//i.test(u)) shell.openExternal(u)
    return { action: 'deny' }
  })
  view.webContents.on('did-navigate', () => pushState())
  view.webContents.on('did-navigate-in-page', () => pushState())
  win.webContents.on('did-finish-load', () => pushState())
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(BAR_HTML))
  layout()
  view.webContents.loadURL(url)
  win.show()
}

export async function disconnectLinkedin(): Promise<void> {
  if (win && !win.isDestroyed()) win.close()
  await ses().clearStorageData()
  await ses().clearCache()
  linkedinState.connected = false
  notify()
}

function currentLead(): Lead | undefined {
  return target?.leadId ? db.get().leads.find((l) => l.id === target!.leadId) : undefined
}

function pushState(): void {
  if (!win || win.isDestroyed()) return
  const lead = currentLead()
  const s = db.get().settings
  win.webContents.send('lnk:state', {
    signedIn: linkedinState.connected,
    lead: lead ? { name: lead.name, who: lead.contactName || lead.decisionMaker || '', sentAt: lead.linkedinSentAt ?? 0, profile: /linkedin\.com\/in\//i.test(lead.linkedin) } : null,
    note: target?.note ?? '',
    sentToday: linkedinSentToday(),
    limit: s.linkedin.dailyLimit,
    canBack: !!view?.webContents.navigationHistory.canGoBack(),
    onTarget: !!target && !!view && view.webContents.getURL().split('?')[0] === target.url.split('?')[0],
    lastAction
  })
}

function act(name: string): void {
  const lead = currentLead()
  switch (name) {
    case 'copy':
      if (target?.note) { clipboard.writeText(target.note); lastAction = 'copied' }
      break
    case 'insert':
      // Types the note into whatever box is focused on the LinkedIn page, as if pasted. You still press Send.
      if (target?.note && view) {
        clipboard.writeText(target.note)
        view.webContents.focus()
        view.webContents.insertText(target.note)
        lastAction = 'inserted'
      }
      break
    case 'sent':
      if (lead) {
        const now = Date.now()
        lead.linkedinSentAt = now
        if (lead.stage === 'researched' || lead.stage === 'qualified') { stageBefore.set(lead.id, lead.stage); lead.stage = 'contacted'; lead.stageChangedAt = now }
        lead.updatedAt = now
        save()
        notify()
        toast(`${lead.name} marked as contacted on LinkedIn`)
        lastAction = 'sent'
      }
      break
    case 'unsent':
      if (lead) {
        delete lead.linkedinSentAt
        const prev = stageBefore.get(lead.id)
        if (prev && lead.stage === 'contacted') { lead.stage = prev; lead.stageChangedAt = Date.now() }
        stageBefore.delete(lead.id)
        lead.updatedAt = Date.now()
        save()
        notify()
        lastAction = ''
      }
      break
    case 'back':
      if (view?.webContents.navigationHistory.canGoBack()) view.webContents.navigationHistory.goBack()
      break
    case 'target':
      view?.webContents.loadURL(target?.url ?? HOME)
      break
    case 'close':
      win?.close()
      return
  }
  pushState()
}

/** The bar above the LinkedIn page, in LeadPitch's look. Plain HTML so it loads instantly. */
const BAR_HTML = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<style>
:root{--bg:#f6f6f8;--panel:#fff;--text:#16171d;--muted:#6b6e7b;--line:rgba(24,26,46,.09);--line2:rgba(24,26,46,.16);--accent:#3557e8;--ink:#fff;--soft:rgba(53,87,232,.1);--pos:#1b8049;--possoft:rgba(27,128,73,.11);--warn:#9a5b00}
@media (prefers-color-scheme:dark){:root{--bg:#151619;--panel:#1d1e22;--text:#ececf0;--muted:#9a9cab;--line:rgba(255,255,255,.075);--line2:rgba(255,255,255,.14);--accent:#3b5bea;--soft:rgba(124,149,255,.14);--pos:#4cc982;--possoft:rgba(76,201,130,.13);--warn:#e3a33b}}
*{box-sizing:border-box;margin:0}
html,body{height:${BAR}px;overflow:hidden;background:var(--bg);color:var(--text);font:13px/1.35 "Segoe UI Variable Text","Segoe UI",system-ui,-apple-system,sans-serif;-webkit-font-smoothing:antialiased;user-select:none}
.bar{height:${BAR}px;display:flex;align-items:center;gap:10px;padding:0 12px;border-bottom:1px solid var(--line)}
.who{min-width:0;flex:0 1 auto;max-width:260px}
.who b{display:block;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.who span{display:block;color:var(--muted);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.note{flex:1;min-width:0;height:36px;display:flex;align-items:center;gap:8px;padding:0 10px;border:1px solid var(--line);background:var(--panel);border-radius:9px}
.note p{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--text)}
.note p.empty{color:var(--muted)}
.count{color:var(--muted);font-variant-numeric:tabular-nums;font-size:12px;flex:none}
.count.over{color:var(--warn)}
button{font:inherit;height:32px;padding:0 12px;border-radius:8px;border:1px solid var(--line2);background:var(--panel);color:var(--text);cursor:pointer;white-space:nowrap;flex:none;transition:background .12s,border-color .12s,transform .08s}
button:hover{border-color:var(--accent)}
button:active{transform:scale(.97)}
button:disabled{opacity:.45;cursor:default;transform:none;border-color:var(--line2)}
button.primary{background:var(--accent);border-color:var(--accent);color:var(--ink);font-weight:600}
button.ghost{border-color:transparent;background:transparent;color:var(--muted);padding:0 8px}
button.ghost:hover{color:var(--text);background:var(--line)}
.done{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 10px;border-radius:8px;background:var(--possoft);color:var(--pos);font-weight:600;white-space:nowrap;flex:none}
.msg{flex:1;color:var(--muted)}
.msg b{color:var(--text);font-weight:600}
.flash{color:var(--pos);font-size:12px;white-space:nowrap;flex:none}
svg{width:15px;height:15px;display:block}
@media (max-width:980px){.who{max-width:160px}.hide-sm{display:none}}
</style></head><body><div class="bar" id="bar"></div>
<script>
const $ = (h) => { document.getElementById('bar').innerHTML = h }
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))
const back = '<svg viewBox="0 0 256 256" fill="currentColor"><path d="M224 128a8 8 0 0 1-8 8H59.3l58.4 58.3a8 8 0 0 1-11.4 11.4l-72-72a8 8 0 0 1 0-11.4l72-72a8 8 0 0 1 11.4 11.4L59.3 120H216a8 8 0 0 1 8 8Z"/></svg>'
const check = '<svg viewBox="0 0 256 256" fill="currentColor"><path d="M229.7 77.7l-128 128a8 8 0 0 1-11.4 0l-56-56a8 8 0 0 1 11.4-11.4L96 188.7 218.3 66.3a8 8 0 0 1 11.4 11.4Z"/></svg>'
const btn = (a, label, cls = '', dis = false, title = '') => '<button class="' + cls + '" ' + (dis ? 'disabled' : '') + ' title="' + esc(title) + '" onclick="lnk.act(\\'' + a + '\\')">' + label + '</button>'
window.lnk.onState((s) => {
  const nav = btn('back', back, 'ghost', !s.canBack, 'Back')
  if (!s.signedIn) {
    $(nav + '<div class="msg"><b>Sign in to LinkedIn below.</b> The sign-in stays in this LeadPitch window only. LeadPitch never sees your password.</div>' + btn('close', 'Close', 'ghost'))
    return
  }
  if (!s.lead) {
    $(nav + '<div class="msg"><b>LinkedIn is connected.</b> Open a lead and choose Message on LinkedIn to send a note from your profile.</div>' + btn('close', 'Done', 'primary'))
    return
  }
  const n = s.note.length
  const sent = s.lead.sentAt ? new Date(s.lead.sentAt) : null
  const flash = s.lastAction === 'copied' ? 'Copied. Paste with Ctrl V.' : s.lastAction === 'inserted' ? 'Added. Check it, then press Send.' : ''
  const sub = s.lead.who ? 'Note for ' + s.lead.who : (s.lead.profile ? 'Their profile' : 'People search')
  $(nav
    + '<div class="who"><b>' + esc(s.lead.name) + '</b><span>' + esc(sub) + ' · ' + s.sentToday + ' of ' + s.limit + ' today</span></div>'
    + '<div class="note" title="' + esc(s.note) + '">' + (n ? '<p>' + esc(s.note) + '</p><span class="count' + (n > 300 ? ' over' : '') + '">' + n + ' / 300</span>' : '<p class="empty">No LinkedIn note yet. Write one in Outreach, or type your own.</p>') + '</div>'
    + (flash ? '<span class="flash">' + flash + '</span>' : '')
    + (s.onTarget ? '' : btn('target', 'Their profile', 'hide-sm'))
    + btn('copy', 'Copy note', '', !n, 'Copy the note to the clipboard')
    + btn('insert', 'Add to message box', 'hide-sm', !n, 'Click into the LinkedIn message or note box first')
    + (sent ? '<span class="done">' + check + 'Sent ' + sent.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + '</span>' + btn('unsent', 'Undo', 'ghost') : btn('sent', 'I sent it', 'primary', false, 'Marks the lead as contacted'))
  )
})
</script></body></html>`
