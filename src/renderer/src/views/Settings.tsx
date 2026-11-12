import { useState } from 'react'
import { ArrowsClockwise, Key, TerminalWindow } from '@phosphor-icons/react'
import type { Settings, TitlebarPrefs } from '@shared/types'
import { useApp } from '../state'
import { MailSection } from '../components/MailSection'
import { Logo, Meter, Seg, Switch, fmtTokens, mod, resetsIn, usagePercent } from '../components/ui'

export function SettingsView() {
  const { data, claude, refreshClaude, toast, showOnboarding, usage, refreshUsage } = useApp()
  const pct = usagePercent(usage)
  const s = data.settings
  const set = (patch: Partial<Settings>) => window.lp.settings.update(patch)
  const setTb = (patch: Partial<TitlebarPrefs>) => set({ titlebar: { ...s.titlebar, ...patch } })
  const [test, setTest] = useState<{ ok: boolean; auth?: boolean; message: string } | null>(null)
  const [testing, setTesting] = useState(false)
  const [key, setKey] = useState('')
  const [keyErr, setKeyErr] = useState<string | null>(null)
  const [name, setName] = useState(s.senderName)

  const runTest = async () => {
    setTesting(true)
    setTest(null)
    setTest(await window.lp.claude.test())
    setTesting(false)
    refreshClaude()
  }
  const saveKey = async () => {
    setKeyErr(null)
    try {
      await window.lp.settings.setApiKey(key)
      setKey('')
      toast('API key saved and encrypted on this computer')
    } catch (e) {
      setKeyErr((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
  }

  const sub = s.mode === 'apikey'
  const status = !claude
    ? { tone: '', text: 'Checking' }
    : !claude.found
      ? { tone: 'warn', text: 'Not found' }
      : claude.loggedIn
        ? { tone: 'pos', text: 'Connected' }
        : { tone: 'warn', text: sub ? 'No key' : 'Signed out' }

  return (
    <div className="view narrow">
      <div className="vh"><div><h1>Settings</h1></div></div>
      <div className="settings">
        <section>
          <h2 className="section-title">Claude</h2>
          <div className="card">
            <div className="conn">
              <div className="conn-ic"><TerminalWindow size={20} /></div>
              <div style={{ minWidth: 0 }}>
                <b>{claude?.found ? `Claude Code ${claude.version ?? ''}` : 'Claude Code'}</b>
                <span>
                  {!claude ? 'Checking this computer'
                    : !claude.found ? claude.error ?? 'Not installed'
                    : sub ? (data.hasApiKey ? 'Using your Anthropic API key' : 'Add an API key below')
                    : claude.loggedIn ? `Signed in as ${claude.email ?? 'you'}${claude.subscription ? ` · ${claude.subscription} plan` : ''}`
                    : 'Not signed in'}
                </span>
              </div>
              <span className={`chip ${status.tone}`}><span className={`dot ${status.tone === 'pos' ? '' : status.tone ? 'warn' : 'idle'}`} />{status.text}</span>
            </div>
            <div className="set-row">
              <div><b>Connect with</b><span>Your subscription is the default. An API key is billed per use by Anthropic.</span></div>
              <Seg label="Connect with" value={s.mode} onChange={(v) => { setTest(null); set({ mode: v }) }} options={[{ value: 'subscription', label: 'Claude subscription' }, { value: 'apikey', label: 'API key' }]} />
            </div>
            {!sub && claude?.found && (
              <div className="set-row">
                <div><b>Account</b><span>Opens a terminal running Claude Code sign in. Come back here when it says you are logged in.</span></div>
                <div className="ctl">
                  <button className="btn btn-ghost" onClick={() => { window.lp.claude.signIn(); toast('Finish signing in in the terminal window') }}>{claude.loggedIn ? 'Sign in again' : 'Sign in'}</button>
                </div>
              </div>
            )}
            {sub && (
              <div className="set-row">
                <div style={{ minWidth: 0 }}>
                  <b>Anthropic API key</b>
                  <span>{data.hasApiKey ? 'A key is saved, encrypted with your system keychain.' : 'Create one at console.anthropic.com. It is stored encrypted on this computer.'}</span>
                  {keyErr && <span style={{ color: 'var(--neg)' }}>{keyErr}</span>}
                </div>
                <div className="ctl">
                  {data.hasApiKey ? (
                    <button className="btn btn-danger" onClick={() => window.lp.settings.setApiKey(null)}>Remove key</button>
                  ) : (
                    <>
                      <input className="input" type="password" placeholder="sk-ant-..." value={key} onChange={(e) => setKey(e.target.value)} style={{ width: 200 }} aria-label="API key" />
                      <button className="btn btn-primary" disabled={!key.trim()} onClick={saveKey}><Key size={14} />Save</button>
                    </>
                  )}
                </div>
              </div>
            )}
            <div className="set-row">
              <div><b>Test connection</b><span>Sends a one-word prompt to check that Claude answers.</span></div>
              <div className="ctl"><button className="btn btn-ghost" disabled={testing || !claude?.found} onClick={runTest}><ArrowsClockwise size={14} />{testing ? 'Testing' : 'Test'}</button></div>
            </div>
            {test && (
              <div className={`inline-msg ${test.ok ? 'ok' : 'bad'}`}>
                {test.ok ? test.message : test.auth ? 'Your Claude session has expired. Use Sign in again, then test once more.' : test.message}
              </div>
            )}
            <div className="set-row">
              <div style={{ minWidth: 0 }}><b>Claude Code location</b><span className="mono" style={{ overflowWrap: 'anywhere' }}>{s.claudePath || claude?.path || 'Not found'}</span></div>
              <div className="ctl">
                {s.claudePath && <button className="btn btn-plain" onClick={() => set({ claudePath: '' })}>Find automatically</button>}
                <button className="btn btn-ghost" onClick={async () => { const p = await window.lp.dialog.claudePath(); if (p) set({ claudePath: p }) }}>Change</button>
              </div>
            </div>
            <div className="set-row">
              <div><b>Research model</b><span>Opus is the most thorough. Sonnet is faster and uses less of your limit.</span></div>
              <Seg label="Model" value={s.model} onChange={(v) => set({ model: v })} options={[{ value: 'opus', label: 'Opus' }, { value: 'sonnet', label: 'Sonnet' }]} />
            </div>
            <div className="set-row">
              <div><b>Parallel sessions</b><span>Runs larger than 15 leads split into batches. This many run at the same time: faster, but uses your limit faster.</span></div>
              <Seg label="Parallel sessions" value={String(s.parallel ?? 3)} onChange={(v) => set({ parallel: Number(v) })} options={['1', '2', '3', '4', '5'].map((v) => ({ value: v, label: v }))} />
            </div>
            <div className="set-row">
              <div><b>Web research</b><span>Lets Claude search the web and read company sites. Without it, results rely on what Claude already knows.</span></div>
              <Switch label="Web research" checked={s.webResearch} onChange={(v) => set({ webResearch: v })} />
            </div>
          </div>
        </section>

        <section>
          <h2 className="section-title">Claude usage<button className="more" onClick={refreshUsage}>Refresh</button></h2>
          <div className="card">
            {usage?.limitHit && (
              <div style={{ padding: '14px 18px 0' }}>
                <div className="alert"><div className="grow"><b>Claude reported a usage limit</b>{usage.limitHit.message}</div></div>
              </div>
            )}
            <div className="usage-now">
              <div className="row">
                <b>Current 5-hour window</b>
                <span className="muted">{usage?.current ? `resets in ${resetsIn(usage.current.end)}, at ${new Date(usage.current.end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'not started, it begins with your next Claude message'}</span>
                {pct !== null && <span className="num" style={{ marginLeft: 'auto', fontWeight: 600 }}>{pct}%</span>}
              </div>
              <Meter value={pct ?? 0} tone={usage?.limitHit ? 'neg' : (pct ?? 0) >= 85 ? 'warn' : ''} />
            </div>
            <div className="usage-grid">
              <div><span>This window</span><b className="num">{usage?.current ? fmtTokens(usage.current.tokens) : '0'}</b><span>tokens, {usage?.current?.messages ?? 0} replies</span></div>
              <div><span>LeadPitch share</span><b className="num">{usage?.current ? fmtTokens(usage.current.leadpitchTokens) : '0'}</b><span>tokens from research and drafts</span></div>
              <div><span>Last 7 days</span><b className="num">{fmtTokens(usage?.weekTokens ?? 0)}</b><span>tokens, {usage?.weekMessages ?? 0} replies</span></div>
            </div>
            <p className="usage-note">Counted from Claude Code on this computer, including your own Claude Code sessions. Anthropic does not publish exact plan limits, so 100% is your busiest 5-hour window in the last 30 days. When Claude reports a real limit, it shows here and in the title bar.</p>
          </div>
        </section>

        <MailSection />

        <section>
          <h2 className="section-title">Outreach</h2>
          <div className="card">
            <div className="set-row">
              <div><b>Your name</b><span>Used to sign the messages Claude drafts.</span></div>
              <input className="input" style={{ width: 220 }} value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name !== s.senderName && set({ senderName: name.trim() })} aria-label="Your name" />
            </div>
            <div className="set-row">
              <div><b>Default language</b><span>The language new drafts open in.</span></div>
              <Seg label="Default language" value={s.defaultLang} onChange={(v) => set({ defaultLang: v })} options={[{ value: 'en', label: 'English' }, { value: 'fr', label: 'French' }, { value: 'ar', label: 'Arabic' }]} />
            </div>
          </div>
        </section>

        <section>
          <h2 className="section-title">Appearance</h2>
          <div className="card">
            <div className="set-row">
              <div><b>Theme</b><span>Follows your system unless you choose one.</span></div>
              <Seg label="Theme" value={s.theme} onChange={(v) => set({ theme: v })} options={[{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} />
            </div>
            <div className="set-row">
              <div><b>Sidebar</b><span>Collapse it to icons with {mod()}+\.</span></div>
              <Switch label="Collapse sidebar" checked={s.sidebarCollapsed} onChange={(v) => set({ sidebarCollapsed: v })} />
            </div>
            <div className="set-row">
              <div><b>Window controls</b><span>Close, minimize and maximize buttons in the title bar.</span></div>
              <Seg label="Window controls" value={s.titlebar.controls} onChange={(v) => setTb({ controls: v })} options={[{ value: 'win', label: 'Windows' }, { value: 'mac', label: 'macOS' }]} />
            </div>
            <div className="set-row">
              <div><b>Title bar height</b></div>
              <Seg label="Title bar height" value={s.titlebar.density} onChange={(v) => setTb({ density: v })} options={[{ value: 'compact', label: 'Compact' }, { value: 'regular', label: 'Regular' }]} />
            </div>
            <div className="set-row">
              <div><b>Title bar material</b></div>
              <Seg label="Title bar material" value={s.titlebar.material} onChange={(v) => setTb({ material: v })} options={[{ value: 'glass', label: 'Translucent' }, { value: 'solid', label: 'Solid' }]} />
            </div>
            <div className="set-row">
              <div><b>Title bar items</b><span>Search, research status, Claude status and the New research button.</span></div>
              <div className="ctl" style={{ flexWrap: 'wrap' }}>
                {([['search', 'Search'], ['run', 'Status'], ['claude', 'Claude'], ['newBtn', 'New']] as const).map(([k, label]) => (
                  <button key={k} className="filter" aria-pressed={s.titlebar[k]} onClick={() => setTb({ [k]: !s.titlebar[k] })}>{label}</button>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section>
          <h2 className="section-title">Keyboard</h2>
          <div className="card">
            {[
              [`${mod()} K`, 'Search leads and commands'],
              [`${mod()} N`, 'New research'],
              [`${mod()} Enter`, 'Start research from the form'],
              [`${mod()} 1 to 6`, 'Switch views'],
              [`${mod()} \\`, 'Collapse or expand the sidebar'],
              ['J and K', 'Move through leads'],
              ['S', 'Star the open lead'],
              ['X', 'Select the open lead'],
              ['Esc', 'Close the open panel']
            ].map(([k, d]) => (
              <div className="set-row" key={k} style={{ padding: '9px 18px' }}><span>{d}</span><span className="kbd">{k}</span></div>
            ))}
          </div>
        </section>

        <div className="card about">
          <Logo size={56} />
          <div style={{ flex: 1 }}>
            <b style={{ fontWeight: 600, fontSize: 15 }}>Lead<span className="brand-p">Pitch</span> 0.1</b>
            <p>Built on the Lead Research Assistant skill from ComposioHQ's awesome-claude-skills (Apache 2.0). Your leads are stored only on this computer.</p>
          </div>
          <button className="btn btn-ghost" onClick={showOnboarding}>Setup guide</button>
        </div>
      </div>
    </div>
  )
}
