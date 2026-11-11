import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowsClockwise, Check, Copy, PaperPlaneTilt, PencilSimpleLine, WarningCircle } from '@phosphor-icons/react'
import type { Channel, Draft, Lang } from '@shared/types'
import { useApp } from '../state'
import { Empty, Score, Seg, ShowMore, stageLabel } from '../components/ui'

const shortRole = (s: string) => s.split(/[;(]/)[0].trim()

const TWEAKS = ['Shorter', 'More formal', 'Warmer', 'Ask for a 15 minute call', 'Mention a free trial']

export function Outreach() {
  const { data, outreachLeadId, setOutreachLeadId, go, toast } = useApp()
  const [channel, setChannel] = useState<Channel>('email')
  const [lang, setLang] = useState<Lang>(data.settings.defaultLang)
  const [busy, setBusy] = useState(false)
  const [shown, setShown] = useState(30)
  const [error, setError] = useState<string | null>(null)

  const list = useMemo(
    () =>
      data.leads
        .filter((l) => l.stage !== 'won' && l.stage !== 'lost')
        .sort((a, b) => {
          const hasA = data.drafts.some((d) => d.leadId === a.id) ? 1 : 0
          const hasB = data.drafts.some((d) => d.leadId === b.id) ? 1 : 0
          return hasB - hasA || b.score - a.score
        }),
    [data.leads, data.drafts]
  )
  const lead = data.leads.find((l) => l.id === outreachLeadId) ?? list[0]
  const draft = lead && data.drafts.find((d) => d.leadId === lead.id && d.channel === channel && d.lang === lang)

  // Open on a channel and language that already has a draft for this lead.
  useEffect(() => {
    if (!lead || draft) return
    const any = data.drafts.filter((d) => d.leadId === lead.id).sort((a, b) => b.updatedAt - a.updatedAt)[0]
    if (any) { setChannel(any.channel); setLang(any.lang) }
  }, [lead?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const saveTimer = useRef<number>()
  useEffect(() => {
    setSubject(draft?.subject ?? '')
    setBody(draft?.body ?? '')
    setError(null)
  }, [draft?.id, draft?.updatedAt, lead?.id, channel, lang]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!lead) {
    return (
      <div className="view">
        <div className="vh"><div><h1>Outreach</h1></div></div>
        <div className="card">
          <Empty icon={<PaperPlaneTilt size={22} />} title="No one to write to yet" action={<button className="btn btn-primary" onClick={() => go('research')}>Start research</button>}>
            Once you have leads, Claude drafts a first message for each one from its research.
          </Empty>
        </div>
      </div>
    )
  }

  const persist = (s: string, b: string) => {
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      const d: Draft = { id: draft?.id ?? crypto.randomUUID(), leadId: lead.id, channel, lang, subject: s, body: b, updatedAt: Date.now() }
      window.lp.drafts.save(d)
    }, 500)
  }
  const generate = async (instruction?: string) => {
    setBusy(true)
    setError(null)
    try {
      await window.lp.drafts.generate({ leadId: lead.id, channel, lang, instruction })
    } catch (e) {
      setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    } finally {
      setBusy(false)
    }
  }
  const copy = async () => {
    const text = channel === 'email' && subject ? `${subject}\n\n${body}` : body
    try {
      await navigator.clipboard.writeText(text)
      toast('Copied. Paste it into your email or LinkedIn.')
    } catch {
      toast('Could not copy')
    }
  }
  const markContacted = () => {
    window.lp.leads.update(lead.id, { stage: 'contacted' })
    toast(`${lead.name} moved to Contacted`, { action: { label: 'Undo', run: () => window.lp.leads.update(lead.id, { stage: lead.stage }) } })
  }
  const auth = error?.startsWith('AUTH:')
  const chars = body.length

  return (
    <div className="view">
      <div className="vh">
        <div>
          <h1>Outreach</h1>
          <p>Claude writes a first message from each lead's research. Edit it, copy it, and send it from your own email or LinkedIn.</p>
        </div>
      </div>
      <div className="outreach">
        <div className="card drafts" role="list">
          {list.slice(0, Math.max(shown, list.findIndex((x) => x.id === outreachLeadId) + 1)).map((l) => {
            const has = data.drafts.some((d) => d.leadId === l.id)
            return (
              <button key={l.id} className="draft-item" aria-current={l.id === lead.id} onClick={() => setOutreachLeadId(l.id)}>
                <b>{l.name}</b>
                <Score value={l.score} />
                <span className="sub">{shortRole(l.decisionMaker) || 'Contact'} · {stageLabel(l.stage)}{has ? ' · Draft ready' : ''}</span>
              </button>
            )
          })}
          <ShowMore shown={shown} total={list.length} step={30} noun="leads" onMore={() => setShown((n) => n + 30)} />
        </div>

        <div className="card editor">
          <div className="editor-head">
            <Seg label="Channel" value={channel} onChange={setChannel} options={[{ value: 'email', label: 'Email' }, { value: 'linkedin', label: 'LinkedIn' }]} />
            <Seg label="Language" value={lang} onChange={setLang} options={[{ value: 'en', label: 'English' }, { value: 'fr', label: 'French' }, { value: 'ar', label: 'Arabic' }]} />
            <div className="actions">
              {draft && <button className="btn btn-ghost" disabled={busy} onClick={() => generate()}><ArrowsClockwise size={14} />Rewrite</button>}
              <button className="btn btn-primary" disabled={!body || busy} onClick={copy}><Copy size={14} />Copy</button>
            </div>
          </div>
          <div className="to"><span>To</span><b>{shortRole(lead.decisionMaker) || 'Decision maker'}, {lead.name}</b></div>

          {busy ? (
            <div className="msg-skel" aria-label="Writing">
              {channel === 'email' && <div className="skel" style={{ width: '45%', height: 14 }} />}
              {[92, 100, 86, 97, 60, 0, 94, 72].map((w, i) => <div key={i} className="skel" style={{ width: `${w}%`, opacity: w ? 1 : 0 }} />)}
            </div>
          ) : draft || body ? (
            <>
              {channel === 'email' && (
                <input className="subject" value={subject} placeholder="Subject" aria-label="Subject" dir={lang === 'ar' ? 'rtl' : 'ltr'}
                  onChange={(e) => { setSubject(e.target.value); persist(e.target.value, body) }} />
              )}
              <textarea className="msg" value={body} aria-label="Message" dir={lang === 'ar' ? 'rtl' : 'ltr'}
                onChange={(e) => { setBody(e.target.value); persist(subject, e.target.value) }} />
            </>
          ) : (
            <Empty icon={<PencilSimpleLine size={22} />} title={`No ${channel === 'email' ? 'email' : 'LinkedIn note'} yet`} action={
              <button className="btn btn-primary" onClick={() => generate()}>Write with Claude</button>}>
              Claude uses the signal, the value for them and the approach from this lead's research.
            </Empty>
          )}

          {error && (
            <div className="alert">
              <WarningCircle size={16} weight="fill" style={{ flex: 'none', marginTop: 1 }} />
              <div className="grow">{auth ? 'Claude needs you to sign in again.' : error}</div>
              {auth ? <button className="btn btn-ghost" onClick={() => window.lp.claude.signIn()}>Sign in</button> : <button className="btn btn-ghost" onClick={() => go('settings')}>Settings</button>}
            </div>
          )}

          {(draft || body) && !busy && (
            <div className="editor-foot">
              {TWEAKS.map((t) => <button key={t} className="tweak" onClick={() => generate(t)}>{t}</button>)}
              <span className="grow" />
              <span className={`muted num ${channel === 'linkedin' && chars > 300 ? 'warn' : ''}`} style={{ color: channel === 'linkedin' && chars > 300 ? 'var(--warn)' : undefined }}>
                {channel === 'linkedin' ? `${chars} / 300` : `${body.split(/\s+/).filter(Boolean).length} words`}
              </span>
              {(lead.stage === 'researched' || lead.stage === 'qualified') && (
                <button className="btn btn-ghost" onClick={markContacted}><Check size={14} />Mark as contacted</button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
