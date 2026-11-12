import { useCallback, useEffect, useState } from 'react'
import { ArrowSquareOut, ArrowsClockwise, Copy, Cpu, DownloadSimple, Key, Trash } from '@phosphor-icons/react'
import type { FallbackDetails, FallbackSettings, FreeProvider } from '@shared/types'
import { useApp } from '../state'
import { Seg } from './ui'

const clean = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** Settings: free open models through LeadPitch's own OmniRoute, for when the Claude limit is reached. */
export function FreeModelsSection() {
  const { data, toast } = useApp()
  const f = data.settings.fallback
  const setF = (patch: Partial<FallbackSettings>) => window.lp.settings.update({ fallback: { ...f, ...patch } })
  const [st, setSt] = useState<FallbackDetails | null>(null)
  const [list, setList] = useState<FreeProvider[]>([])
  const [busy, setBusy] = useState<'' | 'install' | 'add' | 'test' | 'remove' | 'uninstall'>('')
  const [msg, setMsg] = useState<{ ok: boolean; message: string } | null>(null)
  const [pick, setPick] = useState('groq')
  const [key, setKey] = useState('')
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [port, setPort] = useState(String(f.port))
  const [model, setModel] = useState(f.model)

  const refresh = useCallback(async () => setSt(await window.lp.free.status()), [])
  useEffect(() => {
    refresh()
    window.lp.free.providers().then(setList)
    const off = window.lp.free.onChange(refresh)
    // Install progress and the "in use" state change while this screen is open.
    const t = setInterval(refresh, 4000)
    return () => { off(); clearInterval(t) }
  }, [refresh])

  const go = async (kind: typeof busy, fn: () => Promise<unknown>) => {
    setBusy(kind)
    setMsg(null)
    try { await fn() } catch (e) { setMsg({ ok: false, message: clean(e) }) } finally { setBusy(''); refresh() }
  }

  const provider = list.find((p) => p.id === pick)
  const connected = st?.providers ?? []
  const status = !st ? { tone: '', text: 'Checking' }
    : !st.installed ? { tone: '', text: st.installing ? 'Installing' : 'Not installed' }
    : !connected.length ? { tone: 'warn', text: 'Add a provider' }
    : st.active ? { tone: 'warn', text: f.mode === 'always' ? 'In use' : 'In use now' }
    : f.mode === 'off' ? { tone: '', text: 'Off' }
    : { tone: 'pos', text: 'Ready' }

  return (
    <section>
      <h2 className="section-title">Free models</h2>
      <div className="card">
        <div className="conn">
          <div className="conn-ic"><Cpu size={20} /></div>
          <div style={{ minWidth: 0 }}>
            <b>Keep working when your Claude limit is reached</b>
            <span>
              {st?.active && st.activeUntil
                ? `Scoring and writing use free models until about ${new Date(st.activeUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. LeadPitch tries Claude again every 20 minutes.`
                : 'Scoring, emails and meeting briefs can switch to free open models through OmniRoute. Steps that search the web still need Claude.'}
            </span>
          </div>
          <span className={`chip ${status.tone}`}><span className={`dot ${status.tone === 'pos' ? '' : status.tone ? 'warn' : 'idle'}`} />{status.text}</span>
        </div>

        {st && !st.installed && (
          <>
            <div className="set-row">
              <div>
                <b>Install for LeadPitch only</b>
                <span>
                  Downloads OmniRoute (open source, about 900 MB) into LeadPitch's own folder. It runs only while LeadPitch is open, only on this computer,
                  and only LeadPitch uses it. Your Claude login is never sent to it.
                  {!st.nodeOk && <> It needs Node.js 22.22 or 24 and newer{st.nodeVersion ? `; this computer has ${st.nodeVersion}` : ''}. <button className="link-like" onClick={() => window.lp.shell.open('https://nodejs.org/en/download')}>Get Node.js</button></>}
                </span>
              </div>
              <div className="ctl">
                <button className="btn btn-primary" disabled={!!busy || st.installing || !st.nodeOk} onClick={() => go('install', async () => { await window.lp.free.install(); toast('Free models installed. Add a free provider to use them.') })}>
                  <DownloadSimple size={14} />{st.installing || busy === 'install' ? 'Installing' : 'Install'}
                </button>
              </div>
            </div>
            {(st.installing || busy === 'install') && <div className="inline-msg">{st.installLog || 'Starting the download'}. This takes a few minutes.</div>}
          </>
        )}

        {st?.installed && (
          <>
            <div className="set-row">
              <div><b>When to use them</b><span>{f.mode === 'always' ? 'Every task that does not need web search goes to free models, which saves your subscription. Results are less sharp than Claude\'s.' : f.mode === 'auto' ? 'Only after Claude says your limit is reached, until the window resets.' : 'LeadPitch uses only Claude. At the limit is the usual choice.'}</span></div>
              <Seg label="When to use free models" value={f.mode} onChange={(v) => setF({ mode: v })} options={[{ value: 'off', label: 'Off' }, { value: 'auto', label: 'At the limit' }, { value: 'always', label: 'Always' }]} />
            </div>

            {connected.map((c) => {
              const p = list.find((x) => x.id === c.id)
              return (
                <div className="set-row" key={c.id}>
                  <div style={{ minWidth: 0 }}><b>{p?.name ?? c.id}</b><span className="mono">{c.masked}</span></div>
                  <div className="ctl"><button className="btn btn-plain" disabled={!!busy} onClick={() => go('remove', () => window.lp.free.removeProvider(c.id))}>Remove</button></div>
                </div>
              )
            })}

            <div className="set-row">
              <div style={{ minWidth: 0 }}>
                <b>{connected.length ? 'Add another provider' : 'Connect a free provider'}</b>
                <span>
                  {provider?.note} Sign up, create a key, and paste it here. It stays in LeadPitch's free models folder on this computer.{' '}
                  {provider && <button className="link-like" onClick={() => window.lp.shell.open(provider.url)}>Get a free {provider.name} key</button>}
                </span>
              </div>
              <div className="ctl" style={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <select className="input" style={{ width: 170 }} value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Provider">
                  {list.map((p) => <option key={p.id} value={p.id}>{p.name}{connected.some((c) => c.id === p.id) ? ' (connected)' : ''}</option>)}
                </select>
                <input className="input" type="password" style={{ width: 190 }} value={key} placeholder="Paste the key" onChange={(e) => setKey(e.target.value)} aria-label="Provider key" />
                <button className="btn btn-primary" disabled={!key.trim() || !!busy} onClick={() => go('add', async () => { await window.lp.free.addProvider(pick, key); setKey(''); toast(`${provider?.name ?? 'Provider'} connected`) })}>
                  <Key size={14} />{busy === 'add' ? 'Adding' : 'Add'}
                </button>
              </div>
            </div>

            <div className="set-row">
              <div><b>Test</b><span>Sends a one-word prompt through a free model.{st.freeCalls ? ` ${st.freeCalls} free answers since LeadPitch opened.` : ''}</span></div>
              <div className="ctl">
                <button className="btn btn-ghost" disabled={!!busy || !connected.length} onClick={async () => { setBusy('test'); setMsg(await window.lp.free.test()); setBusy(''); refresh() }}>
                  <ArrowsClockwise size={14} />{busy === 'test' ? 'Testing' : 'Test'}
                </button>
              </div>
            </div>

            <details className="set-advanced">
              <summary>Advanced</summary>
              <div className="set-row">
                <div><b>Model</b><span>"auto" picks a working free model from your providers. You can name one instead, for example groq/llama-3.3-70b-versatile.</span></div>
                <div className="ctl">
                  <input className="input mono" style={{ width: 220 }} value={model} onChange={(e) => setModel(e.target.value)} onBlur={() => model.trim() && model.trim() !== f.model && setF({ model: model.trim() })} aria-label="Free model" />
                </div>
              </div>
              <div className="set-row">
                <div><b>Port</b><span>OmniRoute listens on 127.0.0.1 only. Change the port if another program uses it.</span></div>
                <input className="input num" style={{ width: 90 }} value={port} onChange={(e) => setPort(e.target.value.replace(/\D/g, ''))} onBlur={() => { const n = Number(port); if (n > 1024 && n < 65536 && n !== f.port) setF({ port: n }) }} aria-label="Port" />
              </div>
              <div className="set-row">
                <div style={{ minWidth: 0 }}>
                  <b>OmniRoute dashboard</b>
                  <span>Opens in your browser. Sign in with the password LeadPitch created for it.</span>
                </div>
                <div className="ctl">
                  {st.password && <button className="btn btn-plain" onClick={() => { navigator.clipboard.writeText(st.password!); toast('Dashboard password copied') }}><Copy size={14} />Copy password</button>}
                  <button className="btn btn-ghost" onClick={() => go('', () => window.lp.free.dashboard())}><ArrowSquareOut size={14} />Open</button>
                </div>
              </div>
              <div className="set-row">
                <div><b>Remove free models</b><span>Stops OmniRoute and deletes its folder and keys, freeing about 900 MB.</span></div>
                <div className="ctl">
                  {confirmRemove ? (
                    <>
                      <button className="btn btn-plain" onClick={() => setConfirmRemove(false)}>Keep</button>
                      <button className="btn btn-danger" disabled={!!busy} onClick={() => go('uninstall', async () => { await window.lp.free.uninstall(); setConfirmRemove(false); toast('Free models removed') })}><Trash size={14} />{busy === 'uninstall' ? 'Removing' : 'Remove'}</button>
                    </>
                  ) : (
                    <button className="btn btn-danger" onClick={() => setConfirmRemove(true)}><Trash size={14} />Remove</button>
                  )}
                </div>
              </div>
            </details>
          </>
        )}
        {(msg || st?.error) && <div className={`inline-msg ${msg?.ok ? 'ok' : 'bad'}`}>{msg?.message ?? st?.error}</div>}
      </div>
    </section>
  )
}
