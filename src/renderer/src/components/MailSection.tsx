import { useState } from 'react'
import { ArrowsClockwise, EnvelopeSimple, Key, PaperPlaneTilt } from '@phosphor-icons/react'
import { MAIL_PRESETS, type MailSettings } from '@shared/types'
import { useApp } from '../state'
import { Seg, Switch } from './ui'

/** Settings: connect a mailbox and set the sending rules. */
export function MailSection() {
  const { data, toast } = useApp()
  const m = data.settings.mail
  const st = data.mailStatus
  const setMail = (patch: Partial<MailSettings>) => window.lp.settings.update({ mail: { ...m, ...patch } })
  const [address, setAddress] = useState(m.address)
  const [fromName, setFromName] = useState(m.fromName)
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState<'' | 'test' | 'send'>('')
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [dnc, setDnc] = useState(m.doNotContact)
  const [optOut, setOptOut] = useState(m.optOutLine)
  const [custom, setCustom] = useState({ smtpHost: m.smtpHost, smtpPort: String(m.smtpPort), imapHost: m.imapHost, imapPort: String(m.imapPort) })

  const run = async (kind: 'test' | 'send') => {
    setBusy(kind)
    setResult(null)
    try {
      setResult(kind === 'test' ? await window.lp.mail.test() : await window.lp.mail.sendTest())
    } finally {
      setBusy('')
    }
  }
  const savePw = async () => {
    await window.lp.mail.setPassword(pw)
    setPw('')
    toast('App password saved and encrypted on this computer')
    run('test')
  }
  const help: Record<MailSettings['provider'], { label: string; url: string; text: string }> = {
    gmail: { label: 'Create a Google app password', url: 'https://myaccount.google.com/apppasswords', text: 'Gmail needs 2-step verification turned on, then an app password. Your normal password will not work.' },
    outlook: { label: 'Create a Microsoft app password', url: 'https://account.live.com/proofs/AppPassword', text: 'Outlook needs two-step verification and an app password. Some Microsoft 365 work accounts block this; an admin can allow it.' },
    other: { label: '', url: '', text: 'Use the SMTP and IMAP settings from your email provider.' }
  }
  const h = help[m.provider]
  const status = !m.address || !data.hasMailPassword ? 'Not connected' : st.connected ? 'Connected' : st.lastError ? 'Problem' : 'Not tested'
  const tone = status === 'Connected' ? 'pos' : status === 'Problem' ? 'warn' : ''

  return (
    <section>
      <h2 className="section-title">Email</h2>
      <div className="card">
        <div className="conn">
          <div className="conn-ic"><EnvelopeSimple size={20} /></div>
          <div style={{ minWidth: 0 }}>
            <b>{m.address || 'Your mailbox'}</b>
            <span>
              {m.address && data.hasMailPassword
                ? `${st.sentToday} of ${m.dailyLimit} sent today${st.lastCheck ? `, replies checked at ${new Date(st.lastCheck).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}`
                : 'Send sequences from your own address. Nothing goes out without your approval.'}
            </span>
          </div>
          <span className={`chip ${tone}`}><span className={`dot ${tone === 'pos' ? '' : tone ? 'warn' : 'idle'}`} />{status}</span>
        </div>

        <div className="set-row">
          <div>
            <b>Provider</b>
            <span>{h.text} {h.url && <button className="link-like" onClick={() => window.lp.shell.open(h.url)}>{h.label}</button>}</span>
          </div>
          <Seg
            label="Provider"
            value={m.provider}
            onChange={(v) => {
              setMail({ provider: v, ...MAIL_PRESETS[v] })
              setCustom({ smtpHost: MAIL_PRESETS[v].smtpHost, smtpPort: String(MAIL_PRESETS[v].smtpPort), imapHost: MAIL_PRESETS[v].imapHost, imapPort: String(MAIL_PRESETS[v].imapPort) })
            }}
            options={[{ value: 'gmail', label: 'Gmail' }, { value: 'outlook', label: 'Outlook' }, { value: 'other', label: 'Other' }]}
          />
        </div>

        {m.provider === 'other' && (
          <div className="set-row">
            <div><b>Servers</b><span>Port 465 uses SSL and 587 uses STARTTLS. Replies are read over IMAP, usually port 993.</span></div>
            <div className="ctl" style={{ flexWrap: 'wrap' }}>
              <input className="input" style={{ width: 170 }} placeholder="smtp.example.com" value={custom.smtpHost} onChange={(e) => setCustom({ ...custom, smtpHost: e.target.value })} aria-label="SMTP server" />
              <input className="input" style={{ width: 64 }} value={custom.smtpPort} onChange={(e) => setCustom({ ...custom, smtpPort: e.target.value })} aria-label="SMTP port" />
              <input className="input" style={{ width: 170 }} placeholder="imap.example.com" value={custom.imapHost} onChange={(e) => setCustom({ ...custom, imapHost: e.target.value })} aria-label="IMAP server" />
              <input className="input" style={{ width: 64 }} value={custom.imapPort} onChange={(e) => setCustom({ ...custom, imapPort: e.target.value })} aria-label="IMAP port" />
              <button className="btn btn-ghost" onClick={() => setMail({ smtpHost: custom.smtpHost.trim(), smtpPort: Number(custom.smtpPort) || 465, imapHost: custom.imapHost.trim(), imapPort: Number(custom.imapPort) || 993 })}>Save</button>
            </div>
          </div>
        )}

        <div className="set-row">
          <div><b>Email address</b><span>The address mail is sent from.</span></div>
          <input className="input" style={{ width: 260 }} type="email" value={address} placeholder="you@yourcompany.com" onChange={(e) => setAddress(e.target.value)} onBlur={() => address.trim() !== m.address && setMail({ address: address.trim() })} aria-label="Email address" />
        </div>
        <div className="set-row">
          <div><b>Sender name</b><span>Shown to recipients and used to sign the emails.</span></div>
          <input className="input" style={{ width: 260 }} value={fromName} placeholder={data.settings.senderName || 'Your name'} onChange={(e) => setFromName(e.target.value)} onBlur={() => fromName.trim() !== m.fromName && setMail({ fromName: fromName.trim() })} aria-label="Sender name" />
        </div>
        <div className="set-row">
          <div><b>App password</b><span>{data.hasMailPassword ? 'Saved, encrypted with your system keychain.' : 'Stored encrypted on this computer. Never your normal password.'}</span></div>
          <div className="ctl">
            {data.hasMailPassword ? (
              <button className="btn btn-danger" onClick={() => window.lp.mail.setPassword(null)}>Remove</button>
            ) : (
              <>
                <input className="input" type="password" style={{ width: 200 }} value={pw} placeholder="16-character app password" onChange={(e) => setPw(e.target.value)} aria-label="App password" />
                <button className="btn btn-primary" disabled={!pw.trim() || !m.address} onClick={savePw}><Key size={14} />Save</button>
              </>
            )}
          </div>
        </div>
        <div className="set-row">
          <div><b>Check the connection</b><span>Signs in for sending and for reading replies. The test email goes to your own address.</span></div>
          <div className="ctl">
            <button className="btn btn-ghost" disabled={!!busy || !data.hasMailPassword} onClick={() => run('test')}><ArrowsClockwise size={14} />{busy === 'test' ? 'Testing' : 'Test'}</button>
            <button className="btn btn-ghost" disabled={!!busy || !data.hasMailPassword} onClick={() => run('send')}><PaperPlaneTilt size={14} />{busy === 'send' ? 'Sending' : 'Send test email'}</button>
          </div>
        </div>
        {result && <div className={`inline-msg ${result.ok ? 'ok' : 'bad'}`}>{result.message}</div>}
        {!result && st.lastError && <div className="inline-msg bad">{st.lastError}</div>}

        <div className="set-row">
          <div><b>Daily limit</b><span>Keep new mailboxes low. 20 to 40 a day keeps you out of spam folders.</span></div>
          <Seg label="Daily limit" value={String(m.dailyLimit)} onChange={(v) => setMail({ dailyLimit: Number(v) })} options={['10', '20', '30', '50', '80'].map((v) => ({ value: v, label: v }))} />
        </div>
        <div className="set-row">
          <div><b>Sending hours</b><span>Mail waits for this window, in your computer's time zone. LeadPitch has to be open to send.</span></div>
          <div className="ctl">
            <select className="input" style={{ width: 92 }} value={m.startHour} onChange={(e) => setMail({ startHour: Number(e.target.value) })} aria-label="Start hour">
              {Array.from({ length: 24 }, (_, i) => <option key={i} value={i}>{String(i).padStart(2, '0')}:00</option>)}
            </select>
            <span className="muted">to</span>
            <select className="input" style={{ width: 92 }} value={m.endHour} onChange={(e) => setMail({ endHour: Number(e.target.value) })} aria-label="End hour">
              {Array.from({ length: 24 }, (_, i) => i + 1).map((i) => <option key={i} value={i}>{String(i).padStart(2, '0')}:00</option>)}
            </select>
            <span className="muted">Weekends</span>
            <Switch label="Send on weekends" checked={m.weekends} onChange={(v) => setMail({ weekends: v })} />
          </div>
        </div>
        <div className="set-row">
          <div><b>Follow-ups</b><span>Days after the first email. They are cancelled as soon as the lead replies.</span></div>
          <div className="ctl">
            <Seg label="First follow-up" value={String(m.followUpDays[0] ?? 3)} onChange={(v) => setMail({ followUpDays: [Number(v), Math.max(Number(v) + 1, m.followUpDays[1] ?? 7)] })} options={['2', '3', '4', '5'].map((v) => ({ value: v, label: `Day ${v}` }))} />
            <Seg label="Second follow-up" value={String(m.followUpDays[1] ?? 7)} onChange={(v) => setMail({ followUpDays: [m.followUpDays[0] ?? 3, Number(v)] })} options={['6', '7', '10', '14'].map((v) => ({ value: v, label: `Day ${v}` }))} />
          </div>
        </div>
        <div className="set-row">
          <div><b>Track replies and bounces</b><span>Reads your inbox every 5 minutes. A reply moves the lead to Replied and stops its follow-ups.</span></div>
          <Switch label="Track replies" checked={m.trackReplies} onChange={(v) => setMail({ trackReplies: v })} />
        </div>
        <div className="set-row" style={{ alignItems: 'start' }}>
          <div><b>Opt-out line</b><span>Added under every email. Many countries require it, and it protects your sender reputation.</span></div>
          <input className="input" style={{ width: 320 }} value={optOut} onChange={(e) => setOptOut(e.target.value)} onBlur={() => optOut !== m.optOutLine && setMail({ optOutLine: optOut.trim() })} aria-label="Opt-out line" />
        </div>
        <div className="set-row" style={{ alignItems: 'start' }}>
          <div><b>Do not contact</b><span>Emails or whole domains, one per line. LeadPitch never sends to them. Leads whose mail bounces are marked automatically.</span></div>
          <textarea className="input" rows={3} style={{ width: 320 }} value={dnc} placeholder={'name@company.com\ncompetitor.com'} onChange={(e) => setDnc(e.target.value)} onBlur={() => dnc !== m.doNotContact && setMail({ doNotContact: dnc })} aria-label="Do not contact" />
        </div>
      </div>
    </section>
  )
}
